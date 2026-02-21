#!/usr/bin/env bash
# ==============================================================================
# Bootstrap Terraform Remote Backend
# Creates an Azure Storage Account for Terraform state with best practices:
#   - Blob versioning enabled
#   - Soft delete enabled (7 days)
#   - HTTPS only
#   - Locked resource group to prevent accidental deletion
# ==============================================================================
set -euo pipefail

# Defaults (override via environment variables)
LOCATION="${LOCATION:-eastus2}"
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-terraform-state}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-}"
CONTAINER_NAME="${CONTAINER_NAME:-tfstate}"

usage() {
  cat <<EOF
Usage: $0 [-l location] [-g resource_group] [-s storage_account] [-c container]

Options:
  -l  Azure region (default: eastus2)
  -g  Resource group name (default: rg-terraform-state)
  -s  Storage account name (required if not set via STORAGE_ACCOUNT env var)
  -c  Blob container name (default: tfstate)
  -h  Show this help

Example:
  $0 -s stterraformstate
  $0 -l westus2 -g rg-tfstate -s stmycompanytfstate
EOF
  exit 1
}

while getopts "l:g:s:c:h" opt; do
  case $opt in
    l) LOCATION="$OPTARG" ;;
    g) RESOURCE_GROUP="$OPTARG" ;;
    s) STORAGE_ACCOUNT="$OPTARG" ;;
    c) CONTAINER_NAME="$OPTARG" ;;
    h) usage ;;
    *) usage ;;
  esac
done

if [[ -z "$STORAGE_ACCOUNT" ]]; then
  echo "Error: Storage account name is required. Use -s flag or set STORAGE_ACCOUNT env var."
  usage
fi

# Validate storage account name (3-24 lowercase alphanumeric)
if ! [[ "$STORAGE_ACCOUNT" =~ ^[a-z0-9]{3,24}$ ]]; then
  echo "Error: Storage account name must be 3-24 lowercase letters and numbers only."
  exit 1
fi

# Verify Azure CLI authentication
if ! az account show &>/dev/null; then
  echo "Error: Not logged in to Azure. Run: az login"
  exit 1
fi

echo "=== Bootstrapping Terraform Backend ==="
echo "  Location:        $LOCATION"
echo "  Resource Group:  $RESOURCE_GROUP"
echo "  Storage Account: $STORAGE_ACCOUNT"
echo "  Container:       $CONTAINER_NAME"
echo ""

# Create resource group
echo "Creating resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --tags purpose=terraform-state managedBy=bootstrap

# Create storage account with versioning
echo "Creating storage account..."
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --https-only true \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false

# Enable blob versioning
echo "Enabling blob versioning..."
az storage account blob-service-properties update \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --enable-versioning true \
  --enable-delete-retention true \
  --delete-retention-days 7

# Create blob container
echo "Creating blob container..."
az storage container create \
  --name "$CONTAINER_NAME" \
  --account-name "$STORAGE_ACCOUNT" \
  --auth-mode login

# Add resource lock to prevent accidental deletion
echo "Adding delete lock on resource group..."
az lock create \
  --name "protect-terraform-state" \
  --resource-group "$RESOURCE_GROUP" \
  --lock-type CanNotDelete \
  --notes "Protects Terraform state storage from accidental deletion"

echo ""
echo "=== Backend Configuration ==="
echo ""
echo "Add this to your infra/terraform/main.tf:"
echo ""
echo "  backend \"azurerm\" {"
echo "    resource_group_name  = \"$RESOURCE_GROUP\""
echo "    storage_account_name = \"$STORAGE_ACCOUNT\""
echo "    container_name       = \"$CONTAINER_NAME\""
echo "    key                  = \"landing-zone.tfstate\""
echo "  }"
echo ""
echo "Then run: terraform init -migrate-state"
