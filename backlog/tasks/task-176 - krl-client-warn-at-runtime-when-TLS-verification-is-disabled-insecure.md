---
id: TASK-176
title: 'krl-client: warn at runtime when TLS verification is disabled (insecure)'
status: To Do
assignee: []
created_date: '2026-07-02 16:43'
labels:
  - ssh-cert-manager
  - krl-client
  - security
dependencies: []
ordinal: 3014
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pre-release security review (v3.4.0): 'insecure' (TLS verification off) is accepted from the root-owned config file and env (configfile.go:14) with no runtime warning when active, so an operator can silently run without TLS verification. Low severity. Emit a prominent warning (structured log at WARN) on every run whenever insecure is in effect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When TLS verification is disabled (insecure via flag/env/config), the client emits a WARN-level log on every run stating verification is off
<!-- AC:END -->
