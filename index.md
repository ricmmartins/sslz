---
layout: home
title: "Startup-Scale Landing Zone"
description: "A stripped-down, opinionated, deployable Azure Landing Zone for startups. Deploy in under 1 hour."
---

<section class="hero">
  <a href="{{ site.github_repo }}" class="hero-badge" target="_blank" rel="noopener">Open Source on GitHub</a>
  <h1>Azure Landing Zone<br>for Startups</h1>
  <p class="tagline">A stripped-down, opinionated, production-ready Azure Landing Zone designed for startups and digital-native teams. Built for companies with 5–50 engineers that need to get Azure right from day one without enterprise complexity.</p>
  <div class="hero-ctas">
    <a href="#quick-start" class="btn btn-primary">Quick Start</a>
    <a href="{{ site.github_repo }}" class="btn btn-secondary" target="_blank" rel="noopener">View on GitHub</a>
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
      <p>Enterprise-scoped, entering extended support (archived Aug 2026). Microsoft now recommends <a href="https://aka.ms/avm">Azure Verified Modules</a>.</p>
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
  <img src="{{ '/assets/images/architecture-overview.png' | relative_url }}" alt="Architecture overview showing Entra ID Tenant with management group, prod and nonprod subscriptions, networking, monitoring, policies, and budget alerts" style="max-width: 100%; border-radius: 10px; border: 1px solid var(--border-color);">
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
    </div>
    <div class="step-card">
      <div class="step-number">2</div>
      <h3>Deploy</h3>
      <span class="step-time">20 min</span>
      <p>Run Bicep or Terraform to create policies, networking, monitoring, security, and budgets.</p>
    </div>
    <div class="step-card">
      <div class="step-number">3</div>
      <h3>Verify</h3>
      <span class="step-time">5 min</span>
      <p>Check resource groups, Log Analytics, and policy assignments in the Portal or CLI.</p>
    </div>
    <div class="step-card">
      <div class="step-number">4</div>
      <h3>Post-Deploy</h3>
      <span class="step-time">30 min</span>
      <p>RBAC assignments, CI/CD setup with Workload Identity Federation, and first test deployment.</p>
    </div>
  </div>
  <p style="text-align: center; margin-top: 2rem;">
    <a href="{{ '/docs/ci-cd-setup' | relative_url }}" class="btn btn-primary">Full Deployment Guide</a>
  </p>
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
