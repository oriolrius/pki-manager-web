---
id: decision-005
title: 005 - Frontend Architecture with React 19 and TanStack Stack
date: '2025-10-23 15:58'
status: accepted
---

## Context

The PKI Manager required a modern, production-ready frontend for managing certificate authorities, certificates, and PKI operations. Key requirements included:

- Type-safe communication with tRPC backend
- Professional UI/UX for complex PKI workflows
- Responsive design for various screen sizes
- Real-time data synchronization
- File-based routing with type safety
- Dark/light theme support
- Comprehensive form validation
- Accessible components (WCAG compliance)

Traditional React setups with React Router and manual type definitions would require significant boilerplate and maintenance. We needed a cohesive stack that provided:
- Full end-to-end type safety
- Automatic route generation
- Built-in data fetching patterns
- Production-ready UI components
- Modern development experience

## Decision

We will build the frontend using the **TanStack + React 19 + shadcn/ui stack**:

### Core Stack

**React 19** - Latest React with improved performance
- Server Components support (future)
- Enhanced hooks and concurrent features
- Improved TypeScript integration

**TanStack Router 1.94.3** - Type-safe file-based routing
- Automatic route generation from file structure
- Full TypeScript inference for routes/params
- Nested layouts and parallel routes
- Built-in search params management

**TanStack Query 5.62.11** - Server state management
- Automatic caching and invalidation
- Optimistic updates
- Background refetching
- Pagination and infinite scroll support

**tRPC 11.0.0** - End-to-end type safety
- Full type inference from backend to frontend
- No code generation required
- Automatic request batching via httpBatchLink
- React Query integration

### UI & Styling

**shadcn/ui** - Component library
- Radix UI primitives (accessible by default)
- Tailwind CSS styling
- Copy-paste components (no npm package)
- Customizable via CSS variables
- Style: "new-york" (modern design system)

**Tailwind CSS 4.0** - Utility-first styling
- CSS variables for theming
- Dark mode support (class-based)
- Custom color palette (indigo/violet/purple gradients)
- Responsive breakpoints
- JIT compilation

**Custom Fonts**
- Inter - Body text (lightweight, readable)
- Space Grotesk - Headings (modern, distinctive)

### Project Structure

```
frontend/
├── src/
│   ├── routes/              # File-based routes
│   │   ├── __root.tsx      # Root layout
│   │   ├── index.tsx       # Dashboard
│   │   ├── cas.tsx         # CA list
│   │   ├── cas.$id.tsx     # CA details
│   │   └── certificates.tsx
│   │
│   ├── components/ui/       # shadcn/ui components
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── table.tsx
│   │   └── ...
│   │
│   └── lib/
│       ├── trpc.ts         # tRPC client
│       └── utils.ts        # Utilities
│
├── vite.config.ts          # Vite + TanStack plugin
└── components.json         # shadcn/ui config
```

## Implementation

### Route Pattern
```typescript
// src/routes/cas.$id.tsx
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/cas/$id')({
  component: CADetailPage,
});

function CADetailPage() {
  const { id } = Route.useParams();
  const caQuery = trpc.ca.getById.useQuery({ id });
  // ...
}
```

### Data Fetching Pattern
```typescript
// Query (read)
const casQuery = trpc.ca.list.useQuery({
  status: 'active',
  limit: 50,
});

// Mutation (write)
const createCA = trpc.ca.create.useMutation({
  onSuccess: () => {
    utils.ca.list.invalidate();
    toast.success('CA created');
  },
});
```

### Type Safety
```typescript
// Backend exports AppRouter type
export const appRouter = router({
  ca: caRouter,
  certificate: certificateRouter,
});
export type AppRouter = typeof appRouter;

// Frontend imports and uses type
import type { AppRouter } from '../../../backend/src/trpc/router';
export const trpc = createTRPCReact<AppRouter>();

// Full type inference - TypeScript knows all procedures!
trpc.ca.list.useQuery({ /* autocomplete */ });
```

## Consequences

### Positive

1. **Type Safety**: End-to-end types from database → backend → frontend
2. **Developer Experience**: Excellent autocomplete, instant feedback on API changes
3. **Performance**: Automatic request batching, optimized re-renders
4. **Maintainability**: File-based routing, clear conventions
5. **Professional UI**: shadcn/ui components are accessible, customizable, production-ready
6. **Modern**: Using latest stable versions of all tools
7. **Flexibility**: shadcn components are copy-paste, can modify as needed

### Negative

1. **Learning Curve**: Team must learn TanStack Router concepts
2. **Beta Software**: React 19 is new (though stable)
3. **Bundle Size**: Large dependency tree (~2MB dev, ~400KB prod gzipped)
4. **Bleeding Edge**: Potential for breaking changes in minor updates
5. **Documentation**: Some TanStack Router patterns not well documented yet

### Neutral

1. **No React Router**: Different mental model from traditional routing
2. **tRPC Coupling**: Backend must also use tRPC (already decided)
3. **Component Style**: shadcn/ui "new-york" style - team preference
4. **Tailwind**: Utility-first CSS requires different mindset

## Technical Specifications

### Build Configuration
- **Vite 6.0.5**: Lightning-fast dev server
- **TypeScript 5.7.2**: Strict mode enabled
- **ESLint 9.17.0**: Code quality enforcement
- **Dev Server**: Port 5173 with proxy to backend:3000

### Browser Support
- Modern browsers (ES2022)
- No IE11 support
- CSS Grid and Flexbox required

### Performance Targets
- First Contentful Paint: < 1.5s
- Time to Interactive: < 3s
- Bundle size: < 500KB gzipped
- Lighthouse score: > 90

## Key Features

### Routing
- Type-safe navigation: `navigate({ to: '/cas/$id', params: { id } })`
- Nested layouts: Sidebar persists across routes
- Search params: Filters persist in URL
- 404 handling: Automatic not-found routes

### Data Management
- Optimistic updates: UI updates before server confirms
- Background refetching: Data stays fresh automatically
- Cache invalidation: Related queries refresh on mutation
- Pagination: Built-in pagination support

### UI Components (shadcn/ui)
- Button (6 variants), Card, Input, Select, Table
- Badge, Dialog, Tabs, Checkbox, Textarea, Label
- Alert, Dropdown Menu, Skeleton
- All accessible (ARIA), keyboard navigable

### Theme System
- Dark/light/system modes
- CSS variable based (easy customization)
- Persists to localStorage
- Smooth transitions

## Alternatives Considered

### Next.js App Router
**Rejected** because:
- SSR not required for internal PKI tool
- Adds deployment complexity
- Vendor lock-in to Vercel ecosystem
- More complex mental model for team

### React Router + Axios + Manual Types
**Rejected** because:
- No type safety without code generation
- Manual request deduplication
- More boilerplate
- Doesn't integrate with React Query

### Remix
**Rejected** because:
- Too opinionated for SPA use case
- Requires SSR infrastructure
- Less flexible routing than TanStack

### Vue/Angular/Svelte
**Rejected** because:
- Team expertise in React
- Better TypeScript ecosystem
- tRPC has excellent React support

## Related Work

- Technology Stack: See decision-001 for backend architecture
- Components: `frontend/src/components/ui/` directory
- Routes: `frontend/src/routes/` directory
