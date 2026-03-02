# SSLZ Project Instructions

## Project Overview

SSLZ (Startup-Scale Landing Zone) is an opinionated Azure Landing Zone for startups.
- **Site:** https://azurelanding.zone (Jekyll + GitHub Pages)
- **Repo:** ricmmartins/sslz
- **IaC:** Dual implementation — Bicep (`infra/bicep/`) and Terraform (`infra/terraform/`)
- **Examples:** 3 reference architectures in `examples/` (SaaS, API-first, AI)
- **Docs:** Jekyll site pages in `docs/`, navigation in `_data/navigation.yml`

## Commit Preferences

- Never include `Co-authored-by: Copilot` trailer in git commits
- Use conventional commit prefixes: `fix:`, `docs:`, `feat:`, `chore:`

## Azure Deployment Gotchas

### securityContacts/default
Azure auto-creates `securityContacts/default` with empty values when ANY Defender plan
is enabled on a subscription (even via Portal). Terraform needs an `import` block in
the **root module** (not child modules) to adopt it. Import blocks in child modules
produce: `Import blocks are only allowed in the root module`.

### Budget Start Date
Azure Consumption Budget API requires full ISO 8601 datetime: `YYYY-MM-01T00:00:00Z`.
Just a date (`YYYY-MM-DD`) causes validation errors. Bicep uses `utcNow('yyyy-MM')`,
Terraform uses `plantimestamp()`.

### Diagnostic Settings Propagation
Subscription-level diagnostic settings may appear absent after Bicep deployment due to
propagation delay (2-3 minutes). Use REST API with `api-version=2021-05-01-preview` to
verify. The CLI command `az monitor diagnostic-settings subscription list` uses a
different API version and may return empty even when the resource exists.

### DINE/Modify Policy Role Assignments
When deploying DINE/Modify policies via IaC (not Portal), Azure does NOT auto-create
role assignments for policy managed identities. Must explicitly add:
- Tag Contributor (×2) for inherit-tag policies
- Log Analytics Contributor (×1) for activity-log-diag
- Monitoring Contributor (×1) for activity-log-diag

### Orphaned Role Assignments
When DINE/Modify policies are deleted and recreated, old role assignments become
orphaned (managed identity principals deleted from Entra ID). Redeploying causes
`RoleAssignmentUpdateNotPermitted`. Must delete via REST API because
`az role assignment delete` fails for deleted principals:
```bash
az rest --method DELETE -u "https://management.azure.com/subscriptions/${SUB_ID}/providers/Microsoft.Authorization/roleAssignments/${NAME}?api-version=2022-04-01"
```

### skip_service_principal_aad_check
Terraform role assignments for policy managed identities need
`skip_service_principal_aad_check = true` (equivalent of Bicep's
`principalType: 'ServicePrincipal'`). Without it, assignments can fail with
`PrincipalNotFound` due to AAD replication lag.

### Subnet IP Reservation
Azure reserves 5 IPs per subnet (network, gateway, 2× DNS, broadcast).
Usable IPs: /20=4091, /22=1019, /24=251. Always show usable counts in docs.

## Policy Assignments

8 policy assignments — names must be consistent across Bicep, Terraform, teardown
script, and documentation:
1. `mcsb-audit`
2. `allowed-locations`
3. `allowed-locations-rg`
4. `require-env-tag-rg`
5. `require-team-tag-rg`
6. `inherit-env-tag`
7. `inherit-team-tag`
8. `activity-log-diag`

## Jekyll Site

- Cross-reference links between docs pages MUST include `.md` extension for the
  `jekyll-relative-links` plugin. Bare links like `(graduation-guide)` produce 404s
  on the Jekyll site but work on GitHub.com.
- Site is hosted via GitHub Pages with CNAME `azurelanding.zone`
- Navigation order is controlled by `nav_order` in each page's front matter

## Architecture Principles

- One workload per subscription (Microsoft CAF best practice)
- Subscriptions are the primary isolation boundary, not resource groups
- This project assumes a single workload — second workload triggers graduation to ALZ
- Graduation guide at `docs/graduation-guide.md` covers the full migration path
