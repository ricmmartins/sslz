# Example: AI Startup

An AI/ML startup running inference workloads on AKS with GPU node pools, Azure OpenAI, and Blob Storage for model artifacts and training data.

## Architecture

```
Internet
    │
Azure Front Door (WAF)
    │
AKS Cluster
    ├── System node pool     (Standard_D4s_v5, 2-5 nodes)
    ├── GPU node pool         (Standard_NC6s_v3, 1-3 nodes, Spot)
    └── CPU inference pool    (Standard_D8s_v5, 2-10 nodes)
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
| AKS system pool (3x D4s_v5) | On-demand | $420 |
| AKS GPU pool (2x NC6s_v3 Spot) | Spot (~70% off) | $600 |
| AKS CPU inference pool (3x D8s_v5) | 1yr RI | $550 |
| Azure OpenAI | GPT-4o, ~1M tokens/day | $30-100 |
| Storage | 1TB LRS Hot | $20 |
| Redis | Standard C1 | $80 |
| ACR | Standard | $20 |
| Key Vault | Standard | $5 |
| **Total** | | **~$1,700-1,800/month** |

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
