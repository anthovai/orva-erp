import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildAttachmentContentDisposition, canRenderInlineAttachment } from '@open-mercato/core/modules/attachments/lib/security'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { SupportTicket } from '../../../data/entities'

// The route authenticates the customer itself; staff auth does not apply.
export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

/** Screenshots and short documents; a customer does not need to upload a film. */
const MAX_BYTES = 8 * 1024 * 1024
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain'])

type StorageDriverFactory = {
  resolveForPartition(partitionCode: string, scope: { tenantId: string; organizationId: string }): Promise<{
    read(partitionCode: string, storagePath: string): Promise<{ buffer: Buffer }>
  }>
}

type ScopedUploadService = {
  upload(input: {
    tenantId: string; organizationId: string; entityId: string; recordId: string
    fileName: string; declaredMimeType?: string | null; buffer: Buffer; maxBytes?: number
  }): Promise<{ id: string; fileName?: string | null }>
}

/**
 * The file back out again.
 *
 * The installed `/api/attachments/file/[id]` route answers to a staff session,
 * which a customer will never have, so the ownership question is asked here
 * instead — and asked of the ticket, not of the attachment: a file is
 * downloadable only while it hangs on a ticket whose `customer_entity_id` is
 * the one on the session. Everything else is a 404, including files that exist
 * and belong to someone else.
 */
export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const customerEntityId = auth.customerEntityId ?? null
  if (!customerEntityId) return Response.json({ error: 'Not found' }, { status: 404 })
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const rows = await withTenantRls(em, scope.tenantId, (tem) => tem.execute(
    `select a.partition_code, a.storage_path, a.file_name, a.mime_type
     from attachments a
     join orva_support_tickets t on t.id::text = a.record_id
     where a.id = ?::uuid and a.entity_id = 'orva_support:ticket'
       and a.tenant_id = ?::uuid
       and t.tenant_id = ?::uuid and t.organization_id = ?::uuid
       and t.customer_entity_id = ?::uuid and t.deleted_at is null
     limit 1`,
    [id, scope.tenantId, scope.tenantId, scope.organizationId, customerEntityId],
  )) as Array<{ partition_code: string; storage_path: string; file_name: string; mime_type: string | null }>
  const row = rows[0]
  if (!row) return Response.json({ error: 'Not found' }, { status: 404 })

  const factory = container.resolve<StorageDriverFactory>('storageDriverFactory')
  let buffer: Buffer
  try {
    const driver = await factory.resolveForPartition(row.partition_code, scope)
    buffer = (await driver.read(row.partition_code, row.storage_path)).buffer
  } catch {
    return Response.json({ error: 'File not available' }, { status: 404 })
  }

  // Same posture as the installed route: only types safe to render get a real
  // content type, the rest download, and nothing is sniffed.
  const inline = canRenderInlineAttachment(row.mime_type)
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Cache-Control': 'private, max-age=60',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': inline ? (row.mime_type || 'application/octet-stream') : 'application/octet-stream',
      'Content-Disposition': buildAttachmentContentDisposition(row.file_name, inline ? 'inline' : 'attachment'),
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/**
 * A screenshot on the customer's own ticket — which is how a bug actually
 * arrives.
 *
 * The file goes through the installed attachments module's scoped upload
 * service, so quota, storage driver and the attachment record are the same
 * ones the staff screen uses; this route only decides WHO may upload WHERE.
 * The attachments HTTP route cannot be reused directly because it requires a
 * staff session and staff features, which a customer will never have.
 */
export async function POST(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const customerEntityId = auth.customerEntityId ?? null
  if (!customerEntityId) return Response.json({ error: 'Not found' }, { status: 404 })

  let form: FormData
  try { form = await req.formData() } catch { return Response.json({ error: 'ต้องส่งเป็น multipart/form-data พร้อมไฟล์' }, { status: 400 }) }
  const ticketId = String(form.get('ticketId') ?? '')
  const file = form.get('file')
  if (!ticketId || !(file instanceof File)) return Response.json({ error: 'ต้องระบุ ticketId และไฟล์' }, { status: 400 })
  if (file.size > MAX_BYTES) return Response.json({ error: 'ไฟล์ใหญ่เกิน 8 MB' }, { status: 400 })
  if (file.type && !ALLOWED.has(file.type)) return Response.json({ error: 'รองรับเฉพาะรูปภาพ PDF หรือไฟล์ข้อความ' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId }

  const owns = await withTenantRls(em, scope.tenantId, (tem) =>
    tem.count(SupportTicket, { id: ticketId, ...scope, customerEntityId, deletedAt: null }))
  if (!owns) return Response.json({ error: 'Not found' }, { status: 404 })

  const uploader = container.resolve<ScopedUploadService>('attachmentScopedUploadService')
  const buffer = Buffer.from(await file.arrayBuffer())
  try {
    const saved = await uploader.upload({
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      entityId: 'orva_support:ticket',
      recordId: ticketId,
      fileName: file.name || 'attachment',
      declaredMimeType: file.type || null,
      buffer,
      maxBytes: MAX_BYTES,
    })
    return Response.json({ ok: true, id: String(saved.id), fileName: saved.fileName ?? file.name }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: `แนบไฟล์ไม่สำเร็จ: ${message.slice(0, 300)}` }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Support',
  summary: 'Portal — attach a file to your own ticket',
  methods: {
    GET: {
      summary: 'Streams one file back, if it hangs on a ticket the signed-in customer owns',
      tags: ['Orva Support'],
      query: z.object({ id: z.string().uuid() }),
      responses: [{ status: 200, description: 'The file.', schema: z.any() }],
      errors: [{ status: 404, description: 'Not the customer\'s file', schema: z.object({ error: z.string() }) }],
    },
    POST: {
      summary: 'Uploads an image, PDF or text file (max 8 MB) against a ticket the signed-in customer owns',
      tags: ['Orva Support'],
      responses: [{ status: 201, description: 'Stored.', schema: z.object({ ok: z.boolean(), id: z.string(), fileName: z.string() }) }],
      errors: [{ status: 404, description: 'Not the customer\'s ticket', schema: z.object({ error: z.string() }) }],
    },
  },
}
