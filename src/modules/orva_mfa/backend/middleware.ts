import type { EntityManager } from '@mikro-orm/postgresql'
import type { PageRouteMiddleware } from '@open-mercato/shared/modules/middleware/page'
import { SessionFlag, TotpCredential } from '../data/entities'

const CONTINUE = { action: 'continue' as const }

/**
 * Belt-and-braces MFA gate for every backend page. The primary gate is the
 * login interceptor (an enrolled user never gets a full token without the
 * challenge), but two paths still need this guard:
 *   - sessions minted BEFORE the user enrolled,
 *   - refreshed tokens, which rebuild claims and drop the custom `mfa` one —
 *     covered by the session-flag lookup keyed on the stable sid.
 */
export const middleware: PageRouteMiddleware[] = [
  {
    id: 'orva_mfa.backend.step-up-gate',
    mode: 'backend',
    target: '/backend*',
    priority: 50,
    async run(context) {
      const auth = context.auth
      if (!auth?.sub || !auth.tenantId) return CONTINUE
      if ((auth as Record<string, unknown>).mfa === true) return CONTINUE

      const container = await context.ensureContainer()
      const em = container.resolve('em') as EntityManager
      const credential = await em.findOne(TotpCredential, {
        tenantId: auth.tenantId,
        userId: auth.sub,
        status: 'active',
        deletedAt: null,
      })
      if (!credential) return CONTINUE

      if (auth.sid) {
        const flag = await em.findOne(SessionFlag, { sessionId: String(auth.sid) })
        if (flag && flag.userId === auth.sub) return CONTINUE
      }
      return { action: 'redirect', location: '/mfa' }
    },
  },
]

export default middleware
