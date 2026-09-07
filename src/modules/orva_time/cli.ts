import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { plan, applyPlan } from './lib/apply'
import { summarize } from './lib/sync'

/**
 * `mercato orva_time sync --tenant <id> --org <id> [--dry-run]`
 *
 * The reconcile half of the design. The subscriber gives immediacy; this gives
 * correctness — it is what fixes a mirror missed while a worker was down, and
 * it is the backfill for every project that existed before the sync did.
 *
 * `--dry-run` prints the plan and writes nothing. It reports the tally *and*
 * says plainly when there is nothing to do, because the importer shipped the
 * opposite bug (afcf17e): a dry run whose zeros read like findings.
 */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else { args[key] = next; index += 1 }
  }
  return args
}

const sync: ModuleCli = {
  command: 'sync',
  async run(argv) {
    const args = parseArgs(argv ?? [])
    const tenantId = typeof args.tenant === 'string' ? args.tenant : null
    const organizationId = typeof args.org === 'string' ? args.org : null
    const dryRun = args['dry-run'] === true

    if (!tenantId || !organizationId) {
      console.error('usage: mercato orva_time sync --tenant <uuid> --org <uuid> [--dry-run]')
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const scope = { tenantId, organizationId }

    const actions = await plan(em, scope)
    const tally = summarize(actions)

    if (actions.length === 0) {
      console.log('โครงการ and โปรเจกต์ already agree — nothing to do.')
      return
    }

    console.log(`${actions.length} action(s):`)
    for (const [kind, count] of Object.entries(tally)) {
      if (count > 0) console.log(`  ${kind}: ${count}`)
    }
    for (const action of actions) {
      if (action.kind === 'drift') {
        console.log(`  drift: link ${action.linkId} — งาน "${action.taskingName}" vs โครงการ "${action.timeName}" (last synced "${action.syncedName}")`)
      }
      if (action.kind === 'orphan') console.log(`  orphan: link ${action.linkId} has no ${action.missing} row`)
      if (action.kind === 'code-collision') console.log(`  code-collision: ${action.code} is held by time project ${action.heldBy}`)
    }

    if (dryRun) {
      console.log('--dry-run: nothing was written.')
      return
    }

    const result = await applyPlan(em, scope, actions)
    console.log(`applied ${result.applied}; left for a human: ${result.reported.length}`)
  },
}

export default [sync]
