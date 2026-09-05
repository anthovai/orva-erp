import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveActiveOrganizationId, organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { z } from 'zod'
import { listProjects, listTasks, readTaskingConfig, taskProgress } from '../../lib/client'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['orva_tasking.view'] },
}

const projectSchema = z.object({
  id: z.number(),
  title: z.string(),
  description: z.string().nullable(),
  total: z.number(),
  done: z.number(),
  donePct: z.number(),
})

const responseSchema = z.object({
  configured: z.boolean(),
  items: z.array(projectSchema),
})

/**
 * The task projects, each with how much of its work is finished.
 *
 * The Tasking token stays on the server: the browser talks only to Orva, so a
 * token that can read every project never reaches a page where a user could
 * read it out.
 */
export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!resolveActiveOrganizationId(auth)) return organizationScopeRequiredResponse()

  const config = readTaskingConfig()
  // Not an error: the module ships before the token is issued, and the screen
  // explains how to finish the setup rather than showing a failure.
  if (!config) return Response.json({ configured: false, items: [] })

  try {
    const projects = await listProjects(config)
    const items = await Promise.all(
      projects.map(async (project) => {
        const progress = taskProgress(await listTasks(config, project.id))
        return {
          id: project.id,
          title: project.title,
          description: project.description ?? null,
          ...progress,
        }
      }),
    )
    return Response.json({ configured: true, items })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not reach KKG-Tasking' },
      { status: 502 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Orva Tasking',
  summary: 'Task projects with work progress',
  methods: {
    GET: {
      summary: 'Projects from KKG-Tasking, each with tasks done vs total',
      tags: ['Orva Tasking'],
      responses: [{ status: 200, description: 'Projects, or configured=false when no token is set.', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Authentication required', schema: z.object({ error: z.string() }) },
        { status: 502, description: 'KKG-Tasking unreachable', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
