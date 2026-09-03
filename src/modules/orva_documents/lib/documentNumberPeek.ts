import type { EntityManager } from '@mikro-orm/postgresql'

/**
 * Non-claiming preview of the next sales document number.
 *
 * Upstream's form asks POST /api/sales/document-numbers the moment the create
 * screen opens, and that route CLAIMS a sequence value — every abandoned form
 * burned a number (the quote counter drifted from 11 to 27 in a day). Thai
 * bookkeeping wants continuous series, so the app overrides that route: the
 * screen shows the number the series WOULD give, and the create command's
 * interceptor claims it for real only when the document is saved.
 *
 * Formatting mirrors upstream's token set; formats with random tokens
 * ({rand}, {guid}, {nanoid}) cannot be previewed deterministically and fall
 * back to a real claim.
 */
export type PeekKind = 'quote' | 'order'

const DEFAULTS: Record<PeekKind, string> = {
  quote: 'QUOTE-{yyyy}{mm}{dd}-{seq:5}',
  order: 'ORDER-{yyyy}{mm}{dd}-{seq:5}',
}

export function formatDocumentNumber(template: string, kind: PeekKind, sequence: number, now = new Date()): string {
  return template.replace(/\{([a-zA-Z]+)(?::([^}]+))?\}/g, (match, rawToken: string, rawArg?: string) => {
    const token = rawToken.toLowerCase()
    const arg = typeof rawArg === 'string' ? rawArg.trim() : ''
    switch (token) {
      case 'yyyy': return String(now.getFullYear())
      case 'yy': return String(now.getFullYear()).slice(-2)
      case 'mm': return String(now.getMonth() + 1).padStart(2, '0')
      case 'dd': return String(now.getDate()).padStart(2, '0')
      case 'hh': return String(now.getHours()).padStart(2, '0')
      case 'seq': {
        const width = parseInt(arg || '', 10)
        return Number.isFinite(width) && width > 0 ? String(sequence).padStart(Math.min(width, 12), '0') : String(sequence)
      }
      case 'kind': return kind
      default: return match
    }
  })
}

export const hasRandomTokens = (template: string) => /\{(rand|guid|nanoid)(?::[^}]+)?\}/i.test(template)

export async function resolveFormat(em: EntityManager, scope: { tenantId: string; organizationId: string }, kind: PeekKind): Promise<string> {
  const rows = (await em.execute(
    `select quote_number_format, order_number_format from sales_settings
     where tenant_id = ?::uuid and organization_id = ?::uuid and deleted_at is null limit 1`,
    [scope.tenantId, scope.organizationId],
  )) as Array<{ quote_number_format: string | null; order_number_format: string | null }>
  const fmt = kind === 'quote' ? rows[0]?.quote_number_format : rows[0]?.order_number_format
  return fmt?.trim() || DEFAULTS[kind]
}

export async function peekNextNumber(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  kind: PeekKind,
): Promise<{ number: string; format: string; sequence: number } | null> {
  const format = await resolveFormat(em, scope, kind)
  if (hasRandomTokens(format)) return null
  const rows = (await em.execute(
    `select current_value from sales_document_sequences
     where tenant_id = ?::uuid and organization_id = ?::uuid and document_kind = ?`,
    [scope.tenantId, scope.organizationId, kind],
  )) as Array<{ current_value: string | number }>
  const sequence = rows[0] ? Number(rows[0].current_value) + 1 : 1
  return { number: formatDocumentNumber(format, kind, sequence), format, sequence }
}
