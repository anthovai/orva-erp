"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@/components/orva/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

import { useLabels, type Label } from './queries'

/**
 * A small fixed palette rather than a colour wheel.
 *
 * Labels are read at a glance in a list, so what matters is that two of them
 * are easy to tell apart — which a free-form picker makes harder, not easier,
 * because nothing stops two labels being neighbouring greys.
 */
const PALETTE = ['#64748b', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6']

/**
 * ป้ายกำกับ — labels, where Vikunja keeps them.
 *
 * Until now a label could only be invented from inside a task, which meant
 * there was no way to rename one, recolour it, see how much it is used, or
 * clear out the ones nobody picked.
 */
export default function LabelsPage() {
  const t = useT()
  const qc = useQueryClient()
  const [title, setTitle] = React.useState('')
  const [colour, setColour] = React.useState(PALETTE[0])
  const [editing, setEditing] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const labels = useLabels()

  const send = async (method: 'POST' | 'PUT' | 'DELETE', body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_tasking/labels', {
        method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok || !res.result) {
        throw new Error((res.result as { error?: string } | undefined)?.error ?? t('orva_tasking.saveFailed', 'บันทึกไม่สำเร็จ'))
      }
      await qc.invalidateQueries({ queryKey: ['orva_tasking.labels'] })
      return true
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), 'error')
      return false
    } finally { setBusy(false) }
  }

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return
    if (await send('POST', { title, hexColor: colour })) setTitle('')
  }

  const remove = async (label: Label) => {
    const question = label.usageCount > 0
      ? t('orva_tasking.labels.confirmDeleteUsed', 'ลบป้าย "{title}" ไหม ป้ายจะหลุดออกจากงาน {n} รายการ')
          .replace('{title}', label.title).replace('{n}', String(label.usageCount))
      : t('orva_tasking.labels.confirmDelete', 'ลบป้าย "{title}" ไหม').replace('{title}', label.title)
    if (!window.confirm(question)) return
    await send('DELETE', { id: label.id })
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_tasking.labels.title', 'ป้ายกำกับ')}
        description={t('orva_tasking.labels.description', 'ป้ายที่ใช้ร่วมกันทุกโปรเจกต์ — เปลี่ยนชื่อ เปลี่ยนสี หรือลบป้ายที่ไม่มีใครใช้')}
      />
      <PageBody>
        <form onSubmit={create} className="mb-4 flex flex-wrap items-end gap-2 rounded-md border p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span>{t('orva_tasking.labels.newTitle', 'ชื่อป้าย')}</span>
            <Input className="w-56" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend>{t('orva_tasking.labels.colour', 'สี')}</legend>
            <span className="flex gap-1">
              {PALETTE.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-label={option}
                  aria-pressed={colour === option}
                  onClick={() => setColour(option)}
                  className={`size-7 rounded-full border-2 ${colour === option ? 'border-foreground' : 'border-transparent'}`}
                  style={{ backgroundColor: option }}
                />
              ))}
            </span>
          </fieldset>
          <Button type="submit" disabled={busy || !title.trim()}>{t('orva_tasking.create', 'สร้าง')}</Button>
        </form>

        {labels.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}

        {labels.data?.length === 0 ? (
          <div className="rounded-md border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('orva_tasking.labels.empty', 'ยังไม่มีป้ายกำกับ — สร้างป้ายแรกด้านบน')}
            </p>
          </div>
        ) : null}

        <ul className="overflow-hidden rounded-md border">
          {(labels.data ?? []).map((label) => (
            <li key={label.id} className="flex flex-wrap items-center gap-3 border-b px-3 py-2 last:border-b-0">
              <span
                aria-hidden="true"
                className="inline-block size-3 shrink-0 rounded-full"
                style={{ backgroundColor: label.hexColor }}
              />
              {editing === label.id ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault()
                    if (!draft.trim()) return
                    if (await send('PUT', { id: label.id, title: draft, updatedAt: label.updatedAt })) {
                      setEditing(null)
                    }
                  }}
                >
                  <Input className="w-56" value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} autoFocus />
                  <Button type="submit" size="sm" disabled={busy}>{t('orva_tasking.save', 'บันทึก')}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)} disabled={busy}>
                    {t('orva_tasking.cancel', 'ยกเลิก')}
                  </Button>
                </form>
              ) : (
                <>
                  <span className="text-sm font-medium">{label.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {label.usageCount > 0
                      ? t('orva_tasking.labels.used', 'ใช้ใน {n} งาน').replace('{n}', String(label.usageCount))
                      : t('orva_tasking.labels.unused', 'ยังไม่มีใครใช้')}
                  </span>
                  <span className="ml-auto flex gap-1">
                    {/* Recolouring reuses the same palette as creation, so a
                        label cannot end up a colour the picker cannot make. */}
                    {PALETTE.map((option) => (
                      <button
                        key={option}
                        type="button"
                        aria-label={option}
                        disabled={busy || option === label.hexColor}
                        onClick={() => send('PUT', { id: label.id, hexColor: option, updatedAt: label.updatedAt })}
                        className={`size-5 rounded-full border ${option === label.hexColor ? 'border-foreground' : 'border-transparent hover:border-muted-foreground'}`}
                        style={{ backgroundColor: option }}
                      />
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => { setEditing(label.id); setDraft(label.title) }}
                    >
                      {t('orva_tasking.labels.rename', 'เปลี่ยนชื่อ')}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => remove(label)}>
                      {t('orva_tasking.delete', 'ลบ')}
                    </Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      </PageBody>
    </Page>
  )
}
