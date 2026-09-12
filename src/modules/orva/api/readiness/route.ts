import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { resolveBrowserExecutable } from '@/modules/orva_documents/lib/pdf'
import { assessReadiness, readinessSummary, type ReadinessFacts } from '../../lib/readiness'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_finance.gl.view'] },
}

const checkSchema = z.object({
  id: z.string(), labelKey: z.string(),
  severity: z.enum(['blocker', 'warning', 'ok']),
  detail: z.string(), href: z.string().nullable(),
})

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * How many whole days old the newest dump is, or null when there is none.
 *
 * The backup lives on the host's filesystem, not in the database, so this is
 * the one fact the panel reads off disk. A directory that is not there is the
 * same answer as one that is empty: nobody has ever taken a backup.
 */
async function newestBackupAgeDays(): Promise<number | null> {
  const dir = process.env.ORVA_BACKUP_DIR || path.join(homedir(), 'orva-backups')
  try {
    const dumps = (await readdir(dir)).filter((file) => file.endsWith('.dump'))
    if (!dumps.length) return null
    const times = await Promise.all(dumps.map(async (file) => (await stat(path.join(dir, file))).mtimeMs))
    const newest = Math.max(...times)
    return Math.max(0, Math.floor((Date.now() - newest) / 86_400_000))
  } catch {
    return null
  }
}

/**
 * The facts behind ความพร้อมใช้งาน, gathered from wherever each one lives.
 *
 * Deliberately plain SQL against the tables rather than each module's route:
 * the panel asks nine questions of eight modules, and nine HTTP round trips
 * to answer one screen would be slower and would fail in eight ways. Every
 * query is scoped to the caller's tenant and organisation, inside RLS.
 *
 * A table that is not there (a module the tenant does not run) answers with
 * the neutral value rather than failing the panel — the point is to report,
 * not to add one more thing that can break.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const tenantId = auth.tenantId

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const facts = await withTenantRls(em, tenantId, async (tem) => {
    const one = async <T>(sql: string, params: unknown[], fallback: T): Promise<T> => {
      try { return ((await tem.execute(sql, params)) as T[])[0] ?? fallback } catch { return fallback }
    }

    const settings = await one<{ legal: string | null; tax: string | null; addr: string | null; pay: string | null; rate: string | null }>(
      `select seller_legal_name as legal, seller_tax_id as tax, seller_address as addr,
              payment_details as pay, default_hourly_rate as rate
       from orva_documents_settings
       where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null
       limit 1`,
      [tenantId, organizationId], { legal: null, tax: null, addr: null, pay: null, rate: null })

    const taxRate = await one<{ rate: string | null }>(
      `select rate from sales_tax_rates
       where tenant_id = ?::uuid and organization_id = ?::uuid and is_default = true
       limit 1`,
      [tenantId, organizationId], { rate: null })

    const periods = await one<{ n: number }>(
      `select count(*)::int as n from orva_gl_periods
       where tenant_id = ?::uuid and organization_id = ?::uuid and status = 'open'`,
      [tenantId, organizationId], { n: 0 })

    const portal = await one<{ total: number; linked: number }>(
      `select count(*)::int as total,
              count(*) filter (where customer_entity_id is not null)::int as linked
       from customer_accounts_users
       where tenant_id = ?::uuid and deleted_at is null`,
      [tenantId], { total: 0, linked: 0 })

    const schedules = await one<{ total: number; active: number }>(
      `select count(*)::int as total, count(*) filter (where is_enabled)::int as active
       from scheduled_jobs
       where tenant_id = ?::uuid or tenant_id is null`,
      [tenantId], { total: 0, active: 0 })

    const unposted = await one<{ n: number }>(
      `select count(*)::int as n from sales_invoices i
       where i.tenant_id = ?::uuid and i.organization_id = ?::uuid and i.deleted_at is null
         and not exists (select 1 from orva_gl_journals j
                         where j.tenant_id = i.tenant_id and j.source_ref = i.id::text)`,
      [tenantId, organizationId], { n: 0 })

    // Is this connection actually subject to RLS? `current_user` is the role
    // the app authenticated as; a superuser or a BYPASSRLS role sees every
    // tenant's rows no matter what the policies say. Asked here rather than
    // assumed from DATABASE_URL, because the string and the truth can differ.
    const role = await one<{ enforced: boolean }>(
      `select not coalesce(bool_or(rolsuper or rolbypassrls), true) as enforced
       from pg_roles where rolname = current_user`,
      [], { enforced: false })

    return { settings, taxRate, periods, portal, schedules, unposted, role }
  })

  // Environment facts are the host's, not the tenant's, and are read here so
  // the panel can say "email will not go out" instead of the operator finding
  // out when a customer says the quotation never arrived.
  const emailConfigured = Boolean((process.env.RESEND_API_KEY ?? '').trim() && (process.env.RESEND_FROM_EMAIL ?? '').trim())
  let pdfConfigured = true
  try { resolveBrowserExecutable() } catch { pdfConfigured = false }
  const backupAgeDays = await newestBackupAgeDays()

  const readiness: ReadinessFacts = {
    emailConfigured,
    pdfConfigured,
    seller: {
      legalName: Boolean(facts.settings.legal),
      taxId: Boolean(facts.settings.tax),
      address: Boolean(facts.settings.addr),
      paymentDetails: Boolean(facts.settings.pay),
    },
    defaultTaxRate: num(facts.taxRate.rate),
    openPeriods: Number(facts.periods.n ?? 0),
    hourlyRate: num(facts.settings.rate),
    portalUsers: { total: Number(facts.portal.total ?? 0), linked: Number(facts.portal.linked ?? 0) },
    schedules: { total: Number(facts.schedules.total ?? 0), active: Number(facts.schedules.active ?? 0) },
    unpostedInvoices: Number(facts.unposted.n ?? 0),
    backupAgeDays,
    rlsEnforced: Boolean(facts.role.enforced),
  }

  const checks = assessReadiness(readiness)
  return Response.json({ checks, summary: readinessSummary(checks) })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva',
  summary: 'ความพร้อมใช้งาน — whether this tenant can do a normal day of business',
  methods: {
    GET: {
      summary: 'Reports the settings and environment facts that silently stop billing, posting or sending',
      tags: ['Orva'],
      responses: [{
        status: 200,
        description: 'Checks worst-first, with the screen that owns each one.',
        schema: z.object({
          checks: z.array(checkSchema),
          summary: z.object({ blockers: z.number(), warnings: z.number(), ready: z.boolean() }),
        }),
      }],
    },
  },
}
