"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'

import { usePortalProjects, type PortalProject } from '../../../../components/queries'

export type { PortalProject }

/**
 * งานของเรา — what the customer sees instead of the old share link.
 *
 * One place covering every project the business chose to show them, with the
 * same figures the KKG-Tasking overview page shows today: done of total, a
 * percentage, how much is late, and what falls due next.
 *
 * No project id appears in the text. Nothing here is reachable by guessing a
 * URL — every figure is computed inside the signed-in customer's own scope.
 */
export default function PortalWorkPage({ params }: { params: { orgSlug: string } }) {
  const t = useT()
  const { orgSlug } = params

  const projects = usePortalProjects()

  return (
    <div className="space-y-6">
      <PortalPageHeader
        title={t('orva_tasking.portal.title', 'งานของเรา')}
        description={t('orva_tasking.portal.description', 'ความคืบหน้าของงานที่กำลังทำให้คุณ')}
      />

      {projects.isLoading ? (
        <PortalCard>
          <p className="text-sm text-muted-foreground">{t('orva_tasking.portal.loading', 'กำลังโหลด…')}</p>
        </PortalCard>
      ) : null}

      {projects.error ? (
        <PortalCard>
          <p className="text-sm text-status-error-text">
            {t('orva_tasking.portal.loadFailed', 'โหลดข้อมูลไม่สำเร็จ')}
          </p>
          <Button className="mt-3" variant="outline" onClick={() => projects.refetch()}>
            {t('orva_tasking.retry', 'ลองอีกครั้ง')}
          </Button>
        </PortalCard>
      ) : null}

      {projects.data?.length === 0 ? (
        <PortalCard>
          <PortalEmptyState
            title={t('orva_tasking.portal.empty', 'ยังไม่มีงานที่เปิดให้ดู')}
            description={t('orva_tasking.portal.emptyHint', 'ติดต่อผู้ดูแลโครงการของคุณได้เลย')}
          />
        </PortalCard>
      ) : null}

      {(projects.data ?? []).map((project) => (
        <PortalCard key={project.id}>
          <PortalCardHeader
            title={project.name}
            label={project.quoteNumber ?? undefined}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={`/${orgSlug}/portal/work/${project.id}`}>
                  {t('orva_tasking.portal.open', 'ดูรายละเอียด')}
                </Link>
              </Button>
            }
          />
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="tabular-nums font-medium">
              {project.done}/{project.total} · {project.percent}%
            </span>
            {project.overdue > 0 ? (
              <span className="rounded-full bg-status-error-bg px-2 py-0.5 text-xs text-status-error-text">
                {t('orva_tasking.portal.overdue', 'เลยกำหนด {n}').replace('{n}', String(project.overdue))}
              </span>
            ) : null}
            {project.dueSoon > 0 ? (
              <span className="text-xs text-muted-foreground">
                {t('orva_tasking.portal.dueSoon', 'ครบกำหนดใน 7 วัน {n}').replace('{n}', String(project.dueSoon))}
              </span>
            ) : null}
            {project.nextDue ? (
              <span className="tabular-nums text-xs text-muted-foreground">
                {t('orva_tasking.portal.nextDue', 'ถัดไป {date}').replace('{date}', project.nextDue)}
              </span>
            ) : null}
          </div>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={project.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('orva_tasking.portal.progressLabel', 'ความคืบหน้า {name}').replace('{name}', project.name)}
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${project.percent}%` }} />
          </div>
        </PortalCard>
      ))}
    </div>
  )
}
