import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { withTenantRls } from '@/lib/rls'
import { HrEmployee } from '../../../data/entities'
import { orvaHrTag } from '../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_hr.employees.view'] },
}

const querySchema = z.object({ id: z.string().uuid() })

const employeeSchema = z.object({
  id: z.string(),
  employeeNo: z.string().nullable(),
  staffMemberId: z.string().nullable(),
  displayName: z.string().nullable(),
  position: z.string().nullable(),
  hireDate: z.string().nullable(),
  monthlySalary: z.number(),
  status: z.string(),
  titleTh: z.string().nullable(),
  firstNameTh: z.string().nullable(),
  lastNameTh: z.string().nullable(),
  nationalId: z.string().nullable(),
  ssoNumber: z.string().nullable(),
  address: z.string().nullable(),
  bankName: z.string().nullable(),
  bankAccountNo: z.string().nullable(),
  terminationDate: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

/**
 * One employment record with its statutory identity readable.
 *
 * The list route answers from the query index, which stores what raw SQL sees
 * — and four of these columns are ciphertext there. The edit form and the
 * filing screens read here instead, where `findWithDecryption` returns the
 * plaintext the operator typed.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const organizationId = resolveActiveOrganizationId(auth)
  if (!organizationId) return organizationScopeRequiredResponse()
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
  if (!parsed.success) return Response.json({ error: 'id is required' }, { status: 400 })

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const tenantId = auth.tenantId
  const [row] = await withTenantRls(em, tenantId, (tem) => findWithDecryption(
    tem, HrEmployee,
    { id: parsed.data.id, tenantId, organizationId, deletedAt: null },
    { limit: 1 },
    { tenantId },
  ))
  if (!row) return Response.json({ error: 'Employee not found' }, { status: 404 })

  return Response.json({
    id: String(row.id),
    employeeNo: row.employeeNo ?? null,
    staffMemberId: row.staffMemberId ?? null,
    displayName: row.displayName ?? null,
    position: row.position ?? null,
    hireDate: row.hireDate ?? null,
    monthlySalary: Number(row.monthlySalary ?? 0),
    status: row.status,
    titleTh: row.titleTh ?? null,
    firstNameTh: row.firstNameTh ?? null,
    lastNameTh: row.lastNameTh ?? null,
    nationalId: row.nationalId ?? null,
    ssoNumber: row.ssoNumber ?? null,
    address: row.address ?? null,
    bankName: row.bankName ?? null,
    bankAccountNo: row.bankAccountNo ?? null,
    terminationDate: row.terminationDate ?? null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: orvaHrTag,
  summary: 'Employee detail',
  methods: {
    GET: {
      summary: 'One employment record including the statutory identity, decrypted for the operator',
      tags: [orvaHrTag],
      query: querySchema,
      responses: [{ status: 200, description: 'The employee.', schema: employeeSchema }],
      errors: [{ status: 404, description: 'Not found', schema: z.object({ error: z.string() }) }],
    },
  },
}
