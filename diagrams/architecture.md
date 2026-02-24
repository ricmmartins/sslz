---
layout: page
title: "Architecture Diagrams"
nav_order: 8
description: "Mermaid diagrams of the landing zone architecture"
---

# Architecture Diagrams

## Landing Zone Overview

![Landing Zone Overview]({{ '/assets/images/landing-zone-overview.png' | relative_url }})

## Graduation Path

![Graduation Path]({{ '/assets/images/graduation-path.png' | relative_url }})

## Networking Architecture

```mermaid
graph TB
    subgraph "prod-vnet 10.0.0.0/16"
        subgraph "snet-aks 10.0.0.0/18 (16,382 IPs)"
            aks_nodes["AKS Nodes + Pods<br/>(Azure CNI assigns pod IPs here)"]
        end
        subgraph "snet-app 10.0.4.0/22 (1,022 IPs)"
            app_svc["App Services<br/>Container Apps<br/>VNet-integrated"]
        end
        subgraph "snet-data 10.0.8.0/22 (1,022 IPs)"
            pe["Private Endpoints<br/>SQL, Cosmos, Redis,<br/>Storage, Key Vault"]
        end
        subgraph "snet-shared 10.0.12.0/24 (254 IPs)"
            bastion["Azure Bastion"]
            vpn["VPN Gateway<br/>(if needed)"]
        end
    end

    nsg_aks["NSG: snet-aks<br/>Deny all inbound (default)<br/>Allow AzureLoadBalancer<br/>Allow VNet internal"]
    nsg_app["NSG: snet-app<br/>Deny all inbound (default)<br/>Allow HTTPS from Internet"]
    nsg_data["NSG: snet-data<br/>Deny all inbound (default)<br/>Allow snet-aks, snet-app only"]

    nsg_aks --> aks_nodes
    nsg_app --> app_svc
    nsg_data --> pe

    internet["Internet"] -->|"HTTPS (443)"| app_svc
    aks_nodes -->|"Private Endpoint"| pe
    app_svc -->|"Private Endpoint"| pe
```

> **Note:** All subnets have a default deny-all-inbound NSG rule. Traffic is explicitly allowed per the arrows above. The `/18` AKS subnet is intentionally large because Azure CNI allocates one IP per pod.

## Security Model

```mermaid
graph TB
    subgraph "Entra ID"
        ga["Global Admin<br/>(break-glass account)<br/>MFA enforced, PIM eligible"]
        sg_admins["sg-azure-admins<br/>Role: Owner on mg-yourcompany"]
        sg_devs["sg-azure-developers<br/>Role: Contributor on sub-nonprod<br/>Role: Reader on sub-prod"]
    end

    subgraph "Azure Policy Enforcement"
        mcsb["MCSB Baseline<br/>(audit mode)"]
        tag_policy["Require tags:<br/>environment, team"]
        loc_policy["Allowed locations:<br/>eastus2, centralus"]
    end

    subgraph "Defender for Cloud"
        defender_servers["Servers: P2 (prod) / Free"]
        defender_containers["Containers: On (if AKS)"]
        defender_db["Databases: On (prod)"]
        defender_kv["Key Vault: On"]
    end

    subgraph "RBAC on Resources"
        kv_rbac["Key Vault<br/>RBAC authorization<br/>(no access policies)"]
        mi["Managed Identities<br/>App → Key Vault Secrets User<br/>AKS → AcrPull"]
    end

    ga -->|"emergency only"| sg_admins
    sg_admins -->|"manage"| mcsb
    sg_admins -->|"manage"| tag_policy
    sg_admins -->|"manage"| loc_policy
    sg_devs -->|"deploy to"| kv_rbac
    mi -->|"no passwords"| kv_rbac
    defender_servers --> mcsb
    defender_containers --> mcsb
    defender_db --> mcsb
    defender_kv --> mcsb
```
