import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { signAudienceJwt, verifyJwt } from '@open-mercato/shared/lib/auth/jwt'
import { TotpCredential } from '../data/entities'
import { MFA_PENDING_AUDIENCE, MFA_PENDING_TTL_SECONDS } from '../lib/service'

/**
 * Step-up gate at token issuance. The core login route derives the
 * `auth_token` cookie from the (possibly intercepted) response body's
 * `token`, so swapping it here means an MFA-enrolled user never receives a
 * full staff session from a password alone: they get a 5-minute
 * `orva_mfa_pending` audience token that no staff surface accepts (wrong
 * audience + no sid), plus a redirect to the /mfa challenge page.
 *
 * NOTE: no `features` key — the login route passes userFeatures: [] and a
 * feature-gated interceptor would be silently skipped.
 */
export const interceptors: ApiInterceptor[] = [
  {
    id: 'orva_mfa.login.step-up',
    targetRoute: 'auth/login',
    methods: ['POST'],
    async after(_request, response, context) {
      const issued = response.body?.token
      if (typeof issued !== 'string' || issued.length === 0) return {}
      const claims = verifyJwt(issued)
      if (!claims || typeof claims.sub !== 'string' || typeof claims.tenantId !== 'string') return {}

      const credential = await context.em.findOne(TotpCredential, {
        tenantId: claims.tenantId,
        userId: claims.sub,
        status: 'active',
        deletedAt: null,
      })
      if (!credential) return {}

      const pending = signAudienceJwt(
        MFA_PENDING_AUDIENCE,
        {
          sub: claims.sub,
          tenantId: claims.tenantId,
          orgId: (claims.orgId as string | null) ?? null,
          email: typeof claims.email === 'string' ? claims.email : '',
        },
        MFA_PENDING_TTL_SECONDS,
      )
      return { merge: { token: pending, redirect: '/mfa', mfaRequired: true } }
    },
  },
]

export default interceptors
