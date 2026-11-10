#!/usr/bin/env bash
# ==============================================================================
# Teardown Landing Zone Resources
# Safely destroys resources created by the landing zone deployment.
#
# Usage:
#   ./scripts/teardown.sh --tool terraform --env prod
#   ./scripts/teardown.sh --tool bicep --env nonprod --yes
#
# This script:
#   1. Shows what will be destroyed
#   2. Asks for confirmation (unless --yes is passed)
#   3. Removes resources in the correct order
#   4. Optionally removes the Terraform state backend
# ==============================================================================
set -euo pipefail

TOOL=""
ENV=""
AUTO_APPROVE=false
REMOVE_BACKEND=false
INCLUDE_SUBSCRIPTION_SETTINGS=false
INCLUDE_MANAGEMENT_GROUP=false
RESET_DEFENDER_PLANS=false

usage() {
  cat <<EOF
Usage: $0 --tool <terraform|bicep> --env <prod|nonprod> [--company <name>] [--yes] [--remove-backend]

Options:
  --tool             Deployment tool used (terraform or bicep)
  --env              Environment to tear down (prod or nonprod)
  --company          Company name used in resource naming (required for Bicep teardown)
  --yes              Skip confirmation prompt
  --remove-backend   Also remove Terraform state backend (storage account + lock)
  --include-subscription-settings
                     Also delete leftovers from either tool: baseline resource groups, exact-named
                     policy assignments (and their role assignments), diagnostic setting, budget and
                     security contact. Requires --company. Do not use on a subscription shared with
                     other workloads. Defender plans stay unless you add --reset-defender-plans.
  --include-management-group
                     Also move the subscriptions in mg-<company> back to the Tenant Root Group and
                     delete the group. Requires --company. Run it only after tearing down both
                     prod and nonprod, because the group is shared.
  --reset-defender-plans
                     Also set the Defender for Cloud plans this project manages back to Free on the
                     current subscription (VirtualMachines, Containers, SqlServers,
                     OpenSourceRelationalDatabases, KeyVaults, Arm, StorageAccounts). This removes
                     protection and its billing, even if the plan was enabled before the deploy.
  --help             Show this help

Examples:
  $0 --tool terraform --env nonprod
  $0 --tool bicep --env prod --company mycompany --yes
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool) TOOL="$2"; shift 2 ;;
    --env) ENV="$2"; shift 2 ;;
    --yes) AUTO_APPROVE=true; shift ;;
    --remove-backend) REMOVE_BACKEND=true; shift ;;
    --include-subscription-settings) INCLUDE_SUBSCRIPTION_SETTINGS=true; shift ;;
    --include-management-group) INCLUDE_MANAGEMENT_GROUP=true; shift ;;
    --reset-defender-plans) RESET_DEFENDER_PLANS=true; shift ;;
    --company) COMPANY="$2"; shift 2 ;;
    --help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$TOOL" || -z "$ENV" ]]; then
  echo "Error: --tool and --env are required."
  usage
fi

if [[ "$TOOL" != "terraform" && "$TOOL" != "bicep" ]]; then
  echo "Error: --tool must be 'terraform' or 'bicep'."
  exit 1
fi

if [[ "$ENV" != "prod" && "$ENV" != "nonprod" ]]; then
  echo "Error: --env must be 'prod' or 'nonprod'."
  exit 1
fi

if [[ "$INCLUDE_SUBSCRIPTION_SETTINGS" == "true" ]] && ! [[ "${COMPANY:-}" =~ ^[A-Za-z][A-Za-z0-9-]*$ ]]; then
  echo "Error: --include-subscription-settings requires --company with the same company identifier used at deploy time (letters, digits, hyphens)."
  exit 1
fi

if [[ "$INCLUDE_MANAGEMENT_GROUP" == "true" ]] && ! [[ "${COMPANY:-}" =~ ^[A-Za-z][A-Za-z0-9-]*$ ]]; then
  echo "Error: --include-management-group requires --company with the same company identifier used at deploy time."
  exit 1
fi

if [[ "$TOOL" == "bicep" ]] && ! [[ "${COMPANY:-}" =~ ^[A-Za-z][A-Za-z0-9-]*$ ]]; then
  echo "Error: Bicep teardown requires --company with the same company identifier used at deploy time (letters, digits, hyphens)."
  exit 1
fi

cleanup_management_group() {
  local mg="mg-${COMPANY}"
  if ! az account management-group show --name "$mg" &>/dev/null; then
    echo "Management group $mg not found. Nothing to delete."
    return
  fi
  echo "Removing management group $mg..."
  local children subs sub
  children=$(az account management-group show --name "$mg" --expand --query "children[?type=='Microsoft.Management/managementGroups'].name" -o tsv | tr -d '\r')
  if [[ -n "$children" ]]; then
    echo "$mg has child management groups ($children). Delete them first. Skipping."
    return
  fi
  subs=$(az account management-group show --name "$mg" --expand --query "children[].name" -o tsv | tr -d '\r')
  for sub in $subs; do
    echo "Moving subscription $sub to the Tenant Root Group..."
    az account management-group subscription remove --name "$mg" --subscription "$sub" || true
  done
  if az account management-group delete --name "$mg"; then
    echo "Deleted $mg."
  else
    echo "Could not delete $mg. Check that it is empty and that you have access at the root scope."
  fi
}

reset_defender_plans() {
  local plan tier
  echo "Setting Defender for Cloud plans back to Free on this subscription..."
  for plan in VirtualMachines Containers SqlServers OpenSourceRelationalDatabases KeyVaults Arm StorageAccounts; do
    tier=$(az security pricing show --name "$plan" --query pricingTier -o tsv 2>/dev/null | tr -d '\r')
    if [[ "$tier" == "Standard" ]]; then
      if az security pricing create --name "$plan" --tier Free -o none; then
        echo "  $plan: Free"
      else
        echo "  $plan: could not change"
      fi
    else
      echo "  $plan: already ${tier:-Free}"
    fi
  done
}

echo "=== Landing Zone Teardown ==="
echo "  Tool:        $TOOL"
echo "  Environment: $ENV"
echo ""

# Safety check: ensure we're authenticated
if ! az account show &>/dev/null; then
  echo "Error: Not logged in to Azure. Run: az login"
  exit 1
fi

SUBSCRIPTION=$(az account show --query "name" -o tsv)
echo "  Subscription: $SUBSCRIPTION"
echo ""

if [[ "$AUTO_APPROVE" != "true" ]]; then
  echo "WARNING: This will permanently destroy all landing zone resources in the $ENV environment."
  echo ""
  read -r -p "Type '$ENV' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "$ENV" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

cleanup_subscription_settings() {
  local SUB_ID SCOPE NAME PRINCIPAL RA RGS_LEFT
  SUB_ID=$(az account show --query id -o tsv)
  SCOPE="/subscriptions/${SUB_ID}"
  echo ""
  echo "=== Removing leftover baseline settings (${SCOPE}) ==="
  # Catches items created by the other tool or left outside Terraform state.
  RGS_LEFT=$(az group list --query "[?name=='rg-${COMPANY}-${ENV}-monitoring' || name=='rg-${COMPANY}-${ENV}-networking'].name" -o tsv)
  for NAME in $RGS_LEFT; do
    echo "Deleting leftover resource group $NAME"
    az group delete --name "$NAME" --yes --no-wait
  done
  for NAME in mcsb-audit allowed-locations allowed-locations-rg require-env-tag-rg require-team-tag-rg inherit-env-tag inherit-team-tag activity-log-diag; do
    if az policy assignment show --name "$NAME" --scope "$SCOPE" &>/dev/null; then
      PRINCIPAL=$(az policy assignment show --name "$NAME" --scope "$SCOPE" --query identity.principalId -o tsv 2>/dev/null || true)
      # Remove the managed identity's role assignments before the policy; they are not deleted with it.
      if [[ -n "$PRINCIPAL" && "$PRINCIPAL" != "None" ]]; then
        for RA in $(az role assignment list --assignee "$PRINCIPAL" --scope "$SCOPE" --query "[].id" -o tsv 2>/dev/null || true); do
          echo "Deleting role assignment $RA"
          az role assignment delete --ids "$RA" || true
        done
      fi
      echo "Deleting policy assignment $NAME"
      az policy assignment delete --name "$NAME" --scope "$SCOPE" || true
    fi
  done
  # Orphans from earlier runs (policy identities that were deleted) make the next Bicep deploy fail
  # with RoleAssignmentUpdateNotPermitted. Only subscription-scope assignments of the baseline roles
  # whose principal no longer exists are removed.
  for RA in $(az role assignment list --scope "$SCOPE" --query "[?scope=='${SCOPE}' && principalType=='ServicePrincipal' && (roleDefinitionName=='Tag Contributor' || roleDefinitionName=='Monitoring Contributor' || roleDefinitionName=='Log Analytics Contributor')].id" -o tsv 2>/dev/null || true); do
    PRINCIPAL=$(az role assignment show --ids "$RA" --query principalId -o tsv 2>/dev/null || true)
    SP_TYPE=$(az ad sp show --id "$PRINCIPAL" --query servicePrincipalType -o tsv 2>&1 || true)
    if [[ "$SP_TYPE" == *"does not exist"* || "$SP_TYPE" == *ResourceNotFound* ]]; then
      echo "Deleting orphaned role assignment $RA"
      az role assignment delete --ids "$RA" || true
    fi
  done
  az monitor diagnostic-settings subscription delete --name diag-activity-log-to-law --subscription "$SUB_ID" --yes 2>/dev/null </dev/null || true
  az consumption budget delete --budget-name "budget-${COMPANY}-${ENV}-monthly" --subscription "$SUB_ID" 2>/dev/null || true
  az security contact delete --name default --yes 2>/dev/null </dev/null || true
  echo "Left in place: Defender for Cloud plans. Restore them from your pre-deployment inventory."
}

if [[ "$TOOL" == "terraform" ]]; then
  echo ""
  echo "=== Running Terraform Destroy ==="
  TF_DIR="infra/terraform"

  if [[ ! -d "$TF_DIR" ]]; then
    echo "Error: $TF_DIR not found. Run from the repository root."
    exit 1
  fi

  # Set budget start date to avoid validation errors during destroy
  export TF_VAR_budget_start_date
  TF_VAR_budget_start_date="$(date -u +%Y-%m-01T00:00:00Z)"

  cd "$TF_DIR"

  # terraform.tfvars must exist — it provides required variables
  # (subscription_id, company_name, budget_alert_emails, security_contact_email).
  if [[ ! -f "terraform.tfvars" ]]; then
    echo "Error: terraform.tfvars not found in $TF_DIR."
    echo "This file is required for destroy — it provides subscription_id, company_name, and other required variables."
    echo "Create it from the example: cp terraform.tfvars.example terraform.tfvars"
    exit 1
  fi

  terraform init

  # The Defender workspace association has prevent_destroy and would block the destroy.
  # Forget it in state only (no Azure change); the full cleanup is opt-in.
  if [[ "$INCLUDE_SUBSCRIPTION_SETTINGS" == "true" ]] && terraform state list 2>/dev/null | grep -qF 'azurerm_security_center_workspace.defender'; then
    echo "Removing the prevent_destroy Defender workspace association from Terraform state (Azure unchanged)."
    terraform state rm 'azurerm_security_center_workspace.defender[0]'
  fi

  terraform destroy \
    -var="environment=$ENV" \
    $( [[ "$AUTO_APPROVE" == "true" ]] && echo "-auto-approve" )

  echo ""
  echo "Terraform destroy complete."

  if [[ "$INCLUDE_SUBSCRIPTION_SETTINGS" == "true" ]]; then
    cleanup_subscription_settings
  fi

  if [[ "$REMOVE_BACKEND" == "true" ]]; then
    echo ""
    echo "=== Removing Terraform State Backend ==="
    RG="rg-terraform-state"
    if az group show --name "$RG" &>/dev/null; then
      # Remove the lock first
      LOCK_ID=$(az lock list --resource-group "$RG" --query "[0].id" -o tsv 2>/dev/null || true)
      if [[ -n "$LOCK_ID" ]]; then
        echo "Removing delete lock..."
        az lock delete --ids "$LOCK_ID"
      fi
      echo "Deleting resource group $RG..."
      az group delete --name "$RG" --yes --no-wait
      echo "Backend removal initiated (runs in background)."
    else
      echo "Backend resource group $RG not found — already removed."
    fi
  fi

elif [[ "$TOOL" == "bicep" ]]; then
  echo ""
  echo "=== Removing Bicep Resources ==="
  echo ""
  echo "Bicep deployments are incremental and don't support native teardown."
  echo "Removing resource groups created by the landing zone..."
  echo ""

  # Match only the two groups defined by the baseline, not neighboring environments or workloads.
  RGS=$(az group list --query "[?name=='rg-${COMPANY}-${ENV}-monitoring' || name=='rg-${COMPANY}-${ENV}-networking'].name" -o tsv)

  if [[ -z "$RGS" ]]; then
    echo "No matching resource groups found for environment: $ENV"
    echo "Expected groups: rg-${COMPANY}-${ENV}-monitoring and rg-${COMPANY}-${ENV}-networking"
  else
    echo "Resource groups to delete:"
    echo "$RGS" | while read -r rg; do echo "  - $rg"; done
    echo ""

    if [[ "$AUTO_APPROVE" != "true" ]]; then
      read -r -p "Proceed with deletion? (y/N): " CONFIRM_RG
      if [[ "$CONFIRM_RG" != "y" && "$CONFIRM_RG" != "Y" ]]; then
        echo "Aborted."
        exit 1
      fi
    fi

    echo "$RGS" | while read -r rg; do
      echo "Deleting $rg..."
      az group delete --name "$rg" --yes --no-wait
    done

    echo ""
    echo "Resource group deletions initiated (running in background)."
    echo "Monitor progress: az group list --query \"[?starts_with(name, 'rg-') && contains(name, '-${ENV}')].{name:name, state:properties.provisioningState}\" -o table"
  fi

  if [[ "$INCLUDE_SUBSCRIPTION_SETTINGS" == "true" ]]; then
    cleanup_subscription_settings
  fi

  echo ""
  echo "NOTE: Subscription-level resources (policies, Defender plans, diagnostic settings,"
  echo "budgets, role assignments) are not removed by deleting resource groups."
  echo "Use your pre-deployment inventory to restore shared settings and remove only owned IDs."
  echo ""
  echo "  # Policy assignments: inventory each exact ID and managed-identity principalId first."
  echo "  # Delete only assignments newly created by this deployment; restore any modified assignments."
  echo ""
  echo "  # Orphaned role assignments from DINE/Modify policy managed identities"
  echo "  # These are NOT automatically deleted when policies are removed."
  echo "  # Failing to remove them causes RoleAssignmentUpdateNotPermitted on redeploy."
  echo "  # Capture each deployed policy's principalId BEFORE deleting that policy."
  echo "  # Remove only exact role-assignment IDs whose principalId and scope match that inventory."
  echo "  # Never delete subscription role assignments by role name alone."
  echo ""
  echo "  # Diagnostic setting"
  echo "  # Delete only the exact diagnostic-setting ID captured in the deployment inventory."
  echo ""
  echo "  # Security contact"
  echo "  # Restore the prior security contact from your pre-deployment inventory."
  echo ""
  echo "  # Budget"
  echo "  az consumption budget delete --budget-name budget-\${COMPANY:-<company>}-${ENV}-monthly"
  echo ""
  echo "  # Restore prior Defender plan settings from your pre-deployment inventory."
  echo "  # Do not reset shared subscription plans to Free without checking their prior state."
fi

if [[ "$RESET_DEFENDER_PLANS" == "true" ]]; then
  reset_defender_plans
fi

if [[ "$INCLUDE_MANAGEMENT_GROUP" == "true" ]]; then
  cleanup_management_group
fi

echo ""
echo "=== Teardown Complete ==="
