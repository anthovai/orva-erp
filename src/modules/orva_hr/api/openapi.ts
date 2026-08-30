import { z, type ZodTypeAny } from 'zod'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
} from '@open-mercato/shared/lib/openapi/crud'

export const orvaHrTag = 'Orva HR'

export const okSchema = z.object({ ok: z.literal(true) })
export const createdSchema = z.object({ id: z.string().uuid() })

export function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

export const createOrvaHrCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: orvaHrTag,
  defaultCreateResponseSchema: createdSchema,
})
