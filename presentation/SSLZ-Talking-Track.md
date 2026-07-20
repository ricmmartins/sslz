# SSLZ — Per-Slide Talking Track
## Meeting with Ravi, Bhaskar & Amit | April 2, 2026
---

## SLIDE 1 — Title

**SAY:**

> "Hey everyone, thanks for making time for this. I want to walk you through something I've been building over the last couple of months that I believe has real strategic value for how we onboard startups onto Azure — and specifically, how it fits into the Founders Hub journey.
>
> I'll cover the gap I identified, the solution I built, the traction it's getting, and then I have a specific ask for your support on the next phase."

**TIMING:** ~1 min

---

## SLIDE 2 — The Gap I Identified

**SAY:**

> "So let me set the stage. When a startup wants to set up their Azure environment properly today, what are their options?
>
> They can follow the full Azure Landing Zone — which is excellent, battle-tested, and designed for organizations with thousands of users. But it's 100+ modules, a deep management group hierarchy, and months of work. For a 10-person startup, it's like buying a commercial kitchen to make breakfast.
>
> Or there's ALZ-Bicep, CAF Terraform — still enterprise-scoped. And the CAF Terraform module is actually entering extended support, archived August this year.
>
> So what actually happens? Most startups just... skip governance entirely.
>
> And that's the key insight here: **the real competitor isn't ALZ — it's zero governance.** That's the gap I identified."

**TIMING:** ~2 min

**IF ASKED:** "What about the Trey Research small-enterprise reference?"
> "Trey Research is a reference architecture — a diagram and documentation. It also targets small enterprises with 100+ users. What I built is deployable infrastructure for startups with 5–15 engineers. You clone the repo, run the deployment, done in under an hour."

---

## SLIDE 3 — What Startups Actually Do Today

**SAY:**

> "Let me make this concrete. Today startups face two paths, and both are wrong.
>
> Option A: follow full ALZ. Two months of 'cloud foundations' work. Your team of 5 engineers is paralyzed.
>
> Option B — and this is what I see over and over working with startups — they skip governance. One subscription, no policies, no budgets, no RBAC. Ship fast, deal with security later.
>
> And it works... until the first enterprise customer sends a security questionnaire. Until the first runaway cost incident. Until someone runs `az group delete` and it hits production.
>
> Startups need a third path. That's what I built."

**TIMING:** ~2 min

---

## SLIDE 4 — The Solution: SSLZ

**SAY:**

> "So I built the Startup-Scale Landing Zone — SSLZ. It's an opinionated, production-ready Azure infrastructure template that deploys in under one hour using either Bicep or Terraform.
>
> Four things make it different:
>
> First — one management group, two subscriptions. Prod and non-prod. That's it. No six-layer hierarchy.
>
> Second — security is built-in. Defender for Cloud, RBAC groups, NSG deny-all defaults, policy enforcement. All automated, not manual steps.
>
> Third — cost controls from day one. Budget alerts at 50, 80, and 100 percent. Mandatory tagging. No exceptions.
>
> And fourth — and this is critical — an explicit graduation path. When you outgrow SSLZ, there's a step-by-step guide to migrate to full ALZ. This isn't a dead end. It's an on-ramp.
>
> Important framing: this is NOT a competitor to ALZ. It's complementary. It targets a completely different profile — teams of 5 to 50 engineers, pre-seed to Series A, no platform team."

**TIMING:** ~3 min

**IF ASKED:** "Does the ALZ team know about this?"
> "I've been transparent about the positioning — complementary, not competitive. The graduation guide explicitly funnels startups into ALZ when they're ready. I'd welcome a conversation with the ALZ team to tighten that alignment."

---

## SLIDE 5 — Architecture

**SAY:**

> "The architecture is deliberately minimal. One management group with two subscriptions underneath. Each subscription gets its own VNet with a standardized subnet layout — AKS, app, data, shared.
>
> Now look at what's NOT here. No hub network. No Azure Firewall — which runs $900-plus a month. No VNet peering. Each subscription is self-contained.
>
> Why? A hub-spoke topology costs $1,500 a month minimum. For a startup with a single workload in a single region, that's cost and complexity with zero return. NSGs provide network filtering for free and handle 95 percent of startup networking use cases.
>
> When they actually need centralized egress control or hybrid connectivity, the graduation guide walks them through adding a hub — without touching any existing resources. Everything here is additive, not a rebuild."

**TIMING:** ~2 min

**IF ASKED:** "What about security without a firewall?"
> "NSGs provide L3/L4 filtering. For startups with a single workload in a single region, that's sufficient. The graduation guide covers when and how to add a hub and firewall — the trigger is usually hybrid connectivity or compliance requirements."

---

## SLIDE 6 — What Ships Out of the Box

**SAY:**

> "Quick rundown of what you get out of the box.
>
> Management groups, Azure Policy with the Microsoft Cloud Security Benchmark in audit mode — not deny, so we don't block legitimate deployments on day one. VNets with NSGs. Log Analytics with activity log forwarding. Defender for Cloud — CSPM is free, Servers P2 on prod only where the risk actually is. Budget alerts. And full CI/CD with GitHub Actions using Workload Identity Federation — so no secrets to store, rotate, or accidentally commit.
>
> All of this deploys in one command."

**TIMING:** ~1 min (move through quickly, it's a reference slide)

---

## SLIDE 7 — Startup Archetypes

**SAY:**

> "I also built three production-grade example architectures. These aren't toy demos — each one has full Bicep and Terraform implementations, deployment instructions, and realistic cost estimates.
>
> SaaS startup: Container Apps with Azure SQL Elastic Pool, Redis, Key Vault. Multi-tenant with shared schema. Container Apps scale to zero in non-prod.
>
> AI startup: AKS with GPU Spot node pools — 60 to 90 percent savings — plus Azure OpenAI, Blob Storage, Redis for inference caching. Covers model serving framework choices and KEDA autoscaling.
>
> API-first startup: App Service with deployment slots for zero-downtime swaps, API Management on Consumption tier — pay-per-call — and Cosmos DB.
>
> The idea is that a startup can pick the archetype closest to their stack and have a working production environment in a couple of hours."

**TIMING:** ~2 min

---

## SLIDE 8 — Traction & Blog

**SAY:**

> "Let me share where this stands in terms of traction.
>
> On the repo side: 211 commits in about six weeks. Dual IaC — 6 Bicep modules, 5 Terraform modules. Five GitHub Actions workflows. Eight documentation pages. Three startup archetype examples. Custom domain — startupscalelanding.zone. This is polished and production-ready.
>
> But the bigger story is the content engine I've been building. I've published **38 articles** on the Startups at Microsoft blog on TechCommunity. Collectively, those posts have generated **nearly 190,000 views**.
>
> *(pause — let the number land)*
>
> The top three alone account for over 100,000 views: 'From Zero to Hero with Azure Landing Zones' — 42,000 views. 'Demystifying Microsoft Entra ID, Tenants & Subscriptions' — 35,000 views. 'Key Architectural Differences Between AWS and Azure' — 25,000 views.
>
> And beyond those, I've got articles on AKS networking, identity and access control, Azure monitoring strategies, VM cost optimization — the full range of topics that startups hit as they scale on Azure.
>
> The SSLZ project is the natural next step in that body of work. The 'From Zero to Hero' article — 42K views — is literally the foundation article that SSLZ builds on.
>
> 38 articles built the audience. SSLZ gives that audience something actionable to deploy. And Founders Hub is the distribution channel that ties it all together."

**TIMING:** ~3 min

**IF ASKED:** "Who's using it?"
> "The blog engagement speaks for itself — 190K views means we're reaching the right audience. I can share specific startup conversations if helpful. The real scale comes from the Founders Hub integration — that's the distribution channel."

---

## SLIDE 9 — Design Principles

**SAY:**

> "Three principles guided every decision in SSLZ.
>
> First: opinionated over flexible. 'It depends' isn't helpful when you have five engineers and no platform team. SSLZ makes the call — two subscriptions, no hub, deny-all NSGs, MCSB in audit mode — and tells you when to revisit.
>
> Second: reversible over perfect. Nothing here paints you into a corner. Moving subscriptions between management groups is a 10-second operation. Adding a hub is a new deployment, not a rebuild.
>
> Third: honest about trade-offs. We don't claim 'enterprise-grade.' We say 'you'll outgrow this when these signals appear' and we tell you exactly what the next layer costs. That transparency is what separates useful guidance from marketing."

**TIMING:** ~2 min

---

## SLIDE 10 — Founders Hub Integration Vision

**SAY:**

> *(Slow down here — this is the core ask)*
>
> "Now here's where I think this gets really interesting and why I wanted to bring this to you.
>
> Look at the left side — this is today. A startup joins Founders Hub, gets Azure credits and benefits. Great. But then what? There's no guidance on HOW to set up Azure properly. Most of them create a single subscription with zero governance. They burn through credits inefficiently. Some hit security issues. Some hit cost surprises. Some churn off Azure because the initial experience felt chaotic.
>
> Now look at the right side — with SSLZ. Same startup, same credits, but now they also get a recommended path to deploy a secure foundation in one hour. Security and cost controls from day one. And when they're ready — when they hit 50 engineers, or need multi-region, or face compliance requirements — they graduate to full ALZ.
>
> What I'm proposing is that we position SSLZ as a recommended resource in the Founders Hub onboarding flow. Not mandatory — recommended. A link from the portal to startupscalelanding.zone as part of the 'get started' guidance."

**TIMING:** ~3 min

---

## SLIDE 11 — Why This Matters for the Org

**SAY:**

> "Let me connect this to outcomes we all care about.
>
> Startup retention — a better first experience means startups stay on Azure longer. That's direct impact on consumption.
>
> Support reduction — governance from day one means fewer 'my bill exploded' escalations and fewer security incidents to triage.
>
> Enterprise pipeline — startups that start with SSLZ have a clear path to become full ALZ enterprise customers. We're building the funnel.
>
> And the content flywheel — the blog series drives awareness into the community, SSLZ converts that into adoption. They reinforce each other."

**TIMING:** ~2 min

---

## SLIDE 12 — The Ask

**SAY:**

> "So here's what I'm asking for — four specific things.
>
> First: endorsement. I'd like your backing to position SSLZ as a Founders Hub recommended resource.
>
> Second: collaboration. I need an intro to the Founders Hub product team to discuss where in the onboarding flow this fits best.
>
> Third: feedback. I want to make sure the graduation path aligns with what the ALZ team envisions. If there are gaps, I want to close them now.
>
> And fourth: visibility. If you think this is valuable, share it with your field teams and startup-facing colleagues. The more startups that land well on Azure, the better it is for everyone."

**TIMING:** ~2 min

---

## SLIDE 13 — Timeline & Next Steps

**SAY:**

> "Quick look at where things stand. The checkmarks speak for themselves — I identified the gap, built the solution, published the blog post, launched the website. That's all done.
>
> Today is the 'present to team' milestone. The next step is Founders Hub onboarding integration, then field team enablement, and ongoing iteration based on community feedback.
>
> The solution is built and published. Now I need org support to drive integration."

**TIMING:** ~1 min

---

## SLIDE 14 — Close

**SAY:**

> "To wrap up: I identified this gap through my direct work with startups. I built the solution — 211 commits, dual IaC, full documentation, live website. I published the blog series to build the audience. And now I'm driving the org integration with Founders Hub.
>
> I'll leave you with the line that guides this whole project: **'For startups, the alternative isn't ALZ — it's usually no governance at all.'**
>
> What questions do you have?"

**TIMING:** ~1 min, then open Q&A

---

## ADDITIONAL Q&A BANK

**Q: "What if startups get stuck on SSLZ and never graduate?"**
> "The graduation guide has explicit signals — 50+ engineers, compliance requirements, multi-region, hybrid connectivity. But even if they stay on SSLZ longer than expected, they're still on Azure with proper governance. That's infinitely better than zero governance."

**Q: "Who maintains this long-term?"**
> "I do. It's actively maintained — 211 commits and counting. The blog series keeps me engaged with the community, and I iterate based on real feedback from startups."

**Q: "Can this work with Terraform Cloud / Azure DevOps / other CI/CD?"**
> "Yes. The default is GitHub Actions, but the Terraform modules work with any CI system. The Bicep modules work with Azure DevOps or anything that can run `az deployment`. It's just IaC."

**Q: "What does SSLZ itself cost to run?"**
> "The landing zone resources are minimal — Log Analytics workspace, policy assignments, budget alerts. The expensive enterprise components — hub VNet, Azure Firewall, ExpressRoute — are explicitly excluded. That's the whole point."

**Q: "How does this compare to what competitors offer startups?"**
> "AWS has the Well-Architected Framework and Control Tower, but Control Tower is complex. GCP has the Cloud Foundation Toolkit. None of them have a one-hour deployable starter kit specifically for early-stage startups. This is a differentiator."

**Q: "Is this something we could offer as a template in azd?"**
> "Already done. There's an azure.yaml — it works with `azd up` today. That's another integration surface for the Founders Hub team."

---

**TOTAL PRESENTATION TIME:** ~25 minutes + 10–15 min Q&A
