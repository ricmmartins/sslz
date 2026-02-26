#!/usr/bin/env bash
# ==============================================================================
# Validate Prerequisites
# Pre-flight checks for deploying the Azure Landing Zone:
#   - Required CLI tools and versions
#   - Azure authentication and subscription
#   - Required provider registrations
#   - Basic permissions check
# ==============================================================================
set -uo pipefail

ERRORS=0
WARNINGS=0

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo "  ⚠ $1"; WARNINGS=$((WARNINGS + 1)); }

echo "=== Checking CLI Tools ==="

# Azure CLI
if command -v az &>/dev/null; then
  AZ_VERSION=$(az version --query '"azure-cli"' -o tsv 2>/dev/null)
  pass "Azure CLI $AZ_VERSION"
else
  fail "Azure CLI not found — install from https://aka.ms/install-azure-cli"
fi

# Terraform
if command -v terraform &>/dev/null; then
  TF_VERSION=$(terraform version -json 2>/dev/null | grep -o '"terraform_version":"[^"]*"' | cut -d'"' -f4)
  # Fallback: parse from plain text output if JSON parsing failed
  if [[ -z "$TF_VERSION" ]]; then
    TF_VERSION=$(terraform version 2>/dev/null | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
  fi
  # Check minimum version 1.5.0
  if [[ -n "$TF_VERSION" ]] && printf '%s\n' "1.5.0" "$TF_VERSION" | sort -V | head -1 | grep -q "1.5.0"; then
    pass "Terraform $TF_VERSION (>= 1.5.0)"
  else
    fail "Terraform ${TF_VERSION:-unknown} is below minimum 1.5.0"
  fi
else
  warn "Terraform not found — install from https://terraform.io/downloads (only needed for Terraform option)"
fi

# Bicep
if command -v az &>/dev/null; then
  if az bicep version --only-show-errors &>/dev/null; then
    BICEP_VERSION=$(az bicep version --only-show-errors 2>&1 | grep -oE '[0-9]+\.[0-9.]+' | head -1)
    pass "Bicep CLI $BICEP_VERSION"
  else
    warn "Bicep CLI not installed — run: az bicep install"
  fi
fi

# tflint (optional)
if command -v tflint &>/dev/null; then
  pass "tflint $(tflint --version 2>&1 | grep -oE '[0-9]+\.[0-9.]+' | head -1)"
else
  warn "tflint not found (optional) — install from https://github.com/terraform-linters/tflint"
fi

echo ""
echo "=== Checking Azure Authentication ==="

if az account show &>/dev/null; then
  ACCOUNT_NAME=$(az account show --query "name" -o tsv)
  SUBSCRIPTION_ID=$(az account show --query "id" -o tsv)
  TENANT_ID=$(az account show --query "tenantId" -o tsv)
  pass "Logged in to: $ACCOUNT_NAME"
  pass "Subscription: $SUBSCRIPTION_ID"
  pass "Tenant:       $TENANT_ID"
else
  fail "Not logged in to Azure — run: az login"
fi

echo ""
echo "=== Checking Provider Registrations ==="

REQUIRED_PROVIDERS=(
  "Microsoft.Resources"
  "Microsoft.Network"
  "Microsoft.OperationalInsights"
  "Microsoft.Security"
  "Microsoft.PolicyInsights"
  "Microsoft.Consumption"
  "Microsoft.Authorization"
  "Microsoft.Insights"
)

if az account show &>/dev/null; then
  for provider in "${REQUIRED_PROVIDERS[@]}"; do
    STATE=$(az provider show --namespace "$provider" --query "registrationState" -o tsv 2>/dev/null || echo "Unknown")
    if [[ "$STATE" == "Registered" ]]; then
      pass "$provider"
    else
      fail "$provider is $STATE — run: az provider register --namespace $provider"
    fi
  done
else
  warn "Skipping provider checks (not logged in)"
fi

echo ""
echo "=== Checking Permissions ==="

if az account show &>/dev/null; then
  # Check if we can list resource groups (basic permission test)
  if az group list --query "[0].name" -o tsv &>/dev/null; then
    pass "Can list resource groups (basic permissions OK)"
  else
    fail "Cannot list resource groups — insufficient permissions"
  fi

  # Check if we can read policy assignments
  if az policy assignment list --query "[0].name" -o tsv &>/dev/null; then
    pass "Can read policy assignments"
  else
    warn "Cannot read policy assignments — may need higher permissions for policy module"
  fi
fi

echo ""
echo "=== Summary ==="
if [[ $ERRORS -eq 0 ]]; then
  echo "All checks passed ($WARNINGS warnings). Ready to deploy!"
  exit 0
else
  echo "$ERRORS errors, $WARNINGS warnings. Fix errors before deploying."
  exit 1
fi
