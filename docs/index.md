---
title: Home
nav_order: 1
---

# Azure Landing Zone for Startups

A stripped-down, opinionated, deployable Azure Landing Zone for digital-native companies and startups.  
Built for teams of 5-50 engineers who need to get Azure right from day one.

## What you get

- One management group, two subscriptions (Prod + Non-Prod)
- Minimal policy baseline (MCSB audit + required tags + allowed locations + activity log forwarding)
- Per-subscription VNet + subnets + NSGs (no hub by default)
- Centralized logging to Log Analytics
- Defender for Cloud baseline (CSPM everywhere, Servers P2 on prod)
- Budget alerts at 50/80/100%

## Start here

- [Architecture Decisions](architecture.md)
- [Networking Deep Dive](networking.md)
- [Security Baseline](security.md)
- [Cost Management](cost-management.md)
- [CI/CD Setup](ci-cd-setup.md)
- [Troubleshooting](troubleshooting.md)
- [Graduation Guide](graduation-guide.md)

## Quick Start

If you're looking for the deployment steps, see the repo README.  
If you plan to modify the code and keep your own version, fork the repo first.
