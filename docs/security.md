# Security Baseline

Security that protects you without slowing you down. Every recommendation here is either free or costs less than a compromised production database.

## Defender for Cloud

### What to Enable

| Plan | Enable? | Cost | Why |
|---|---|---|---|
| CSPM (Free) | Both subs | Free | Secure Score, recommendations, asset inventory. No reason to skip. |
| Defender for Servers P2 | Prod only | ~$15/server/month | EDR via Defender for Endpoint, vulnerability assessment, JIT VM access, adaptive application controls. |
| Defender for Containers | If running AKS | ~$7/vCPU/month | Runtime threat detection, image vulnerability scanning, Kubernetes audit log monitoring. |
| Defender for Databases | Prod only | Varies | SQL/Postgres threat detection — alerts on SQL injection, anomalous access, brute force. |
| Defender for Key Vault | Prod only | ~$0.02/10k transactions | Alerts on unusual access patterns to secrets. Cheap insurance. |
| Defender for Storage | No | ~$10/month per account | Malware scanning. Skip unless you accept user file uploads. |
| Defender for App Service | No | ~$15/month per instance | Limited value compared to other plans. Revisit later. |
| Defender for DNS | No | ~$0.70/million queries | Niche. Only if you suspect DNS exfiltration (you don't). |

### Secure Score

Don't chase a perfect score. A score of 60-70% with the high-severity items resolved is fine for a startup. Focus on:
- MFA enabled for all accounts
- No public-facing storage accounts
- No public-facing databases
- Encryption at rest enabled (default for most services)
- Diagnostic settings configured

## RBAC Model

### Groups and Roles

| Entra ID Group | Azure Role | Scope | Who |
|---|---|---|---|
| `sg-azure-admins` | Owner | Management Group | CTO, Lead SRE, Co-founders (2-3 max) |
| `sg-azure-developers` | Contributor | Non-prod subscription | All developers |
| `sg-azure-developers` | Reader | Prod subscription | All developers |
| CI/CD Service Principal | Contributor | Both subscriptions | GitHub Actions / Azure DevOps |

### Rules

1. **Never assign roles to individual users.** Always use groups. When someone leaves, you remove them from the group, not from 15 role assignments.
2. **Developers don't get Contributor on prod.** Deployments go through CI/CD. Debug with Reader + Log Analytics + Application Insights.
3. **No Owner at subscription level for non-admins.** Owner can modify RBAC, which means one compromised account can grant itself anything.
4. **Service Principals get Contributor, not Owner.** CI/CD doesn't need to manage RBAC.

### Emergency Access

For live incidents where developers need to modify prod:
1. A member of `sg-azure-admins` grants temporary Contributor access to the developer on the specific resource group
2. The developer fixes the issue
3. The admin revokes access immediately after

This is manual. That's fine. If you're doing this more than once a month, either your CI/CD is broken or your monitoring is insufficient.

When this becomes frequent enough to be painful, implement Privileged Identity Management (PIM) for just-in-time access with time-bound approvals.

## Identity Security

### MFA

**Enable Security Defaults in Entra ID.** This is free and gives you:
- MFA required for all users (using Microsoft Authenticator)
- Legacy authentication protocols blocked
- Admin activities require MFA

Do this before anything else. It blocks 99.9% of identity attacks.

### Break-Glass Account

Create exactly one break-glass account:
- **Username:** `breakglass@yourcompany.onmicrosoft.com`
- **Role:** Global Administrator
- **MFA:** Hardware security key (YubiKey or similar) — NOT phone-based
- **Password:** 20+ characters, randomly generated
- **Storage:** Physical safe or a separate, dedicated password manager vault
- **Testing:** Verify it works quarterly
- **Monitoring:** Set up an alert in Entra ID when this account signs in

This account is for when your primary admin accounts are locked out, MFA is broken, or Conditional Access policies lock everyone out.

### Workload Identity Federation

For CI/CD pipelines, use Workload Identity Federation instead of client secrets:

```yaml
# GitHub Actions example
- name: Azure Login
  uses: azure/login@v2
  with:
    client-id: ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id: ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
```

**Why?**
- No secrets to store, rotate, or accidentally commit to git
- Credentials are short-lived (token per workflow run)
- Scoped to specific repos and branches

Setup: Entra ID > App Registrations > Your App > Certificates & secrets > Federated credentials > Add GitHub Actions.

## Logging

### What to Log

Everything goes to a single Log Analytics workspace in your prod subscription:

| Log Source | How to Enable | What It Captures |
|---|---|---|
| Activity Log (both subs) | Azure Policy: `DeployIfNotExists` | Who deployed/modified/deleted resources (control plane) |
| Entra ID Sign-in Logs | Entra ID > Diagnostic settings | All user sign-ins, failed attempts, MFA challenges |
| Entra ID Audit Logs | Entra ID > Diagnostic settings | Group changes, role assignments, app registrations |
| Resource Diagnostic Logs | Azure Policy or per-resource | Resource-specific metrics and logs (SQL queries, Key Vault access, etc.) |
| Application Insights | SDK / auto-instrumentation | Application telemetry, traces, exceptions, dependencies |

### Retention

| Tier | Duration | Cost |
|---|---|---|
| Interactive (hot) | 90 days | Included in ingestion cost |
| Archive (cold) | 180 days | ~$0.02/GB/month |

90 days interactive covers most troubleshooting. Archive for 180 days covers most audit requirements. If you have specific compliance retention needs, adjust accordingly.

### Key Queries to Save

```kusto
// Failed sign-ins in the last 24 hours
SigninLogs
| where TimeGenerated > ago(24h)
| where ResultType != "0"
| summarize count() by UserPrincipalName, ResultDescription
| order by count_ desc

// Resource deletions in the last 7 days
AzureActivity
| where TimeGenerated > ago(7d)
| where OperationNameValue endswith "DELETE"
| project TimeGenerated, Caller, ResourceGroup, ResourceId
| order by TimeGenerated desc

// High-privilege role assignments
AzureActivity
| where OperationNameValue == "Microsoft.Authorization/roleAssignments/write"
| project TimeGenerated, Caller, Properties
```

### Alerts

Set up these alerts on your Log Analytics workspace:

| Alert | Condition | Severity |
|---|---|---|
| Break-glass account sign-in | `SigninLogs \| where UserPrincipalName == "breakglass@..."` | Critical (Sev 0) |
| Subscription Owner added | Role assignment with Owner role | High (Sev 1) |
| Resource group deleted in prod | Activity Log delete on resource group | High (Sev 1) |
| Unusual sign-in location | Sign-in from new country | Medium (Sev 2) |

## Network Security

### The Essentials

1. **NSGs on every subnet** — Deny all inbound by default, explicitly allow what's needed
2. **Service-level firewalls** — Azure SQL firewall rules, Storage firewall, etc.
3. **TLS everywhere** — Enforce HTTPS on all public endpoints (App Service: HTTPS Only = On)
4. **No public IPs on databases** — Use Private Endpoints or service firewall to restrict access

### What You Can Skip

- **Azure Firewall** — $900+/month. Use NSGs until compliance says otherwise.
- **DDoS Protection Standard** — $2,944/month. Azure's basic DDoS protection (free) covers L3/L4. Use Front Door WAF for L7 protection.
- **Azure Bastion** — $138+/month. Use `az ssh` or just-in-time VM access (Defender for Servers P2) instead.

### Secret Management

- **Use Azure Key Vault** for all secrets, certificates, and encryption keys
- **Never put secrets in code, environment variables, or app settings directly**
- **Use managed identities** for Azure-to-Azure authentication (App Service to SQL, AKS to Key Vault, etc.)
- **Key Vault access:** Use RBAC (Key Vault Secrets User role), not access policies

```bicep
// Example: App Service with managed identity accessing Key Vault
resource appService 'Microsoft.Web/sites@2023-12-01' = {
  identity: { type: 'SystemAssigned' }
  // ...
}

resource kvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: appService.identity.principalId
    principalType: 'ServicePrincipal'
  }
}
```
