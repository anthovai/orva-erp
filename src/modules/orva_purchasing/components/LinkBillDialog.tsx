"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { selectClass } from './pickers'

export type LinkableLine = {
  id: string
  lineNo: number
  description: string
  accountId: string
  net: number
  billedAmount: number
}

type UnlinkedBill = {
  id: string
  billNo: string | null
  billDate: string
  status: string
  totalAmount: number
  vendorBillRef: string | null
  unlinkedLines: number
  lines: Array<{
    lineNo: number
    amount: number
    description: string | null
    accountId: string
    accountCode: string | null
    linked: boolean
  }>
}

export type BillAllocation = { lineId: string; billLineNo: number; amount: number }

const money = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Linking a bill the ledger already holds.
 *
 * This is the recovery half of the two-step design: finance created the bill,
 * the link call did not land, and the order is under-reporting what it has
 * been charged. It lists only this vendor's bills with an unallocated line,
 * which keeps a wrong pairing hard to make.
 *
 * Each bill line is paired by choosing an ordered line. The default pairing
 * matches on GL account, because a bill line and the line that ordered it
 * almost always post to the same account — the operator confirms rather than
 * assembles.
 */
export function LinkBillDialog({
  orderId,
  open,
  onOpenChange,
  lines,
  onSubmit,
}: {
  orderId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  lines: LinkableLine[]
  onSubmit: (billId: string, allocations: BillAllocation[]) => Promise<void>
}) {
  const t = useT()
  const [billId, setBillId] = React.useState('')
  const [pairing, setPairing] = React.useState<Record<number, string>>({})
  const [busy, setBusy] = React.useState(false)

  const query = useQuery({
    queryKey: ['orva_purchasing.unlinkedBills', orderId],
    queryFn: () =>
      readApiResultOrThrow<{ bills: UnlinkedBill[] }>(`/api/orva_purchasing/orders/${orderId}/unlinked-bills`),
    enabled: open,
  })

  const bills = query.data?.bills ?? []
  const bill = bills.find((candidate) => candidate.id === billId) ?? null

  // Default each unallocated bill line to the ordered line sharing its account.
  React.useEffect(() => {
    if (!bill) {
      setPairing({})
      return
    }
    const next: Record<number, string> = {}
    for (const line of bill.lines) {
      if (line.linked) continue
      const match = lines.find((candidate) => candidate.accountId === line.accountId)
      next[line.lineNo] = match?.id ?? ''
    }
    setPairing(next)
  }, [bill, lines])

  React.useEffect(() => {
    if (open) return
    setBillId('')
    setPairing({})
  }, [open])

  const allocations: BillAllocation[] = bill
    ? bill.lines
        .filter((line) => !line.linked && pairing[line.lineNo])
        .map((line) => ({ lineId: pairing[line.lineNo], billLineNo: line.lineNo, amount: line.amount }))
    : []

  const submit = async () => {
    if (!bill || allocations.length === 0) return
    setBusy(true)
    try {
      await onSubmit(bill.id, allocations)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('orva_purchasing.linkBill.title', 'ผูกบิลที่มีอยู่')}</DialogTitle>
        </DialogHeader>
        <div
          className="flex flex-col gap-4"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        >
          <p className="text-sm text-muted-foreground">
            {t(
              'orva_purchasing.linkBill.hint',
              'ใช้เมื่อบิลถูกบันทึกในบัญชีแล้วแต่ยังไม่ผูกกับใบสั่งซื้อนี้ — เลือกบิล แล้วจับคู่บรรทัดบิลกับรายการที่สั่ง',
            )}
          </p>

          {query.isLoading ? <LoadingMessage label={t('orva_purchasing.loading', 'กำลังโหลด…')} /> : null}
          {query.isError ? (
            <ErrorMessage
              label={t('orva_purchasing.linkBill.error', 'โหลดรายการบิลไม่ได้')}
              description={query.error instanceof Error ? query.error.message : undefined}
            />
          ) : null}

          {!query.isLoading && !query.isError && bills.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              {t('orva_purchasing.linkBill.empty', 'ไม่มีบิลของผู้ขายรายนี้ที่ยังไม่ได้ผูก')}
            </p>
          ) : null}

          {bills.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_purchasing.linkBill.pickBill', 'เลือกบิล')}</span>
              <select className={selectClass} value={billId} onChange={(event) => setBillId(event.target.value)}>
                <option value="">{t('orva_purchasing.linkBill.pickBillPlaceholder', '— เลือกบิล —')}</option>
                {bills.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.billNo ?? candidate.id.slice(0, 8)} · {candidate.billDate} ·{' '}
                    {money(candidate.totalAmount)} ·{' '}
                    {t('orva_purchasing.linkBill.unlinkedLines', 'ยังไม่ผูก {n} บรรทัด').replace(
                      '{n}',
                      String(candidate.unlinkedLines),
                    )}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {bill ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-max text-sm">
                <caption className="sr-only">{t('orva_purchasing.linkBill.title', 'ผูกบิลที่มีอยู่')}</caption>
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">{t('orva_purchasing.linkBill.billLine', 'บรรทัดบิล')}</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">{t('orva_purchasing.lines.net', 'มูลค่า')}</th>
                    <th scope="col" className="px-3 py-2 font-medium">{t('orva_purchasing.linkBill.orderLine', 'ตรงกับรายการที่สั่ง')}</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.lines.map((line) => (
                    <tr key={line.lineNo} className="border-t">
                      <td className="px-3 py-2">
                        <span className="font-medium">
                          {line.lineNo}. {line.description ?? '—'}
                        </span>
                        {line.accountCode ? (
                          <span className="ml-2 text-xs text-muted-foreground">{line.accountCode}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(line.amount)}</td>
                      <td className="px-3 py-2">
                        {line.linked ? (
                          <span className="text-xs text-muted-foreground">
                            {t('orva_purchasing.linkBill.alreadyLinked', 'ผูกไว้แล้ว')}
                          </span>
                        ) : (
                          <select
                            className={selectClass}
                            value={pairing[line.lineNo] ?? ''}
                            onChange={(event) =>
                              setPairing((prev) => ({ ...prev, [line.lineNo]: event.target.value }))
                            }
                            aria-label={t('orva_purchasing.linkBill.orderLine', 'ตรงกับรายการที่สั่ง')}
                          >
                            <option value="">{t('orva_purchasing.linkBill.skip', '— ไม่ผูกบรรทัดนี้ —')}</option>
                            {lines.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.lineNo}. {candidate.description} ({money(candidate.net)})
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t('orva_purchasing.cancel', 'ยกเลิก')}
            </Button>
            <Button onClick={submit} disabled={busy || allocations.length === 0}>
              {busy
                ? t('orva_purchasing.saving', 'กำลังบันทึก…')
                : t('orva_purchasing.linkBill.confirm', 'ผูกบิล')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default LinkBillDialog
