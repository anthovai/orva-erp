import type { EntityManager } from '@mikro-orm/postgresql'
import { buildCashFlow } from './cashflow'
import { money, toCsv } from './csv'
import { monthBounds } from './homeOverview'
import {
  accountSums, bankLinesInMonth, bookkeepingStatus, journalLines, organizationName, taxDocumentsInMonth,
  vatReport, whtReport, type BookkeepingStatus, type Scope, type TaxDocumentRow,
} from './reportQueries'
import { accountBalance, buildBalanceSheet, buildProfitAndLoss } from './statements'
import { buildZip, type ZipEntry } from './zip'

/**
 * ชุดปิดเดือน — everything the outsourced accounting firm needs for one month,
 * as one zip: the VAT and WHT registers behind ภ.พ.30 and ภ.ง.ด.3/53, the
 * general journal and ledger, trial balances, the three statements, the bank
 * reconciliation state, and (when the caller renders them) the PDFs of every
 * tax document issued. CSVs open in Excel with Thai intact (BOM), files are
 * numbered in reading order, and a cover sheet says what is inside and what
 * is still loose in the books.
 *
 * This module is pure over the report queries: the caller supplies rendered
 * PDFs, because rendering needs the requester's session and a Chromium.
 */
export type PackFigures = {
  vatOutput: number
  vatInput: number
  vatNet: number
  whtPayable: number
  whtReceivable: number
  income: number
  expense: number
  netProfit: number
  cashClosing: number
  journalCount: number
  taxDocumentCount: number
  bankUnmatched: number
}

export type PackPlan = {
  month: string
  from: string
  to: string
  companyName: string | null
  figures: PackFigures
  checklist: BookkeepingStatus
  taxDocuments: TaxDocumentRow[]
  entries: ZipEntry[]
}

export type RenderedPdf = { name: string; data: Uint8Array }

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']

export function thaiMonthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${THAI_MONTHS[m - 1]} ${y + 543}`
}

export function packFileName(month: string): string {
  return `ชุดปิดเดือน-${month}.zip`
}

const fmt = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Assembles every CSV of the pack and the figures the cover sheet quotes. */
export async function planMonthPack(tem: EntityManager, scope: Scope, month: string): Promise<PackPlan> {
  const { from, to } = monthBounds(month)
  const yearStart = `${month.slice(0, 4)}-01-01`
  const [vat, wht, lines, monthSums, ytdSums, cumulativeSums, openingSums, bank, checklist, taxDocuments, companyName] = await Promise.all([
    vatReport(tem, scope, month),
    whtReport(tem, scope, month),
    journalLines(tem, scope, from, to),
    accountSums(tem, scope, { from, to, excludeClosing: true }),
    accountSums(tem, scope, { from: yearStart, to, excludeClosing: true }),
    accountSums(tem, scope, { to }),
    accountSums(tem, scope, { toExclusive: from }),
    bankLinesInMonth(tem, scope, from, to),
    bookkeepingStatus(tem, scope, month, from, to),
    taxDocumentsInMonth(tem, scope, month),
    organizationName(tem, scope),
  ])

  const pl = buildProfitAndLoss(monthSums)
  const plYtd = buildProfitAndLoss(ytdSums)
  const bs = buildBalanceSheet(cumulativeSums)
  const active = (rows: typeof cumulativeSums) => rows.filter((r) => Number(r.debit) || Number(r.credit))
  const cashFlow = buildCashFlow(active(openingSums), active(cumulativeSums))

  const entries: ZipEntry[] = []

  entries.push({
    name: '01-ภ.พ.30-รายงานภาษีขาย.csv',
    data: toCsv(
      ['วันที่', 'เลขที่ใบกำกับภาษี', 'ชื่อผู้ซื้อ', 'เลขประจำตัวผู้เสียภาษี', 'สาขา', 'มูลค่าสินค้า/บริการ', 'ภาษีมูลค่าเพิ่ม', 'รวม'],
      vat.sales.map((r) => [r.date, r.document_no, r.customer_name, r.customer_tax_id, r.customer_branch, money(r.base), money(r.vat), money(r.total)]),
    ),
  })
  entries.push({
    name: '02-ภ.พ.30-รายงานภาษีซื้อ.csv',
    data: toCsv(
      ['วันที่', 'เลขที่บิล', 'เลขที่ใบกำกับของผู้ขาย', 'ชื่อผู้ขาย', 'เลขประจำตัวผู้เสียภาษี', 'มูลค่าสินค้า/บริการ', 'ภาษีมูลค่าเพิ่ม', 'รวม'],
      vat.purchases.map((r) => [r.date, r.document_no, r.vendor_ref, r.vendor_name, r.vendor_tax_id, money(r.base), money(r.vat), money(r.total)]),
    ),
  })
  entries.push({
    name: '03-ภ.พ.30-สรุป.csv',
    data: toCsv(
      ['รายการ', 'จำนวนเงิน'],
      [
        ['ยอดขายที่ต้องเสียภาษี', money(vat.summary.outputBase)],
        ['ภาษีขาย', money(vat.summary.outputVat)],
        ['ยอดซื้อที่มีสิทธิ์นำมาหัก', money(vat.summary.inputBase)],
        ['ภาษีซื้อ', money(vat.summary.inputVat)],
        [Number(vat.summary.netPayable) >= 0 ? 'ภาษีที่ต้องชำระ' : 'ภาษีชำระเกิน (ยกไป)', Math.abs(money(vat.summary.netPayable))],
      ],
    ),
  })
  entries.push({
    name: '04-ภ.ง.ด.3-53-ภาษีหัก ณ ที่จ่ายที่บริษัทหักไว้.csv',
    data: toCsv(
      ['วันที่จ่าย', 'เลขที่จ่ายเงิน', 'เลขที่ 50 ทวิ', 'ผู้รับเงิน', 'เลขประจำตัวผู้เสียภาษี', 'ประเภทเงินได้', 'อัตรา %', 'เงินที่จ่าย', 'ภาษีที่หัก'],
      wht.withheldByUs.map((r) => [r.date, r.payment_no, r.cert_no, r.vendor_name, r.vendor_tax_id, r.income_type, r.rate, money(r.base), money(r.wht)]),
    ),
  })
  entries.push({
    name: '05-ภาษีถูกหัก ณ ที่จ่าย-ลูกค้าหักบริษัท.csv',
    data: toCsv(
      ['วันที่รับเงิน', 'เลขที่ใบเสร็จ', 'เลขที่ใบแจ้งหนี้', 'ลูกค้า', 'อัตรา %', 'ยอดตามใบแจ้งหนี้', 'ภาษีที่ถูกหัก'],
      wht.withheldFromUs.map((r) => [r.date, r.receipt_no, r.invoice_no, r.customer_name, r.rate, money(r.base), money(r.wht)]),
    ),
  })
  entries.push({
    name: '06-สมุดรายวันทั่วไป.csv',
    data: toCsv(
      ['เลขที่', 'วันที่', 'ประเภท', 'คำอธิบายรายการ', 'บรรทัด', 'รหัสบัญชี', 'ชื่อบัญชี', 'รายละเอียด', 'เดบิต', 'เครดิต'],
      lines.map((l) => [l.journal_no, l.journal_date, l.journal_kind, l.memo, l.line_no, l.account_code, l.account_name, l.description, money(l.debit), money(l.credit)]),
    ),
  })

  const tbRows = (sums: typeof monthSums) => sums
    .filter((r) => Number(r.debit) || Number(r.credit))
    .map((r) => {
      const balance = accountBalance(r.accountType, r.debit, r.credit)
      return [r.code, r.name, r.accountType, money(r.debit), money(r.credit), money(balance)]
    })
  entries.push({ name: '07-งบทดลอง-เฉพาะเดือน.csv', data: toCsv(['รหัส', 'ชื่อบัญชี', 'ประเภท', 'เดบิต', 'เครดิต', 'คงเหลือ'], tbRows(monthSums)) })
  entries.push({ name: '08-งบทดลอง-สะสมถึงสิ้นเดือน.csv', data: toCsv(['รหัส', 'ชื่อบัญชี', 'ประเภท', 'เดบิต', 'เครดิต', 'คงเหลือ'], tbRows(cumulativeSums)) })

  entries.push({
    name: '09-งบกำไรขาดทุน.csv',
    data: toCsv(
      ['หมวด', 'รหัส', 'ชื่อบัญชี', 'เดือนนี้', 'สะสมตั้งแต่ต้นปี'],
      [
        ...pl.income.map((r) => ['รายได้', r.code, r.name, money(r.balance), money(plYtd.income.find((y) => y.code === r.code)?.balance ?? 0)]),
        ['รายได้', '', 'รวมรายได้', money(pl.totalIncome), money(plYtd.totalIncome)],
        ...pl.expense.map((r) => ['ค่าใช้จ่าย', r.code, r.name, money(r.balance), money(plYtd.expense.find((y) => y.code === r.code)?.balance ?? 0)]),
        ['ค่าใช้จ่าย', '', 'รวมค่าใช้จ่าย', money(pl.totalExpense), money(plYtd.totalExpense)],
        ['', '', 'กำไร (ขาดทุน) สุทธิ', money(pl.netProfit), money(plYtd.netProfit)],
      ],
    ),
  })
  entries.push({
    name: '10-งบแสดงฐานะการเงิน.csv',
    data: toCsv(
      ['หมวด', 'รหัส', 'ชื่อบัญชี', `ณ ${to}`],
      [
        ...bs.asset.map((r) => ['สินทรัพย์', r.code, r.name, money(r.balance)]),
        ['สินทรัพย์', '', 'รวมสินทรัพย์', money(bs.totalAssets)],
        ...bs.liability.map((r) => ['หนี้สิน', r.code, r.name, money(r.balance)]),
        ['หนี้สิน', '', 'รวมหนี้สิน', money(bs.totalLiabilities)],
        ...bs.equity.map((r) => ['ส่วนของผู้ถือหุ้น', r.code, r.name, money(r.balance)]),
        ['ส่วนของผู้ถือหุ้น', '', 'กำไร (ขาดทุน) สะสมงวดปัจจุบัน', money(bs.currentEarnings)],
        ['ส่วนของผู้ถือหุ้น', '', 'รวมส่วนของผู้ถือหุ้น', money(bs.totalEquity)],
        ['', '', 'รวมหนี้สินและส่วนของผู้ถือหุ้น', money(bs.totalLiabilitiesAndEquity)],
      ],
    ),
  })
  entries.push({
    name: '11-งบกระแสเงินสด.csv',
    data: toCsv(
      ['กิจกรรม', 'รหัส', 'รายการ', 'จำนวนเงิน'],
      [
        ['ดำเนินงาน', '', 'กำไร (ขาดทุน) สุทธิ', money(cashFlow.netProfit)],
        ...cashFlow.operating.map((r) => ['ดำเนินงาน', r.code, r.name, money(r.amount)]),
        ['ดำเนินงาน', '', 'เงินสดสุทธิจากกิจกรรมดำเนินงาน', money(cashFlow.totalOperating)],
        ...cashFlow.investing.map((r) => ['ลงทุน', r.code, r.name, money(r.amount)]),
        ['ลงทุน', '', 'เงินสดสุทธิจากกิจกรรมลงทุน', money(cashFlow.totalInvesting)],
        ...cashFlow.financing.map((r) => ['จัดหาเงิน', r.code, r.name, money(r.amount)]),
        ['จัดหาเงิน', '', 'เงินสดสุทธิจากกิจกรรมจัดหาเงิน', money(cashFlow.totalFinancing)],
        ['', '', 'เงินสดเพิ่มขึ้น (ลดลง) สุทธิ', money(cashFlow.netChange)],
        ['', '', 'เงินสดต้นงวด', money(cashFlow.openingCash)],
        ['', '', 'เงินสดปลายงวด', money(cashFlow.closingCash)],
      ],
    ),
  })

  // Ledger: the same posted lines grouped by account with opening + running balance.
  const opening = new Map(openingSums.map((r) => [r.code, accountBalance(r.accountType, r.debit, r.credit)]))
  const types = new Map(openingSums.map((r) => [r.code, r.accountType]))
  const ledgerRows: Array<Array<string | number | null>> = []
  const byAccount = [...lines].sort((a, b) => a.account_code.localeCompare(b.account_code) || a.journal_date.localeCompare(b.journal_date) || (a.journal_no ?? '').localeCompare(b.journal_no ?? ''))
  let current: string | null = null
  let running = 0
  for (const l of byAccount) {
    if (l.account_code !== current) {
      current = l.account_code
      running = opening.get(l.account_code) ?? 0
      ledgerRows.push([l.account_code, l.account_name, from, '', '', 'ยอดยกมา', null, null, money(running)])
    }
    const sign = ['liability', 'equity', 'income'].includes(types.get(l.account_code) ?? '') ? -1 : 1
    running += sign * (Number(l.debit) - Number(l.credit))
    ledgerRows.push([l.account_code, l.account_name, l.journal_date, l.journal_no, l.memo, l.description, money(l.debit), money(l.credit), money(running)])
  }
  entries.push({
    name: '12-บัญชีแยกประเภท.csv',
    data: toCsv(['รหัส', 'ชื่อบัญชี', 'วันที่', 'เลขที่สมุดรายวัน', 'คำอธิบาย', 'รายละเอียด', 'เดบิต', 'เครดิต', 'คงเหลือ'], ledgerRows),
  })

  entries.push({
    name: '13-กระทบยอดธนาคาร.csv',
    data: toCsv(
      ['บัญชีธนาคาร', 'วันที่', 'รายการตาม statement', 'อ้างอิง', 'จำนวนเงิน', 'สถานะ', 'จับคู่กับสมุดรายวัน'],
      bank.map((b) => [`${b.account_code} ${b.account_name}`, b.txn_date, b.description, b.reference, money(b.amount), b.status === 'matched' ? 'จับคู่แล้ว' : b.status === 'excluded' ? 'ไม่นับ' : 'ยังไม่จับคู่', b.journal_no]),
    ),
  })

  const cashClosing = Number(cashFlow.closingCash)
  const figures: PackFigures = {
    vatOutput: money(vat.summary.outputVat),
    vatInput: money(vat.summary.inputVat),
    vatNet: money(vat.summary.netPayable),
    whtPayable: money(wht.summary.payable),
    whtReceivable: money(wht.summary.receivable),
    income: money(pl.totalIncome),
    expense: money(pl.totalExpense),
    netProfit: money(pl.netProfit),
    cashClosing: money(cashClosing),
    journalCount: new Set(lines.map((l) => l.journal_no)).size,
    taxDocumentCount: taxDocuments.length,
    bankUnmatched: checklist.unmatchedBankLines,
  }

  return { month, from, to, companyName, figures, checklist, taxDocuments, entries }
}

/** The cover sheet: what is inside, headline figures, and what is still loose. */
export function coverSheet(plan: PackPlan, pdfs: RenderedPdf[], pdfNote: string | null): string {
  const f = plan.figures
  const warnings: string[] = []
  if (plan.checklist.draftJournals > 0) warnings.push(`- สมุดรายวันฉบับร่างที่ยังไม่ผ่านรายการ ${plan.checklist.draftJournals} ฉบับ (ไม่รวมอยู่ในตัวเลขชุดนี้)`)
  if (plan.checklist.unpostedInvoices > 0) warnings.push(`- ใบแจ้งหนี้ที่ออกแล้วแต่ยังไม่ลงบัญชี ${plan.checklist.unpostedInvoices} ใบ`)
  if (plan.checklist.unmatchedBankLines > 0) warnings.push(`- รายการธนาคารที่ยังไม่กระทบยอด ${plan.checklist.unmatchedBankLines} รายการ`)
  if (plan.checklist.periodStatus !== 'closed') warnings.push(`- งวดบัญชี ${plan.month} ยัง${plan.checklist.periodStatus === 'missing' ? 'ไม่ได้สร้าง' : 'ไม่ปิด'} — ตัวเลขอาจเปลี่ยนได้ถ้ามีการบันทึกเพิ่ม`)
  if (pdfNote) warnings.push(`- ${pdfNote}`)

  return [
    `ชุดปิดเดือน ${thaiMonthName(plan.month)} (${plan.from} ถึง ${plan.to})`,
    plan.companyName ? `บริษัท: ${plan.companyName}` : null,
    `จัดทำโดย Orva เมื่อ ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`,
    '',
    'สรุปตัวเลข',
    `  ภาษีขาย ${fmt(f.vatOutput)}  ภาษีซื้อ ${fmt(f.vatInput)}  ${f.vatNet >= 0 ? 'ภ.พ.30 ต้องชำระ' : 'ภ.พ.30 ชำระเกิน'} ${fmt(Math.abs(f.vatNet))}`,
    `  ภาษีหัก ณ ที่จ่ายที่บริษัทหักไว้ (ภ.ง.ด.3/53 ต้องนำส่ง) ${fmt(f.whtPayable)}`,
    `  ภาษีที่ลูกค้าหักบริษัท (เครดิตภาษี) ${fmt(f.whtReceivable)}`,
    `  รายได้ ${fmt(f.income)}  ค่าใช้จ่าย ${fmt(f.expense)}  กำไร (ขาดทุน) สุทธิ ${fmt(f.netProfit)}`,
    `  เงินสดและเงินฝากปลายเดือน ${fmt(f.cashClosing)}`,
    `  สมุดรายวันที่ผ่านรายการ ${f.journalCount} ฉบับ  เอกสารภาษีที่ออก ${f.taxDocumentCount} ชุด`,
    '',
    warnings.length ? 'สิ่งที่ยังค้าง' : 'ไม่มีรายการค้าง — งวดนี้พร้อมปิด',
    ...warnings,
    '',
    'ไฟล์ในชุดนี้',
    ...plan.entries.map((e) => `  ${e.name}`),
    ...(pdfs.length ? ['  เอกสารภาษี/', ...pdfs.map((p) => `    ${p.name}`)] : []),
    '',
    'หมายเหตุ: ไฟล์ .csv เป็น UTF-8 (มี BOM) เปิดใน Excel ได้โดยตรง ตัวเลขเป็นบาท ทศนิยม 2 ตำแหน่ง',
  ].filter((line) => line != null).join('\r\n')
}

export function assembleZip(plan: PackPlan, pdfs: RenderedPdf[], pdfNote: string | null): Uint8Array {
  const now = new Date()
  return buildZip([
    { name: '00-สรุปเดือน.txt', data: '﻿' + coverSheet(plan, pdfs, pdfNote), modified: now },
    ...plan.entries.map((e) => ({ ...e, modified: now })),
    ...pdfs.map((p) => ({ name: `เอกสารภาษี/${p.name}`, data: p.data, modified: now })),
  ])
}
