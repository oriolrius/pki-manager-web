/** Legacy Kubernetes API adapter. Service tokens are owned by integrations. */
import { IntegrationService, type RegisterIntegrationParams } from './integration.service.js';
import type { ServiceContext } from './types.js';
export {
  IntegrationNotFoundError as ClusterNotFoundError,
  IntegrationRevokedError as ClusterRevokedError,
  IntegrationCANotFoundError as ClusterCANotFoundError,
} from './integration.service.js';
export type { RegisterIntegrationParams as RegisterClusterParams, RegisterIntegrationResult as RegisterClusterResult } from './integration.service.js';

export class ClusterService extends IntegrationService {
  override register(ctx: ServiceContext, params: RegisterIntegrationParams) {
    return super.register(ctx, { ...params, kind: 'kubernetes' });
  }
  override async getById(ctx: ServiceContext, id: string) {
    const item = await super.getById(ctx, id);
    return { ...item, k8sCertificatesCount: item.certificatesCount };
  }
  override async list(ctx: ServiceContext) {
    return (await super.list(ctx)).map((item) => ({ ...item, k8sCertificatesCount: item.certificatesCount }));
  }
}
let instance: ClusterService | undefined;
export function getClusterService(): ClusterService {
  return instance ??= new ClusterService();
}
