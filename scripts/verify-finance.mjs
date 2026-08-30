// Orva Finance: live verification of the GL invariants that are enforced in
// the DATABASE (triggers + checks), independent of application code.
// Connects with DATABASE_URL (orva_app). Usage: node scripts/verify-finance.mjs
import 'dotenv/config'
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
let failures = 0
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures++ }
const expectError = async (name, pattern, fn) => {
  await client.query('savepoint sp')
  try { await fn(); check(name, false, 'no error raised') }
  catch (e) { check(name, pattern.test(e.message), e.message.split('\n')[0]) }
  await client.query('rollback to sp')
}

try {
  const { rows: [scope] } = await client.query(`select t.id as tenant, o.id as org from tenants t, organizations o limit 1`)
  await client.query('begin')
  await client.query(`select set_config('orva.tenant_id', $1, true)`, [scope.tenant])

  const mk = async (sql, params) => (await client.query(sql, params)).rows[0]
  const acct = async (code, type) => (await mk(
    `insert into orva_gl_accounts (tenant_id, organization_id, code, name, account_type, created_at, updated_at)
     values ($1,$2,$3,$3,$4,now(),now()) returning id`, [scope.tenant, scope.org, code, type])).id
  const cash = await acct(`T-1000-${Date.now()}`, 'asset')
  const sales = await acct(`T-4000-${Date.now()}`, 'income')

  const openPeriod = (await mk(
    `insert into orva_fiscal_periods (tenant_id, organization_id, code, starts_on, ends_on, status, created_at, updated_at)
     values ($1,$2,$3,'2099-01-01','2099-01-31','open',now(),now()) returning id`,
    [scope.tenant, scope.org, `T-2099-01-${Date.now()}`])).id
  const closedPeriod = (await mk(
    `insert into orva_fiscal_periods (tenant_id, organization_id, code, starts_on, ends_on, status, created_at, updated_at)
     values ($1,$2,$3,'2099-02-01','2099-02-28','closed',now(),now()) returning id`,
    [scope.tenant, scope.org, `T-2099-02-${Date.now()}`])).id

  const journal = async (period, date, no) => (await mk(
    `insert into orva_gl_journals (tenant_id, organization_id, journal_no, status, period_id, journal_date, total_debit, total_credit, created_at, updated_at)
     values ($1,$2,$3,'draft',$4,$5,100,100,now(),now()) returning id`,
    [scope.tenant, scope.org, no, period, date])).id
  const line = (j, acc, debit, credit, n) => client.query(
    `insert into orva_gl_journal_lines (tenant_id, organization_id, journal_id, line_no, account_id, debit, credit, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,now(),now())`, [scope.tenant, scope.org, j, n, acc, debit, credit])

  // happy path: balanced journal in an open period posts
  const j1 = await journal(openPeriod, '2099-01-15', `T-JE-OK-${Date.now()}`)
  await line(j1, cash, 100, 0, 1)
  await line(j1, sales, 0, 100, 2)
  await client.query(`update orva_gl_journals set status='posted', posted_at=now() where id=$1`, [j1])
  check('balanced journal in open period posts', true)

  // posted journal is immutable / undeletable / lines frozen (DB triggers)
  await expectError('posted journal rejects UPDATE', /immutable/i,
    () => client.query(`update orva_gl_journals set memo='tamper' where id=$1`, [j1]))
  await expectError('posted journal rejects DELETE', /cannot be deleted/i,
    () => client.query(`delete from orva_gl_journals where id=$1`, [j1]))
  await expectError('posted journal lines reject UPDATE (incl. soft delete)', /immutable/i,
    () => client.query(`update orva_gl_journal_lines set deleted_at=now() where journal_id=$1`, [j1]))
  await expectError('posted journal lines reject INSERT', /immutable/i,
    () => line(j1, cash, 1, 0, 3))

  // trial balance aggregation over posted lines (same SQL shape as the report)
  const { rows: tb } = await client.query(
    `select a.id, coalesce(sum(l.debit),0)::numeric as d, coalesce(sum(l.credit),0)::numeric as c
     from orva_gl_accounts a
     left join orva_gl_journal_lines l on l.account_id = a.id and l.deleted_at is null
       and exists (select 1 from orva_gl_journals j where j.id = l.journal_id and j.status='posted' and j.deleted_at is null)
     where a.id = any($1::uuid[]) group by a.id`, [[cash, sales]])
  const cashRow = tb.find((r) => r.id === cash)
  const salesRow = tb.find((r) => r.id === sales)
  check('trial balance: cash debit 100 / sales credit 100',
    Number(cashRow?.d) === 100 && Number(cashRow?.c) === 0 && Number(salesRow?.c) === 100 && Number(salesRow?.d) === 0,
    `cash d=${cashRow?.d} c=${cashRow?.c}, sales d=${salesRow?.d} c=${salesRow?.c}`)

  // unbalanced posting is rejected by the trigger
  const j2 = await journal(openPeriod, '2099-01-16', `T-JE-UNBAL-${Date.now()}`)
  await expectError('unbalanced journal cannot post', /not balanced/i,
    () => client.query(`update orva_gl_journals set status='posted', total_debit=100, total_credit=99 where id=$1`, [j2]))

  // closed period rejects posting
  const j3 = await journal(closedPeriod, '2099-02-10', `T-JE-CLOSED-${Date.now()}`)
  await expectError('closed period rejects posting', /closed/i,
    () => client.query(`update orva_gl_journals set status='posted' where id=$1`, [j3]))

  // date outside period rejects posting
  const j4 = await journal(openPeriod, '2099-03-01', `T-JE-DATE-${Date.now()}`)
  await expectError('journal date outside period rejects posting', /outside period/i,
    () => client.query(`update orva_gl_journals set status='posted' where id=$1`, [j4]))

  // line-level constraint: debit and credit on the same line
  await expectError('line with both debit and credit rejected (check)', /amounts_check/i,
    () => line(j2, cash, 5, 5, 9))

  // ---- AP vendor bills ----
  await client.query('begin')
  await client.query(`select set_config('orva.tenant_id', $1, true)`, [scope.tenant])
  const apAcct = await acct(`T-2100-${Date.now()}`, 'liability')
  const expAcct = await acct(`T-5000-${Date.now()}`, 'expense')
  const { rows: [vendor] } = await client.query(
    `insert into orva_parties (tenant_id, organization_id, kind, display_name, created_at, updated_at)
     values ($1,$2,'company','AP Probe Vendor',now(),now()) returning id`, [scope.tenant, scope.org])
  const { rows: [bill] } = await client.query(
    `insert into orva_ap_bills (tenant_id, organization_id, bill_no, status, vendor_party_id, period_id, bill_date, total_amount, created_at, updated_at)
     values ($1,$2,$3,'draft',$4,$5,'2099-01-20',500,now(),now()) returning id`,
    [scope.tenant, scope.org, `T-BILL-${Date.now()}`, vendor.id, openPeriod])
  await client.query(
    `insert into orva_ap_bill_lines (tenant_id, organization_id, bill_id, line_no, expense_account_id, amount, created_at, updated_at)
     values ($1,$2,$3,1,$4,500,now(),now())`, [scope.tenant, scope.org, bill.id, expAcct])
  await expectError('bill line with zero amount rejected (check)', /amount_check/i,
    () => client.query(
      `insert into orva_ap_bill_lines (tenant_id, organization_id, bill_id, line_no, expense_account_id, amount, created_at, updated_at)
       values ($1,$2,$3,2,$4,0,now(),now())`, [scope.tenant, scope.org, bill.id, expAcct]))
  await client.query(`update orva_ap_bills set status='posted', posted_at=now() where id=$1`, [bill.id])
  await expectError('posted bill rejects UPDATE', /immutable/i,
    () => client.query(`update orva_ap_bills set memo='tamper' where id=$1`, [bill.id]))
  await expectError('posted bill rejects DELETE', /cannot be deleted/i,
    () => client.query(`delete from orva_ap_bills where id=$1`, [bill.id]))
  await expectError('posted bill lines frozen', /immutable/i,
    () => client.query(`update orva_ap_bill_lines set amount=999 where bill_id=$1`, [bill.id]))
  // relaxed bill guard: paid_amount-only updates are allowed on posted bills
  await client.query(`update orva_ap_bills set paid_amount = 200 where id=$1`, [bill.id])
  check('posted bill accepts paid_amount-only update', true)
  await expectError('posted bill rejects paid_amount above total', /out of range/i,
    () => client.query(`update orva_ap_bills set paid_amount = 999999 where id=$1`, [bill.id]))

  // payments: posted = frozen, allocations guarded
  const { rows: [cashProbe] } = await client.query(
    `insert into orva_gl_accounts (tenant_id, organization_id, code, name, account_type, created_at, updated_at)
     values ($1,$2,$3,$3,'asset',now(),now()) returning id`, [scope.tenant, scope.org, `T-1100-${Date.now()}`])
  const { rows: [payment] } = await client.query(
    `insert into orva_ap_payments (tenant_id, organization_id, payment_no, status, vendor_party_id, cash_account_id, period_id, payment_date, total_amount, created_at, updated_at)
     values ($1,$2,$3,'draft',$4,$5,$6,'2099-01-25',200,now(),now()) returning id`,
    [scope.tenant, scope.org, `T-PAY-${Date.now()}`, vendor.id, cashProbe.id, openPeriod])
  await client.query(
    `insert into orva_ap_payment_allocations (tenant_id, organization_id, payment_id, bill_id, amount, created_at, updated_at)
     values ($1,$2,$3,$4,200,now(),now())`, [scope.tenant, scope.org, payment.id, bill.id])
  await expectError('payment allocation with zero amount rejected (check)', /amount_check/i,
    () => client.query(
      `insert into orva_ap_payment_allocations (tenant_id, organization_id, payment_id, bill_id, amount, created_at, updated_at)
       values ($1,$2,$3,$4,0,now(),now())`, [scope.tenant, scope.org, payment.id, bill.id]))
  await client.query(`update orva_ap_payments set status='posted', posted_at=now() where id=$1`, [payment.id])
  await expectError('posted payment rejects UPDATE', /immutable/i,
    () => client.query(`update orva_ap_payments set memo='tamper' where id=$1`, [payment.id]))
  await expectError('posted payment rejects DELETE', /cannot be deleted/i,
    () => client.query(`delete from orva_ap_payments where id=$1`, [payment.id]))
  await expectError('posted payment allocations frozen', /immutable/i,
    () => client.query(`update orva_ap_payment_allocations set amount=1 where payment_id=$1`, [payment.id]))

  // AR posting records: immutable + one per invoice
  const fakeInvoiceId = randomUUID()
  const { rows: [arPosting] } = await client.query(
    `insert into orva_ar_invoice_postings (tenant_id, organization_id, invoice_id, invoice_number, journal_id, amount, created_at)
     select $1,$2,$3,'T-INV-PROBE',j.id,100,now() from orva_gl_journals j where j.tenant_id=$1 limit 1 returning id`,
    [scope.tenant, scope.org, fakeInvoiceId])
  await expectError('ar posting record rejects UPDATE', /immutable/i,
    () => client.query(`update orva_ar_invoice_postings set amount=1 where id=$1`, [arPosting.id]))
  await expectError('ar posting record rejects DELETE', /immutable/i,
    () => client.query(`delete from orva_ar_invoice_postings where id=$1`, [arPosting.id]))
  await expectError('ar double-posting blocked (unique per invoice)', /invoice_unique/i,
    () => client.query(
      `insert into orva_ar_invoice_postings (tenant_id, organization_id, invoice_id, invoice_number, journal_id, amount, created_at)
       select $1,$2,$3,'T-INV-PROBE-2',j.id,100,now() from orva_gl_journals j where j.tenant_id=$1 limit 1`,
      [scope.tenant, scope.org, fakeInvoiceId]))

  // AR receipts: posted = frozen, allocations guarded
  const { rows: [receipt] } = await client.query(
    `insert into orva_ar_receipts (tenant_id, organization_id, receipt_no, status, cash_account_id, period_id, receipt_date, total_amount, created_at, updated_at)
     values ($1,$2,$3,'draft',$4,$5,'2099-01-26',100,now(),now()) returning id`,
    [scope.tenant, scope.org, `T-RCT-${Date.now()}`, cashProbe.id, openPeriod])
  await client.query(
    `insert into orva_ar_receipt_allocations (tenant_id, organization_id, receipt_id, invoice_id, amount, created_at, updated_at)
     values ($1,$2,$3,$4,100,now(),now())`, [scope.tenant, scope.org, receipt.id, fakeInvoiceId])
  await expectError('receipt allocation with zero amount rejected (check)', /amount_check/i,
    () => client.query(
      `insert into orva_ar_receipt_allocations (tenant_id, organization_id, receipt_id, invoice_id, amount, created_at, updated_at)
       values ($1,$2,$3,$4,0,now(),now())`, [scope.tenant, scope.org, receipt.id, fakeInvoiceId]))
  await client.query(`update orva_ar_receipts set status='posted', posted_at=now() where id=$1`, [receipt.id])
  await expectError('posted receipt rejects UPDATE', /immutable/i,
    () => client.query(`update orva_ar_receipts set memo='tamper' where id=$1`, [receipt.id]))
  await expectError('posted receipt rejects DELETE', /cannot be deleted/i,
    () => client.query(`delete from orva_ar_receipts where id=$1`, [receipt.id]))
  await expectError('posted receipt allocations frozen', /immutable/i,
    () => client.query(`update orva_ar_receipt_allocations set amount=1 where receipt_id=$1`, [receipt.id]))

  await expectError('ap settings unique per scope', /scope_unique/i, async () => {
    await client.query(`insert into orva_ap_settings (tenant_id, organization_id, ap_account_id, created_at, updated_at) values ($1,$2,$3,now(),now())`, [scope.tenant, scope.org, apAcct])
    await client.query(`insert into orva_ap_settings (tenant_id, organization_id, ap_account_id, created_at, updated_at) values ($1,$2,$3,now(),now())`, [scope.tenant, scope.org, apAcct])
  })
  await client.query('rollback')

  // RLS: another tenant sees nothing
  await client.query('rollback')
  await client.query('begin')
  await client.query(`select set_config('orva.tenant_id', $1, true)`, [randomUUID()])
  const { rows: [{ count: crossCount }] } = await client.query(
    `select count(*)::int as count from orva_gl_journals where journal_no like 'T-JE-%'`)
  check('cross-tenant: journals invisible (RLS)', crossCount === 0, `${crossCount} visible`)
  await client.query('rollback')
} finally {
  await client.end()
}
process.exit(failures === 0 ? 0 : 1)
