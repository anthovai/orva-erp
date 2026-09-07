import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { syncOrganization } from '../lib/apply'

/**
 * A work project changed, so its โครงการ follows.
 *
 * Post-commit by construction: this runs off an event, so the mirror write
 * never rides on the tasking transaction. If it fails — a worker down, a
 * database blip — nothing is left half-written on the tasking side, and
 * `mercato orva_time sync` puts it right on the next run. That pairing is
 * deliberate: the event is for immediacy, the reconcile is for correctness,
 * and a sync with only the first is the failure this module was asked to
 * prevent.
 */
const logger = createLogger('orva_time').child({ component: 'tasking-project-mirror' })

export const metadata = {
  // One registration for created, updated and archived. `event` is a single
  // string in the subscriber contract, and the wildcard form is already used
  // by installed modules (`currencies.currency.*`), so three files sharing a
  // handler would be three ways to say this.
  event: 'orva_tasking.project.*',
  persistent: true,
  id: 'orva_time:tasking-project-mirror',
}

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
  container?: { resolve<T = unknown>(name: string): T }
}

type ProjectEvent = {
  id?: unknown
  tenantId?: unknown
  organizationId?: unknown
}

export default async function handle(payload: ProjectEvent, ctx: ResolverContext): Promise<void> {
  const tenantId = typeof payload?.tenantId === 'string' ? payload.tenantId : null
  const organizationId = typeof payload?.organizationId === 'string' ? payload.organizationId : null

  // Fail loudly rather than write across tenants. A subscriber that cannot
  // name its tenant has no business touching a tenant-scoped table.
  if (!tenantId || !organizationId) {
    logger.error('project event carried no tenant or organization; refusing to sync', {
      hasTenant: Boolean(tenantId),
      hasOrganization: Boolean(organizationId),
    })
    return
  }

  const resolve = ctx.container?.resolve?.bind(ctx.container) ?? ctx.resolve
  const em = resolve<EntityManager>('em')

  const result = await syncOrganization(em, { tenantId, organizationId })
  if (result.applied > 0 || result.reported.length > 0) {
    logger.info('mirrored a work project change into โครงการ', {
      applied: result.applied,
      reported: result.reported.length,
    })
  }
}
