import type { EntityManager } from '@mikro-orm/postgresql'
import type { ModuleCli } from '@open-mercato/shared/modules/registry'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { withTenantRls } from '@/lib/rls'
import { PurchaseOrderLine } from './data/entities'
import { findOrphanReceipts, receivedByLine, repairOrphanReceipts } from './lib/receipts'
import { deriveReceiptStatus } from './lib/status'

/**
 * `mercato orva_purchasing reconcile --tenant <id> --org <id> [--dry-run]`
 *
 * The operator-side half of the receive design. Goods move through
 * `orva_stock` in its own transaction, so a failure in this module's own write
 * afterwards leaves a WMS receipt with no row here — the order then
 * under-reports what arrived, which is the one inconsistency the design cannot
 * prevent and must therefore be able to repair.
 *
 * Idempotent: the unique index on `movement_id` means a second run inserts
 * nothing. Safe to run on a schedule, and honest when there is nothing to do —
 * it says so rather than printing zeros that read like findings (the mistake
 * the tasking importer shipped, afcf17e).
 */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

const reconcile: ModuleCli = {
  command: 'reconcile',
  async run(argv) {
    const args = parseArgs(argv ?? [])
    const tenantId = typeof args.tenant === 'string' ? args.tenant : null
    const organizationId = typeof args.org === 'string' ? args.org : null
    const dryRun = args['dry-run'] === true

    if (!tenantId || !organizationId) {
      console.error('usage: mercato orva_purchasing reconcile --tenant <uuid> --org <uuid> [--dry-run]')
      process.exitCode = 1
      return
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const scope = { tenantId, organizationId }

    const orphans = await withTenantRls(em, tenantId, (tem) => findOrphanReceipts(tem, scope))
    if (orphans.length === 0) {
      console.log('orva_purchasing reconcile: every WMS receipt for a purchase order is already recorded — nothing to do.')
      return
    }

    const byOrder = new Map<string, number>()
    for (const orphan of orphans) byOrder.set(orphan.orderId, (byOrder.get(orphan.orderId) ?? 0) + 1)
    console.log(
      `orva_purchasing reconcile: ${orphans.length} unlinked receipt(s) across ${byOrder.size} order(s).`,
    )
    for (const orphan of orphans) {
      console.log(
        `  order ${orphan.orderId} line ${orphan.orderLineId} qty ${orphan.quantity} ` +
          `lot ${orphan.lotNumber ?? '—'} movement ${orphan.movementId} received ${orphan.receivedOn}`,
      )
    }

    if (dryRun) {
      console.log('--dry-run: nothing was written.')
      return
    }

    const repaired = await withTenantRls(em, tenantId, async (tem) => {
      const count = await repairOrphanReceipts(tem, scope, orphans, null)
      // Every touched order's status follows its receipts again.
      for (const orderId of byOrder.keys()) {
        const lines = await tem.find(PurchaseOrderLine, { orderId, tenantId, deletedAt: null })
        if (lines.length === 0) continue
        const received = await receivedByLine(tem, scope, orderId)
        const status = deriveReceiptStatus(
          lines.map((line) => ({ ordered: Number(line.quantity), received: received.get(line.id) ?? 0 })),
        )
        await tem.execute(
          `update orva_purchasing_orders set status = ?, updated_at = now()
            where id = ?::uuid and tenant_id = ?::uuid and status not in ('closed', 'cancelled')`,
          [status, orderId, tenantId],
        )
      }
      return count
    })
    console.log(`orva_purchasing reconcile: wrote ${repaired} receipt(s) and refreshed ${byOrder.size} order status(es).`)
  },
}

export const cli: ModuleCli[] = [reconcile]

export default cli
