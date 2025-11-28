import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Type definitions matching the component
type ProgressItemStatus = 'pending' | 'processing' | 'success' | 'error';

interface ProgressItem {
  id: string;
  label: string;
  status: ProgressItemStatus;
  error?: string;
}

interface BulkOperationProgress {
  isOpen: boolean;
  operation: 'revoke' | 'renew' | 'delete';
  title: string;
  items: ProgressItem[];
  isComplete: boolean;
}

interface Certificate {
  id: string;
  subjectDn: string;
}

// Helper functions (extracted from the component for testing)
const extractCN = (subjectDn: string): string => {
  const match = subjectDn.match(/CN=([^,]+)/);
  return match?.[1] || subjectDn;
};

const buildProgressItems = (certIds: string[], certificates: Certificate[]): ProgressItem[] => {
  return certIds.map(id => {
    const cert = certificates.find(c => c.id === id);
    return {
      id,
      label: cert ? extractCN(cert.subjectDn) : id.slice(0, 8),
      status: 'pending' as const,
    };
  });
};

// Simulate the mutation onSuccess handler for revoke/delete
const processRevokeResults = (
  prev: BulkOperationProgress | null,
  results: Array<{ certificateId: string; success: boolean; error?: string }>
): BulkOperationProgress | null => {
  if (!prev) return null;
  return {
    ...prev,
    isComplete: true,
    items: prev.items.map(item => {
      const result = results.find(r => r.certificateId === item.id);
      return {
        ...item,
        status: result?.success ? 'success' : 'error',
        error: result?.error,
      };
    }),
  };
};

// Simulate the mutation onSuccess handler for renew
const processRenewResults = (
  prev: BulkOperationProgress | null,
  results: Array<{ originalCertificateId: string; success: boolean; error?: string }>
): BulkOperationProgress | null => {
  if (!prev) return null;
  return {
    ...prev,
    isComplete: true,
    items: prev.items.map(item => {
      const result = results.find(r => r.originalCertificateId === item.id);
      return {
        ...item,
        status: result?.success ? 'success' : 'error',
        error: result?.error,
      };
    }),
  };
};

describe('Bulk Operation Progress - Helper Functions', () => {
  describe('extractCN', () => {
    it('extracts CN from a standard subject DN', () => {
      expect(extractCN('CN=example.com,O=Example Org,C=US')).toBe('example.com');
    });

    it('extracts CN from a complex subject DN', () => {
      expect(extractCN('CN=server-01.internal,OU=IT,O=Acme Corp,ST=CA,C=US')).toBe('server-01.internal');
    });

    it('returns full DN if CN not found', () => {
      expect(extractCN('O=Example Org,C=US')).toBe('O=Example Org,C=US');
    });

    it('handles CN at end of DN', () => {
      expect(extractCN('O=Example Org,CN=test.local')).toBe('test.local');
    });
  });

  describe('buildProgressItems', () => {
    const mockCertificates: Certificate[] = [
      { id: 'cert-1', subjectDn: 'CN=server-01.example.com,O=Org' },
      { id: 'cert-2', subjectDn: 'CN=client-user@example.com,O=Org' },
      { id: 'cert-3', subjectDn: 'CN=api.internal,O=Org' },
    ];

    it('creates progress items with pending status', () => {
      const items = buildProgressItems(['cert-1', 'cert-2'], mockCertificates);
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({
        id: 'cert-1',
        label: 'server-01.example.com',
        status: 'pending',
      });
      expect(items[1]).toEqual({
        id: 'cert-2',
        label: 'client-user@example.com',
        status: 'pending',
      });
    });

    it('uses truncated ID as label for unknown certificates', () => {
      const items = buildProgressItems(['unknown-cert-12345'], mockCertificates);
      expect(items[0].label).toBe('unknown-');
    });

    it('handles empty certificate list', () => {
      const items = buildProgressItems(['cert-1'], []);
      expect(items[0].label).toBe('cert-1'.slice(0, 8));
    });
  });
});

describe('Bulk Operation Progress - State Transitions', () => {
  describe('Revoke operation', () => {
    let initialProgress: BulkOperationProgress;

    beforeEach(() => {
      initialProgress = {
        isOpen: true,
        operation: 'revoke',
        title: 'Revoking Certificates',
        items: [
          { id: 'cert-1', label: 'server-01', status: 'processing' },
          { id: 'cert-2', label: 'server-02', status: 'processing' },
          { id: 'cert-3', label: 'server-03', status: 'processing' },
        ],
        isComplete: false,
      };
    });

    afterEach(() => {
      // Cleanup - test data is only used in this test scope
    });

    it('transitions all items to success on successful bulk revoke', () => {
      const results = [
        { certificateId: 'cert-1', success: true },
        { certificateId: 'cert-2', success: true },
        { certificateId: 'cert-3', success: true },
      ];

      const result = processRevokeResults(initialProgress, results);

      expect(result?.isComplete).toBe(true);
      expect(result?.items[0].status).toBe('success');
      expect(result?.items[1].status).toBe('success');
      expect(result?.items[2].status).toBe('success');
    });

    it('transitions failed items to error with message', () => {
      const results = [
        { certificateId: 'cert-1', success: true },
        { certificateId: 'cert-2', success: false, error: 'Certificate is already revoked' },
        { certificateId: 'cert-3', success: true },
      ];

      const result = processRevokeResults(initialProgress, results);

      expect(result?.items[0].status).toBe('success');
      expect(result?.items[1].status).toBe('error');
      expect(result?.items[1].error).toBe('Certificate is already revoked');
      expect(result?.items[2].status).toBe('success');
    });

    it('marks all items as error when no results match', () => {
      const results: Array<{ certificateId: string; success: boolean }> = [];

      const result = processRevokeResults(initialProgress, results);

      expect(result?.isComplete).toBe(true);
      expect(result?.items.every(i => i.status === 'error')).toBe(true);
    });

    it('returns null if previous state is null', () => {
      const result = processRevokeResults(null, []);
      expect(result).toBeNull();
    });
  });

  describe('Renew operation', () => {
    let initialProgress: BulkOperationProgress;

    beforeEach(() => {
      initialProgress = {
        isOpen: true,
        operation: 'renew',
        title: 'Renewing Certificates',
        items: [
          { id: 'cert-1', label: 'server-01', status: 'processing' },
          { id: 'cert-2', label: 'server-02', status: 'processing' },
        ],
        isComplete: false,
      };
    });

    it('transitions items based on originalCertificateId', () => {
      const results = [
        { originalCertificateId: 'cert-1', newCertificateId: 'new-cert-1', success: true },
        { originalCertificateId: 'cert-2', success: false, error: 'Certificate is expired' },
      ];

      const result = processRenewResults(initialProgress, results);

      expect(result?.items[0].status).toBe('success');
      expect(result?.items[1].status).toBe('error');
      expect(result?.items[1].error).toBe('Certificate is expired');
    });
  });

  describe('Delete operation', () => {
    let initialProgress: BulkOperationProgress;

    beforeEach(() => {
      initialProgress = {
        isOpen: true,
        operation: 'delete',
        title: 'Deleting Certificates',
        items: [
          { id: 'cert-1', label: 'expired-cert', status: 'processing' },
        ],
        isComplete: false,
      };
    });

    it('processes delete results correctly', () => {
      const results = [
        { certificateId: 'cert-1', success: true },
      ];

      const result = processRevokeResults(initialProgress, results);

      expect(result?.isComplete).toBe(true);
      expect(result?.items[0].status).toBe('success');
    });

    it('handles delete errors with descriptive messages', () => {
      const results = [
        { certificateId: 'cert-1', success: false, error: 'Certificate must be revoked or expired for more than 90 days before deletion' },
      ];

      const result = processRevokeResults(initialProgress, results);

      expect(result?.items[0].status).toBe('error');
      expect(result?.items[0].error).toBe('Certificate must be revoked or expired for more than 90 days before deletion');
    });
  });
});

describe('Bulk Operation Progress - Summary Calculations', () => {
  it('calculates correct success count', () => {
    const progress: BulkOperationProgress = {
      isOpen: true,
      operation: 'revoke',
      title: 'Revoking',
      items: [
        { id: '1', label: 'cert-1', status: 'success' },
        { id: '2', label: 'cert-2', status: 'success' },
        { id: '3', label: 'cert-3', status: 'error', error: 'Failed' },
      ],
      isComplete: true,
    };

    const successCount = progress.items.filter(i => i.status === 'success').length;
    const errorCount = progress.items.filter(i => i.status === 'error').length;

    expect(successCount).toBe(2);
    expect(errorCount).toBe(1);
  });

  it('calculates progress bar percentage correctly', () => {
    const items: ProgressItem[] = [
      { id: '1', label: 'cert-1', status: 'success' },
      { id: '2', label: 'cert-2', status: 'error' },
      { id: '3', label: 'cert-3', status: 'processing' },
      { id: '4', label: 'cert-4', status: 'pending' },
    ];

    const completedCount = items.filter(i => i.status === 'success' || i.status === 'error').length;
    const percentage = (completedCount / items.length) * 100;

    expect(percentage).toBe(50);
  });
});

describe('Bulk Operation Progress - Error Handling', () => {
  it('handles global error that affects all items', () => {
    const initialProgress: BulkOperationProgress = {
      isOpen: true,
      operation: 'delete',
      title: 'Deleting',
      items: [
        { id: '1', label: 'cert-1', status: 'processing' },
        { id: '2', label: 'cert-2', status: 'processing' },
      ],
      isComplete: false,
    };

    // Simulate onError handler
    const errorMessage = 'Network error occurred';
    const result = {
      ...initialProgress,
      isComplete: true,
      items: initialProgress.items.map(i => ({
        ...i,
        status: 'error' as const,
        error: errorMessage,
      })),
    };

    expect(result.isComplete).toBe(true);
    expect(result.items.every(i => i.status === 'error')).toBe(true);
    expect(result.items.every(i => i.error === errorMessage)).toBe(true);
  });
});
