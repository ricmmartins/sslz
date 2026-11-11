#!/usr/bin/env bash
# Starts the SSLZ Agent with everything it needs in this shell: tools, Azure login and the two subscription IDs.
# It only reads your Azure account list. It never deploys, registers providers or changes Azure.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

for tool in node copilot az; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing prerequisite: $tool" >&2; exit 1; }
done

if ! az account show >/dev/null 2>&1; then
  echo "Not signed in to Azure. Run 'az login' (use the tenant you want to inspect), then run this script again." >&2
  exit 1
fi

tenant="$(az account show --query tenantId -o tsv)"
echo "Active Azure tenant: $tenant ($(az account show --query user.name -o tsv))"
echo "Only subscriptions in this tenant are offered. If it is not the tenant you want, run: az login --tenant <tenant-id>"

for optional in terraform; do
  command -v "$optional" >/dev/null 2>&1 || echo "Note: $optional is not installed. Planning and the preflight work, but Terraform validation will be unavailable."
done
az bicep version >/dev/null 2>&1 || echo "Note: Bicep is not installed (az bicep install). Bicep validation will be unavailable."

pick_subscription() {
  local label="$1" var="$2" choice
  mapfile -t subs < <(az account list --all --query "[?state=='Enabled' && tenantId=='$tenant'].[name,id]" -o tsv)
  if [ "${#subs[@]}" -eq 0 ]; then
    echo "No enabled subscriptions found in tenant $tenant." >&2
    exit 1
  fi
  echo
  echo "Select the $label subscription:"
  local i=1
  for line in "${subs[@]}"; do
    printf '  %d) %s\n' "$i" "${line%%$'\t'*}"
    i=$((i + 1))
  done
  read -r -p "Number: " choice
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#subs[@]}" ]; then
    echo "Invalid choice." >&2
    exit 1
  fi
  export "$var=${subs[$((choice - 1))]##*$'\t'}"
}

[ -n "${SSLZ_PROD_SUBSCRIPTION_ID:-}" ] || pick_subscription "production (identity)" SSLZ_PROD_SUBSCRIPTION_ID
[ -n "${SSLZ_NONPROD_SUBSCRIPTION_ID:-}" ] || pick_subscription "non-production (connectivity)" SSLZ_NONPROD_SUBSCRIPTION_ID

if [ "$SSLZ_PROD_SUBSCRIPTION_ID" = "$SSLZ_NONPROD_SUBSCRIPTION_ID" ]; then
  echo "The production and non-production subscriptions must be different." >&2
  exit 1
fi

echo
echo "Subscriptions set for this session (IDs are not printed). Starting the SSLZ Agent..."
exec copilot --agent sslz-agent --interactive "${1:-Start a new founder journey.}"
