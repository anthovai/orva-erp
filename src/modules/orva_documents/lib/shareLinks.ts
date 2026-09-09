import type { EntityManager } from '@mikro-orm/postgresql'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { DocumentShareLink } from '../data/entities'
import { isShareable, type DocumentType } from './document'

/**
 * Public links for documents that are not quotations.
 *
 * A quotation's public link is the sales module's acceptance token — one
 * door, resolving one quote. Everything else that may be handed to someone
 * outside the company goes through a row in `orva_documents_share_links`:
 * the token's hash (never the token), the record it points at, the type it
 * prints as, an expiry, and a revocation.
 *
 * What may pass through this door is decided by `SHAREABLE_TYPES`: today the
 * ใบส่งของ only. A statutory tax document is never served off a link a driver
 * can forward.
 */

export const DEFAULT_SHARE_DAYS = 30

export type ShareLinkLike = {
  expiresAt?: Date | string | null
  revokedAt?: Date | string | null
}

/** Live means neither revoked nor past its expiry — the only state the public route serves. */
export function shareLinkIsLive(link: ShareLinkLike, now: Date = new Date()): boolean {
  if (link.revokedAt) return false
  if (!link.expiresAt) return true
  const expires = link.expiresAt instanceof Date ? link.expiresAt : new Date(link.expiresAt)
  return Number.isFinite(expires.getTime()) && expires.getTime() > now.getTime()
}

/** Midnight UTC `days` days on: the link expires at the end of a calendar day, like a quote's validity. */
export function expiryFor(now: Date, days: number): Date {
  const expires = new Date(now)
  expires.setUTCHours(0, 0, 0, 0)
  expires.setUTCDate(expires.getUTCDate() + days + 1)
  return expires
}

/**
 * Resolves a public token to its link. Runs before any tenant is known, on
 * the framework path where RLS is fail-open — exactly like the quote lookup —
 * and hands the tenant back so every read after it can be pinned.
 */
export async function findShareLinkByHashedToken(em: EntityManager, tokenHash: string): Promise<DocumentShareLink | null> {
  return em.fork().findOne(DocumentShareLink, { tokenHash })
}

export type MintArgs = {
  tenantId: string
  organizationId: string
  sourceKind: 'invoice'
  sourceId: string
  documentType: DocumentType
  expiresInDays?: number
  createdBy?: string | null
  now?: Date
}

/**
 * Mints a link and revokes every live one for the same record and type.
 *
 * Rotation, like the quote link: the operator is told that the previous link
 * stops working, so a link that went to the wrong person can be replaced by
 * pressing the same button. Returns the raw token exactly once; only its hash
 * is stored.
 */
export async function mintShareLink(
  tem: EntityManager,
  args: MintArgs,
): Promise<{ rawToken: string; link: DocumentShareLink }> {
  if (!isShareable(args.documentType)) {
    throw new Error(`${args.documentType} is not a shareable document type`)
  }
  const now = args.now ?? new Date()
  await tem.nativeUpdate(
    DocumentShareLink,
    {
      tenantId: args.tenantId,
      organizationId: args.organizationId,
      sourceKind: args.sourceKind,
      sourceId: args.sourceId,
      documentType: args.documentType,
      revokedAt: null,
    },
    { revokedAt: now, updatedAt: now },
  )
  const rawToken = crypto.randomUUID()
  const link = tem.create(DocumentShareLink, {
    tenantId: args.tenantId,
    organizationId: args.organizationId,
    sourceKind: args.sourceKind,
    sourceId: args.sourceId,
    documentType: args.documentType,
    tokenHash: hashAuthToken(rawToken),
    expiresAt: expiryFor(now, args.expiresInDays ?? DEFAULT_SHARE_DAYS),
    revokedAt: null,
    createdBy: args.createdBy ?? null,
    createdAt: now,
    updatedAt: now,
  })
  tem.persist(link)
  await tem.flush()
  return { rawToken, link }
}
