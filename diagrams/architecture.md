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

## Generating Diagrams

These Mermaid diagrams render natively on GitHub. For higher-quality visuals:

1. **VS Code:** Install the "Mermaid" extension for live preview
2. **CLI:** Use `mmdc` (mermaid-cli) to export as PNG/SVG:
   ```bash
   npx @mermaid-js/mermaid-cli mmdc -i architecture.md -o architecture.png
   ```
3. **draw.io:** Import the `.drawio` files in this directory (if added by contributors)
