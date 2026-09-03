/**
 * Pure math for drafting a Kaiser-style service quotation: line totals, 7%
 * VAT, the 3% withholding the customer will deduct, and an installment
 * schedule (e.g. 30/40/30). The agent uses this to show the owner a complete
 * proposal before anyone opens the create screen — nothing here writes.
 */
export type DraftLine = { description: string; quantity: number; unitPrice: number }

export type DraftInstallment = { label: string; percent: number; net: number; vat: number; gross: number; expectedTransfer: number; wht: number }

export type QuoteDraft = {
  lines: Array<DraftLine & { amount: number }>
  net: number
  vatRate: number
  vat: number
  gross: number
  whtRate: number
  /** what the customer will actually transfer if they withhold on the whole job */
  expectedTransfer: number
  wht: number
  installments: DraftInstallment[]
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildQuoteDraft(
  lines: DraftLine[],
  opts: { vatRate?: number; whtRate?: number; installments?: Array<{ label: string; percent: number }>; pricesIncludeVat?: boolean } = {},
): QuoteDraft {
  const vatRate = opts.vatRate ?? 0.07
  const whtRate = opts.whtRate ?? 0.03
  if (!lines.length) throw new Error('quote draft needs at least one line')
  const priced = lines.map((line) => {
    const raw = round2(line.quantity * line.unitPrice)
    const amount = opts.pricesIncludeVat ? round2(raw / (1 + vatRate)) : raw
    return { ...line, amount }
  })
  const net = round2(priced.reduce((s, l) => s + l.amount, 0))
  const vat = round2(net * vatRate)
  const gross = round2(net + vat)
  const wht = round2(net * whtRate)

  const plan = opts.installments?.length ? opts.installments : [{ label: 'งวดเดียว', percent: 100 }]
  const totalPercent = plan.reduce((s, p) => s + p.percent, 0)
  if (Math.abs(totalPercent - 100) > 0.001) throw new Error(`installments must total 100%, got ${totalPercent}%`)

  // Allocate by percent, pushing rounding residue into the last installment so
  // the schedule always sums exactly to the quote.
  let netLeft = net
  const installments: DraftInstallment[] = plan.map((p, index) => {
    const isLast = index === plan.length - 1
    const instNet = isLast ? round2(netLeft) : round2(net * (p.percent / 100))
    netLeft = round2(netLeft - instNet)
    const instVat = round2(instNet * vatRate)
    const instWht = round2(instNet * whtRate)
    return {
      label: p.label,
      percent: p.percent,
      net: instNet,
      vat: instVat,
      gross: round2(instNet + instVat),
      wht: instWht,
      expectedTransfer: round2(instNet + instVat - instWht),
    }
  })

  return { lines: priced, net, vatRate, vat, gross, whtRate, wht, expectedTransfer: round2(gross - wht), installments }
}

/** A polite Thai reminder for an unpaid invoice, ready to paste or send. */
export function paymentReminderText(input: {
  customer: string | null
  invoiceNumber: string
  amount: number
  dueDate: string | null
  daysOverdue: number
  companyName: string
  bankLine?: string | null
}): string {
  const money = input.amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const who = input.customer ? `เรียน ${input.customer}` : 'เรียน ลูกค้าที่เคารพ'
  const when = input.daysOverdue > 0
    ? `ซึ่งครบกำหนดชำระเมื่อ ${input.dueDate ?? '-'} (เกินกำหนด ${input.daysOverdue} วัน)`
    : input.dueDate ? `ซึ่งจะครบกำหนดชำระในวันที่ ${input.dueDate}` : ''
  return [
    who,
    '',
    `${input.companyName} ขอเรียนแจ้งยอดค้างชำระตามใบแจ้งหนี้เลขที่ ${input.invoiceNumber} จำนวน ${money} บาท ${when}`.trim(),
    '',
    input.bankLine ? `กรุณาโอนชำระมาที่ ${input.bankLine}` : 'กรุณาโอนชำระตามรายละเอียดบัญชีในใบแจ้งหนี้',
    'หากท่านหักภาษี ณ ที่จ่าย 3% รบกวนส่งหนังสือรับรอง (50 ทวิ) มาพร้อมหลักฐานการโอนด้วยครับ',
    'หากชำระแล้ว ขออภัยในความไม่สะดวก และรบกวนส่งสลิปให้เราเพื่อออกใบเสร็จรับเงิน/ใบกำกับภาษี',
    '',
    'ขอแสดงความนับถือ',
    input.companyName,
  ].join('\n')
}
