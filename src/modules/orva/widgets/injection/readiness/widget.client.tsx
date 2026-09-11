"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CheckCircle2, CircleAlert, OctagonAlert } from 'lucide-react'
import type { ReadinessCheck, ReadinessSeverity } from '../../../lib/readiness'

type Response = {
  checks: ReadinessCheck[]
  summary: { blockers: number; warnings: number; ready: boolean }
}

const TONE: Record<ReadinessSeverity, { row: string; icon: React.ComponentType<{ className?: string }> }> = {
  blocker: { row: 'bg-status-error-bg text-status-error-text', icon: OctagonAlert },
  warning: { row: 'bg-status-warning-bg text-status-warning-text', icon: CircleAlert },
  ok: { row: 'bg-status-success-bg text-status-success-text', icon: CheckCircle2 },
}

/**
 * ความพร้อมใช้งาน on the system-status screen.
 *
 * The upstream panel above it reports debugging and cache flags — how the
 * server is behaving. This one reports whether the BUSINESS can work: can it
 * bill, post, and send. Every row names the screen that owns the fact, because
 * the whole problem is that each one lives somewhere different and nobody
 * goes looking until a customer notices.
 */
export default function ReadinessWidget() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['orva.readiness', scopeVersion],
    queryFn: () => readApiResultOrThrow<Response>('/api/orva/readiness'),
  })

  const summary = query.data?.summary
  return (
    <section className="mt-6 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{t('orva.readiness.title', 'ความพร้อมใช้งาน')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('orva.readiness.description', 'การตั้งค่าที่ทำให้ออกบิล ลงบัญชี และส่งเอกสารได้จริง — ทุกอย่างอยู่คนละหน้า เลยรวมมาไว้ที่เดียว')}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
          {t('orva.readiness.refresh', 'ตรวจใหม่')}
        </Button>
      </div>

      {query.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('orva.readiness.loading', 'กำลังตรวจ…')}</p>
      ) : null}
      {query.error ? (
        <p className="mt-4 text-sm text-status-error-text">{t('orva.readiness.failed', 'ตรวจไม่สำเร็จ')}</p>
      ) : null}

      {summary ? (
        <p className="mt-3 text-sm font-medium">
          {summary.ready
            ? t('orva.readiness.allGood', 'พร้อมใช้งาน ไม่มีอะไรค้าง')
            : t('orva.readiness.counts', 'ต้องแก้ก่อน {blockers} · ควรแก้ {warnings}')
                .replace('{blockers}', String(summary.blockers))
                .replace('{warnings}', String(summary.warnings))}
        </p>
      ) : null}

      <ul className="mt-3 space-y-2" data-testid="orva-readiness-list">
        {(query.data?.checks ?? []).map((check) => {
          const tone = TONE[check.severity]
          const Icon = tone.icon
          return (
            <li key={check.id} className="flex flex-wrap items-start gap-3 rounded-md border p-3 text-sm">
              <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${tone.row}`}>
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t(check.labelKey, check.id)}</span>
                <span className="block text-muted-foreground">{check.detail}</span>
              </span>
              {check.href ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={check.href}>{t('orva.readiness.open', 'ไปที่หน้านั้น')}</Link>
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
