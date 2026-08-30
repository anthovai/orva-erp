import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { PayrollLine } from '../../data/entities'
import { createOrvaHrCrudOpenApi, createPagedListResponseSchema } from '../openapi'

const ENTITY_ID = 'orva_hr:payroll_line' as const

const lineListSchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(200).default(100),
    sortField: z.string().optional().default('employee_no'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    runId: z.string().uuid().optional(),
    withDeleted: z.coerce.boolean().optional().default(false),
    organizationId: z.string().uuid().optional(),
  })
  .passthrough()

type LineListQuery = z.infer<typeof lineListSchema>

const lineListItemSchema = z
  .object({
    id: z.string().uuid(),
    run_id: z.string().uuid(),
    employee_id: z.string().uuid(),
    employee_no: z.string().nullable().optional(),
    employee_name: z.string(),
    gross: z.union([z.string(), z.number()]).optional(),
    sso_employee: z.union([z.string(), z.number()]).optional(),
    sso_employer: z.union([z.string(), z.number()]).optional(),
    wht: z.union([z.string(), z.number()]).optional(),
    net: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough()

// Read-only: lines are produced by the calculate action and frozen once the
// run posts — there is no manual editing surface by design.
export const { metadata, GET } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['orva_hr.payroll.view'] },
  },
  orm: {
    entity: PayrollLine,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: ENTITY_ID },
  list: {
    schema: lineListSchema,
    entityId: ENTITY_ID,
    fields: [
      'id', 'run_id', 'employee_id', 'employee_no', 'employee_name',
      'gross', 'sso_employee', 'sso_employer', 'wht', 'net',
      'tenant_id', 'organization_id', 'created_at', 'updated_at',
    ],
    sortFieldMap: { id: 'id', employee_no: 'employee_no', employee_name: 'employee_name', net: 'net' },
    buildFilters: async (query: LineListQuery) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.runId) filters.run_id = query.runId
      return filters
    },
  },
})

export const openApi = createOrvaHrCrudOpenApi({
  resourceName: 'Payroll Line',
  pluralName: 'Payroll Lines',
  querySchema: lineListSchema,
  listResponseSchema: createPagedListResponseSchema(lineListItemSchema),
})
