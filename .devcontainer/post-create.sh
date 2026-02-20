#!/bin/bash
set -euo pipefail

echo "Installing jq and shellcheck..."
sudo apt-get update -qq && sudo apt-get install -y -qq jq shellcheck > /dev/null

echo "Installing Bicep CLI..."
az bicep install

echo "Installing tflint..."
curl -s https://raw.githubusercontent.com/terraform-linters/tflint/master/install_linux.sh | bash

echo "Verifying tool versions..."
echo "  Terraform: $(terraform version -json | jq -r '.terraform_version')"
echo "  Bicep:     $(az bicep version --only-show-errors 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')"
echo "  Azure CLI: $(az version --query '"azure-cli"' -o tsv)"
echo "  GitHub CLI: $(gh --version | head -1)"
echo "  tflint:    $(tflint --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
echo "  ShellCheck: $(shellcheck --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"

echo "Dev container ready!"
