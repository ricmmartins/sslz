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

usage() {
  cat <<EOF
Usage: $0 --tool <terraform|bicep> --env <prod|nonprod> [--company <name>] [--yes] [--remove-backend]

Options:
  --tool             Deployment tool used (terraform or bicep)
  --env              Environment to tear down (prod or nonprod)
  --company          Company name used in resource naming (narrows RG matching for Bicep teardown)
  --yes              Skip confirmation prompt
  --remove-backend   Also remove Terraform state backend (storage account + lock)
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
  terraform destroy \
    -var="environment=$ENV" \
    $( [[ "$AUTO_APPROVE" == "true" ]] && echo "-auto-approve" )

  echo ""
  echo "Terraform destroy complete."

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

  # List resource groups matching the landing zone naming convention (rg-<company>-<env>-*)
  if [[ -n "${COMPANY:-}" ]]; then
    RGS=$(az group list --query "[?starts_with(name, 'rg-${COMPANY}-${ENV}')].name" -o tsv)
  else
    RGS=$(az group list --query "[?starts_with(name, 'rg-') && contains(name, '-${ENV}')].name" -o tsv)
  fi

  if [[ -z "$RGS" ]]; then
    echo "No matching resource groups found for environment: $ENV"
    echo "Expected pattern: rg-*-${ENV}[-*]"
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

  echo ""
  echo "NOTE: Subscription-level resources (policies, Defender plans, diagnostic settings,"
  echo "budgets, role assignments) are not removed by deleting resource groups. To remove them:"
  echo ""
  echo "  # Policy assignments"
  echo "  az policy assignment delete --name mcsb-audit"
  echo "  az policy assignment delete --name allowed-locations"
  echo "  az policy assignment delete --name allowed-locations-rg"
  echo "  az policy assignment delete --name require-env-tag-rg"
  echo "  az policy assignment delete --name require-team-tag-rg"
  echo "  az policy assignment delete --name inherit-env-tag"
  echo "  az policy assignment delete --name inherit-team-tag"
  echo "  az policy assignment delete --name activity-log-diag"
  echo ""
  echo "  # Orphaned role assignments from DINE/Modify policy managed identities"
  echo "  # These are NOT automatically deleted when policies are removed."
  echo "  # Failing to remove them causes RoleAssignmentUpdateNotPermitted on redeploy."
  echo "  SUB_ID=\$(az account show --query id -o tsv)"
  echo "  az role assignment list --all --query \"[?(roleDefinitionName=='Tag Contributor' || roleDefinitionName=='Log Analytics Contributor' || roleDefinitionName=='Monitoring Contributor')].name\" -o tsv | while read name; do"
  echo "    az rest --method DELETE -u \"https://management.azure.com/subscriptions/\${SUB_ID}/providers/Microsoft.Authorization/roleAssignments/\${name}?api-version=2022-04-01\""
  echo "  done"
  echo ""
  echo "  # Diagnostic setting"
  echo "  az rest --method DELETE -u \"https://management.azure.com/subscriptions/\${SUB_ID}/providers/microsoft.insights/diagnosticSettings/diag-activity-log-to-law?api-version=2021-05-01-preview\""
  echo ""
  echo "  # Security contact"
  echo "  az rest --method DELETE -u \"https://management.azure.com/subscriptions/\${SUB_ID}/providers/Microsoft.Security/securityContacts/default?api-version=2020-01-01-preview\""
  echo ""
  echo "  # Budget"
  echo "  az consumption budget delete --budget-name budget-\${COMPANY:-<company>}-${ENV}-monthly"
  echo ""
  echo "  # Reset Defender plans to Free"
  echo "  for plan in VirtualMachines Containers SqlServers OpenSourceRelationalDatabases KeyVaults Arm CloudPosture; do"
  echo "    az security pricing create --name \$plan --tier Free"
  echo "  done"
fi

echo ""
echo "=== Teardown Complete ==="
