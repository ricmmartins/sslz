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
Usage: $0 --tool <terraform|bicep> --env <prod|nonprod> [--yes] [--remove-backend]

Options:
  --tool             Deployment tool used (terraform or bicep)
  --env              Environment to tear down (prod or nonprod)
  --yes              Skip confirmation prompt
  --remove-backend   Also remove Terraform state backend (storage account + lock)
  --help             Show this help

Examples:
  $0 --tool terraform --env nonprod
  $0 --tool bicep --env prod --yes
EOF
  exit 1
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --tool) TOOL="$2"; shift 2 ;;
    --env) ENV="$2"; shift 2 ;;
    --yes) AUTO_APPROVE=true; shift ;;
    --remove-backend) REMOVE_BACKEND=true; shift ;;
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
  terraform init
  terraform destroy \
    -var="environment=$ENV" \
    ${AUTO_APPROVE:+-auto-approve}

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

  # List matching resource groups
  RGS=$(az group list --query "[?contains(name, '-${ENV}-')].name" -o tsv)

  if [[ -z "$RGS" ]]; then
    echo "No matching resource groups found for environment: $ENV"
  else
    echo "Resource groups to delete:"
    echo "$RGS" | while read -r rg; do echo "  - $rg"; done
    echo ""

    echo "$RGS" | while read -r rg; do
      echo "Deleting $rg..."
      az group delete --name "$rg" --yes --no-wait
    done

    echo ""
    echo "Resource group deletions initiated (running in background)."
    echo "Monitor progress: az group list --query \"[?contains(name, '-${ENV}-')].{name:name, state:properties.provisioningState}\" -o table"
  fi

  echo ""
  echo "NOTE: Subscription-level resources (policies, Defender plans, diagnostic settings)"
  echo "are not removed by deleting resource groups. To remove them:"
  echo "  az policy assignment delete --name <assignment-name>"
  echo "  az monitor diagnostic-settings subscription delete --name diag-activity-log-to-law"
fi

echo ""
echo "=== Teardown Complete ==="
