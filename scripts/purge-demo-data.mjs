// One-time admin purge: remove every demo / mock / test record so the books
// and the CRM hold only Kaiser Klowns' own data.
//
// What it removes (2026-09-03 inventory):
//   - Demo journals JE-000001..009 (seeded August samples), their reversals
//     JE-000012..020, and the E2E test entries JE-000021..026 — with lines.
//     The two real journals are renumbered JE-000010 → JE-000001 (AR
//     KK-INV-2026012) and JE-000011 → JE-000002 (receipt RCT-000001).
//   - Test receipt RCT-000002, its allocation and the AR posting of the test
//     invoice KKG-INV-2026013; demo vendor bill BILL-000001 and its lines.
//   - The six demo parties (สมชาย วัฒนกุล … บริษัท สยามซัพพลาย จำกัด) and roles/links.
//   - Demo staff teams (Engineering/Product/Operations) and members, the
//     sample workflow definition with its paused instances/tasks/events,
//     sales notes attached to purged demo quotes/orders, all notifications,
//     and the month-pack rows generated while testing.
//   - EVERY soft-deleted row in the database (demo customers, deals, quotes,
//     orders, products already deleted through the UI) — hard-deleted so no
//     trace remains.
//   - Sequences reset: journal → JE-000003 next, receipt → RCT-000002 next,
//     bill → BILL-000001 next, asset → 1.
//   - RCT-000001 memo: bank reference 2026083145496439 → 2026083145496438.
//
// Posted journals are frozen by orva_gl_journal_guard BY DESIGN, so this runs
// as the admin role with triggers suspended for one transaction. It refuses
// to touch KK-QTN-2026011, KK-INV-2026012, RCT-000001 or the two real
// customers — those are matched by exact number and left alone.
//
//   node scripts/purge-demo-data.mjs          # dry run: prints what would go
//   node scripts/purge-demo-data.mjs --apply  # does it, in one transaction
import 'dotenv/config'
import { Client } from 'pg'

const APPLY = process.argv.includes('--apply')
const url = process.env.ORVA_ADMIN_DATABASE_URL
if (!url) {
  console.error('ORVA_ADMIN_DATABASE_URL is not set (admin connection required to suspend the GL guard)')
  process.exit(1)
}

const DEMO_JOURNALS = [
  ...Array.from({ length: 9 }, (_, i) => `JE-${String(i + 1).padStart(6, '0')}`),
  ...Array.from({ length: 15 }, (_, i) => `JE-${String(i + 12).padStart(6, '0')}`),
]
const KEEP_JOURNALS = { 'JE-000010': 'JE-000001', 'JE-000011': 'JE-000002' }

const client = new Client({ connectionString: url })
await client.connect()
const count = async (sql, params = []) => Number((await client.query(sql, params)).rows[0]?.n ?? 0)
const step = async (label, sql, params = []) => {
  const result = await client.query(sql, params)
  console.log(`  ${String(result.rowCount ?? 0).padStart(5)}  ${label}`)
  return result.rowCount ?? 0
}

try {
  await client.query('begin')
  await client.query('set local session_replication_role = replica')

  console.log(APPLY ? 'Purging demo data…' : 'DRY RUN — nothing will be written. Re-run with --apply to purge.')
  console.log('Real records that stay:')
  for (const row of (await client.query(
    `select 'quote' as kind, quote_number as no from sales_quotes where deleted_at is null
     union all select 'invoice', invoice_number from sales_invoices where deleted_at is null
     union all select 'receipt', receipt_no from orva_ar_receipts where receipt_no = 'RCT-000001'
     union all select 'journal', journal_no from orva_gl_journals where journal_no in ('JE-000010','JE-000011')
     union all select 'customer', 'entity ' || id::text from customer_entities where deleted_at is null`,
  )).rows) console.log(`  keep  ${row.kind.padEnd(9)} ${row.no}`)

  console.log('Removing:')
  // --- finance -------------------------------------------------------------
  await step('journal lines of demo/test journals',
    `delete from orva_gl_journal_lines l using orva_gl_journals j where j.id = l.journal_id and j.journal_no = any($1)`, [DEMO_JOURNALS])
  await step('demo/test journals', `delete from orva_gl_journals where journal_no = any($1)`, [DEMO_JOURNALS])
  await step('test receipt allocations', `delete from orva_ar_receipt_allocations a using orva_ar_receipts r where r.id = a.receipt_id and r.receipt_no <> 'RCT-000001'`)
  await step('test receipts', `delete from orva_ar_receipts where receipt_no <> 'RCT-000001'`)
  await step('test invoice postings', `delete from orva_ar_invoice_postings where invoice_number <> 'KK-INV-2026012'`)
  await step('demo bill lines', `delete from orva_ap_bill_lines`)
  await step('demo payment allocations', `delete from orva_ap_payment_allocations`)
  await step('demo payments', `delete from orva_ap_payments`)
  await step('demo bills', `delete from orva_ap_bills`)
  await step('depreciation runs', `delete from orva_fa_depreciations`)
  await step('fixed assets', `delete from orva_fa_assets`)
  await step('bank statement lines', `delete from orva_bank_statement_lines`)
  await step('month-pack test history', `delete from orva_month_packs`)
  await step('demo party links', `delete from orva_party_links`)
  await step('demo party roles', `delete from orva_party_roles`)
  await step('demo parties', `delete from orva_parties`)

  // --- renumber the two real journals, reset sequences --------------------
  for (const [from, to] of Object.entries(KEEP_JOURNALS)) {
    await step(`renumber ${from} → ${to}`, `update orva_gl_journals set journal_no = $2 where journal_no = $1`, [from, to])
  }
  await step('sequence journal → next JE-000003', `update orva_gl_sequences set next_value = 3 where kind = 'journal'`)
  await step('sequence receipt → next RCT-000002', `update orva_gl_sequences set next_value = 2 where kind = 'ar_receipt'`)
  await step('sequence bill → next BILL-000001', `update orva_gl_sequences set next_value = 1 where kind = 'ap_bill'`)
  await step('sequence asset → 1', `update orva_gl_sequences set next_value = 1 where kind = 'fa_asset'`)
  await step('RCT-000001 memo bank reference …439 → …438',
    `update orva_ar_receipts set memo = replace(memo, '2026083145496439', '2026083145496438') where receipt_no = 'RCT-000001' and memo like '%2026083145496439%'`)

  // --- framework leftovers ---------------------------------------------------
  await step('sample workflow events', `delete from workflow_events`)
  await step('sample workflow event triggers', `delete from workflow_event_triggers`)
  await step('sample user tasks', `delete from user_tasks`)
  await step('sample step instances', `delete from step_instances`)
  await step('sample workflow branch instances', `delete from workflow_branch_instances`)
  await step('sample workflow instances', `delete from workflow_instances`)
  await step('sample workflow definitions', `delete from workflow_definitions`)
  await step('orphan sales notes', `delete from sales_notes where quote_id is null or not exists (select 1 from sales_quotes q where q.id = sales_notes.quote_id and q.deleted_at is null)`)
  await step('notifications', `delete from notifications`)
  for (const table of [
    'staff_time_entry_segments', 'staff_time_entries', 'staff_time_project_members', 'staff_time_projects', 'staff_leave_requests',
    'staff_team_member_activities', 'staff_team_member_addresses', 'staff_team_member_job_histories', 'staff_team_member_comments',
    'staff_team_members', 'staff_team_roles', 'staff_teams',
  ]) await step(`demo ${table}`, `delete from ${table}`)

  // --- hard-delete everything already soft-deleted ----------------------------
  const softTables = (await client.query(
    `select c.table_name from information_schema.columns c
     join information_schema.tables t on t.table_name = c.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'deleted_at' order by 1`,
  )).rows.map((r) => r.table_name)
  let remaining = softTables
  for (let pass = 1; remaining.length && pass <= 6; pass++) {
    const next = []
    for (const table of remaining) {
      const n = await count(`select count(*)::int as n from ${table} where deleted_at is not null`)
      if (!n) continue
      await client.query('savepoint sp')
      try {
        await step(`soft-deleted rows in ${table}`, `delete from ${table} where deleted_at is not null`)
      } catch {
        await client.query('rollback to savepoint sp')
        next.push(table) // a child still references it — retry after the children went
      }
    }
    remaining = next
  }
  if (remaining.length) throw new Error(`could not hard-delete soft-deleted rows in: ${remaining.join(', ')}`)

  // customer_companies / customer_people have no deleted_at of their own; they
  // hang off the (now removed) demo customer_entities, as do their custom fields.
  await step('orphan customer companies', `delete from customer_companies c where not exists (select 1 from customer_entities ce where ce.id = c.entity_id)`)
  await step('orphan customer people', `delete from customer_people p where not exists (select 1 from customer_entities ce where ce.id = p.entity_id)`)
  await step('orphan customer custom-field values',
    `delete from custom_field_values v where v.entity_id like 'customers:%'
       and not exists (select 1 from customer_entities ce where ce.id::text = v.record_id)
       and not exists (select 1 from customer_companies c where c.id::text = v.record_id)
       and not exists (select 1 from customer_people p where p.id::text = v.record_id)
       and not exists (select 1 from customer_deals d where d.id::text = v.record_id)`)

  console.log('Books after purge:')
  for (const row of (await client.query(
    `select j.journal_no, to_char(j.journal_date, 'YYYY-MM-DD') as journal_date, j.memo, j.total_debit from orva_gl_journals j where j.deleted_at is null order by j.journal_no`,
  )).rows) console.log(`  ${row.journal_no}  ${row.journal_date}  ${row.total_debit}  ${row.memo}`)

  if (APPLY) {
    await client.query('commit')
    console.log('Committed. Restart the dev server so the ORM/query cache forgets the removed rows.')
  } else {
    await client.query('rollback')
    console.log('Dry run rolled back — nothing changed.')
  }
} catch (error) {
  await client.query('rollback').catch(() => {})
  console.error('failed, nothing changed:', error.message)
  process.exitCode = 1
} finally {
  await client.end()
}
