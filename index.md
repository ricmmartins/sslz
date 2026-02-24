---
layout: home
title: "Startup-Scale Landing Zone"
description: "A stripped-down, opinionated, deployable Azure Landing Zone for startups. Deploy in under 1 hour."
---

<section class="hero">
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

<section class="architecture-preview landing-section">
  <h2>Architecture Overview</h2>
  <p class="section-subtitle">Simple, self-contained subscriptions. No hub network, no Azure Firewall — until you need them.</p>
  <pre><code class="language-mermaid">---
config:
  theme: base
  themeVariables:
    primaryColor: "#e8f4fd"
    primaryTextColor: "#1a1a2e"
    primaryBorderColor: "#0078D4"
    lineColor: "#0078D4"
    secondaryColor: "#e0fafe"
    tertiaryColor: "#f0f2f5"
    fontFamily: "Inter, Segoe UI, sans-serif"
    fontSize: "13px"
  flowchart:
    useMaxWidth: false
    padding: 30
    diagramPadding: 30
    nodeSpacing: 40
    rankSpacing: 40
---
graph TB
    subgraph tenant[" Entra ID Tenant "]
        subgraph mg[" mg-yourcompany "]
            subgraph prod[" sub-prod "]
                rg_mon_p["rg-prod-monitoring"]
                rg_net_p["rg-prod-networking"]
                rg_app_p["rg-prod-app"]
                subgraph monitoring[" Monitoring "]
                    law["Log Analytics"]
                    defender["Defender"]
                end
                subgraph net_prod[" prod-vnet 10.0.0.0/16 "]
                    snet_aks["snet-aks /18"]
                    snet_app["snet-app /22"]
                    snet_data["snet-data /22"]
                    snet_shared["snet-shared /24"]
                end
            end
            subgraph nonprod[" sub-nonprod "]
                rg_mon_n["rg-nonprod-monitoring"]
                rg_net_n["rg-nonprod-networking"]
                subgraph net_nonprod[" nonprod-vnet 10.1.0.0/16 "]
                    snet_aks_n["snet-aks /18"]
                    snet_app_n["snet-app /22"]
                    snet_data_n["snet-data /22"]
                    snet_shared_n["snet-shared /24"]
                end
            end
        end
        policies["Azure Policies\nMCSB + Tags + Locations"]
        budgets["Budget Alerts\n50% / 80% / 100%"]
    end
    policies --&gt; rg_mon_p
    policies --&gt; rg_mon_n
    budgets --&gt; rg_app_p
    budgets --&gt; rg_net_n
    law --&gt; defender

    style tenant fill:#f0f2f5,stroke:#718096,color:#1a1a2e
    style mg fill:#f8f9fa,stroke:#0078D4,color:#1a1a2e,stroke-width:2px
    style prod fill:#e8f4fd,stroke:#0078D4,color:#1a1a2e,stroke-width:2px
    style nonprod fill:#e0fafe,stroke:#50E6FF,color:#1a1a2e,stroke-width:2px
    style monitoring fill:#dbeafe,stroke:#005A9E,color:#1a1a2e
    style net_prod fill:#dbeafe,stroke:#005A9E,color:#1a1a2e
    style net_nonprod fill:#d5f5f6,stroke:#30C6DF,color:#1a1a2e

    style rg_mon_p fill:#0078D4,color:#fff,stroke:#005A9E
    style rg_net_p fill:#0078D4,color:#fff,stroke:#005A9E
    style rg_app_p fill:#0078D4,color:#fff,stroke:#005A9E
    style rg_mon_n fill:#50E6FF,color:#1a1a2e,stroke:#30C6DF
    style rg_net_n fill:#50E6FF,color:#1a1a2e,stroke:#30C6DF
    style law fill:#005A9E,color:#fff,stroke:#003D6B
    style defender fill:#005A9E,color:#fff,stroke:#003D6B
    style snet_aks fill:#fff,color:#1a1a2e,stroke:#0078D4
    style snet_app fill:#fff,color:#1a1a2e,stroke:#0078D4
    style snet_data fill:#fff,color:#1a1a2e,stroke:#0078D4
    style snet_shared fill:#fff,color:#1a1a2e,stroke:#0078D4
    style snet_aks_n fill:#fff,color:#1a1a2e,stroke:#50E6FF
    style snet_app_n fill:#fff,color:#1a1a2e,stroke:#50E6FF
    style snet_data_n fill:#fff,color:#1a1a2e,stroke:#50E6FF
    style snet_shared_n fill:#fff,color:#1a1a2e,stroke:#50E6FF
    style policies fill:#0078D4,color:#fff,stroke:#005A9E,stroke-width:2px
    style budgets fill:#50E6FF,color:#1a1a2e,stroke:#30C6DF,stroke-width:2px
  </code></pre>
</section>

<section class="whats-included landing-section" id="quick-start">
  <h2>What's Included</h2>
  <p class="section-subtitle">Everything you need to start, nothing you don't.</p>
  <table>
    <thead>
      <tr><th>Component</th><th>What You Get</th></tr>
    </thead>
    <tbody>
      <tr><td><strong>Management Groups</strong></td><td>Single MG with two subscriptions underneath</td></tr>
      <tr><td><strong>Azure Policy</strong></td><td>Microsoft Cloud Security Benchmark (audit), required tags, allowed locations</td></tr>
      <tr><td><strong>Networking</strong></td><td>VNet + subnets per subscription, NSGs with deny-all-inbound default</td></tr>
      <tr><td><strong>Monitoring</strong></td><td>Log Analytics workspace, Activity Log forwarding, diagnostic settings policy</td></tr>
      <tr><td><strong>Security</strong></td><td>Defender for Cloud CSPM, Defender for Servers P2 (prod), MFA via Security Defaults</td></tr>
      <tr><td><strong>Cost Management</strong></td><td>Budget alerts at 50/80/100%, tagging enforcement</td></tr>
      <tr><td><strong>CI/CD</strong></td><td>GitHub Actions workflows for Bicep and Terraform</td></tr>
    </tbody>
  </table>
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

<section class="landing-section">
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
      <p>Mermaid diagrams of the full landing zone</p>
    </a>
  </div>
</section>
