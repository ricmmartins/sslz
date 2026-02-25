---
layout: home
title: "The Startup-Scale Landing Zone"
description: "A stripped-down, opinionated, deployable Azure Landing Zone for startups. Deploy in under 1 hour."
---

<section class="hero">
  <a href="{{ site.github_repo }}" class="hero-badge" target="_blank" rel="noopener">Open Source on GitHub</a>
  <h1>Startup-Scale Landing Zone</h1>
  <p class="tagline">A stripped-down, opinionated, production-ready Azure Landing Zone designed for startups and digital-native teams. Built for companies with 5–50 engineers that need to get Azure right from day one without enterprise complexity.</p>
  <div class="hero-ctas">
    <a href="#quick-start" class="btn btn-primary">Quick Start</a>
    <a href="{{ site.github_repo }}" class="btn btn-secondary" target="_blank" rel="noopener">View on GitHub</a>
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
        <div><strong>Deploy this in under 1 hour with Bicep or Terraform.</strong> Graduate to full ESLZ when you hit ~50 engineers, multi-region, or regulatory compliance requirements.</div>
      </div>
    </div>
  </div>
</section>

<section class="key-points landing-section">
  <h2>Why This Landing Zone</h2>
  <p class="section-subtitle">Enterprise-grade foundations without enterprise complexity.</p>
  <div class="cards-grid">
    <div class="card">
      <div class="card-icon">&#9889;</div>
      <h3>1 Hour Deploy</h3>
      <p>From zero to production-ready Azure with Bicep or Terraform. No consultants required.</p>
    </div>
    <div class="card">
      <div class="card-icon">&#9878;</div>
      <h3>2 Subscriptions</h3>
      <p>One management group, prod + non-prod. Simple hierarchy that grows with you.</p>
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
      <p>Deploys in 1 hour. Grows with you. Written for engineers, not consultants.</p>
    </div>
  </div>
</section>

<section class="architecture-preview landing-section">
  <h2>Architecture Overview</h2>
  <p class="section-subtitle">Simple, self-contained subscriptions. No hub network, no Azure Firewall — until you need them.</p>
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
            <span>prod-vnet</span>
            <code>10.0.0.0/16</code>
          </div>
          <div class="net-subnets">
            <div class="net-subnet subnet-aks"><span>snet-aks</span><code>/18</code></div>
            <div class="net-subnet subnet-app"><span>snet-app</span><code>/22</code></div>
            <div class="net-subnet subnet-data"><span>snet-data</span><code>/22</code></div>
            <div class="net-subnet subnet-shared"><span>snet-shared</span><code>/24</code></div>
          </div>
        </div>
        <div class="net-vnet net-vnet-nonprod">
          <div class="net-vnet-header">
            <span>nonprod-vnet</span>
            <code>10.1.0.0/16</code>
          </div>
          <div class="net-subnets">
            <div class="net-subnet subnet-aks"><span>snet-aks</span><code>/18</code></div>
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
      <p>Azure CLI, Terraform (optional), two subscriptions, and Owner permissions.</p>
      <details>
        <summary>Show commands</summary>
<pre><code>git clone https://github.com/ricmmartins/sslz.git
cd sslz

az login
az account set --subscription &lt;YOUR_PROD_SUBSCRIPTION_ID&gt;

# Check all prerequisites
./scripts/validate-prerequisites.sh</code></pre>
      </details>
    </div>
    <div class="step-card">
      <div class="step-number">2</div>
      <h3>Deploy</h3>
      <span class="step-time">20 min</span>
      <p>Run Bicep or Terraform to create policies, networking, monitoring, security, and budgets.</p>
      <details>
        <summary>Bicep commands</summary>
<pre><code>cd infra/bicep

cp parameters/prod.bicepparam parameters/prod.local.bicepparam
# Edit prod.local.bicepparam with your values

az deployment sub what-if \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/prod.local.bicepparam

az deployment sub create \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters/prod.local.bicepparam</code></pre>
      </details>
      <details>
        <summary>Terraform commands</summary>
<pre><code>cd infra/terraform

cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform plan -out=tfplan
terraform apply tfplan</code></pre>
      </details>
    </div>
    <div class="step-card">
      <div class="step-number">3</div>
      <h3>Verify</h3>
      <span class="step-time">5 min</span>
      <p>Check resource groups, Log Analytics, and policy assignments in the Portal or CLI.</p>
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
  --query "[?contains(name, 'mcsb')].displayName" -o tsv</code></pre>
      </details>
    </div>
    <div class="step-card">
      <div class="step-number">4</div>
      <h3>Post-Deploy</h3>
      <span class="step-time">30 min</span>
      <p>RBAC assignments, CI/CD setup with Workload Identity Federation, and first test deployment.</p>
      <details>
        <summary>Show commands</summary>
<pre><code># Teardown (if needed)
./scripts/teardown.sh --tool terraform --env nonprod
./scripts/teardown.sh --tool bicep --env nonprod</code></pre>
      </details>
    </div>
  </div>
  <p style="text-align: center; margin-top: 2rem;">
    <a href="{{ '/docs/ci-cd-setup' | relative_url }}" class="btn btn-primary">Full Deployment Guide</a>
  </p>
</section>

<section class="landing-section" id="day-1-checklist">
  <h2>Day-1 Checklist</h2>
  <p class="section-subtitle">90 minutes from zero to production-ready. Three phases, one afternoon.</p>
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
          <li>Verify Entra ID tenant is set up, custom domain added</li>
          <li>Enable Security Defaults (Entra ID &gt; Properties &gt; Security Defaults)</li>
          <li>Create break-glass account with hardware MFA key</li>
          <li>Create security group <code>sg-azure-admins</code>, add 2-3 founders/leads</li>
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
          <li>Run Bicep or Terraform deployment (creates policies, networking, monitoring, security, budgets)</li>
          <li>Verify resources in Azure Portal</li>
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
          <li>Assign <code>sg-azure-admins</code> as Owner on the management group</li>
          <li>Create Entra ID groups: <code>sg-azure-developers</code>, <code>sg-azure-readers</code></li>
          <li>Assign RBAC roles (see <a href="{{ '/docs/security' | relative_url }}">Security docs</a>)</li>
          <li>Set up CI/CD with Workload Identity Federation</li>
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
  <p class="section-subtitle">Practical guides written for engineers, not consultants.</p>
  <div class="docs-grid">
    <a href="{{ '/docs/architecture' | relative_url }}" class="doc-card">
      <h3>Architecture Decisions</h3>
      <p>Why this layout, what we skipped, and when to revisit</p>
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
      <p>When and how to migrate to full ESLZ</p>
    </a>
    <a href="{{ '/diagrams/architecture' | relative_url }}" class="doc-card">
      <h3>Architecture Diagrams</h3>
      <p>Visual diagrams of the full landing zone</p>
    </a>
  </div>
</section>
