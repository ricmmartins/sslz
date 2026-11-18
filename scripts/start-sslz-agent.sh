#!/usr/bin/env bash
# Starts the SSLZ Agent in this shell. With two Azure subscriptions it sets their IDs; otherwise it starts planning-only.
# Usage: start-sslz-agent.sh [--blank | "your first message"]. With no argument it opens the guided founder journey.
# It only reads your Azure account list. It never deploys, registers providers or changes Azure.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

case "${1:-}" in
  "" | --blank) ;;
  -h | --help)
    echo 'Usage: start-sslz-agent.sh [--blank | "your first message"]'
    echo "With no argument it opens the guided founder journey. --blank opens the agent with no first message."
    exit 0
    ;;
  -*)
    echo "Unknown option: $1. Use --help to see the options." >&2
    exit 1
    ;;
esac

for tool in node copilot; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing prerequisite: $tool" >&2; exit 1; }
done

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI (az) is not installed. Continuing in planning-only mode."
  export SSLZ_DISCOVERY_ONLY=1
elif ! az account show >/dev/null 2>&1; then
  echo "Not signed in to Azure. Continuing in planning-only mode. If you have an account, run 'az login' and start again."
  export SSLZ_DISCOVERY_ONLY=1
else
  tenant="$(az account show --query tenantId -o tsv)"
  echo "Active Azure tenant: $tenant ($(az account show --query user.name -o tsv))"
  echo "Only subscriptions in this tenant are offered. If it is not the tenant you want, run: az login --tenant <tenant-id>"
  az bicep version >/dev/null 2>&1 || echo "Note: Bicep is not installed (az bicep install). Bicep validation will be unavailable."
fi

command -v terraform >/dev/null 2>&1 || echo "Note: terraform is not installed. Planning and the preflight work, but Terraform validation will be unavailable."

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
  read -r -p "Number: " choice || {
    echo "No input received. Set SSLZ_PROD_SUBSCRIPTION_ID and SSLZ_NONPROD_SUBSCRIPTION_ID to skip these questions." >&2
    exit 1
  }
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#subs[@]}" ]; then
    echo "Invalid choice." >&2
    exit 1
  fi
  export "$var=${subs[$((choice - 1))]##*$'\t'}"
}

if [ -z "${SSLZ_DISCOVERY_ONLY:-}" ] && { [ -z "${SSLZ_PROD_SUBSCRIPTION_ID:-}" ] || [ -z "${SSLZ_NONPROD_SUBSCRIPTION_ID:-}" ]; }; then
  enabled_count="$(az account list --all --query "[?state=='Enabled' && tenantId=='$tenant'] | length(@)" -o tsv)"
  if [ "${enabled_count:-0}" -lt 2 ]; then
    echo
    echo "This tenant has ${enabled_count:-0} enabled Azure subscription(s). The SSLZ foundation needs two (production and non-production)."
    echo "You can still use the agent to plan. It will not read your Azure account until two subscriptions exist (see docs/ci-cd-setup.md)."
    export SSLZ_DISCOVERY_ONLY=1
  else
    echo
    echo "The SSLZ uses two Azure subscriptions: one for production and one for non-production."
    echo "Pick two different ones. If you already set up the SSLZ, pick the two you configured for it."
    echo "If you are only trying the agent, any two work: it only reads them."
    echo "Nothing is created or changed by choosing them. Next time, skip these questions with:"
    echo "  export SSLZ_PROD_SUBSCRIPTION_ID=<id>  SSLZ_NONPROD_SUBSCRIPTION_ID=<id>"
  fi
fi
if [ -z "${SSLZ_DISCOVERY_ONLY:-}" ]; then
  [ -n "${SSLZ_PROD_SUBSCRIPTION_ID:-}" ] || pick_subscription "production" SSLZ_PROD_SUBSCRIPTION_ID
  [ -n "${SSLZ_NONPROD_SUBSCRIPTION_ID:-}" ] || pick_subscription "non-production" SSLZ_NONPROD_SUBSCRIPTION_ID

  if [ "$SSLZ_PROD_SUBSCRIPTION_ID" = "$SSLZ_NONPROD_SUBSCRIPTION_ID" ]; then
    echo "The production and non-production subscriptions must be different." >&2
    exit 1
  fi
  echo
  echo "Subscriptions set for this session (IDs are not printed). Starting the SSLZ Agent..."
else
  echo
  echo "Starting the SSLZ Agent in planning-only mode..."
  if [ -t 0 ]; then
    read -r -p "Press Enter to continue (the agent screen replaces this one)... " _
  fi
fi
note=""
if [ -n "${SSLZ_DISCOVERY_ONLY:-}" ]; then
  note=" Launcher note: planning-only mode, no Azure account was read. Mention this in one short sentence."
elif [ -n "${SSLZ_PROD_SUBSCRIPTION_ID:-}" ] && [ -n "${SSLZ_NONPROD_SUBSCRIPTION_ID:-}" ]; then
  note=" Launcher note: two subscriptions are set for this session; access is unverified. Mention this in one short sentence."
fi
case "${1:-}" in
  --blank) exec copilot --agent sslz-agent ;;
  "") exec copilot --agent sslz-agent --interactive "Start a new founder journey.${note}" ;;
  *) exec copilot --agent sslz-agent --interactive "$1" ;;
esac
