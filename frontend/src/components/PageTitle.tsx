import { useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/callback': 'Signing In',
  '/cas': 'Certificate Authorities',
  '/cas/new': 'Create Certificate Authority',
  '/cas/$id': 'Certificate Authority Details',
  '/certificates': 'Certificates',
  '/certificates/new': 'Issue Certificate',
  '/certificates/bulk': 'Bulk Certificate Operations',
  '/certificates/$id': 'Certificate Details',
  '/clusters': 'Kubernetes Clusters',
  '/integrations': 'Integrations',
  '/api-docs': 'API Documentation',
  '/ssh': 'SSH Certificate Manager',
  '/ssh/cas': 'SSH Certificate Authorities',
  '/ssh/cas/new': 'Create SSH Certificate Authority',
  '/ssh/cas/$id': 'SSH Certificate Authority Details',
  '/ssh/hosts': 'SSH Hosts',
  '/ssh/hosts/new': 'Add SSH Host',
  '/ssh/hosts/$id': 'SSH Host Details',
  '/ssh/users': 'SSH Users',
  '/ssh/users/new': 'Issue SSH User Certificate',
  '/ssh/principals': 'SSH Principals',
  '/ssh/krl': 'SSH Key Revocation Lists',
  '/ssh/zones': 'SSH Zones',
};

export function PageTitle() {
  const routeId = useRouterState({
    select: (state) => state.matches.at(-1)?.routeId,
  });
  const page = routeId ? pageTitles[routeId] : undefined;

  useEffect(() => {
    document.title = page ? `${page} | PKI Manager` : 'PKI Manager';
  }, [page]);

  return null;
}
