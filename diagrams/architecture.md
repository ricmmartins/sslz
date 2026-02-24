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

![Networking Architecture]({{ '/assets/images/networking-architecture.png' | relative_url }})

> **Note:** All subnets have a default deny-all-inbound NSG rule. The `/18` AKS subnet is intentionally large because Azure CNI allocates one IP per pod.

## Security Model

![Security Model]({{ '/assets/images/security-model.png' | relative_url }})
