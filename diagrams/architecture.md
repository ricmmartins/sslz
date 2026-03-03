---
layout: page
title: "Architecture Diagrams"
nav_order: 8
description: "Visual diagrams of the landing zone architecture"
---

## Landing Zone Overview

<div class="viz-diagram">
<div class="viz-boundary">
<span class="viz-boundary-label">Entra ID Tenant</span>
<div class="viz-mg-bar">
<span class="viz-mg-icon">&#9878;</span>
<span class="viz-mg-name">mg-yourcompany</span>
<span class="viz-pill viz-pill-blue">Policies Applied</span>
<span class="viz-pill viz-pill-amber">Budget Alerts</span>
</div>
<div class="viz-two-col">
<div class="viz-sub-card">
<div class="viz-sub-title viz-amber-accent">
<span class="viz-dot viz-dot-amber"></span>
<strong>sub-nonprod</strong>
</div>
<div class="viz-rg-list">
<span class="viz-rg-tag">rg-&lt;co&gt;-nonprod-monitoring</span>
<span class="viz-rg-tag">rg-&lt;co&gt;-nonprod-networking</span>
</div>
<div class="viz-vnet-box viz-amber-border">
<div class="viz-vnet-title"><span>vnet-&lt;co&gt;-nonprod</span><code>10.1.0.0/16</code></div>
<div class="viz-subnet-grid">
<span class="viz-subnet snet-aks">snet-aks /20</span>
<span class="viz-subnet snet-app">snet-app /22</span>
<span class="viz-subnet snet-data">snet-data /22</span>
<span class="viz-subnet snet-shared">snet-shared /24</span>
</div>
</div>
</div>
<div class="viz-sub-card">
<div class="viz-sub-title viz-green-accent">
<span class="viz-dot viz-dot-green"></span>
<strong>sub-prod</strong>
</div>
<div class="viz-rg-list">
<span class="viz-rg-tag">rg-&lt;co&gt;-prod-monitoring</span>
<span class="viz-rg-tag">rg-&lt;co&gt;-prod-networking</span>
</div>
<div class="viz-vnet-box viz-green-border">
<div class="viz-vnet-title"><span>vnet-&lt;co&gt;-prod</span><code>10.0.0.0/16</code></div>
<div class="viz-subnet-grid">
<span class="viz-subnet snet-aks">snet-aks /20</span>
<span class="viz-subnet snet-app">snet-app /22</span>
<span class="viz-subnet snet-data">snet-data /22</span>
<span class="viz-subnet snet-shared">snet-shared /24</span>
</div>
</div>
</div>
</div>
<div class="viz-cross-row">
<div class="viz-cross-item viz-blue-left">
<strong>Azure Policies</strong>
<span>MCSB (audit) + Tags + Locations</span>
</div>
<div class="viz-cross-item viz-amber-left">
<strong>Budget Alerts</strong>
<span>50% / 80% / 100% thresholds</span>
</div>
<div class="viz-cross-item viz-green-left">
<strong>Monitoring</strong>
<span>Log Analytics + Defender for Cloud</span>
</div>
</div>
</div>
</div>

## Graduation Path

<div class="viz-diagram">
<div class="viz-grad-pipeline">
<div class="viz-grad-step viz-grad-active">
<div class="viz-grad-num">&#10003;</div>
<strong>Starter</strong>
<span>1 MG, 2 Subs</span>
<span>No Hub</span>
</div>
<div class="viz-grad-step">
<div class="viz-grad-num">1</div>
<strong>MG Hierarchy</strong>
<span>Multi-level groups</span>
</div>
<div class="viz-grad-step">
<div class="viz-grad-num">2</div>
<strong>Hub + Firewall</strong>
<span>Centralized egress</span>
</div>
<div class="viz-grad-step">
<div class="viz-grad-num">3</div>
<strong>Management Sub</strong>
<span>Dedicated ops</span>
</div>
<div class="viz-grad-step">
<div class="viz-grad-num">4</div>
<strong>Policy Hardening</strong>
<span>Deny-mode policies</span>
</div>
<div class="viz-grad-step">
<div class="viz-grad-num">5</div>
<strong>Identity Hardening</strong>
<span>PIM, Access Reviews</span>
</div>
<div class="viz-grad-step viz-grad-final">
<div class="viz-grad-num">&#9733;</div>
<strong>Full ESLZ</strong>
<span>Enterprise-ready</span>
</div>
</div>
<div class="viz-grad-trigger">
<span>&#8599; Trigger: 50+ engineers, multi-region, or regulatory compliance requirements</span>
</div>
</div>

## Networking Architecture

<div class="viz-diagram">
<div class="viz-net-ingress">
<span class="viz-net-cloud">&#9729; Internet</span>
<span class="viz-net-proto">HTTPS (443)</span>
</div>
<div class="viz-net-nsg-row">
<div class="viz-net-nsg">
<strong>NSG: snet-aks</strong>
<span>Deny all inbound (default)</span>
<span>Allow AzureLoadBalancer</span>
<span>Allow VNet internal</span>
</div>
<div class="viz-net-nsg">
<strong>NSG: snet-app</strong>
<span>Deny all inbound (default)</span>
</div>
<div class="viz-net-nsg">
<strong>NSG: snet-data</strong>
<span>Deny all inbound (default)</span>
<span>Allow snet-aks, snet-app only</span>
</div>
</div>
<div class="viz-net-vnet">
<div class="viz-net-vnet-header"><span>vnet-&lt;co&gt;-prod</span><code>10.0.0.0/16</code></div>
<div class="viz-net-subnet-grid">
<div class="viz-net-subnet-card viz-purple-top">
<div class="viz-net-subnet-head"><strong>snet-shared</strong><code>10.0.24.0/24</code></div>
<span class="viz-net-ip-count">251 IPs</span>
<div class="viz-net-svc-list">
<span>Azure Bastion</span>
<span>VPN Gateway (if needed)</span>
</div>
</div>
<div class="viz-net-subnet-card viz-blue-top">
<div class="viz-net-subnet-head"><strong>snet-aks</strong><code>10.0.0.0/20</code></div>
<span class="viz-net-ip-count">4,091 IPs</span>
<div class="viz-net-svc-list">
<span>AKS Nodes + Pods</span>
<span>Azure CNI assigns pod IPs here</span>
</div>
</div>
<div class="viz-net-subnet-card viz-green-top">
<div class="viz-net-subnet-head"><strong>snet-app</strong><code>10.0.16.0/22</code></div>
<span class="viz-net-ip-count">1,019 IPs</span>
<div class="viz-net-svc-list">
<span>App Services</span>
<span>Container Apps (VNet-integrated)</span>
</div>
</div>
<div class="viz-net-subnet-card viz-amber-top">
<div class="viz-net-subnet-head"><strong>snet-data</strong><code>10.0.20.0/22</code></div>
<span class="viz-net-ip-count">1,019 IPs</span>
<div class="viz-net-svc-list">
<span>SQL, Cosmos, Redis</span>
<span>Storage, Key Vault</span>
</div>
</div>
</div>
</div>
<div class="viz-net-pe-bar">
<span>&#128279; Private Endpoints connect snet-aks and snet-app to data services in snet-data</span>
</div>
</div>

> **Note:** All subnets have a default deny-all-inbound NSG rule. The `/20` AKS subnet is intentionally large because Azure CNI allocates one IP per pod.

## Security Model

<div class="viz-diagram">
<div class="viz-sec-stack">
<div class="viz-sec-layer">
<div class="viz-sec-layer-label">&#128100; Identity</div>
<div class="viz-sec-layer-cards">
<div class="viz-sec-card">
<strong>Global Admin</strong>
<span>Break-glass account</span>
<span>MFA enforced, no PIM</span>
<span class="viz-sec-badge viz-badge-red">Emergency only</span>
</div>
<div class="viz-sec-card">
<strong>sg-azure-admins</strong>
<span>Owner on mg-yourcompany</span>
</div>
<div class="viz-sec-card">
<strong>sg-azure-developers</strong>
<span>Contributor on sub-nonprod</span>
<span>Reader on sub-prod</span>
</div>
</div>
</div>
<div class="viz-sec-arrow">&#8595;</div>
<div class="viz-sec-layer">
<div class="viz-sec-layer-label">&#128737; Security Tooling</div>
<div class="viz-sec-layer-cards">
<div class="viz-sec-card">
<strong>CSPM</strong>
<span>Free (always)</span>
</div>
<div class="viz-sec-card">
<strong>Servers</strong>
<span>P2 (prod) / Free</span>
</div>
<div class="viz-sec-card">
<strong>Databases</strong>
<span>On (prod)</span>
</div>
<div class="viz-sec-card">
<strong>Containers</strong>
<span>On (if AKS)</span>
</div>
<div class="viz-sec-card">
<strong>Key Vault</strong>
<span>On</span>
</div>
<div class="viz-sec-card">
<strong>ARM</strong>
<span>On (always)</span>
</div>
</div>
</div>
<div class="viz-sec-arrow">&#8595;</div>
<div class="viz-sec-layer">
<div class="viz-sec-layer-label">&#9878; Governance</div>
<div class="viz-sec-layer-cards">
<div class="viz-sec-card">
<strong>MCSB Baseline</strong>
<span>Audit mode</span>
</div>
<div class="viz-sec-card">
<strong>Required Tags</strong>
<span>environment, team</span>
</div>
<div class="viz-sec-card">
<strong>Allowed Locations</strong>
<span>eastus2, centralus</span>
</div>
</div>
</div>
<div class="viz-sec-arrow">&#8595;</div>
<div class="viz-sec-layer">
<div class="viz-sec-layer-label">&#128274; Access Control</div>
<div class="viz-sec-layer-cards">
<div class="viz-sec-card">
<strong>Managed Identities</strong>
<span>App &#8594; Key Vault Secrets User</span>
<span>AKS &#8594; AcrPull</span>
<span class="viz-sec-badge viz-badge-green">No passwords</span>
</div>
<div class="viz-sec-card">
<strong>Key Vault</strong>
<span>RBAC authorization</span>
<span>No access policies</span>
</div>
</div>
</div>
</div>
</div>
