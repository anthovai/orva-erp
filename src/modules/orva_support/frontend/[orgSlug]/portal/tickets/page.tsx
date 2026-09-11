"use client"
import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChevronLeft, Paperclip } from 'lucide-react'

type TicketRow = {
  id: string; ticketNo: string; subject: string; kind: string; status: string
  createdAt: string; updatedAt: string; lastReplyAt: string | null; replyCount: number
}
type Message = { id: string; author: 'staff' | 'customer'; body: string; createdAt: string }
type Conversation = {
  linked: boolean
  ticket: { id: string; ticketNo: string; subject: string; kind: string; status: string; createdAt: string }
  messages: Message[]
  attachments: Array<{ id: string; fileName: string }>
}

const KINDS = ['bug', 'question', 'change_request', 'incident'] as const
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ')

/**
 * เรื่องที่แจ้งไว้ — the customer's own side of the support desk.
 *
 * They can see what they reported, read what the desk answered, write back,
 * attach the screenshot that explains a bug faster than a paragraph does, and
 * open a new ticket without composing an email. Internal notes never appear
 * here; the server filters them out, not this screen.
 */
export default function PortalTicketsPage() {
  const t = useT()
  const qc = useQueryClient()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [composing, setComposing] = React.useState(false)
  const [draft, setDraft] = React.useState({ subject: '', description: '', kind: 'question' })
  const [reply, setReply] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement | null>(null)

  const list = useQuery({
    queryKey: ['orva_support.portal.tickets'],
    queryFn: () => readApiResultOrThrow<{ linked: boolean; tickets: TicketRow[] }>('/api/orva_support/portal/tickets'),
  })
  const conversation = useQuery({
    queryKey: ['orva_support.portal.conversation', openId],
    enabled: Boolean(openId),
    queryFn: () => readApiResultOrThrow<Conversation>(`/api/orva_support/portal/tickets?ticketId=${encodeURIComponent(openId!)}`),
  })

  const label = (group: string, value: string) => t(`orva_support.${group}.${value}`, value)

  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) throw new Error(json.error ?? t('orva_support.portal.tickets.failed', 'ส่งไม่สำเร็จ ลองใหม่อีกครั้ง'))
    return json
  }

  // The file rides along after the ticket or reply is saved: it needs a ticket id.
  const attach = async (ticketId: string, picked: File) => {
    const form = new FormData()
    form.set('ticketId', ticketId)
    form.set('file', picked)
    const res = await fetch('/api/orva_support/portal/attachments', { method: 'POST', credentials: 'include', body: form })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(json.error ?? t('orva_support.portal.tickets.attachFailed', 'แนบไฟล์ไม่สำเร็จ'))
    }
  }

  const clearFile = () => { setFile(null); if (fileRef.current) fileRef.current.value = '' }

  const open = useMutation({
    mutationFn: async () => {
      const created = (await post('/api/orva_support/portal/tickets', draft)) as { id: string; ticketNo: string }
      if (file) await attach(created.id, file)
      return created
    },
    onSuccess: async (created) => {
      setError(null)
      setComposing(false)
      setDraft({ subject: '', description: '', kind: 'question' })
      clearFile()
      await qc.invalidateQueries({ queryKey: ['orva_support.portal.tickets'] })
      setOpenId(created.id)
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  })

  const answer = useMutation({
    mutationFn: async () => {
      if (!openId) return
      if (reply.trim()) await post('/api/orva_support/portal/replies', { ticketId: openId, body: reply })
      if (file) await attach(openId, file)
    },
    onSuccess: async () => {
      setError(null)
      setReply('')
      clearFile()
      await qc.invalidateQueries({ queryKey: ['orva_support.portal.conversation'] })
      await qc.invalidateQueries({ queryKey: ['orva_support.portal.tickets'] })
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  })

  const filePicker = (busy: boolean) => (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={fileRef} type="file" className="hidden"
        accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Paperclip className="mr-1 h-4 w-4" aria-hidden />
        {t('orva_support.portal.tickets.attach', 'แนบไฟล์')}
      </Button>
      {file ? (
        <span className="text-xs text-muted-foreground">
          {file.name}
          <button type="button" className="ml-2 underline" onClick={clearFile}>{t('orva_support.portal.tickets.removeFile', 'เอาออก')}</button>
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{t('orva_support.portal.tickets.attachHint', 'รูปภาพ PDF หรือไฟล์ข้อความ ไม่เกิน 8 MB')}</span>
      )}
    </div>
  )

  if (openId) {
    const data = conversation.data
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => { setOpenId(null); setError(null); clearFile() }} className="-ml-2">
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
          {t('orva_support.portal.tickets.back', 'กลับไปรายการ')}
        </Button>
        {conversation.isLoading ? <PortalCard><p className="text-sm text-muted-foreground">{t('orva_support.portal.loading', 'กำลังโหลด…')}</p></PortalCard> : null}
        {conversation.error ? <PortalCard><p className="text-sm text-status-error-text">{t('orva_support.portal.loadFailed', 'โหลดไม่สำเร็จ')}</p></PortalCard> : null}
        {data?.ticket ? (
          <PortalCard>
            <div data-testid="portal-ticket">
              <h1 className="text-lg font-semibold">{data.ticket.ticketNo} · {data.ticket.subject}</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                {label('kind', data.ticket.kind)} · {label('status', data.ticket.status)} · {when(data.ticket.createdAt)}
              </p>
            </div>
            <ul className="mt-4 space-y-3" data-testid="portal-ticket-messages">
              {data.messages.map((message) => (
                <li key={message.id} className={`rounded-md border p-3 text-sm ${message.author === 'staff' ? 'bg-muted/40' : ''}`}>
                  <p className="text-xs text-muted-foreground">
                    {message.author === 'staff'
                      ? t('orva_support.portal.tickets.fromUs', 'ทีมงาน')
                      : t('orva_support.portal.tickets.fromYou', 'คุณ')} · {when(message.createdAt)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">{message.body}</p>
                </li>
              ))}
            </ul>
            {data.attachments.length ? (
              <div className="mt-4">
                <p className="text-xs font-medium text-muted-foreground">{t('orva_support.portal.tickets.files', 'ไฟล์แนบ')}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {data.attachments.map((item) => (
                    <li key={item.id}>
                      <a className="underline" href={`/api/orva_support/portal/attachments?id=${encodeURIComponent(item.id)}`} target="_blank" rel="noreferrer">{item.fileName}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-5 space-y-2 border-t pt-4">
              <label className="flex flex-col gap-1 text-sm">
                <span>{t('orva_support.portal.tickets.replyLabel', 'ตอบกลับ')}</span>
                <textarea
                  className="rounded-md border bg-background px-3 py-2" rows={4} value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder={t('orva_support.portal.tickets.replyPlaceholder', 'เล่าเพิ่มเติม หรือแจ้งว่าแก้ได้แล้ว')}
                />
              </label>
              {filePicker(answer.isPending)}
              {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
              <Button disabled={answer.isPending || (!reply.trim() && !file)} onClick={() => answer.mutate()}>
                {t('orva_support.portal.tickets.send', 'ส่ง')}
              </Button>
            </div>
          </PortalCard>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title={t('orva_support.portal.tickets.title', 'เรื่องที่แจ้งไว้')}
        description={t('orva_support.portal.tickets.description', 'แจ้งปัญหาหรือขอให้แก้ไข แล้วติดตามได้ที่นี่ — ไม่ต้องส่งอีเมลถามความคืบหน้า')}
      />

      {list.data && !list.data.linked ? (
        <PortalCard>
          <PortalEmptyState
            title={t('orva_support.portal.tickets.notLinked', 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลลูกค้า')}
            description={t('orva_support.portal.tickets.notLinkedHint', 'ติดต่อทีมงานเพื่อผูกบัญชี แล้วเรื่องที่แจ้งไว้จะมาแสดงที่นี่')}
          />
        </PortalCard>
      ) : (
        <>
          <div>
            <Button onClick={() => { setComposing((v) => !v); setError(null) }}>
              {composing ? t('orva_support.portal.tickets.cancel', 'ยกเลิก') : t('orva_support.portal.tickets.new', 'แจ้งเรื่องใหม่')}
            </Button>
          </div>

          {composing ? (
            <PortalCard>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); open.mutate() }}>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_support.portal.tickets.subject', 'เรื่อง')}</span>
                  <Input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required maxLength={200} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_support.portal.tickets.kind', 'ประเภท')}</span>
                  <select className="rounded-md border bg-background px-3 py-2" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                    {KINDS.map((k) => <option key={k} value={k}>{label('kind', k)}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t('orva_support.portal.tickets.detail', 'รายละเอียด')}</span>
                  <textarea
                    className="rounded-md border bg-background px-3 py-2" rows={5} required
                    value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    placeholder={t('orva_support.portal.tickets.detailPlaceholder', 'เกิดอะไรขึ้น กำลังทำอะไรอยู่ตอนนั้น และเห็นข้อความว่าอย่างไร')}
                  />
                </label>
                {filePicker(open.isPending)}
                {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
                <Button type="submit" disabled={open.isPending || !draft.subject.trim() || !draft.description.trim()}>
                  {t('orva_support.portal.tickets.submit', 'แจ้งเรื่อง')}
                </Button>
              </form>
            </PortalCard>
          ) : null}

          {list.isLoading ? <PortalCard><p className="text-sm text-muted-foreground">{t('orva_support.portal.loading', 'กำลังโหลด…')}</p></PortalCard> : null}
          {list.error ? (
            <PortalCard>
              <p className="text-sm text-status-error-text">{t('orva_support.portal.loadFailed', 'โหลดไม่สำเร็จ')}</p>
              <Button className="mt-3" variant="outline" onClick={() => list.refetch()}>{t('orva_support.portal.retry', 'ลองอีกครั้ง')}</Button>
            </PortalCard>
          ) : null}
          {list.data?.linked && !list.data.tickets.length ? (
            <PortalCard>
              <PortalEmptyState
                title={t('orva_support.portal.tickets.empty', 'ยังไม่มีเรื่องที่แจ้งไว้')}
                description={t('orva_support.portal.tickets.emptyHint', 'เจอปัญหาหรืออยากให้ปรับอะไร แจ้งได้เลย')}
              />
            </PortalCard>
          ) : null}

          <ul className="space-y-3" data-testid="portal-ticket-list">
            {(list.data?.tickets ?? []).map((row) => (
              <li key={row.id}>
                <button type="button" className="w-full text-left" onClick={() => { setOpenId(row.id); setError(null) }}>
                  <PortalCard>
                    <span className="block font-medium">{row.ticketNo} · {row.subject}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {label('status', row.status)} · {label('kind', row.kind)} · {when(row.createdAt)}
                      {row.replyCount ? ` · ${t('orva_support.portal.tickets.replies', '{n} ข้อความ').replace('{n}', String(row.replyCount))}` : ''}
                    </span>
                  </PortalCard>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
