# Architecture Diagrams

## Landing Zone Overview (Mermaid)

```mermaid
graph TB
    subgraph "Entra ID Tenant"
        subgraph "mg-yourcompany"
            subgraph "sub-prod"
                rg_mon_p["rg-prod-monitoring"]
                rg_net_p["rg-prod-networking"]
                rg_app_p["rg-prod-app"]

                subgraph "Monitoring"
                    law["Log Analytics Workspace"]
                    defender["Defender for Cloud"]
                end

                subgraph "Networking (prod-vnet 10.0.0.0/16)"
                    snet_aks["snet-aks /18"]
                    snet_app["snet-app /22"]
                    snet_data["snet-data /22"]
                    snet_shared["snet-shared /24"]
                end
            end

            subgraph "sub-nonprod"
                rg_mon_n["rg-nonprod-monitoring"]
                rg_net_n["rg-nonprod-networking"]

                subgraph "Networking (nonprod-vnet 10.1.0.0/16)"
                    snet_aks_n["snet-aks /18"]
                    snet_app_n["snet-app /22"]
                    snet_data_n["snet-data /22"]
                    snet_shared_n["snet-shared /24"]
                end
            end
        end

        policies["Azure Policies<br/>MCSB (audit) + Tags + Locations"]
        budgets["Budget Alerts<br/>50% / 80% / 100%"]
    end

    policies --> mg-yourcompany
    budgets --> sub-prod
    budgets --> sub-nonprod
    law --> sub-prod
    law --> sub-nonprod
```

## Graduation Path (Mermaid)

```mermaid
graph LR
    A["Starter<br/>1 MG, 2 Subs<br/>No Hub"] -->|"50+ engineers<br/>or compliance"| B["Phase 1<br/>MG Hierarchy"]
    B --> C["Phase 2<br/>Hub + Firewall"]
    C --> D["Phase 3<br/>Management Sub"]
    D --> E["Phase 4<br/>Policy Hardening"]
    E --> F["Full ESLZ"]

    style A fill:#22c55e,color:#fff
    style F fill:#3b82f6,color:#fff
```

## Networking Architecture

```mermaid
graph TB
    subgraph "prod-vnet 10.0.0.0/16"
        subgraph "snet-aks 10.0.0.0/18 (16,382 IPs)"
            aks_nodes["AKS Nodes + Pods<br/>(Azure CNI assigns pod IPs here)"]
        end
        subgraph "snet-app 10.0.64.0/22 (1,022 IPs)"
            app_svc["App Services<br/>Container Apps<br/>VNet-integrated"]
        end
        subgraph "snet-data 10.0.68.0/22 (1,022 IPs)"
            pe["Private Endpoints<br/>SQL, Cosmos, Redis,<br/>Storage, Key Vault"]
        end
        subgraph "snet-shared 10.0.72.0/24 (254 IPs)"
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
        defender_servers["Servers: Free tier"]
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

## Generating Diagrams

These Mermaid diagrams render natively on GitHub. For higher-quality visuals:

1. **VS Code:** Install the "Mermaid" extension for live preview
2. **CLI:** Use `mmdc` (mermaid-cli) to export as PNG/SVG:
   ```bash
   npx @mermaid-js/mermaid-cli mmdc -i architecture.md -o architecture.png
   ```
3. **draw.io:** Import the `.drawio` files in this directory (if added by contributors)
