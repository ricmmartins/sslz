#!/bin/bash
set -e

echo "Installing Bicep CLI..."
az bicep install

echo "Verifying tool versions..."
echo "  Terraform: $(terraform version -json | jq -r '.terraform_version')"
echo "  Bicep:     $(az bicep version --only-show-errors 2>&1 | grep -oP '[\d.]+')"
echo "  Azure CLI: $(az version --query '"azure-cli"' -o tsv)"
echo "  GitHub CLI: $(gh --version | head -1)"

echo "Dev container ready!"
