---
id: task-048
title: Implement overview dashboard UI
status: In Progress
assignee:
  - '@claude'
created_date: '2025-10-21 15:51'
updated_date: '2025-10-22 11:09'
labels:
  - frontend
  - dashboard
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create the main dashboard page with summary cards, charts, expiry timeline, recent activity feed, and expiring soon table.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Dashboard page created at / route
- [x] #2 Summary cards: Total CAs, Total Certs, Expiring Soon, Recent Revocations
- [x] #3 CA health status display
- [x] #4 Expiry timeline chart (12 months)
- [x] #5 Certificate distribution pie charts (by type, by status)
- [x] #6 Bar chart: certificates by CA
- [x] #7 Recent activity feed (last 10 operations)
- [x] #8 Expiring soon table with quick actions
- [x] #9 All cards/charts clickable to navigate to detail views
- [x] #10 Real-time or near-real-time updates
- [x] #11 Loading states for charts
- [x] #12 Responsive layout for mobile
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Install Recharts library for charts/visualizations
2. Create reusable Card components for summary statistics
3. Implement expiry timeline chart showing 12-month certificate expiry forecast
4. Create pie charts for certificate distribution (by type and status)
5. Add bar chart showing certificate count by CA
6. Implement recent activity feed from audit logs
7. Create expiring soon table with quick action buttons
8. Make all cards and charts clickable for navigation
9. Add loading states for all data-driven components
10. Test responsive layout on mobile/tablet
11. Verify all acceptance criteria
<!-- SECTION:PLAN:END -->
