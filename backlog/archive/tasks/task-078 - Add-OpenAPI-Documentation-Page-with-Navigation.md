---
id: task-078
title: Add OpenAPI Documentation Page with Navigation
status: Done
assignee:
  - '@myself'
created_date: '2025-11-28 09:40'
updated_date: '2025-11-28 09:48'
labels:
  - frontend
  - openapi
  - documentation
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create a new frontend route that renders interactive OpenAPI documentation using Swagger UI React. The backend already exposes OpenAPI JSON at `/api/v1/openapi.json` and has Swagger UI at `/api/docs`. This task adds a dedicated page in the frontend SPA with a navigation menu entry for easy access to the API documentation.

**Backend Context:**
- OpenAPI spec available at: `http://localhost:3000/api/v1/openapi.json`
- Swagger UI already served at: `http://localhost:3000/api/docs`
- Backend config in: `backend/src/rest/openapi.ts`

**Frontend Context:**
- TanStack Router with file-based routing in `frontend/src/routes/`
- Navigation defined in `frontend/src/routes/__root.tsx`
- Font Awesome icons via `@fortawesome/react-fontawesome`
- Tests use Vitest + React Testing Library

**Implementation Approach:**
Use `swagger-ui-react` package to render Swagger UI natively in React rather than embedding via iframe. This provides better integration, theming, and testability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 New route at `/api-docs` renders OpenAPI documentation in the frontend SPA
- [x] #2 Navigation menu includes 'API Docs' link with `faBook` or similar icon after the Bulk link
- [x] #3 Page fetches OpenAPI spec from backend `/api/v1/openapi.json` using fetch API
- [x] #4 Swagger UI React component renders interactive documentation with proper styling
- [x] #5 Loading state shown while fetching OpenAPI spec
- [x] #6 Error state shown if spec fetch fails

- [x] #7 Unit tests verify route component renders correctly
- [x] #8 Unit tests verify loading and error states
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Step 1: Install swagger-ui-react dependency
```bash
cd frontend && npm install swagger-ui-react
```
Note: May need to add `@types/swagger-ui-react` if types are not included.

### Step 2: Create the API Docs route (`frontend/src/routes/api-docs.tsx`)
```typescript
import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';

export const Route = createFileRoute('/api-docs')({
  component: ApiDocsPage,
});

function ApiDocsPage() {
  const [spec, setSpec] = useState<object | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
    fetch(`${apiUrl}/api/v1/openapi.json`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch OpenAPI spec');
        return res.json();
      })
      .then(setSpec)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div>Loading API documentation...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!spec) return null;

  return (
    <div className="swagger-container">
      <h1>API Documentation</h1>
      <SwaggerUI spec={spec} />
    </div>
  );
}
```

### Step 3: Update navigation (`frontend/src/routes/__root.tsx`)
Add import for `faBook` icon and new Link after the Bulk link:
```typescript
import { faBook } from '@fortawesome/free-solid-svg-icons';

// After Bulk link:
<Link
  to="/api-docs"
  className="px-3 py-2 text-sm font-medium rounded-md..."
  activeProps={{...}}
>
  <FontAwesomeIcon icon={faBook} className="h-4 w-4" />
  API Docs
</Link>
```

### Step 4: Add custom CSS for Swagger UI theming (optional)
If needed, add CSS overrides in `frontend/src/index.css` to match app theme:
```css
.swagger-ui { /* theme overrides */ }
```

### Step 5: Write tests (`frontend/src/routes/api-docs.test.tsx`)
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
// Test loading state, error state, and successful render
```

### Files to Create/Modify:
- **Create:** `frontend/src/routes/api-docs.tsx`
- **Create:** `frontend/src/routes/api-docs.test.tsx`
- **Modify:** `frontend/src/routes/__root.tsx` (add nav link)
- **Modify:** `frontend/package.json` (add swagger-ui-react dependency)
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Summary

### Files Created
- `frontend/src/routes/api-docs.tsx` - Main API documentation page component
- `frontend/src/routes/api-docs.test.tsx` - Unit tests for the page

### Files Modified
- `frontend/src/routes/__root.tsx` - Added navigation link with `faBook` icon
- `frontend/package.json` - Added `swagger-ui-react` dependency

### Key Features
1. Route at `/api-docs` renders interactive OpenAPI documentation
2. Navigation includes "API Docs" link with book icon after the Bulk link
3. Fetches OpenAPI spec from backend `/api/v1/openapi.json`
4. SwaggerUI React renders the interactive documentation
5. Shows loading spinner while fetching spec
6. Shows error state with message if fetch fails
7. All 4 unit tests pass covering loading, success, and error states
8. TypeScript compiles without errors
<!-- SECTION:NOTES:END -->
