---
layout: page
title: "Resource Inventory"
nav_order: 8
description: "Complete list of Azure resources created by the landing zone"
---

# Resource Inventory

This is the complete inventory of every Azure resource created by the Startup Landing Zone deployment. Both the Bicep and Terraform implementations produce identical resources. Use this page as the single source of truth for what the landing zone deploys.

**Naming convention prefix:** `{companyName}-{environment}` (e.g., `contoso-prod`)

---

## Resource Groups

| Name Pattern | Azure Resource Type | Purpose | Conditional |
|---|---|---|---|
| `rg-{company}-{env}-monitoring` | `Microsoft.Resources/resourceGroups` | Log Analytics workspace and monitoring resources | Created only when an existing workspace is not supplied |
| `rg-{company}-{env}-networking` | `Microsoft.Resources/resourceGroups` | VNet, subnets, and NSGs | Only when `deployNetworking = true` |

---

## Management Groups (Separate Deployment)

Management groups deploy at **tenant scope** and must be deployed separately before the main landing zone using CLI commands (see [Quick Start Step 2](https://github.com/ricmmartins/sslz#step-2-deploy-management-groups-optional-5-min) in the README). They are **not** created via the Portal or CI/CD workflows.

| Name Pattern | Azure Resource Type | Purpose |
|---|---|---|
| `mg-{company}` | `Microsoft.Management/managementGroups` | Top-level management group for the landing zone |

**Hierarchy:**

```
Tenant Root Group
└── mg-{company}  (display name: "{company} Landing Zone")
    ├── Production subscription
    └── Non-production subscription
```

**Requires:** Owner or Management Group Contributor on the Tenant Root Group.

---

## Networking

Networking resources are created in `rg-{company}-{env}-networking` when `deployNetworking = true`.

### Virtual Network

| Property | Prod | Non-Prod |
|---|---|---|
| **Name** | `vnet-{company}-{env}` | `vnet-{company}-{env}` |
| **Resource type** | `Microsoft.Network/virtualNetworks` | — |
| **Address space** | `10.0.0.0/16` | `10.1.0.0/16` |

### Subnets

| Subnet Name | CIDR (Prod) | CIDR (Non-Prod) | Delegation | Purpose |
|---|---|---|---|---|
| `snet-aks` | `10.0.0.0/20` | `10.1.0.0/20` | None | AKS node pool |
| `snet-app` | `10.0.16.0/22` | `10.1.16.0/22` | Configurable (default: `Microsoft.Web/serverFarms`) | App Service / Container Apps |
| `snet-data` | `10.0.20.0/22` | `10.1.20.0/22` | None | Databases and data services |
| `snet-shared` | `10.0.24.0/24` | `10.1.24.0/24` | None | Shared services (Key Vault, etc.) |

### Network Security Groups

Each subnet has a dedicated NSG. All NSGs include a **DenyAllInbound** catch-all rule at priority 4096.

| NSG Name | Azure Resource Type | Associated Subnet |
|---|---|---|
| `nsg-snet-aks` | `Microsoft.Network/networkSecurityGroups` | `snet-aks` |
| `nsg-snet-app` | `Microsoft.Network/networkSecurityGroups` | `snet-app` |
| `nsg-snet-data` | `Microsoft.Network/networkSecurityGroups` | `snet-data` |
| `nsg-snet-shared` | `Microsoft.Network/networkSecurityGroups` | `snet-shared` |

### NSG Rules

#### nsg-snet-aks

| Rule Name | Priority | Direction | Access | Protocol | Source | Dest Port | Dest |
|---|---|---|---|---|---|---|---|
| AllowAzureLoadBalancerInbound | 110 | Inbound | Allow | `*` | `AzureLoadBalancer` | `*` | `*` |
| AllowVNetInbound | 120 | Inbound | Allow | `*` | `VirtualNetwork` | `*` | `VirtualNetwork` |
| DenyAllInbound | 4096 | Inbound | Deny | `*` | `*` | `*` | `*` |

#### nsg-snet-app

| Rule Name | Priority | Direction | Access | Protocol | Source | Dest Port | Dest |
|---|---|---|---|---|---|---|---|
| DenyAllInbound | 4096 | Inbound | Deny | `*` | `*` | `*` | `*` |

#### nsg-snet-data

| Rule Name | Priority | Direction | Access | Protocol | Source | Dest Port | Dest |
|---|---|---|---|---|---|---|---|
| AllowFromAksSubnet | 110 | Inbound | Allow | TCP | `snet-aks` CIDR | `1433, 5432, 6380, 443` | `*` |
| AllowFromAppSubnet | 120 | Inbound | Allow | TCP | `snet-app` CIDR | `1433, 5432, 6380, 443` | `*` |
| DenyAllInbound | 4096 | Inbound | Deny | `*` | `*` | `*` | `*` |

> **Allowed ports on snet-data:** 1433 (SQL Server), 5432 (PostgreSQL), 6380 (Redis SSL), 443 (HTTPS)

#### nsg-snet-shared

| Rule Name | Priority | Direction | Access | Protocol | Source | Dest Port | Dest |
|---|---|---|---|---|---|---|---|
| DenyAllInbound | 4096 | Inbound | Deny | `*` | `*` | `*` | `*` |

---

## Monitoring

### Log Analytics Workspace

| Property | Value |
|---|---|
| **Name** | `law-{company}-{env}` |
| **Resource type** | `Microsoft.OperationalInsights/workspaces` |
| **Resource group** | `rg-{company}-{env}-monitoring` |
| **SKU** | `PerGB2018` |
| **Retention** | 90 days (configurable, 30–730) |
| **Daily quota** | 5 GB (configurable, `-1` = unlimited) |
| **Resource-only permissions** | Enabled |

The workspace location is explicit and defaults to the selected primary region. Supplying a compatible existing
workspace resource ID reuses that workspace and suppresses both workspace and monitoring resource-group creation.

### Activity Log Diagnostic Setting

| Property | Value |
|---|---|
| **Name** | `diag-activity-log-to-law` |
| **Resource type** | `Microsoft.Insights/diagnosticSettings` |
| **Scope** | Subscription |
| **Target** | Log Analytics workspace (`law-{company}-{env}`) |

**Enabled log categories (all 8):**

| Category |
|---|
| Administrative |
| Security |
| Alert |
| Policy |
| ServiceHealth |
| Recommendation |
| Autoscale |
| ResourceHealth |

---

## Security

### Microsoft Defender for Cloud Plans

All plans are `Microsoft.Security/pricings` resources at subscription scope.

| Plan Name (resource) | Resource Type Covered | Default Tier — Prod | Default Tier — Non-Prod | Sub-Plan |
|---|---|---|---|---|
| `CloudPosture` | CSPM | Free | Free | — |
| `VirtualMachines` | Servers | Standard | Free | P2 (when Standard) |
| `Containers` | Containers (AKS) | Free | Free | — |
| `SqlServers` | Azure SQL | Standard | Free | — |
| `OpenSourceRelationalDatabases` | PostgreSQL, MySQL, MariaDB | Standard | Free | — |
| `KeyVaults` | Key Vault | Standard | Standard | — |
| `Arm` | ARM control plane | Standard | Standard | — |
| `StorageAccounts` | Storage | Free | Free | DefenderForStorageV2 only when explicitly enabled |

> **Notes:**
> - Defender for Servers, Databases are enabled by default in prod, disabled in nonprod.
> - Defender for Containers defaults to disabled; enable via parameter if running AKS.
> - Defender for Key Vault and ARM are always Standard (low cost).
> - Defender for Storage V2 defaults to Free in both environments. Explicitly set `enableDefenderForStorage` (Bicep)
>   or `enable_defender_for_storage` (Terraform) to opt into Standard after reviewing current pricing.

When Defender for Servers is enabled, `Microsoft.Security/workspaceSettings/default` (Terraform:
`azurerm_security_center_workspace.default`) explicitly associates the subscription with the effective Log Analytics
workspace. It is omitted when Defender for Servers is disabled.

### Security Contact

| Property | Value |
|---|---|
| **Resource type** | `Microsoft.Security/securityContacts` |
| **Name** | `default` |
| **Email** | Configured via `securityContactEmail` parameter |
| **Notifications** | Enabled |
| **Notify roles** | Owner |
| **Minimum severity** | Medium |
| **Alert source** | Alert |

---

## Governance

### Policy Assignments

All policies are `Microsoft.Authorization/policyAssignments` at subscription scope.

| Assignment Name | Display Name | Built-in Policy/Initiative ID | Effect | Enforcement | Parameters | Identity |
|---|---|---|---|---|---|---|
| `mcsb-audit` | Microsoft Cloud Security Benchmark (Audit) | `1f3afdf9-d0c9-4c3d-847f-89da613e70a8` (Initiative) | Audit | Default | — | None |
| `allowed-locations` | Allowed Locations | `e56962a6-4747-49cd-b67b-bf8b01975c4c` | Deny | Default | `listOfAllowedLocations`: deployment region | None |
| `allowed-locations-rg` | Allowed Locations for Resource Groups | `e765b5de-1225-4ba3-bd56-1ac6695af988` | Deny | Default | `listOfAllowedLocations`: deployment region | None |
| `require-env-tag-rg` | Require environment tag on resource groups | `96670d01-0a4d-4649-9c89-2d3abc0a5025` | Deny | Default | `tagName`: `environment` | None |
| `require-team-tag-rg` | Require team tag on resource groups | `96670d01-0a4d-4649-9c89-2d3abc0a5025` | Deny | Default | `tagName`: `team` | None |
| `inherit-env-tag` | Inherit environment tag from resource group | `cd3aa116-8754-49c9-a813-ad46512ece54` | Modify | Default | `tagName`: `environment` | SystemAssigned |
| `inherit-team-tag` | Inherit team tag from resource group | `cd3aa116-8754-49c9-a813-ad46512ece54` | Modify | Default | `tagName`: `team` | SystemAssigned |
| `activity-log-diag` | Deploy Activity Log diagnostics to Log Analytics | `2465583e-4e78-4c15-b6be-a36cbc7c8b0f` | DeployIfNotExists | Default | `logAnalytics`: workspace resource ID | SystemAssigned |

---

## Cost Management

### Budget

| Property | Value |
|---|---|
| **Name** | `budget-{company}-{env}-monthly` |
| **Resource type** | `Microsoft.Consumption/budgets` |
| **Scope** | Subscription |
| **Category** | Cost |
| **Time grain** | Monthly |
| **Amount** | Configured via `monthlyBudgetAmount` parameter |
| **Start date** | First day of the current month (configurable) |

### Notification Thresholds

| Threshold | Type | Operator |
|---|---|---|
| 50% | Actual | GreaterThan |
| 80% | Actual | GreaterThan |
| 100% | Actual | GreaterThan |
| 100% | Forecasted | GreaterThan |

All notifications are sent to the email addresses specified in `budgetAlertEmails`.

---

## Tags

Default tags applied to all resources and resource groups:

| Tag Key | Value | Purpose |
|---|---|---|
| `environment` | `prod` or `nonprod` | Environment identification and cost tracking |
| `managedBy` | `bicep` or `terraform` | IaC tool used for deployment |
| `project` | `landing-zone` | Project identification |
| `team` | `platform` | Team ownership |

Tag governance is enforced via policy:
- **`environment`** and **`team`** tags are **required** on all resource groups (deny if missing).
- **`environment`** and **`team`** tags are **inherited** from resource groups to child resources (auto-applied via Modify policy).

---

## CI/CD Workflows

| Workflow File | Name | Trigger | Purpose |
|---|---|---|---|
| `validate.yml` | Validate IaC | PR and push to `main` on `infra/**` or `examples/**` | Builds and lints all Bicep files; runs `terraform fmt`, TFLint, and `terraform validate` |
| `deploy-bicep.yml` | Deploy Landing Zone (Bicep) | Manual dispatch from `main` | Optional agent-aware approval wrapper; the classic path uses direct operator Bicep commands |
| `deploy-terraform.yml` | Deploy Landing Zone (Terraform) | Manual dispatch from `main` | Optional agent-aware approval wrapper; the classic path uses direct operator Terraform commands |
| `integration-test.yml` | Integration Test | Manual dispatch or weekly schedule (Monday 06:00 UTC) | Runs Bicep What-If and Terraform Plan against a dedicated integration subscription; optional writes require manual `main` dispatch plus `integration-nonprod`, and teardown is attempted after every started apply |
| `github-pages.yml` | Deploy to GitHub Pages | Push to `main` or manual dispatch | Builds Jekyll site and deploys to GitHub Pages |

---

## Naming Conventions

| Resource Type | Azure Type | Naming Pattern | Example (prod) |
|---|---|---|---|
| Resource Group (monitoring) | `Microsoft.Resources/resourceGroups` | `rg-{company}-{env}-monitoring` | `rg-contoso-prod-monitoring` |
| Resource Group (networking) | `Microsoft.Resources/resourceGroups` | `rg-{company}-{env}-networking` | `rg-contoso-prod-networking` |
| Management Group | `Microsoft.Management/managementGroups` | `mg-{company}` | `mg-contoso` |
| Log Analytics Workspace | `Microsoft.OperationalInsights/workspaces` | `law-{company}-{env}` | `law-contoso-prod` |
| Virtual Network | `Microsoft.Network/virtualNetworks` | `vnet-{company}-{env}` | `vnet-contoso-prod` |
| Subnet | `Microsoft.Network/virtualNetworks/subnets` | `snet-{purpose}` | `snet-aks`, `snet-app`, `snet-data`, `snet-shared` |
| Network Security Group | `Microsoft.Network/networkSecurityGroups` | `nsg-snet-{purpose}` | `nsg-snet-aks` |
| Diagnostic Setting | `Microsoft.Insights/diagnosticSettings` | `diag-activity-log-to-law` | `diag-activity-log-to-law` |
| Budget | `Microsoft.Consumption/budgets` | `budget-{company}-{env}-monthly` | `budget-contoso-prod-monthly` |
| Defender Plans | `Microsoft.Security/pricings` | Azure-defined names | `CloudPosture`, `VirtualMachines`, `KeyVaults`, etc. |
| Security Contact | `Microsoft.Security/securityContacts` | `default` | `default` |
| Policy Assignments | `Microsoft.Authorization/policyAssignments` | Descriptive kebab-case | `mcsb-audit`, `allowed-locations`, etc. |
