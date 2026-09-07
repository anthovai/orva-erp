"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { TaskProjectSummary } from './taskTypes'

type QuoteProject = {
  quoteId: string
  billedPct: number
  paidPct: number
  currencyCode: string
  quoteTotal: number
}

/**
 * โครงการ — every project on one screen.
 *
 * This is Vikunja's ภาพรวม and โปรเจกต์ merged rather than built twice: with a
 * project count in single figures, a summary screen and a navigation screen
 * would have shown the same rows for two different reasons.
 *
 * It carries the pairing the tasking module exists for — งาน% beside
 * เรียกเก็บ% — from the project's own side. The Sales screen of the same name
 * answers it from the quotation's side, and both read the same two numbers.
 */
export default function ProjectListPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()

  const projects = useQuery({
    queryKey: ['orva_tasking.projects', scopeVersion],
    queryFn: async () =>
      (await readApiResultOrThrow<{ items: TaskProjectSummary[] }>('/api/orva_tasking/projects')).items,
  })

  // Billing lives in the documents module, keyed by the same quotation id.
  const billing = useQuery({
    queryKey: ['orva_documents.projects.billing', scopeVersion],
    queryFn: async () =>
      (await readApiResultOrThrow<{ items: QuoteProject[] }>('/api/orva_documents/projects')).items,
  })

  const billedByQuote = React.useMemo(
    () => new Map((billing.data ?? []).map((row) => [row.quoteId, row])),
    [billing.data],
  )

  const rows = React.useMemo(() => (
    (projects.data ?? [])
      .filter((project) => !project.isArchived)
      .sort((a, b) => b.overdue - a.overdue || (b.total - b.done) - (a.total - a.done) || a.name.localeCompare(b.name, 'th'))
  ), [projects.data])

  return (
    <Page>
      <PageHeader
        title={t('orva_tasking.projectList.title', 'โครงการ')}
        description={t('orva_tasking.projectList.description', 'ทุกโปรเจกต์ที่กำลังทำ พร้อมความคืบหน้าของงานเทียบกับที่เรียกเก็บไปแล้ว')}
        actions={
          <Button asChild>
            <Link href="/backend/tasking">{t('orva_tasking.projectList.openTasks', 'ไปที่งาน')}</Link>
          </Button>
        }
      />
      <PageBody>
        {projects.isLoading ? <p className="text-sm text-muted-foreground">…</p> : null}

        {projects.data && rows.length === 0 ? (
          <div className="rounded-md border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t('orva_tasking.noProjects', 'ยังไม่มีโปรเจกต์ — สร้างโปรเจกต์แรกเพื่อเริ่มบันทึกงาน')}
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((project) => {
            const billed = project.quoteId ? billedByQuote.get(project.quoteId) : undefined
            // Drift is only meaningful once there is work written down and a
            // quotation to compare it against.
            const gap = billed && project.total > 0
              ? Math.round((project.donePct - billed.billedPct) * 10) / 10
              : null
            return (
              <section key={project.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/backend/tasking?project=${project.id}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {project.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    {project.overdue > 0 ? (
                      <span className="rounded-full bg-status-error-bg px-2 py-0.5 text-xs text-status-error-text">
                        {t('orva_tasking.overdueShort', 'เลยกำหนด {n}').replace('{n}', String(project.overdue))}
                      </span>
                    ) : null}
                    {project.customerVisible ? (
                      <span className="rounded-full bg-status-success-bg px-2 py-0.5 text-xs text-status-success-text">
                        {t('orva_tasking.publishedBadge', 'ลูกค้าดูได้')}
                      </span>
                    ) : null}
                  </span>
                </div>

                <p className="mt-1 text-xs text-muted-foreground">
                  {project.quoteNumber ?? t('orva_tasking.internalBadge', 'งานภายใน')}
                </p>

                <dl className="mt-3 space-y-2">
                  <div>
                    <dt className="flex items-baseline justify-between text-xs text-muted-foreground">
                      <span>{t('orva_tasking.projectList.work', 'งานที่ทำแล้ว')}</span>
                      <span className="tabular-nums">
                        {project.total > 0
                          ? `${project.donePct}% (${project.done}/${project.total})`
                          : t('orva_documents.projects.noTasks', 'ยังไม่ได้ลงงาน')}
                      </span>
                    </dt>
                    <dd className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${project.donePct}%` }} />
                    </dd>
                  </div>

                  {billed ? (
                    <div>
                      <dt className="flex items-baseline justify-between text-xs text-muted-foreground">
                        <span>{t('orva_tasking.projectList.billed', 'เรียกเก็บไปแล้ว')}</span>
                        <span className="tabular-nums">{billed.billedPct}%</span>
                      </dt>
                      <dd className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary/40" style={{ width: `${billed.billedPct}%` }} />
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {gap !== null && Math.abs(gap) >= 20 ? (
                  <p className={`mt-2 text-xs ${gap > 0 ? 'text-status-warning-text' : 'text-muted-foreground'}`}>
                    {gap > 0
                      ? t('orva_documents.projects.billBehind', 'งานนำเงิน {gap} จุด — ถึงเวลาออกงวดถัดไป')
                          .replace('{gap}', String(gap))
                      : t('orva_documents.projects.workBehind', 'เงินนำงาน {gap} จุด')
                          .replace('{gap}', String(Math.abs(gap)))}
                  </p>
                ) : null}

                {!project.quoteId ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('orva_tasking.projectList.needsQuote', 'ยังไม่ผูกใบเสนอราคา — ผูกแล้วจะเทียบงานกับเงินได้')}
                  </p>
                ) : null}
              </section>
            )
          })}
        </div>
      </PageBody>
    </Page>
  )
}
