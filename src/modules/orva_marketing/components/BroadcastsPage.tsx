"use client"
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Badge, type BadgeVariant } from '@open-mercato/ui/primitives/badge'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Megaphone, Users, MailX, Send, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import {
  AUDIENCE_KEY, BROADCASTS_KEY, RECIPIENTS_KEY,
  useAudience, useBroadcasts, useRecipients,
  type Broadcast, type Contact,
} from './queries'

type Tab = 'send' | 'audience'

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

/**
 * ส่งข่าวถึงลูกค้า — one screen, two questions: who will get the next email
 * (and why the rest will not), and what went out before. The composer sends
 * to everyone who consented; consent itself is edited on the ผู้รับ tab or on
 * the customer's own page (it is the same field).
 */
export default function BroadcastsPage() {
  const t = useT()
  const qc = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [tab, setTab] = React.useState<Tab>('send')
  const [search, setSearch] = React.useState('')
  const [subject, setSubject] = React.useState('')
  const [body, setBody] = React.useState('')
  const [draft, setDraft] = React.useState<Broadcast | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [open, setOpen] = React.useState<string | null>(null)

  const audience = useAudience(tab === 'audience' ? search : '')
  const broadcasts = useBroadcasts()
  const counts = audience.data?.counts

  const refreshAll = () => Promise.all([
    qc.invalidateQueries({ queryKey: [BROADCASTS_KEY] }),
    qc.invalidateQueries({ queryKey: [AUDIENCE_KEY] }),
    qc.invalidateQueries({ queryKey: [RECIPIENTS_KEY] }),
  ])

  const fail = (e: unknown) => flash(e instanceof Error ? e.message : String(e), 'error')
  const resultError = (res: { ok: boolean; result?: unknown }) => (res.result as { error?: string } | undefined)?.error ?? 'failed'

  /** Save as a draft (new or edited); returns the saved row. */
  const saveDraft = async (): Promise<Broadcast | null> => {
    if (!subject.trim() || !body.trim()) { flash(t('orva_marketing.compose.needText', 'ใส่หัวเรื่องและเนื้อหาก่อน'), 'error'); return null }
    const res = draft
      ? await apiCall<{ ok: true; item: Broadcast }>('/api/orva_marketing/broadcasts', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: draft.id, updatedAt: draft.updatedAt, subject, body }),
        })
      : await apiCall<{ ok: true; item: Broadcast }>('/api/orva_marketing/broadcasts', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subject, body }),
        })
    if (res.status === 409) { flash(t('orva_marketing.compose.conflict', 'ฉบับร่างนี้ถูกแก้จากที่อื่น โหลดใหม่แล้วลองอีกครั้ง'), 'error'); await refreshAll(); return null }
    if (!res.ok || !res.result) throw new Error(resultError(res))
    setDraft(res.result.item)
    return res.result.item
  }

  const onSaveDraft = async () => {
    setBusy(true)
    try {
      if (await saveDraft()) { flash(t('orva_marketing.compose.saved', 'บันทึกฉบับร่างแล้ว'), 'success'); await refreshAll() }
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const onSend = async () => {
    const reachable = counts?.reachable ?? 0
    if (!reachable) { flash(t('orva_marketing.compose.nobody', 'ยังไม่มีลูกค้าที่ยินยอมและมีอีเมล — ไปแท็บ "ผู้รับ" เพื่อบันทึกความยินยอมก่อน'), 'error'); return }
    const ok = await confirm({
      title: t('orva_marketing.compose.confirmTitle', 'ส่งอีเมลข่าวสาร?'),
      description: t('orva_marketing.compose.confirmBody', 'จะส่งอีเมล "{subject}" ถึงลูกค้า {n} คน แต่ละคนได้ลิงก์ยกเลิกรับข่าวของตัวเองท้ายอีเมล — ส่งแล้วเรียกคืนไม่ได้')
        .replace('{subject}', subject).replace('{n}', String(reachable)),
      confirmText: t('orva_marketing.compose.confirmSend', 'ส่งเลย'),
    })
    if (!ok) return
    setBusy(true)
    try {
      const saved = await saveDraft()
      if (!saved) return
      const res = await apiCall<{ ok: true; item: Broadcast; summary: { audience: number; sent: number; failed: number } }>('/api/orva_marketing/broadcasts/send', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: saved.id, updatedAt: saved.updatedAt }),
      })
      if (!res.ok || !res.result) throw new Error(resultError(res))
      const { sent, failed } = res.result.summary
      flash(
        failed
          ? t('orva_marketing.compose.sentPartial', 'ส่งแล้ว {sent} คน ส่งไม่สำเร็จ {failed} คน — ดูรายชื่อในประวัติ').replace('{sent}', String(sent)).replace('{failed}', String(failed))
          : t('orva_marketing.compose.sent', 'ส่งถึงลูกค้า {sent} คนแล้ว').replace('{sent}', String(sent)),
        failed ? 'error' : 'success',
      )
      setSubject(''); setBody(''); setDraft(null)
      setOpen(res.result.item.id)
      await refreshAll()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const editDraft = (row: Broadcast) => { setDraft(row); setSubject(row.subject); setBody(row.body); setTab('send'); window.scrollTo({ top: 0 }) }

  const deleteDraft = async (row: Broadcast) => {
    const ok = await confirm({
      title: t('orva_marketing.history.deleteTitle', 'ลบฉบับร่าง?'),
      description: row.subject,
      confirmText: t('orva_marketing.history.delete', 'ลบ'),
      variant: 'destructive',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_marketing/broadcasts', {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: row.id }),
      })
      if (!res.ok) throw new Error(resultError(res))
      if (draft?.id === row.id) { setDraft(null); setSubject(''); setBody('') }
      await refreshAll()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const setConsent = async (contact: Contact, consent: boolean) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_marketing/consent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customerEntityId: contact.id, consent, source: 'staff' }),
      })
      if (!res.ok) throw new Error(resultError(res))
      flash(consent
        ? t('orva_marketing.audience.granted', 'บันทึกว่า {name} ยินยอมรับข่าวสาร').replace('{name}', contact.displayName)
        : t('orva_marketing.audience.withdrawn', 'บันทึกว่า {name} ไม่รับข่าวสาร').replace('{name}', contact.displayName), 'success')
      await qc.invalidateQueries({ queryKey: [AUDIENCE_KEY] })
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const statusBadge = (status: string) => {
    const variant: BadgeVariant = status === 'sent' ? 'success' : status === 'partial' ? 'warning' : status === 'failed' ? 'destructive' : status === 'sending' ? 'info' : 'outline'
    return <Badge variant={variant}>{t(`orva_marketing.status.${status}`, status)}</Badge>
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_marketing.page.title', 'ส่งข่าวถึงลูกค้า')}
        description={t('orva_marketing.page.description', 'อีเมลข่าวสาร/โปรโมชันถึงลูกค้าที่ยินยอมไว้เท่านั้น — แต่ละคนได้ลิงก์ยกเลิกรับข่าวของตัวเอง')}
      />
      <PageBody>
        {/* Three numbers that answer "who gets it" before anything is typed. */}
        <div className="grid gap-3 sm:grid-cols-3" data-testid="marketing-kpis">
          <Kpi icon={<Send className="h-4 w-4" aria-hidden />} label={t('orva_marketing.kpi.reachable', 'จะได้รับอีเมล')} value={counts?.reachable} hint={t('orva_marketing.kpi.reachableHint', 'ยินยอม + มีอีเมล')} tone="text-status-success-text" />
          <Kpi icon={<Users className="h-4 w-4" aria-hidden />} label={t('orva_marketing.kpi.notConsented', 'ยังไม่ยินยอม')} value={counts?.notConsented} hint={t('orva_marketing.kpi.notConsentedHint', 'จะไม่ได้รับ — ขอความยินยอมก่อน')} />
          <Kpi icon={<MailX className="h-4 w-4" aria-hidden />} label={t('orva_marketing.kpi.noEmail', 'ยินยอมแต่ไม่มีอีเมล')} value={counts?.noEmail} hint={t('orva_marketing.kpi.noEmailHint', 'เติมอีเมลในหน้าลูกค้า')} tone="text-status-warning-text" />
        </div>

        <div className="mt-6 flex gap-2 border-b" role="tablist">
          <TabButton active={tab === 'send'} onClick={() => setTab('send')}>{t('orva_marketing.tab.send', 'ส่งข่าว')}</TabButton>
          <TabButton active={tab === 'audience'} onClick={() => setTab('audience')}>{t('orva_marketing.tab.audience', 'ผู้รับและความยินยอม')}</TabButton>
        </div>

        {tab === 'send' ? (
          <div className="mt-4 grid gap-6 lg:grid-cols-5">
            <section className="rounded-lg border bg-card p-4 lg:col-span-3" aria-labelledby="compose-title">
              <h2 id="compose-title" className="mb-3 flex items-center gap-2 text-base font-semibold">
                <Megaphone className="h-4 w-4" aria-hidden />
                {draft ? t('orva_marketing.compose.editing', 'แก้ฉบับร่าง') : t('orva_marketing.compose.title', 'เขียนข่าวใหม่')}
              </h2>
              <label className="mb-1 block text-sm font-medium" htmlFor="broadcast-subject">{t('orva_marketing.compose.subject', 'หัวเรื่องอีเมล')}</label>
              <Input id="broadcast-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200}
                placeholder={t('orva_marketing.compose.subjectPlaceholder', 'เช่น Marventine ออกสินค้าใหม่ — ลด 15% ถึงสิ้นเดือน')} />
              <label className="mb-1 mt-3 block text-sm font-medium" htmlFor="broadcast-body">{t('orva_marketing.compose.body', 'เนื้อหา')}</label>
              <Textarea id="broadcast-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10}
                placeholder={t('orva_marketing.compose.bodyPlaceholder', 'เขียนเหมือนส่งอีเมลถึงลูกค้าคนหนึ่ง ใช้ **ตัวหนา** และ - รายการ ได้')} />
              <p className="mt-2 text-xs text-muted-foreground">
                {t('orva_marketing.compose.footerNote', 'ท้ายอีเมลทุกฉบับจะมีบรรทัด "หากไม่ต้องการรับข่าวสารจากเรา กดที่นี่" พร้อมลิงก์ของผู้รับแต่ละคนโดยอัตโนมัติ')}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button onClick={onSend} disabled={busy || !subject.trim() || !body.trim()} data-testid="broadcast-send">
                  <Send className="mr-2 h-4 w-4" aria-hidden />
                  {t('orva_marketing.compose.send', 'ส่งถึง {n} คน').replace('{n}', String(counts?.reachable ?? 0))}
                </Button>
                <Button variant="outline" onClick={onSaveDraft} disabled={busy || !subject.trim() || !body.trim()}>
                  {t('orva_marketing.compose.saveDraft', 'บันทึกฉบับร่าง')}
                </Button>
                {draft ? (
                  <Button variant="ghost" onClick={() => { setDraft(null); setSubject(''); setBody('') }} disabled={busy}>
                    {t('orva_marketing.compose.cancelEdit', 'เริ่มใหม่')}
                  </Button>
                ) : null}
              </div>
            </section>

            <section className="rounded-lg border bg-card p-4 lg:col-span-2" aria-labelledby="history-title">
              <h2 id="history-title" className="mb-3 text-base font-semibold">{t('orva_marketing.history.title', 'ประวัติการส่ง')}</h2>
              {broadcasts.isLoading ? <p className="text-sm text-muted-foreground">{t('orva_marketing.loading', 'กำลังโหลด…')}</p> : null}
              {broadcasts.isError ? <p className="text-sm text-status-error-text">{t('orva_marketing.loadFailed', 'โหลดไม่สำเร็จ')} <Button variant="link" onClick={() => broadcasts.refetch()}>{t('orva_marketing.retry', 'ลองใหม่')}</Button></p> : null}
              {broadcasts.data && !broadcasts.data.items.length ? (
                <p className="text-sm text-muted-foreground">{t('orva_marketing.history.empty', 'ยังไม่เคยส่งข่าว — ฉบับแรกจะขึ้นที่นี่')}</p>
              ) : null}
              <ul className="divide-y" data-testid="broadcast-history">
                {(broadcasts.data?.items ?? []).map((row) => (
                  <li key={row.id} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{row.subject}</div>
                        <div className="text-xs text-muted-foreground">
                          {row.status === 'draft' ? fmtDate(row.updatedAt) : fmtDate(row.sentAt)}
                          {row.status !== 'draft' ? ` · ${t('orva_marketing.history.counts', 'ส่ง {sent}/{n}').replace('{sent}', String(row.sentCount)).replace('{n}', String(row.audienceCount))}` : ''}
                          {row.failedCount ? ` · ${t('orva_marketing.history.failed', 'ไม่สำเร็จ {n}').replace('{n}', String(row.failedCount))}` : ''}
                        </div>
                      </div>
                      {statusBadge(row.status)}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {row.status === 'draft' ? (
                        <>
                          <Button size="sm" variant="outline" onClick={() => editDraft(row)} disabled={busy}>{t('orva_marketing.history.edit', 'แก้/ส่ง')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteDraft(row)} disabled={busy} aria-label={t('orva_marketing.history.delete', 'ลบ')}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setOpen(open === row.id ? null : row.id)} aria-expanded={open === row.id}>
                          {open === row.id ? <ChevronUp className="mr-1 h-4 w-4" aria-hidden /> : <ChevronDown className="mr-1 h-4 w-4" aria-hidden />}
                          {t('orva_marketing.history.recipients', 'รายชื่อผู้รับ')}
                        </Button>
                      )}
                    </div>
                    {open === row.id ? <RecipientList broadcastId={row.id} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        ) : (
          <section className="mt-4 rounded-lg border bg-card p-4" aria-labelledby="audience-title">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 id="audience-title" className="text-base font-semibold">{t('orva_marketing.audience.title', 'ลูกค้าทั้งหมดและความยินยอม')}</h2>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('orva_marketing.audience.search', 'ค้นหาชื่อหรืออีเมล')} className="w-64" aria-label={t('orva_marketing.audience.search', 'ค้นหาชื่อหรืออีเมล')} />
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              {t('orva_marketing.audience.note', 'สวิตช์นี้คือฟิลด์ "ยินยอมรับข่าวสาร" บนหน้าลูกค้า — เปิดเมื่อลูกค้าบอกว่ายินยอม (PDPA) ปิดเมื่อขอให้หยุด ลูกค้าที่กดลิงก์ยกเลิกเองจะปิดให้อัตโนมัติ')}
            </p>
            {audience.isLoading ? <p className="text-sm text-muted-foreground">{t('orva_marketing.loading', 'กำลังโหลด…')}</p> : null}
            {audience.isError ? <p className="text-sm text-status-error-text">{t('orva_marketing.loadFailed', 'โหลดไม่สำเร็จ')} <Button variant="link" onClick={() => audience.refetch()}>{t('orva_marketing.retry', 'ลองใหม่')}</Button></p> : null}
            {audience.data && !audience.data.contacts.length ? (
              <p className="text-sm text-muted-foreground">{t('orva_marketing.audience.empty', 'ไม่พบลูกค้า — เพิ่มลูกค้าในเมนู งานขาย → ลูกค้า ก่อน')}</p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="audience-table">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t('orva_marketing.audience.col.name', 'ลูกค้า')}</th>
                    <th className="py-2 pr-3 font-medium">{t('orva_marketing.audience.col.email', 'อีเมล')}</th>
                    <th className="py-2 pr-3 font-medium">{t('orva_marketing.audience.col.since', 'บันทึกเมื่อ / ที่มา')}</th>
                    <th className="py-2 font-medium">{t('orva_marketing.audience.col.consent', 'ยินยอม')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(audience.data?.contacts ?? []).map((c) => (
                    <tr key={c.id}>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{c.displayName || '—'}</div>
                        <div className="text-xs text-muted-foreground">{c.kind === 'company' ? t('orva_marketing.audience.company', 'บริษัท') : t('orva_marketing.audience.person', 'บุคคล')}</div>
                      </td>
                      <td className="py-2 pr-3">{c.email ?? <span className="text-status-warning-text">{t('orva_marketing.audience.noEmail', 'ไม่มีอีเมล')}</span>}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{c.consentAt ?? '—'}{c.consentSource ? ` · ${t(`orva_marketing.source.${c.consentSource}`, c.consentSource)}` : ''}</td>
                      <td className="py-2">
                        <SwitchField
                          id={`consent-${c.id}`}
                          checked={c.consent}
                          disabled={busy}
                          onCheckedChange={(next) => setConsent(c, Boolean(next))}
                          label={c.consent ? t('orva_marketing.audience.yes', 'ยินยอม') : t('orva_marketing.audience.no', 'ไม่')}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}

function Kpi({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: number | undefined; hint: string; tone?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">{icon}{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value ?? '—'}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" role="tab" aria-selected={active} onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
    >
      {children}
    </button>
  )
}

function RecipientList({ broadcastId }: { broadcastId: string }) {
  const t = useT()
  const recipients = useRecipients(broadcastId)
  if (recipients.isLoading) return <p className="mt-2 text-xs text-muted-foreground">{t('orva_marketing.loading', 'กำลังโหลด…')}</p>
  if (recipients.isError) return <p className="mt-2 text-xs text-status-error-text">{t('orva_marketing.loadFailed', 'โหลดไม่สำเร็จ')}</p>
  return (
    <ul className="mt-2 space-y-1 text-xs" data-testid="recipient-list">
      {(recipients.data?.items ?? []).map((r) => (
        <li key={r.id} className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate">{r.displayName} <span className="text-muted-foreground">&lt;{r.email}&gt;</span></span>
          <span className={r.status === 'sent' ? 'text-status-success-text' : r.status === 'failed' ? 'text-status-error-text' : 'text-muted-foreground'} title={r.error ?? undefined}>
            {t(`orva_marketing.recipient.${r.status}`, r.status)}
          </span>
        </li>
      ))}
    </ul>
  )
}
