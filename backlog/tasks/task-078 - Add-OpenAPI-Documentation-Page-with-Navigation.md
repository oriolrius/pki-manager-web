---
id: task-078
title: Add OpenAPI Documentation Page with Navigation
status: To Do
assignee: []
created_date: '2025-11-28 09:40'
updated_date: '2025-11-28 09:40'
labels:
  - frontend
  - openapi
  - documentation
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a new frontend route that renders interactive OpenAPI documentation using Swagger UI. The backend already exposes OpenAPI JSON at /api/docs/json and has Swagger UI at /api/docs. This task adds a dedicated page in the frontend with a navigation menu entry for easy access to the API documentation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New route /api-docs renders OpenAPI documentation in the frontend
- [ ] #2 Navigation menu includes 'API Docs' link with appropriate icon
- [ ] #3 Page fetches and displays OpenAPI spec from backend /api/docs/json
- [ ] #4 Swagger UI component renders interactive API documentation
- [ ] #5 Integration tests verify route renders correctly
- [ ] #6 Integration tests verify OpenAPI spec is fetched and displayed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Phase 1: Dependencies & Setup
1. Install swagger-ui-react package in frontend
   - `cd frontend && npm install swagger-ui-react`
   - Add TypeScript types if needed: `@types/swagger-ui-react`

### Phase 2: Create API Docs Route
2. Create new route file `frontend/src/routes/api-docs.tsx`
   - Use TanStack Router `createFileRoute` pattern
   - Import SwaggerUI component from swagger-ui-react
   - Fetch OpenAPI spec from backend `/api/docs/json`
   - Handle loading, error, and success states
   - Apply custom CSS for dark mode compatibility

### Phase 3: Update Navigation Menu
3. Modify `frontend/src/routes/__root.tsx`
   - Add new Link to `/api-docs` route
   - Use FontAwesome icon (faBook or faFileCode)
   - Position after "Bulk" in navigation order
   - Apply consistent styling with other nav items

### Phase 4: Swagger UI Configuration
4. Configure SwaggerUI component options:
   - Set spec URL to backend API endpoint
   - Configure theme to match app design
   - Enable "Try it out" functionality
   - Disable unnecessary features (validator badge, etc.)

### Phase 5: Integration Tests
5. Create test file `frontend/src/routes/api-docs.test.ts`
   - Test route renders without crashing
   - Test loading state displays correctly
   - Mock fetch to return sample OpenAPI spec
   - Test SwaggerUI receives correct props
   - Test error handling when fetch fails

### Phase 6: Styling & Polish
6. Add CSS customizations for Swagger UI
   - Match application color scheme
   - Support dark/light theme toggle
   - Ensure responsive layout
   - Fix any z-index or overflow issues

### Files to Create/Modify
- **Create:** `frontend/src/routes/api-docs.tsx`
- **Create:** `frontend/src/routes/api-docs.test.ts`
- **Modify:** `frontend/src/routes/__root.tsx` (add nav link)
- **Modify:** `frontend/package.json` (add dependency)
<!-- SECTION:PLAN:END -->
