"use client"
import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@/components/orva/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { BookOpen, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useArticles, type Article } from './queries'

const emptyDraft = { title: '', summary: '', body: '', tags: '', isPublished: false, position: 0 }

/**
 * บทความช่วยเหลือ — the answers the owner writes once instead of typing them
 * into every ticket. Published articles appear in the customer portal under
 * ศูนย์ช่วยเหลือ; drafts stay here. One screen: the list on the left, the
 * article being written on the right.
 */
export default function ArticlesPage() {
  const t = useT()
  const qc = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<'all' | 'yes' | 'no'>('all')
  const [editing, setEditing] = React.useState<Article | null>(null)
  const [draft, setDraft] = React.useState(emptyDraft)
  const [busy, setBusy] = React.useState(false)

  const articles = useArticles(search, filter)
  const refresh = () => qc.invalidateQueries({ queryKey: ['orva_support.articles'] })
  const fail = (e: unknown) => flash(e instanceof Error ? e.message : String(e), 'error')
  const errorOf = (res: { result?: unknown }) => (res.result as { error?: string } | undefined)?.error ?? 'failed'

  const startNew = () => { setEditing(null); setDraft(emptyDraft) }
  const startEdit = (article: Article) => {
    setEditing(article)
    setDraft({
      title: article.title, summary: article.summary ?? '', body: article.body,
      tags: article.tags.join(', '), isPublished: article.isPublished, position: article.position,
    })
  }

  const save = async (publish?: boolean) => {
    if (!draft.title.trim() || !draft.body.trim()) { flash(t('orva_support.articles.needText', 'ใส่หัวข้อและเนื้อหาก่อน'), 'error'); return }
    const payload = {
      title: draft.title.trim(),
      summary: draft.summary.trim() || null,
      body: draft.body,
      tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      isPublished: publish ?? draft.isPublished,
      position: Number(draft.position) || 0,
    }
    setBusy(true)
    try {
      const res = editing
        ? await apiCall<{ ok: true; item: Article }>('/api/orva_support/articles', {
            method: 'PUT', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: editing.id, updatedAt: editing.updatedAt, ...payload }),
          })
        : await apiCall<{ ok: true; item: Article }>('/api/orva_support/articles', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
          })
      if (res.status === 409) { flash(t('orva_support.articles.conflict', 'บทความนี้ถูกแก้จากที่อื่น โหลดใหม่แล้วลองอีกครั้ง'), 'error'); await refresh(); return }
      if (!res.ok || !res.result) throw new Error(errorOf(res))
      flash(payload.isPublished
        ? t('orva_support.articles.published', 'เผยแพร่ให้ลูกค้าเห็นแล้ว')
        : t('orva_support.articles.saved', 'บันทึกแล้ว (ยังไม่เผยแพร่)'), 'success')
      setEditing(res.result.item)
      setDraft((d) => ({ ...d, isPublished: res.result!.item.isPublished }))
      await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const togglePublish = async (article: Article) => {
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_support/articles', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: article.id, updatedAt: article.updatedAt, isPublished: !article.isPublished }),
      })
      if (!res.ok) throw new Error(errorOf(res))
      await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const remove = async (article: Article) => {
    const ok = await confirm({
      title: t('orva_support.articles.deleteTitle', 'ลบบทความนี้?'),
      description: article.title,
      confirmText: t('orva_support.articles.delete', 'ลบ'),
      variant: 'destructive',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await apiCall<{ ok: true }>('/api/orva_support/articles', {
        method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: article.id }),
      })
      if (!res.ok) throw new Error(errorOf(res))
      if (editing?.id === article.id) startNew()
      await refresh()
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  const counts = articles.data?.counts

  return (
    <Page>
      <PageHeader
        title={t('orva_support.articles.page.title', 'บทความช่วยเหลือ')}
        description={t('orva_support.articles.page.description', 'คำตอบที่เขียนครั้งเดียวแล้วส่งลิงก์ให้ลูกค้า — ที่เผยแพร่แล้วจะขึ้นในพอร์ทัลลูกค้า')}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-5">
          <section className="lg:col-span-2" aria-labelledby="article-list-title">
            <div className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 id="article-list-title" className="flex items-center gap-2 text-base font-semibold">
                  <BookOpen className="h-4 w-4" aria-hidden />
                  {t('orva_support.articles.listTitle', 'บทความทั้งหมด')}
                </h2>
                <Button size="sm" onClick={startNew} disabled={busy}>{t('orva_support.articles.new', 'เขียนใหม่')}</Button>
              </div>
              <Input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={t('orva_support.articles.search', 'ค้นหาหัวข้อ เนื้อหา หรือแท็ก')}
                aria-label={t('orva_support.articles.search', 'ค้นหาหัวข้อ เนื้อหา หรือแท็ก')}
              />
              <div className="mt-2 flex gap-1" role="tablist">
                {(['all', 'yes', 'no'] as const).map((value) => (
                  <Button
                    key={value} size="sm" variant={filter === value ? 'default' : 'ghost'}
                    role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}
                  >
                    {value === 'all' ? t('orva_support.articles.filter.all', 'ทั้งหมด')
                      : value === 'yes' ? t('orva_support.articles.filter.published', 'เผยแพร่แล้ว')
                        : t('orva_support.articles.filter.draft', 'ฉบับร่าง')}
                  </Button>
                ))}
              </div>
              {counts ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t('orva_support.articles.counts', 'ทั้งหมด {total} บทความ · เผยแพร่แล้ว {published}')
                    .replace('{total}', String(counts.total)).replace('{published}', String(counts.published))}
                </p>
              ) : null}
              {articles.isLoading ? <p className="mt-3 text-sm text-muted-foreground">{t('orva_support.articles.loading', 'กำลังโหลด…')}</p> : null}
              {articles.isError ? (
                <p className="mt-3 text-sm text-status-error-text">
                  {t('orva_support.articles.loadFailed', 'โหลดไม่สำเร็จ')}{' '}
                  <Button variant="link" onClick={() => articles.refetch()}>{t('orva_support.articles.retry', 'ลองใหม่')}</Button>
                </p>
              ) : null}
              {articles.data && !articles.data.items.length ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('orva_support.articles.empty', 'ยังไม่มีบทความ — เขียนคำตอบที่ต้องพิมพ์ซ้ำบ่อยที่สุดเป็นอันแรก')}
                </p>
              ) : null}
              <ul className="mt-2 divide-y" data-testid="article-list">
                {(articles.data?.items ?? []).map((article) => (
                  <li key={article.id} className="flex items-start justify-between gap-2 py-2">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => startEdit(article)}>
                      <span className="block truncate font-medium">{article.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">/{article.slug}</span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant={article.isPublished ? 'success' : 'outline'}>
                        {article.isPublished ? t('orva_support.articles.state.published', 'เผยแพร่') : t('orva_support.articles.state.draft', 'ร่าง')}
                      </Badge>
                      <Button
                        size="sm" variant="ghost" disabled={busy} onClick={() => togglePublish(article)}
                        aria-label={article.isPublished ? t('orva_support.articles.unpublish', 'เลิกเผยแพร่') : t('orva_support.articles.publish', 'เผยแพร่')}
                      >
                        {article.isPublished ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(article)} aria-label={t('orva_support.articles.delete', 'ลบ')}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="lg:col-span-3" aria-labelledby="article-editor-title">
            <div className="rounded-lg border bg-card p-4">
              <h2 id="article-editor-title" className="mb-3 text-base font-semibold">
                {editing ? t('orva_support.articles.editing', 'แก้บทความ') : t('orva_support.articles.writing', 'บทความใหม่')}
              </h2>
              <label className="mb-1 block text-sm font-medium" htmlFor="article-title">{t('orva_support.articles.title', 'หัวข้อ')}</label>
              <Input id="article-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={200}
                placeholder={t('orva_support.articles.titlePlaceholder', 'เช่น วิธีรีเซ็ตรหัสผ่าน')} />
              <label className="mb-1 mt-3 block text-sm font-medium" htmlFor="article-summary">{t('orva_support.articles.summary', 'สรุปหนึ่งบรรทัด (เว้นว่าง = ใช้บรรทัดแรกของเนื้อหา)')}</label>
              <Input id="article-summary" value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} maxLength={500} />
              <label className="mb-1 mt-3 block text-sm font-medium" htmlFor="article-body">{t('orva_support.articles.body', 'เนื้อหา')}</label>
              <Textarea id="article-body" rows={14} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                placeholder={t('orva_support.articles.bodyPlaceholder', 'เขียนเป็นขั้นตอน ใช้ **ตัวหนา** และ - รายการ ได้')} />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="article-tags">{t('orva_support.articles.tags', 'แท็ก (คั่นด้วยจุลภาค)')}</label>
                  <Input id="article-tags" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="บัญชี, การชำระเงิน" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="article-position">{t('orva_support.articles.position', 'ลำดับการแสดง')}</label>
                  <Input id="article-position" inputMode="numeric" value={String(draft.position)} onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => save(true)} disabled={busy || !draft.title.trim() || !draft.body.trim()} data-testid="article-publish">
                  {t('orva_support.articles.saveAndPublish', 'บันทึกและเผยแพร่')}
                </Button>
                <Button variant="outline" onClick={() => save(false)} disabled={busy || !draft.title.trim() || !draft.body.trim()}>
                  {t('orva_support.articles.saveDraft', 'บันทึกเป็นฉบับร่าง')}
                </Button>
                {editing ? <Button variant="ghost" onClick={startNew} disabled={busy}>{t('orva_support.articles.cancelEdit', 'เขียนใหม่')}</Button> : null}
              </div>
              {editing ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {t('orva_support.articles.portalPath', 'ลูกค้าเปิดได้ที่ ศูนย์ช่วยเหลือ → {slug}').replace('{slug}', editing.slug)}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
