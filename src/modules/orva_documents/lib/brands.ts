import type { EntityManager } from '@mikro-orm/postgresql'
import { DocumentBrand, type DocumentSettings } from '../data/entities'
import { formatDocumentNumber, hasRandomTokens, resolveFormat, type PeekKind } from './documentNumberPeek'

/**
 * Brand profiles (spec 2026-09-03 operating model, phase D).
 *
 * One legal entity, several brands. The settings row stays the default brand;
 * a DocumentBrand overrides colour, logos, payment block, terms and the
 * number series. Membership is by number prefix: a document numbered
 * `MRV-QTN-2026001` belongs to the brand with code `MRV`. That keeps the
 * upstream sales tables untouched and makes the brand of any document
 * derivable forever from the number printed on it.
 *
 * Series: upstream's `sales_document_sequences` is unique per
 * (tenant, org, document_kind). A brand series simply uses the kind
 * `quote:MRV` / `invoice:MRV` in the same table, so numbering stays atomic
 * and inspectable next to the default series.
 */
export type BrandScope = { tenantId: string; organizationId: string }
export type BrandKind = 'quote' | 'invoice'

export const BRAND_COOKIE = 'orva_brand'

export async function loadBrands(tem: EntityManager, scope: BrandScope): Promise<DocumentBrand[]> {
  return tem.find(DocumentBrand, { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null }, { orderBy: { code: 'asc' } })
}

/** The brand whose code is the first dash-separated token of the number, if any. */
export function brandForNumber<T extends { code: string }>(number: string | null | undefined, brands: T[]): T | null {
  if (!number) return null
  const head = number.trim().split('-')[0]?.toUpperCase()
  if (!head) return null
  return brands.find((b) => b.code.toUpperCase() === head) ?? null
}

/** Default series format with the leading prefix swapped for the brand code: KKG-QTN-{yyyy}{seq:3} → MRV-QTN-{yyyy}{seq:3}. */
export function reprefixFormat(format: string, code: string): string {
  const trimmed = format.trim()
  if (/^[A-Za-z0-9]+-/.test(trimmed)) return `${code}-${trimmed.slice(trimmed.indexOf('-') + 1)}`
  return `${code}-${trimmed}`
}

/**
 * The settings a brand's document should render with: seller identity from
 * the legal entity, visual/payment/terms from the brand when it sets them.
 */
export function settingsWithBrand<T extends Pick<DocumentSettings, 'brandColor' | 'logoHeader' | 'logoFooter' | 'logoHeaderQuotation' | 'paymentDetails' | 'documentTerms'>>(
  settings: T | null,
  brand: DocumentBrand | null,
): T | null {
  if (!settings || !brand) return settings
  const merged = Object.create(Object.getPrototypeOf(settings) as object) as T
  Object.assign(merged, settings, {
    brandColor: brand.brandColor ?? settings.brandColor,
    logoHeader: brand.logoHeader ?? null,
    logoFooter: brand.logoFooter ?? null,
    logoHeaderQuotation: brand.logoHeaderQuotation ?? brand.logoHeader ?? null,
    paymentDetails: brand.paymentDetails ?? settings.paymentDetails,
    documentTerms: brand.documentTerms ?? settings.documentTerms,
  })
  return merged
}

export const brandSeriesKind = (kind: BrandKind, code: string) => `${kind}:${code.toUpperCase()}`

async function brandFormat(em: EntityManager, scope: BrandScope, brand: DocumentBrand, kind: BrandKind, invoiceDefault?: string | null): Promise<string> {
  const own = kind === 'quote' ? brand.quoteNumberFormat : brand.invoiceNumberFormat
  if (own?.trim()) return own.trim()
  const base = kind === 'quote' ? await resolveFormat(em, scope, 'quote') : (invoiceDefault?.trim() || 'INV-{yyyy}{mm}{dd}-{seq:5}')
  return reprefixFormat(base, brand.code)
}

/** Non-claiming preview of the next number in a brand series. */
export async function peekBrandNumber(
  em: EntityManager,
  scope: BrandScope,
  brand: DocumentBrand,
  kind: BrandKind,
  invoiceDefault?: string | null,
): Promise<{ number: string; format: string; sequence: number } | null> {
  const format = await brandFormat(em, scope, brand, kind, invoiceDefault)
  if (hasRandomTokens(format)) return null
  const rows = (await em.execute(
    `select current_value from sales_document_sequences
     where tenant_id = ?::uuid and organization_id = ?::uuid and document_kind = ?`,
    [scope.tenantId, scope.organizationId, brandSeriesKind(kind, brand.code)],
  )) as Array<{ current_value: string | number }>
  const sequence = rows[0] ? Number(rows[0].current_value) + 1 : 1
  return { number: formatDocumentNumber(format, kind as PeekKind, sequence), format, sequence }
}

/** Atomic claim of the next number in a brand series (same upsert shape as upstream's generator). */
export async function claimBrandNumber(
  em: EntityManager,
  scope: BrandScope,
  brand: DocumentBrand,
  kind: BrandKind,
  invoiceDefault?: string | null,
): Promise<{ number: string; format: string; sequence: number }> {
  const format = await brandFormat(em, scope, brand, kind, invoiceDefault)
  const rows = (await em.execute(
    `insert into sales_document_sequences as s (id, tenant_id, organization_id, document_kind, current_value, created_at, updated_at)
     values (gen_random_uuid(), ?::uuid, ?::uuid, ?, 1, now(), now())
     on conflict (organization_id, tenant_id, document_kind)
     do update set current_value = s.current_value + 1, updated_at = now()
     returning current_value`,
    [scope.tenantId, scope.organizationId, brandSeriesKind(kind, brand.code)],
  )) as Array<{ current_value: string | number }>
  const sequence = Number(rows[0]?.current_value ?? 1)
  return { number: formatDocumentNumber(format, kind as PeekKind, sequence), format, sequence }
}

/** The brand the operator switched to for the next documents, from the request cookie. */
export function readActiveBrandCode(req: Request): string | null {
  const cookie = req.headers.get('cookie') ?? ''
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${BRAND_COOKIE}=([^;]+)`))
  const value = match ? decodeURIComponent(match[1]).trim().toUpperCase() : ''
  return /^[A-Z0-9]{2,6}$/.test(value) ? value : null
}
