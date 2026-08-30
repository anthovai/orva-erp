import { z, type ZodTypeAny } from 'zod'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
} from '@open-mercato/shared/lib/openapi/crud'

export const orvaFinanceTag = 'Orva Finance'

export const okSchema = z.object({ ok: z.literal(true) })
export const createdSchema = z.object({ id: z.string().uuid() })

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

export const createOrvaFinanceCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: orvaFinanceTag,
  defaultCreateResponseSchema: createdSchema,
})
