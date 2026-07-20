# SSLZ — Startup-Scale Landing Zone
## Presentation for Ravi, Bhaskar & Amit | April 2, 2026

---

## SLIDE 1 — Title

**Startup-Scale Landing Zone (SSLZ)**
*Get Azure right from day one — without the enterprise overhead*

Ricardo Martins | April 2, 2026
startupscalelanding.zone

---

## SLIDE 2 — The Gap I Identified

**The problem:**

| What exists today                   | Why it fails startups                                  |
|-------------------------------------|--------------------------------------------------------|
| ALZ (Enterprise-Scale)              | 100+ modules, months to understand, built for 10K-seat orgs |
| ALZ-Bicep                           | Still enterprise-scoped, overwhelming for 10-person teams |
| CAF Terraform Module                | Enterprise-scoped, entering extended support (archived Aug 2026) |
| **Nothing**                         | **Most startups just skip governance entirely**        |

**The real competitor isn't ALZ — it's zero governance.**

---

## SLIDE 3 — What Startups Actually Do Today

Two paths, both wrong:

1. **Follow full ALZ** → 2 months of "cloud foundations" work, team of 5 engineers paralyzed
2. **Skip governance** → One subscription, no policies, no budgets, no RBAC. Works until:
   - First enterprise security questionnaire
   - First runaway cost incident
   - First `az group delete` that hits production

**Startups need a third path.**

---

## SLIDE 4 — The Solution I Built: SSLZ

**A deployable, opinionated Azure Landing Zone that ships in < 1 hour**

- **1 Management Group, 2 Subscriptions** (Prod + Non-Prod) — that's it
- **Security built-in** — Defender, RBAC groups, NSG deny-all, policy enforcement
- **Cost controls from day one** — Budget alerts at 50/80/100%, mandatory tagging
- **Explicit graduation path** — Step-by-step guide to migrate to full ALZ when ready

Target: Teams of 5–50 engineers | Pre-seed to Series A | No platform team

---

## SLIDE 5 — Architecture (Keep It Simple)

```
Tenant Root Group
└── mg-<yourcompany>              ← Policies applied here
    ├── sub-<yourcompany>-prod    ← Production workloads
    └── sub-<yourcompany>-nonprod ← Dev, staging, QA

vnet-<co>-prod (10.0.0.0/16)
├── snet-aks         10.0.0.0/20     (4,091 IPs)
├── snet-app         10.0.16.0/22    (1,019 IPs)
├── snet-data        10.0.20.0/22    (1,019 IPs)
└── snet-shared      10.0.24.0/24    (251 IPs)
```

No hub. No Azure Firewall ($900+/mo). No VNet peering.
Each subscription is self-contained. **Add complexity only when you need it.**

---

## SLIDE 6 — What Ships Out of the Box

| Component              | What's Deployed                                                    |
|------------------------|--------------------------------------------------------------------|
| **Management Groups**  | Single MG with 2 subscriptions                                     |
| **Azure Policy**       | MCSB (audit), required tags, allowed locations, diagnostic settings |
| **Networking**         | VNet + 4 subnets/subscription, NSGs with deny-all-inbound          |
| **Monitoring**         | Log Analytics, Activity Log forwarding, 90-day retention            |
| **Security**           | Defender CSPM (free) + Servers P2 (prod), security contact alerts   |
| **Cost Management**    | Budget alerts at 50/80/100%, tag enforcement via policy             |
| **CI/CD**              | GitHub Actions for Bicep & Terraform, Workload Identity Federation  |

---

## SLIDE 7 — Built for Real Startup Archetypes

Three production-grade example architectures (Bicep + Terraform):

| Archetype         | Stack                                                         |
|-------------------|---------------------------------------------------------------|
| **SaaS Startup**  | Container Apps + Azure SQL Elastic Pool + Redis + Key Vault    |
| **AI Startup**    | AKS + GPU Spot Pools + Azure OpenAI + Blob Storage + Redis     |
| **API-First**     | App Service + API Management + Cosmos DB + App Insights        |

Each includes deployment instructions, realistic cost estimates, and scaling guidance.

---

## SLIDE 8 — Project Traction & Metrics

**Repository:**
- 211 commits in ~6 weeks (Feb–Mar 2026)
- Dual IaC: 6 Bicep modules + 5 Terraform modules
- 5 GitHub Actions workflows (deploy, validate, integration test, pages)
- 8 documentation pages + graduation guide
- Custom domain: **startupscalelanding.zone**
- Published blog post on TechCommunity (Mar 12, 2026)

**My Startups at Microsoft Blog presence:**
- **38 articles** published on TechCommunity
- **189,273 total views** across all posts
- ⭐ Top posts:
  - "From Zero to Hero with Azure Landing Zones" — **42,558 views**
  - "Demystifying Microsoft Entra ID, Tenants & Subscriptions" — **35,159 views**
  - "Key Architectural Differences Between AWS and Azure" — **25,081 views**
- Topics span Landing Zones, Identity, Networking, AKS, Monitoring, Cost Optimization & more

---

## SLIDE 9 — Design Principles

Three rules behind every SSLZ decision:

1. **Opinionated over flexible**
   "It depends" isn't helpful with 5 engineers and no platform team. SSLZ makes the call.

2. **Reversible over perfect**
   Every decision can be changed later. Moving subscriptions between MGs = 10 seconds.

3. **Honest about trade-offs**
   We say "you'll outgrow this when..." and "here's what the next layer costs."

---

## SLIDE 10 — The Founders Hub Integration Vision

**Where SSLZ fits in the Founders Hub journey:**

```
Startup joins Founders Hub
        ↓
Gets Azure credits + benefits
        ↓
   ┌─── TODAY: No guidance on HOW to set up Azure properly ───┐
   │    Most startups burn credits on ungoverned single-sub    │
   └──────────────────────────────────────────────────────────-┘
        ↓
   ┌─── WITH SSLZ: Guided, secure Azure foundation ──────────┐
   │    Deploy in 1 hour → Security + cost controls → Scale   │
   │    → Graduate to ALZ when ready                          │
   └──────────────────────────────────────────────────────────-┘
```

**Integration proposal:**
- SSLZ as a recommended "Day 0" resource in Founders Hub onboarding
- Link from Founders Hub portal → startupscalelanding.zone
- Aligned with existing ALZ guidance (complementary, not competitive)
- Reduces support burden: startups hit fewer security/cost incidents

---

## SLIDE 11 — Why This Matters for the Org

| Metric                          | Impact                                                    |
|---------------------------------|-----------------------------------------------------------|
| **Startup retention on Azure**  | Better first experience → longer engagement               |
| **Support ticket reduction**    | Governance from day 1 → fewer "my bill exploded" escalations |
| **Enterprise readiness**        | Startups graduate to ALZ → become enterprise Azure customers |
| **Content flywheel**            | Blog series drives awareness → SSLZ drives adoption       |

---

## SLIDE 12 — What I'm Asking For

1. **Endorsement** to position SSLZ as a Founders Hub recommended resource
2. **Collaboration** with the Founders Hub team on onboarding integration
3. **Feedback** on the graduation path alignment with ALZ team's vision
4. **Visibility** — share with startup-facing field teams as a recommended starting point

---

## SLIDE 13 — Timeline & Next Steps

| Action                                          | Status          |
|-------------------------------------------------|-----------------|
| Identify gap in startup Azure onboarding        | ✅ Done          |
| Build SSLZ (Bicep + Terraform + docs)           | ✅ Done          |
| Publish on TechCommunity blog                   | ✅ Done (Mar 12) |
| Launch startupscalelanding.zone                 | ✅ Done          |
| Present to team (Ravi, Bhaskar, Amit)           | 📍 Today         |
| Founders Hub onboarding integration             | 🔜 Next          |
| Field team enablement & distribution            | 🔜 Planned       |
| Community feedback loop & iteration             | 🔄 Ongoing       |

---

## SLIDE 14 — Close

**I identified the gap. I built the solution. Now let's drive it into the org.**

🔗 **startupscalelanding.zone**
📝 **github.com/ricmmartins/sslz**
📰 **Startups at Microsoft Blog** — 38 articles, ~190K views

*"For startups, the alternative isn't ALZ — it's usually no governance at all."*
