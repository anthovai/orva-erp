"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Expense = {
  journalId: string; journalNo: string | null; paidOn: string; payee: string | null
  documentNo: string | null; memo: string | null; net: string; vat: string; wht: string; paid: string; expenseAccount: string | null
}
type Account = { id: string; code: string; name: string; account_type: string }

const fmt = (v: number | string) => Number(v).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const thisMonth = () => new Date().toISOString().slice(0, 7)

/**
 * ค่าใช้จ่ายจ่ายสด — one screen for every expense paid without a vendor bill:
 * date, payee, amount, whether the receipt is a tax invoice (input VAT),
 * withholding, category account, cash/bank account and the receipt image.
 * Posting happens on save, so ภ.พ.30 and ภ.ง.ด.3/53 see it immediately.
 */
export default function ExpensesPage() {
  const t = useT()
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [month, setMonth] = React.useState(thisMonth())
  const [saving, setSaving] = React.useState(false)
  const [receipt, setReceipt] = React.useState<File | null>(null)
  const [form, setForm] = React.useState({
    paidOn: today(), payee: '', payeeTaxId: '', documentNo: '',
    expenseAccountId: '', cashAccountId: '', amount: '', vatMode: 'none' as 'none' | 'inclusive' | 'exclusive',
    vatAmount: '', whtAmount: '', whtRate: '', memo: '',
  })

  const list = useQuery({
    queryKey: ['orva_finance.expenses', month, scopeVersion],
    queryFn: () => readApiResultOrThrow<{ items: Expense[] }>(`/api/orva_finance/expenses?month=${month}`),
    enabled: /^\d{4}-\d{2}$/.test(month),
  })
  const accounts = useQuery({
    queryKey: ['orva_finance.accounts.all', scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: Account[] }>('/api/orva_finance/gl/accounts?pageSize=100&sortField=code&sortDir=asc')).items,
  })
  const expenseAccounts = (accounts.data ?? []).filter((a) => a.account_type === 'expense')
  const cashAccounts = (accounts.data ?? []).filter((a) => a.account_type === 'asset' && a.code.startsWith('10'))

  const amount = Number(form.amount || 0)
  const vat = form.vatMode === 'inclusive'
    ? Math.round((amount - amount / 1.07) * 100) / 100
    : form.vatMode === 'exclusive' ? Number(form.vatAmount || 0) : 0
  const net = form.vatMode === 'inclusive' ? Math.round((amount - vat) * 100) / 100 : amount
  const wht = Number(form.whtAmount || 0)
  const cashOut = Math.round((net + vat - wht) * 100) / 100

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await apiCall<{ ok: true; journalId: string; journalNo: string }>('/api/orva_finance/expenses', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paidOn: form.paidOn, payee: form.payee, payeeTaxId: form.payeeTaxId || null, documentNo: form.documentNo || null,
          expenseAccountId: form.expenseAccountId, cashAccountId: form.cashAccountId, amount,
          vatMode: form.vatMode, vatAmount: form.vatMode === 'exclusive' ? Number(form.vatAmount || 0) : 0,
          whtAmount: wht, whtRate: form.whtRate ? Number(form.whtRate) : null, memo: form.memo || null,
        }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      // the receipt image rides along after the journal exists — a failed
      // upload must not undo a posted expense
      if (receipt) {
        const fd = new FormData()
        fd.set('entityId', 'orva_finance:gl_journal')
        fd.set('recordId', res.result.journalId)
        fd.set('file', receipt)
        const ok = await fetch('/api/attachments', { method: 'POST', credentials: 'include', body: fd }).then((r) => r.ok).catch(() => false)
        if (!ok) flash(t('orva_finance.expense.receiptFailed', 'บันทึกค่าใช้จ่ายแล้ว แต่แนบรูปใบเสร็จไม่สำเร็จ'), 'error')
      }
      flash(t('orva_finance.expense.saved', 'บันทึกและลงบัญชีแล้ว {journal}').replace('{journal}', res.result.journalNo), 'success')
      setForm({ ...form, payee: '', payeeTaxId: '', documentNo: '', amount: '', vatAmount: '', whtAmount: '', whtRate: '', memo: '' })
      setReceipt(null)
      await qc.invalidateQueries({ queryKey: ['orva_finance.expenses'] })
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_finance.expense.page.title', 'ค่าใช้จ่ายจ่ายสด')}
        description={t('orva_finance.expense.page.description', 'ค่าใช้จ่ายที่จ่ายจากเงินสด/ธนาคารโดยไม่มีบิลผู้ขาย — ใบเสร็จคือเอกสาร ระบบลงบัญชีให้ทันที พร้อมเข้ารายงานภาษีซื้อและภาษีหัก ณ ที่จ่าย')}
        actions={<Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-5">
          <form onSubmit={submit} className="flex flex-col gap-3 rounded-md border p-4 text-sm lg:col-span-2">
            <label className="flex flex-col gap-1">
              <span>{t('orva_finance.expense.paidOn', 'วันที่จ่าย')}</span>
              <Input type="date" value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} required />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('orva_finance.expense.payee', 'จ่ายให้ใคร')}</span>
              <Input value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} required maxLength={200} placeholder={t('orva_finance.expense.payeePlaceholder', 'เช่น บริษัท เอ จำกัด / ร้านกาแฟ')} />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('orva_finance.expense.amount', 'จำนวนเงินตามใบเสร็จ')}</span>
              <Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} required />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('orva_finance.expense.vatMode', 'ภาษีมูลค่าเพิ่มในใบเสร็จ')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={form.vatMode} onChange={(e) => setForm({ ...form, vatMode: e.target.value as typeof form.vatMode })}>
                <option value="none">{t('orva_finance.expense.vat.none', 'ไม่มี / ใบเสร็จธรรมดา')}</option>
                <option value="inclusive">{t('orva_finance.expense.vat.inclusive', 'ใบกำกับภาษี — ราคารวม VAT แล้ว')}</option>
                <option value="exclusive">{t('orva_finance.expense.vat.exclusive', 'ใบกำกับภาษี — แยก VAT')}</option>
              </select>
            </label>
            {form.vatMode === 'exclusive' ? (
              <label className="flex flex-col gap-1">
                <span>{t('orva_finance.expense.vatAmount', 'ภาษีมูลค่าเพิ่ม')}</span>
                <Input type="number" min="0" step="0.01" value={form.vatAmount} onChange={(e) => setForm({ ...form, vatAmount: e.target.value })} />
              </label>
            ) : null}
            {form.vatMode !== 'none' ? (
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span>{t('orva_finance.expense.payeeTaxId', 'เลขผู้เสียภาษีผู้ขาย')}</span>
                  <Input value={form.payeeTaxId} onChange={(e) => setForm({ ...form, payeeTaxId: e.target.value })} maxLength={20} />
                </label>
                <label className="flex flex-col gap-1">
                  <span>{t('orva_finance.expense.documentNo', 'เลขที่ใบกำกับภาษี')}</span>
                  <Input value={form.documentNo} onChange={(e) => setForm({ ...form, documentNo: e.target.value })} maxLength={60} />
                </label>
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span>{t('orva_finance.expense.wht', 'หักภาษี ณ ที่จ่าย')}</span>
                <Input type="number" min="0" step="0.01" value={form.whtAmount} onChange={(e) => setForm({ ...form, whtAmount: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span>{t('orva_finance.expense.whtRate', 'อัตรา %')}</span>
                <Input type="number" min="0" max="100" step="0.5" value={form.whtRate} onChange={(e) => setForm({ ...form, whtRate: e.target.value })} placeholder="3" />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span>{t('orva_finance.expense.category', 'หมวดค่าใช้จ่าย')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={form.expenseAccountId} onChange={(e) => setForm({ ...form, expenseAccountId: e.target.value })} required>
                <option value="">—</option>
                {expenseAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('orva_finance.expense.paidFrom', 'จ่ายจากบัญชี')}</span>
              <select className="rounded-md border bg-background px-3 py-2" value={form.cashAccountId} onChange={(e) => setForm({ ...form, cashAccountId: e.target.value })} required>
                <option value="">—</option>
                {cashAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('orva_finance.expense.memo', 'บันทึกช่วยจำ')}</span>
              <Input value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} maxLength={500} />
            </label>
            <label className="flex flex-col gap-1">
              <span>{t('orva_finance.expense.receipt', 'รูปใบเสร็จ (แนบไว้กับรายการ)')}</span>
              <input type="file" accept="image/*,application/pdf" className="text-xs" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
            </label>
            {amount > 0 ? (
              <div className="rounded border bg-muted/30 px-3 py-2 text-xs">
                {t('orva_finance.expense.summary', 'ค่าใช้จ่าย {net} · ภาษีซื้อ {vat} · หัก ณ ที่จ่าย {wht} · เงินออกจากบัญชี {cash}')
                  .replace('{net}', fmt(net)).replace('{vat}', fmt(vat)).replace('{wht}', fmt(wht)).replace('{cash}', fmt(cashOut))}
              </div>
            ) : null}
            <Button type="submit" disabled={saving}>{t('orva_finance.expense.submit', 'บันทึกและลงบัญชี')}</Button>
          </form>

          <section className="lg:col-span-3">
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-3 py-2">{t('orva_finance.expense.col.date', 'วันที่')}</th>
                    <th className="px-3 py-2">{t('orva_finance.expense.col.payee', 'จ่ายให้')}</th>
                    <th className="px-3 py-2">{t('orva_finance.expense.col.category', 'หมวด')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.expense.col.net', 'ค่าใช้จ่าย')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.expense.col.vat', 'ภาษีซื้อ')}</th>
                    <th className="px-3 py-2 text-right">{t('orva_finance.expense.col.paid', 'เงินออก')}</th>
                    <th className="px-3 py-2">{t('orva_finance.expense.col.journal', 'สมุดรายวัน')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.isLoading ? <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">…</td></tr> : null}
                  {list.data?.items.length === 0 ? <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">{t('orva_finance.expense.empty', 'ยังไม่มีค่าใช้จ่ายในเดือนนี้')}</td></tr> : null}
                  {(list.data?.items ?? []).map((e) => (
                    <tr key={e.journalId} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{e.paidOn}</td>
                      <td className="px-3 py-2">{e.payee ?? '—'}{e.documentNo ? <div className="text-xs text-muted-foreground">{e.documentNo}</div> : null}</td>
                      <td className="px-3 py-2 text-xs">{e.expenseAccount ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(e.net)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(e.vat) > 0 ? fmt(e.vat) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(e.paid)}</td>
                      <td className="px-3 py-2"><Link href="/backend/gl/journals" className="text-primary hover:underline">{e.journalNo}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('orva_finance.expense.hint', 'ใบกำกับภาษีจากผู้ขายจะเข้ารายงานภาษีซื้อ (ภ.พ.30) และถ้าหักภาษี ณ ที่จ่ายจะเข้าทะเบียน ภ.ง.ด.3/53 ให้เอง')}
            </p>
          </section>
        </div>
      </PageBody>
    </Page>
  )
}
