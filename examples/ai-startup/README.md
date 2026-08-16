# Example: AI Startup

An AI/ML startup running inference workloads on AKS with GPU node pools, Azure OpenAI, and Blob Storage for model artifacts and training data.

## Status and execution boundary

The Bicep and Terraform examples are direct operator IaC, not Phase 6 agent-approved workload deployments. Current-main
evidence covers Bicep build/lint plus Terraform format/lint/validation in hosted CI; it does not include example-specific
Terraform behavioral tests or a retained live deployment, GPU allocation, model-capacity, application-health, or
recovery record for this example.

## Architecture

```
Internet
    │
AKS Cluster
    ├── System node pool     (Standard_D4s_v5, 2-5 nodes)
    ├── GPU node pool         (Standard_NC6s_v3, 0-3 nodes, Spot)
    └── CPU burst pool        (Standard_D4s_v5, 0-10 nodes, Spot)
    │
    ├── Azure OpenAI Service
    ├── Azure Blob Storage    (models, datasets, outputs)
    ├── Azure Cache for Redis (inference caching)
    ├── Azure Container Registry
    └── Azure Key Vault
```

## Why This Stack

| Choice | Rationale |
|---|---|
| AKS over Azure ML | Full control over inference serving (vLLM, TGI, Triton). Azure ML is great for experimentation but adds abstraction you may not want in production inference. |
| GPU Spot nodes | 60-90% savings on GPU compute. Inference can handle evictions with graceful drain + multiple replicas. |
| Azure OpenAI | Managed GPT-4/GPT-4o for RAG, summarization, embeddings. No GPU needed for these workloads. |
| Blob Storage | Cheapest storage for large model weights and datasets. Use lifecycle policies to tier old data to Cool/Archive. |

## Estimated Monthly Cost

| Resource | SKU | Est. Cost |
|---|---|---|
| AKS system pool (2x D4s_v5) | On-demand | $280 |
| AKS GPU pool (2x NC6s_v3 Spot) | Spot (~70% off) | $600 |
| AKS CPU burst pool (3x D4s_v5) | Spot (~70% off) | $200 |
| Azure OpenAI | GPT-4o, ~1M tokens/day | $30-100 |
| Storage | 1TB LRS Hot | $20 |
| Redis | Standard C1 | $54 |
| ACR | Standard | $20 |
| Key Vault | Standard | $5 |
| **Total** | | **~$1,150-1,250/month** |

## Key Decisions

### GPU Node Management

- Use **Spot VMs** for GPU nodes that handle batch inference or can tolerate restarts
- Use **on-demand** for GPU nodes serving real-time, latency-sensitive inference
- Set `--node-taints sku=gpu:NoSchedule` to prevent non-GPU workloads from landing on expensive GPU nodes
- Use KEDA with Prometheus metrics for autoscaling based on inference queue depth

### Model Serving

Options ranked by complexity:
1. **vLLM** — Best for LLM inference. Supports continuous batching, PagedAttention. Easiest to run on AKS.
2. **Triton Inference Server** — Best for multi-model serving (CV, NLP, tabular). More complex but very flexible.
3. **TGI (Text Generation Inference)** — HuggingFace's solution. Good middle ground.

### Cost Optimization

- **Inference caching with Redis:** Cache frequent prompts/responses. 30-50% cost reduction on LLM calls.
- **Azure OpenAI PTU:** If your Azure OpenAI spend exceeds $5k/month, investigate Provisioned Throughput Units for predictable pricing.
- **Blob lifecycle policies:** Automatically move training data older than 30 days to Cool tier (50% cheaper).

## Deploy

### Prerequisites

- Azure CLI >= 2.53.0 with Bicep CLI (or Terraform >= 1.5.0)
- An existing resource group (you must create this — the landing zone does not create application resource groups)
- An SSH public key for AKS node access
- You may need to request GPU quota for NC-series VMs via the Azure Portal (Quotas page)

### Bicep

```bash
cd examples/ai-startup

# Edit the parameter file with your values
cp main.bicepparam main.local.bicepparam
# Update appName, sshPublicKey, etc.

az deployment group create \
  --resource-group rg-mycompany-prod-app \
  --template-file main.bicep \
  --parameters main.local.bicepparam
```

### Terraform

```bash
cd examples/ai-startup/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

terraform init
terraform plan
terraform apply
```

### Post-Deploy

1. Get AKS credentials:
   ```bash
   az aks get-credentials --resource-group <RG_NAME> --name aks-<APP_NAME>-<ENV>
   ```
2. Install the NVIDIA device plugin for GPU workloads:
   ```bash
   kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.1/nvidia-device-plugin.yml
   ```
3. Push your inference container to ACR:
   ```bash
   az acr login --name <ACR_NAME>
   docker push <ACR_LOGIN_SERVER>/inference:latest
   ```

## Teardown

To destroy all resources created by this example:

### Bicep

```bash
# Remove resource locks first if deploying to prod
az lock delete --name protect-kv \
  --resource-group rg-mycompany-prod-app \
  --resource-type Microsoft.KeyVault/vaults \
  --resource-name kv-<APP_NAME>-<ENV>

az group delete --name <RESOURCE_GROUP_NAME> --yes --no-wait
```

### Terraform

```bash
cd examples/ai-startup/terraform
terraform destroy
```

> **Note:** AKS clusters can take 10-15 minutes to fully delete. Storage accounts with blob containers will fail to delete if they contain data — empty the containers first or use `terraform destroy -target` to remove other resources first.
