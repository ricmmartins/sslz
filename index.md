---
layout: home
title: "Startup-Scale Landing Zone (SSLZ)"
description: "A stripped-down, opinionated, deployable Azure Landing Zone for startups. Deploy in under 1 hour."
---

<section class="hero">
  <a href="{{ site.github_repo }}" class="hero-badge" target="_blank" rel="noopener">Open Source on GitHub</a>
  <h1>Startup-Scale Landing Zone</h1>
  <p class="tagline">A stripped-down, opinionated, production-ready Azure Landing Zone for startups and digital-native teams. Built for companies with 5–50 engineers that need to get Azure right from day one without enterprise complexity.</p>
  <div class="hero-ctas">
    <a href="#quick-start" class="btn btn-primary">Quick Start</a>
    <a href="{{ site.github_repo }}" class="btn btn-secondary" target="_blank" rel="noopener">View on GitHub</a>
    <a href="{{ '/use-sslz-agent/' | relative_url }}" class="btn btn-secondary">Use SSLZ Agent</a>
  </div>
</section>

<section class="landing-section">
  <div class="tldr-terminal">
    <div class="tldr-titlebar">
      <span class="tldr-dots"><span></span><span></span><span></span></span>
      <span class="tldr-title">$ cat tldr.md</span>
    </div>
    <div class="tldr-body">
      <div class="tldr-line">
        <span class="tldr-prompt">1</span>
        <div><strong>One management group, two subscriptions</strong> (Prod + Non-Prod) is all you need to start. Don't over-engineer your hierarchy.</div>
      </div>
      <div class="tldr-line">
        <span class="tldr-prompt">2</span>
        <div><strong>Skip the hub network, Azure Firewall, and dedicated Connectivity subscription</strong> until you actually have hybrid/on-prem requirements or 10+ workloads.</div>
      </div>
      <div class="tldr-line">
        <span class="tldr-prompt">3</span>
        <div><strong>Enable Defender for Cloud CSPM (free) + Defender for Servers P2 on prod only.</strong> Turn on diagnostic settings to a single Log Analytics workspace. That's your security baseline.</div>
      </div>
      <div class="tldr-line">
        <span class="tldr-prompt">4</span>
        <div><strong>Set budget alerts at 50%, 80%, and 100% of your monthly burn.</strong> Tag everything with <code>environment</code> and <code>team</code>. No exceptions.</div>
      </div>
      <div class="tldr-line">
        <span class="tldr-prompt">5</span>
        <div><strong>Deploy this in under 1 hour with Bicep or Terraform.</strong> Graduate to full ALZ when you hit ~50 engineers, multi-region, or regulatory compliance requirements.</div>
      </div>
    </div>
  </div>
</section>

<section class="key-points landing-section">
  <h2>Why This Landing Zone</h2>
  <p class="section-subtitle">Enterprise foundations without the enterprise complexity.</p>
  <div class="cards-grid">
    <div class="card">
      <div class="card-icon">&#9889;</div>
      <h3>1 Hour Deploy</h3>
      <p>From zero to production-ready Azure with Bicep or Terraform. No consultants required.</p>
    </div>
    <div class="card">
      <div class="card-icon">&#9878;</div>
      <h3>2 Subscriptions</h3>
      <p>One management group, prod + non-prod. A simple hierarchy you can grow later.</p>
    </div>
    <div class="card">
      <div class="card-icon">&#128737;</div>
      <h3>Security Built-in</h3>
      <p>Defender for Cloud, RBAC, NSG deny-all defaults, policy enforcement from day one.</p>
    </div>
    <div class="card">
      <div class="card-icon">&#128176;</div>
      <h3>Cost Aware</h3>
      <p>Budget alerts at 50/80/100%, tag enforcement, and reservation guidance built in.</p>
    </div>
  </div>
</section>

<section class="landing-section alt-bg">
  <h2>How It Compares</h2>
  <div class="compare-grid">
    <div class="compare-card">
      <h3><a href="https://aka.ms/alz">ALZ (Enterprise Scale)</a></h3>
      <p>100+ modules, months to understand, built for 10k-seat enterprises</p>
    </div>
    <div class="compare-card">
      <h3><a href="https://github.com/Azure/ALZ-Bicep">ALZ-Bicep</a></h3>
      <p>Still enterprise-scoped, overwhelming for a 10-person startup</p>
    </div>
    <div class="compare-card">
      <h3><a href="https://github.com/Azure/terraform-azurerm-caf-enterprise-scale">CAF Terraform Module</a></h3>
      <p>Enterprise-scoped, in extended support (archived Aug 2026). Microsoft recommends migrating to <a href="https://aka.ms/avm">Azure Verified Modules</a>.</p>
    </div>
    <div class="compare-card accent">
      <h3>This Project</h3>
      <p>Deploys in 1 hour, grows with you, and is written for engineers.</p>
    </div>
  </div>
  <div class="callout-warning">
    <strong>⚠️ Important:</strong> This project is <strong>not</strong> a replacement or competitor to <a href="https://aka.ms/alz">Azure Landing Zones (ALZ)</a> or the <a href="https://github.com/Azure/Enterprise-Scale/tree/main/docs/reference/treyresearch">Trey Research</a> small-enterprise reference. It targets a different profile: very early-stage startups (pre-seed to Series A), 5–15 engineers, no dedicated platform team, typically a single workload in a single region, and no hybrid connectivity requirements. For those teams, the usual alternative is a single subscription with zero governance. This project provides a minimal but secure baseline to start with, and an explicit <a href="/docs/graduation-guide">graduation guide</a> for when they're ready to evolve into the full ALZ architecture.
  </div>
</section>

<section class="architecture-preview landing-section">
  <h2>Architecture Overview</h2>
  <p class="section-subtitle">Self-contained subscriptions, with no hub network or Azure Firewall until you need them.</p>
  <div class="arch-visual">
    <div class="arch-panel">
      <h3>Management Hierarchy</h3>
      <div class="mg-diagram">
        <div class="mg-tenant">
          <span class="mg-label">Tenant Root Group</span>
          <div class="mg-group">
            <div class="mg-group-header">
              <span class="mg-icon">&#9878;</span>
              <span>mg-&lt;yourcompany&gt;</span>
              <span class="mg-tag">Policies</span>
            </div>
            <div class="mg-subs">
              <div class="mg-sub mg-sub-prod">
                <span class="mg-sub-dot"></span>
                <div>
                  <strong>sub-&lt;yourcompany&gt;-prod</strong>
                  <span>Production workloads</span>
                </div>
              </div>
              <div class="mg-sub mg-sub-nonprod">
                <span class="mg-sub-dot"></span>
                <div>
                  <strong>sub-&lt;yourcompany&gt;-nonprod</strong>
                  <span>Dev / Staging / QA</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="arch-panel">
      <h3>Network Layout</h3>
      <div class="net-diagram">
        <div class="net-vnet net-vnet-prod">
          <div class="net-vnet-header">
            <span>vnet-&lt;co&gt;-prod</span>
            <code>10.0.0.0/16</code>
          </div>
          <div class="net-subnets">
            <div class="net-subnet subnet-aks"><span>snet-aks</span><code>/20</code></div>
            <div class="net-subnet subnet-app"><span>snet-app</span><code>/22</code></div>
            <div class="net-subnet subnet-data"><span>snet-data</span><code>/22</code></div>
            <div class="net-subnet subnet-shared"><span>snet-shared</span><code>/24</code></div>
          </div>
        </div>
        <div class="net-vnet net-vnet-nonprod">
          <div class="net-vnet-header">
            <span>vnet-&lt;co&gt;-nonprod</span>
            <code>10.1.0.0/16</code>
          </div>
          <div class="net-subnets">
            <div class="net-subnet subnet-aks"><span>snet-aks</span><code>/20</code></div>
            <div class="net-subnet subnet-app"><span>snet-app</span><code>/22</code></div>
            <div class="net-subnet subnet-data"><span>snet-data</span><code>/22</code></div>
            <div class="net-subnet subnet-shared"><span>snet-shared</span><code>/24</code></div>
          </div>
        </div>
        <div class="net-no-peering">
          <span>No VNet peering &mdash; each subscription is self-contained</span>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="landing-section alt-bg" id="quick-start">
  <h2>Quick Start</h2>
  <p class="section-subtitle">From zero to production-ready in under an hour.</p>
  <div class="quick-start-steps">
    <div class="step-card">
      <div class="step-number">1</div>
      <h3>Prerequisites</h3>
      <span class="step-time">5 min</span>
      <p>Clone the repo, log in to Azure, and validate your environment. You'll need <a href="https://learn.microsoft.com/cli/azure/install-azure-cli">Azure CLI</a>, <a href="https://learn.microsoft.com/azure/cost-management-billing/manage/create-subscription">two subscriptions</a> (prod + nonprod), and <a href="https://learn.microsoft.com/azure/role-based-access-control/role-assignments-portal">Owner permission</a> on both. If you create the subscriptions yourself, you are Owner by default.</p>
      <p><strong>On Windows, install <a href="https://git-scm.com/download/win">Git for Windows</a> and run every command in Git Bash.</strong> The <code>.sh</code> scripts do not run in PowerShell or Command Prompt. Azure Cloud Shell and WSL also work.</p>
      <details>
        <summary>Show commands</summary>
<pre><code>git clone https://github.com/ricmmartins/sslz.git
cd sslz

az login
az account set --subscription &lt;YOUR_PROD_SUBSCRIPTION_ID&gt;
az account show --query "{name:name, tenant:tenantId}"   # confirm this is the right subscription

# Validates CLI tools, Azure auth, provider registrations, and permissions
./scripts/validate-prerequisites.sh</code></pre>
      </details>
    </div>
    <div class="step-card">
      <div class="step-number">2</div>
      <h3>Management Groups (Optional)</h3>
      <span class="step-time">5 min</span>
      <p>Create the management group hierarchy. Requires tenant-level permissions (Owner on Tenant Root Group). Skip if you don't have access — the landing zone works without it. If the Bicep command fails with <code>AuthorizationFailed</code>, it needs <a href="https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-to-tenant#required-access">tenant-scope deployment permission</a> (<a href="https://learn.microsoft.com/azure/role-based-access-control/elevate-access-global-admin">elevated access</a>); the Terraform command usually does not need it. After you give yourself the role (Contributor at <code>/</code> is enough), run <code>az logout</code> and <code>az login</code>. It can take several minutes to propagate, and the Azure CLI may print a Python traceback that hides the real error. Replace every <code>&lt;...&gt;</code> placeholder including the angle brackets, and use the same company name in every step, in lowercase letters and digits (it ends up in every resource group and resource name, such as <code>rg-&lt;company&gt;-prod-networking</code>). The <code>displayName</code> line is optional and only changes the management group name shown in the portal. Steps are in the <a href="https://github.com/ricmmartins/sslz#step-2-deploy-management-groups-optional-5-min">README</a>.</p>
      <details>
        <summary>Bicep command</summary>
<pre><code>az deployment tenant create \
  --location eastus2 \
  --template-file infra/bicep/modules/management-groups.bicep \
  --parameters \
    companyName='&lt;yourcompany&gt;' \
    displayName='&lt;YourCompany&gt; Landing Zone' \
    prodSubscriptionId='&lt;PROD_SUB_ID&gt;' \
    nonprodSubscriptionId='&lt;NONPROD_SUB_ID&gt;'</code></pre>
      </details>
      <details>
        <summary>Terraform command</summary>
<pre><code>cd infra/terraform/modules/management-groups
terraform init
terraform apply \
  -var='subscription_id=&lt;ANY_SUB_ID&gt;' \
  -var='company_name=&lt;yourcompany&gt;' \
  -var='display_name=&lt;YourCompany&gt; Landing Zone' \
  -var='prod_subscription_id=&lt;PROD_SUB_ID&gt;' \
  -var='nonprod_subscription_id=&lt;NONPROD_SUB_ID&gt;'
cd ../../../..</code></pre>
      </details>
    </div>
    <div class="step-card">
      <div class="step-number">3</div>
      <h3>Deploy</h3>
      <span class="step-time">20 min</span>
      <p>Deploy the landing zone — policies, networking, monitoring, Defender for Cloud, and budgets. Copy the parameter file, edit with your values, preview with what-if/plan, then deploy.</p>
      <div class="callout-warning">
        <p><strong>Bicep: before you deploy, change <code>budgetStartDate</code>.</strong> The example file ships with an old date (<code>2026-03-01T00:00:00Z</code>). Set it to the first day of the current month, for example <code>2026-11-01T00:00:00Z</code>. A past or mid-month date makes the budget deployment fail. Terraform: leave <code>budget_start_date</code> out and it uses the first day of the current month automatically.</p>
      </div>
      <details>
        <summary>Bicep commands</summary>
<pre><code>cd infra/bicep

# Copy and edit parameters. Change every value in SECTION 1 (companyName, location,
# securityContactEmail, monthlyBudgetAmount, budgetAlertEmails, budgetStartDate).
# SECTION 2 is optional; defaults live in main.bicep.
cp parameters/prod.bicepparam parameters/prod.local.bicepparam

# Preview changes (no resources created)
az deployment sub what-if \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/prod.local.bicepparam

# Deploy
az deployment sub create \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/prod.local.bicepparam \
  --name "lz-prod-$(date +%Y%m%d-%H%M%S)"</code></pre>
      </details>
      <details>
        <summary>Terraform commands</summary>
<pre><code>cd infra/terraform

# Copy and edit variables (subscription_id, company_name, emails, etc.)
cp terraform.tfvars.example terraform.tfvars

# For local dev (no remote backend):
terraform init -backend=false
# For CI/CD or team use, set up remote backend first:
#   ./scripts/bootstrap-backend.sh -s &lt;storage-account-name&gt;
#   terraform init -backend-config="storage_account_name=&lt;name&gt;"

terraform plan -out=tfplan    # Preview changes
terraform apply tfplan        # Deploy</code></pre>
      </details>
    </div>
    <div class="step-card">
      <div class="step-number">4</div>
      <h3>Verify</h3>
      <span class="step-time">5 min</span>
      <p>Confirm resource groups, Log Analytics, policies, and Defender plans were created correctly.</p>
      <details>
        <summary>Show commands</summary>
<pre><code># Check resource groups
az group list \
  --query "[?contains(name, 'yourcompany')].name" -o tsv

# Check Log Analytics workspace
az monitor log-analytics workspace list \
  --query "[].name" -o tsv

# Check policy assignments
az policy assignment list \
  --query "[].displayName" -o tsv

# Check Defender plans
az security pricing list \
  --query "value[?pricingTier=='Standard'].{Name:name, Tier:pricingTier}" -o table

# Check security contact
az security contact show --name default \
  --query "{Email:emails, Roles:notificationsByRole.roles}" -o table

# Check budget
az consumption budget list \
  --query "[].{Name:name, Amount:amount, TimeGrain:timeGrain}" -o table

# Check NSG rules
az network nsg list --query "[].name" -o tsv</code></pre>
      </details>
    </div>
    <div class="step-card">
      <div class="step-number">5</div>
      <h3>Post-Deploy</h3>
      <span class="step-time">30 min</span>
      <p>Assign RBAC roles to your team, set up CI/CD with Workload Identity Federation, and enable cost anomaly alerts. See the <a href="#day-1-checklist">Day-1 Checklist</a> below.</p>
      <details>
        <summary>Teardown commands (if needed)</summary>
<pre><code># Use the same --env you deployed (prod or nonprod)
./scripts/teardown.sh --tool terraform --env prod --company yourcompany
./scripts/teardown.sh --tool bicep --env prod --company yourcompany

# By default, Bicep teardown deletes only the resource groups. To also remove
# leftovers (policy assignments and their role assignments, the activity-log
# diagnostic setting, budget, security contact), add the flag below to either
# tool. Use it only on a subscription with no other workloads. Defender plans stay.
./scripts/teardown.sh --tool terraform --env prod --company yourcompany --include-subscription-settings</code></pre>
      </details>
    </div>
  </div>
  <p style="text-align: center; margin-top: 2rem;">
    <a href="{{ site.github_repo }}#quick-start" class="btn btn-primary" target="_blank" rel="noopener">Full Deployment Guide</a>
  </p>
</section>

<section class="landing-section" id="day-1-checklist">
  <h2>Day-1 Checklist</h2>
  <p class="section-subtitle">90 minutes from zero to production-ready, in three phases.</p>
  <div class="timeline">
    <div class="timeline-phase">
      <div class="timeline-marker">
        <span class="timeline-icon">&#9881;</span>
        <span class="timeline-line"></span>
      </div>
      <div class="timeline-content">
        <div class="timeline-header">
          <h3>Pre-Deployment</h3>
          <span class="timeline-badge">30 min</span>
        </div>
        <ul>
          <li><a href="https://learn.microsoft.com/entra/fundamentals/whatis" target="_blank" rel="noopener">Verify Entra ID tenant is set up</a>, <a href="https://learn.microsoft.com/entra/fundamentals/add-custom-domain" target="_blank" rel="noopener">custom domain added</a></li>
          <li><a href="https://learn.microsoft.com/entra/fundamentals/security-defaults" target="_blank" rel="noopener">Enable Security Defaults</a> (Entra ID &gt; Properties &gt; Security Defaults)</li>
          <li><a href="https://learn.microsoft.com/entra/identity/role-based-access-control/security-emergency-access" target="_blank" rel="noopener">Create break-glass account</a> with hardware MFA key</li>
          <li><a href="https://learn.microsoft.com/entra/fundamentals/groups-view-azure-portal" target="_blank" rel="noopener">Create security group</a> <code>sg-azure-admins</code>, add 2-3 founders/leads</li>
        </ul>
      </div>
    </div>
    <div class="timeline-phase">
      <div class="timeline-marker">
        <span class="timeline-icon">&#9889;</span>
        <span class="timeline-line"></span>
      </div>
      <div class="timeline-content">
        <div class="timeline-header">
          <h3>Deploy</h3>
          <span class="timeline-badge">30 min</span>
        </div>
        <ul>
          <li>Run <a href="https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-to-subscription" target="_blank" rel="noopener">Bicep</a> or <a href="https://learn.microsoft.com/azure/developer/terraform/overview" target="_blank" rel="noopener">Terraform</a> deployment — see <a href="#quick-start">Step 3</a> above</li>
          <li>Verify resources in <a href="https://portal.azure.com" target="_blank" rel="noopener">Azure Portal</a></li>
        </ul>
      </div>
    </div>
    <div class="timeline-phase">
      <div class="timeline-marker">
        <span class="timeline-icon">&#10003;</span>
      </div>
      <div class="timeline-content">
        <div class="timeline-header">
          <h3>Post-Deployment</h3>
          <span class="timeline-badge">30 min</span>
        </div>
        <ul>
          <li><a href="https://learn.microsoft.com/azure/role-based-access-control/role-assignments-portal" target="_blank" rel="noopener">Assign</a> <code>sg-azure-admins</code> as Owner on the management group</li>
          <li>Create Entra ID groups: <code>sg-azure-developers</code>, <code>sg-azure-readers</code></li>
          <li>Assign <a href="https://learn.microsoft.com/azure/role-based-access-control/built-in-roles" target="_blank" rel="noopener">RBAC roles</a> (see <a href="{{ '/docs/security' | relative_url }}">Security docs</a>)</li>
          <li>Set up <a href="{{ '/docs/ci-cd-setup' | relative_url }}">CI/CD</a> with <a href="https://learn.microsoft.com/entra/workload-id/workload-identity-federation" target="_blank" rel="noopener">Workload Identity Federation</a></li>
          <li>Test a sample deployment end-to-end</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<section class="landing-section">
  <h2>What's Included</h2>
  <div class="included-grid">
    <div class="included-card">
      <span class="check-icon">&#10003;</span>
      <div>
        <h3>Management Groups</h3>
        <p>Single MG with two subscriptions underneath</p>
      </div>
    </div>
    <div class="included-card">
      <span class="check-icon">&#10003;</span>
      <div>
        <h3>Azure Policy</h3>
        <p>Microsoft Cloud Security Benchmark (audit), required tags, allowed locations</p>
      </div>
    </div>
    <div class="included-card">
      <span class="check-icon">&#10003;</span>
      <div>
        <h3>Networking</h3>
        <p>VNet + subnets per subscription, NSGs with deny-all-inbound default</p>
      </div>
    </div>
    <div class="included-card">
      <span class="check-icon">&#10003;</span>
      <div>
        <h3>Monitoring</h3>
        <p>Log Analytics workspace, Activity Log forwarding, diagnostic settings policy</p>
      </div>
    </div>
    <div class="included-card">
      <span class="check-icon">&#10003;</span>
      <div>
        <h3>Security</h3>
        <p>Defender for Cloud CSPM, Defender for Servers P2 (prod), MFA via Security Defaults</p>
      </div>
    </div>
    <div class="included-card">
      <span class="check-icon">&#10003;</span>
      <div>
        <h3>Cost Management</h3>
        <p>Budget alerts at 50/80/100%, tagging enforcement</p>
      </div>
    </div>
    <div class="included-card">
      <span class="check-icon">&#10003;</span>
      <div>
        <h3>CI/CD</h3>
        <p>GitHub Actions workflows for Bicep and Terraform</p>
      </div>
    </div>
  </div>
</section>

<section class="landing-section alt-bg">
  <h2>What's NOT Included (By Design)</h2>
  <p class="section-subtitle">Enterprise components you should add later when needed.</p>
  <div class="not-included-list">
    <div class="not-included-item">
      <span class="dash-icon">&ndash;</span>
      <div><strong>Hub VNet + Azure Firewall</strong> <span class="trigger">Add when hybrid connectivity or centralized egress control required</span></div>
    </div>
    <div class="not-included-item">
      <span class="dash-icon">&ndash;</span>
      <div><strong>ExpressRoute / VPN Gateway</strong> <span class="trigger">Add when on-prem connectivity needed</span></div>
    </div>
    <div class="not-included-item">
      <span class="dash-icon">&ndash;</span>
      <div><strong>Multiple MG layers</strong> <span class="trigger">Add when 5+ subscriptions with different policy needs</span></div>
    </div>
    <div class="not-included-item">
      <span class="dash-icon">&ndash;</span>
      <div><strong>Private DNS Zones at scale</strong> <span class="trigger">Add when 3+ PaaS services using Private Endpoints across VNets</span></div>
    </div>
    <div class="not-included-item">
      <span class="dash-icon">&ndash;</span>
      <div><strong>Advanced Conditional Access</strong> <span class="trigger">Add when 30+ Azure users or regulated customer data</span></div>
    </div>
    <div class="not-included-item">
      <span class="dash-icon">&ndash;</span>
      <div><strong>PIM (Privileged Identity Management)</strong> <span class="trigger">Add when you need just-in-time admin access (Series B+)</span></div>
    </div>
  </div>
  <p style="text-align: center; margin-top: 2rem;">
    <a href="{{ '/docs/graduation-guide' | relative_url }}" class="btn btn-primary">Graduation Guide</a>
  </p>
</section>

<section class="landing-section">
  <h2>Starter Examples</h2>
  <p class="section-subtitle">Pre-built configurations for common startup archetypes.</p>
  <div class="examples-grid">
    <a href="{{ site.github_repo }}/tree/main/examples/saas-startup" class="example-card" target="_blank" rel="noopener">
      <h3>SaaS Startup</h3>
      <p>Container Apps + Azure SQL Elastic Pool + Redis + Key Vault</p>
      <span class="card-link">View on GitHub &rarr;</span>
    </a>
    <a href="{{ site.github_repo }}/tree/main/examples/ai-startup" class="example-card" target="_blank" rel="noopener">
      <h3>AI Startup</h3>
      <p>AKS with GPU node pools + Azure OpenAI + Blob Storage</p>
      <span class="card-link">View on GitHub &rarr;</span>
    </a>
    <a href="{{ site.github_repo }}/tree/main/examples/api-first-startup" class="example-card" target="_blank" rel="noopener">
      <h3>API-First Startup</h3>
      <p>App Service + API Management + Cosmos DB</p>
      <span class="card-link">View on GitHub &rarr;</span>
    </a>
  </div>
</section>

<section class="landing-section alt-bg">
  <h2>Documentation</h2>
  <p class="section-subtitle">Practical guides written for engineers.</p>
  <div class="docs-grid">
    <a href="{{ '/docs/architecture' | relative_url }}" class="doc-card">
      <h3>Architecture Decisions</h3>
      <p>Why this layout, what we skipped, and when to revisit</p>
    </a>
    <a href="{{ '/docs/resource-inventory' | relative_url }}" class="doc-card">
      <h3>Resource Inventory</h3>
      <p>Complete list of every Azure resource created</p>
    </a>
    <a href="{{ '/docs/networking' | relative_url }}" class="doc-card">
      <h3>Networking Deep Dive</h3>
      <p>VNet design, NSGs, and when you actually need a hub</p>
    </a>
    <a href="{{ '/docs/security' | relative_url }}" class="doc-card">
      <h3>Security Baseline</h3>
      <p>Defender, RBAC, logging, and network security</p>
    </a>
    <a href="{{ '/docs/cost-management' | relative_url }}" class="doc-card">
      <h3>Cost Management</h3>
      <p>Budgets, reservations, and common cost mistakes</p>
    </a>
    <a href="{{ '/docs/ci-cd-setup' | relative_url }}" class="doc-card">
      <h3>CI/CD Setup</h3>
      <p>Workload Identity Federation and GitHub Actions</p>
    </a>
    <a href="{{ '/docs/troubleshooting' | relative_url }}" class="doc-card">
      <h3>Troubleshooting</h3>
      <p>Common deployment errors and fixes</p>
    </a>
    <a href="{{ '/docs/graduation-guide' | relative_url }}" class="doc-card">
      <h3>Graduation Guide</h3>
      <p>When and how to migrate to full ALZ</p>
    </a>
    <a href="{{ '/diagrams/architecture' | relative_url }}" class="doc-card">
      <h3>Architecture Diagrams</h3>
      <p>Visual diagrams of the full landing zone</p>
    </a>
  </div>
</section>
