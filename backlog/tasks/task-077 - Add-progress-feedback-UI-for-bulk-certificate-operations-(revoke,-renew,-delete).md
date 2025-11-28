---
id: task-077
title: >-
  Add progress feedback UI for bulk certificate operations (revoke, renew,
  delete)
status: To Do
assignee: []
created_date: '2025-11-28 08:52'
updated_date: '2025-11-28 08:55'
labels:
  - frontend
  - ux
  - bulk-operations
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement real-time progress feedback for bulk operations (revoke, renew, delete) similar to the existing download progress dialog used for JKS/ZIP artifacts.

**Current Behavior:**
- Bulk operations (revoke, renew, delete) show a simple confirmation dialog, execute all items at once, and show a generic success/error message
- No per-item progress or result visibility

**Desired Behavior:**
- Show an in-app progress dialog/popup during bulk operations
- Display a list of items being processed with real-time status updates
- Each item shows: certificate identifier (CN or serial), current status (pending/processing/success/error), and result message
- Progress bar showing overall completion
- Summary at the end showing success/failure counts

**Reference Implementation:**
The download progress dialog in `frontend/src/routes/certificates.tsx` (lines 689-730) uses:
- `progressSteps` state array with `{ label, status: 'pending' | 'active' | 'done' }`
- Animated progress bar with percentage
- Step-by-step status indicators

**Technical Approach:**
1. Backend already returns per-item results in bulk operations (see `bulk.routes.ts`)
2. Frontend needs to process items sequentially or show streaming results
3. Create a reusable `BulkOperationProgress` component
4. Integrate with existing bulk handlers in certificates.tsx
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Progress dialog appears when user initiates bulk revoke/renew/delete operations
- [ ] #2 Each certificate in the bulk operation is shown as a list item with its CN or serial number
- [ ] #3 Items show real-time status: pending (gray), processing (spinning), success (green checkmark), error (red X with message)
- [ ] #4 Overall progress bar updates as items complete
- [ ] #5 Summary section shows total success/failure counts when operation completes
- [ ] #6 Dialog can be dismissed only after operation completes (to prevent accidental navigation)
- [ ] #7 Error messages for failed items are descriptive and actionable
- [ ] #8 Tests validate progress state transitions for each operation type
- [ ] #9 Tests verify correct rendering of success/error states per item
- [ ] #10 Tests confirm cleanup of test data after test completion
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Implementation Plan

### Phase 1: State Management & Types

**File: `frontend/src/routes/certificates.tsx`**

1. Add new state variables after line 76:
```typescript
// Bulk operation progress state
const [bulkOperationProgress, setBulkOperationProgress] = useState<{
  isOpen: boolean;
  operation: 'revoke' | 'renew' | 'delete';
  title: string;
  items: Array<{
    id: string;
    label: string; // CN extracted from subjectDn
    status: 'pending' | 'processing' | 'success' | 'error';
    error?: string;
  }>;
  isComplete: boolean;
} | null>(null);
```

2. Add helper function to extract CN from subjectDn:
```typescript
const extractCN = (subjectDn: string): string => {
  const match = subjectDn.match(/CN=([^,]+)/);
  return match?.[1] || subjectDn;
};
```

3. Add helper to build progress items from selected certificates:
```typescript
const buildProgressItems = (certIds: string[]) => {
  return certIds.map(id => {
    const cert = filteredCertificates.find(c => c.id === id);
    return {
      id,
      label: cert ? extractCN(cert.subjectDn) : id.slice(0, 8),
      status: 'pending' as const,
    };
  });
};
```

---

### Phase 2: Enhance Bulk Mutations

**File: `frontend/src/routes/certificates.tsx`**

Update mutations (lines 118-135) to use `mutateAsync` for sequential processing:

```typescript
const executeBulkOperation = async (
  operation: 'revoke' | 'renew' | 'delete',
  certIds: string[],
  mutationFn: (id: string) => Promise<any>
) => {
  const items = buildProgressItems(certIds);
  setBulkOperationProgress({
    isOpen: true,
    operation,
    title: `${operation.charAt(0).toUpperCase() + operation.slice(1)}ing Certificates`,
    items,
    isComplete: false,
  });

  for (let i = 0; i < certIds.length; i++) {
    // Mark current as processing
    setBulkOperationProgress(prev => prev ? {
      ...prev,
      items: prev.items.map((item, idx) => 
        idx === i ? { ...item, status: 'processing' } : item
      ),
    } : null);

    try {
      await mutationFn(certIds[i]);
      // Mark as success
      setBulkOperationProgress(prev => prev ? {
        ...prev,
        items: prev.items.map((item, idx) => 
          idx === i ? { ...item, status: 'success' } : item
        ),
      } : null);
    } catch (error) {
      // Mark as error
      setBulkOperationProgress(prev => prev ? {
        ...prev,
        items: prev.items.map((item, idx) => 
          idx === i ? { 
            ...item, 
            status: 'error', 
            error: error instanceof Error ? error.message : 'Unknown error' 
          } : item
        ),
      } : null);
    }
  }

  // Mark complete
  setBulkOperationProgress(prev => prev ? { ...prev, isComplete: true } : null);
  utils.certificate.list.invalidate();
  setSelectedCertificates(new Set());
};
```

**Alternative approach (batch with per-item results):**
Keep using bulk mutations but process the returned results array:

```typescript
const bulkRevoke = trpc.certificate.bulkRevoke.useMutation({
  onMutate: () => {
    const items = buildProgressItems(Array.from(selectedCertificates));
    setBulkOperationProgress({
      isOpen: true,
      operation: 'revoke',
      title: 'Revoking Certificates',
      items: items.map(i => ({ ...i, status: 'processing' })),
      isComplete: false,
    });
  },
  onSuccess: (data) => {
    setBulkOperationProgress(prev => prev ? {
      ...prev,
      isComplete: true,
      items: prev.items.map(item => {
        const result = data.results.find(r => r.certificateId === item.id);
        return {
          ...item,
          status: result?.success ? 'success' : 'error',
          error: result?.error,
        };
      }),
    } : null);
    utils.certificate.list.invalidate();
    setSelectedCertificates(new Set());
  },
  onError: (error) => {
    setBulkOperationProgress(prev => prev ? {
      ...prev,
      isComplete: true,
      items: prev.items.map(i => ({ ...i, status: 'error', error: error.message })),
    } : null);
  },
});
```

---

### Phase 3: Progress Dialog Component

**File: `frontend/src/routes/certificates.tsx`**

Add after line 730 (after existing progress dialog):

```tsx
{/* Bulk Operation Progress Dialog */}
{bulkOperationProgress?.isOpen && (
  <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div className="bg-card border rounded-lg p-6 max-w-lg w-full mx-4 shadow-lg max-h-[80vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        {!bulkOperationProgress.isComplete && (
          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
        )}
        {bulkOperationProgress.isComplete && (
          <CheckCircle className="h-5 w-5 text-green-500" />
        )}
        <h3 className="text-lg font-semibold">{bulkOperationProgress.title}</h3>
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{
              width: `${(bulkOperationProgress.items.filter(i => 
                i.status === 'success' || i.status === 'error'
              ).length / bulkOperationProgress.items.length) * 100}%`,
            }}
          />
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {bulkOperationProgress.items.filter(i => i.status === 'success' || i.status === 'error').length} of {bulkOperationProgress.items.length} completed
        </p>
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto space-y-2 mb-4">
        {bulkOperationProgress.items.map((item, index) => (
          <div
            key={item.id}
            className={`flex items-start gap-3 p-2 rounded-lg ${
              item.status === 'success' ? 'bg-green-50 dark:bg-green-900/10' :
              item.status === 'error' ? 'bg-red-50 dark:bg-red-900/10' :
              item.status === 'processing' ? 'bg-blue-50 dark:bg-blue-900/10' :
              'bg-muted/50'
            }`}
          >
            {/* Status Icon */}
            <div className="mt-0.5">
              {item.status === 'success' && (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
              {item.status === 'error' && (
                <XCircle className="h-4 w-4 text-red-500" />
              )}
              {item.status === 'processing' && (
                <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              )}
              {item.status === 'pending' && (
                <div className="h-4 w-4 border-2 border-muted-foreground/30 rounded-full" />
              )}
            </div>
            {/* Content */}
            <div className="flex-1 min-w-0">
              <p className={`text-sm truncate ${
                item.status === 'processing' ? 'font-medium' : ''
              }`}>
                {item.label}
              </p>
              {item.error && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  {item.error}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Summary & Actions */}
      {bulkOperationProgress.isComplete && (
        <div className="border-t pt-4">
          <div className="flex justify-between text-sm mb-4">
            <span className="text-green-600 dark:text-green-400">
              ✓ {bulkOperationProgress.items.filter(i => i.status === 'success').length} succeeded
            </span>
            {bulkOperationProgress.items.some(i => i.status === 'error') && (
              <span className="text-red-600 dark:text-red-400">
                ✗ {bulkOperationProgress.items.filter(i => i.status === 'error').length} failed
              </span>
            )}
          </div>
          <button
            onClick={() => setBulkOperationProgress(null)}
            className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Close
          </button>
        </div>
      )}
    </div>
  </div>
)}
```

---

### Phase 4: Update Handlers

**File: `frontend/src/routes/certificates.tsx`**

Update handlers (lines 147-187) to show progress after confirmation:

```typescript
const handleBulkRevoke = () => {
  setConfirmAction({
    type: 'revoke',
    callback: () => {
      setShowConfirmDialog(false);
      // Initialize progress with all items as "processing" (batch mode)
      const items = buildProgressItems(Array.from(selectedCertificates));
      setBulkOperationProgress({
        isOpen: true,
        operation: 'revoke',
        title: 'Revoking Certificates',
        items: items.map(i => ({ ...i, status: 'processing' })),
        isComplete: false,
      });
      bulkRevoke.mutate({
        certificateIds: Array.from(selectedCertificates),
        reason: 'unspecified',
      });
    },
  });
  setShowConfirmDialog(true);
};
```

---

### Phase 5: Testing

**File: `frontend/src/routes/certificates.test.tsx` (new file)**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('Bulk Operation Progress', () => {
  it('shows progress dialog when bulk revoke starts', async () => {
    // Test implementation
  });

  it('displays each certificate with pending status initially', async () => {
    // Test implementation
  });

  it('updates item status from processing to success', async () => {
    // Test implementation
  });

  it('shows error message for failed items', async () => {
    // Test implementation
  });

  it('shows summary with success/failure counts when complete', async () => {
    // Test implementation
  });

  it('disables close button until operation completes', async () => {
    // Test implementation
  });

  it('cleans up test data after tests', async () => {
    // Ensure no test certificates remain
  });
});
```

---

### Files to Modify

1. **`frontend/src/routes/certificates.tsx`**
   - Add state variables (after line 76)
   - Add helper functions
   - Update mutation hooks (lines 118-135)
   - Update handlers (lines 147-187)
   - Add progress dialog component (after line 730)

2. **`frontend/src/routes/certificates.test.tsx`** (new)
   - Component unit tests
   - Progress state transition tests
   - Cleanup verification tests

### No Backend Changes Required
The existing bulk endpoints already return per-item results with success/error info.
<!-- SECTION:PLAN:END -->
