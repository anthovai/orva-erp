"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ChevronLeft } from 'lucide-react'

type ArticleSummary = { slug: string; title: string; summary: string; tags: string[]; updatedAt: string }
type ArticleFull = ArticleSummary & { body: string }

/**
 * ศูนย์ช่วยเหลือ — the answers the owner published, for the signed-in
 * customer. Search narrows the list; opening one shows its text. Scope comes
 * from the session, so nothing here can name another customer's article.
 */
export default function PortalHelpPage() {
  const t = useT()
  const [search, setSearch] = React.useState('')
  const [openSlug, setOpenSlug] = React.useState<string | null>(null)

  const list = useQuery({
    queryKey: ['orva_support.portal.articles', search],
    queryFn: () => {
      const qs = new URLSearchParams()
      if (search) qs.set('search', search)
      return readApiResultOrThrow<{ items: ArticleSummary[] }>(`/api/orva_support/portal/articles${qs.size ? `?${qs}` : ''}`)
    },
  })

  const article = useQuery({
    queryKey: ['orva_support.portal.article', openSlug],
    enabled: Boolean(openSlug),
    queryFn: () => readApiResultOrThrow<{ item: ArticleFull }>(`/api/orva_support/portal/articles?slug=${encodeURIComponent(openSlug!)}`),
  })

  if (openSlug) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setOpenSlug(null)} className="-ml-2">
          <ChevronLeft className="mr-1 h-4 w-4" aria-hidden />
          {t('orva_support.portal.back', 'กลับไปรายการ')}
        </Button>
        <PortalCard>
          {article.isLoading ? <p className="text-sm text-muted-foreground">{t('orva_support.portal.loading', 'กำลังโหลด…')}</p> : null}
          {article.error ? <p className="text-sm text-status-error-text">{t('orva_support.portal.loadFailed', 'โหลดไม่สำเร็จ')}</p> : null}
          {article.data ? (
            <article data-testid="portal-article">
              <h1 className="text-xl font-semibold">{article.data.item.title}</h1>
              {article.data.item.tags.length ? (
                <p className="mt-1 text-xs text-muted-foreground">{article.data.item.tags.join(' · ')}</p>
              ) : null}
              {/* Plain text with the writer's own line breaks — no HTML from a stored string. */}
              <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{article.data.item.body}</div>
            </article>
          ) : null}
        </PortalCard>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title={t('orva_support.portal.title', 'ศูนย์ช่วยเหลือ')}
        description={t('orva_support.portal.description', 'คำตอบสำหรับคำถามที่พบบ่อย — ถ้าไม่เจอ ติดต่อเราได้เลย')}
      />
      <Input
        value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder={t('orva_support.portal.search', 'ค้นหา')}
        aria-label={t('orva_support.portal.search', 'ค้นหา')}
      />
      {list.isLoading ? (
        <PortalCard><p className="text-sm text-muted-foreground">{t('orva_support.portal.loading', 'กำลังโหลด…')}</p></PortalCard>
      ) : null}
      {list.error ? (
        <PortalCard>
          <p className="text-sm text-status-error-text">{t('orva_support.portal.loadFailed', 'โหลดไม่สำเร็จ')}</p>
          <Button className="mt-3" variant="outline" onClick={() => list.refetch()}>{t('orva_support.portal.retry', 'ลองอีกครั้ง')}</Button>
        </PortalCard>
      ) : null}
      {list.data && !list.data.items.length ? (
        <PortalCard>
          <PortalEmptyState
            title={t('orva_support.portal.empty', 'ยังไม่มีบทความ')}
            description={t('orva_support.portal.emptyHint', 'ติดต่อทีมงานได้โดยตรง เรายินดีช่วย')}
          />
        </PortalCard>
      ) : null}
      <ul className="space-y-3" data-testid="portal-article-list">
        {(list.data?.items ?? []).map((item) => (
          <li key={item.slug}>
            <button type="button" className="w-full text-left" onClick={() => setOpenSlug(item.slug)}>
              <PortalCard>
                <span className="block font-medium">{item.title}</span>
                {item.summary ? <span className="mt-1 block text-sm text-muted-foreground">{item.summary}</span> : null}
                {item.tags.length ? <span className="mt-2 block text-xs text-muted-foreground">{item.tags.join(' · ')}</span> : null}
              </PortalCard>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
