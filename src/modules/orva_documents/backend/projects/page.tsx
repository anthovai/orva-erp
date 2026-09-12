"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@/components/orva/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { OrvaPageHeader } from '@/components/orva/PageHeader'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { formatHours } from '@/modules/orva_time/lib/hours'
import { IssueInvoiceDialog } from '../../components/IssueInvoiceDialog'

/**
 * โปรเจกต์: the quote-as-project view. Each software project Kaiser Klowns
 * sells is one quote billed in งวด, so project progress = billing progress —
 * how much of the quote is invoiced, how much is paid, and which project
 * needs its next งวด issued. The benchmark spec's Gap #4 (Odoo Project's
 * milestone billing), scoped to what this business actually runs on.
 */

type ProjectRow = {
  quoteId: string
  quoteNumber: string
  customerName: string | null
  currencyCode: string
  issueDate: string | null
  quoteStatus: string | null
  quoteTotal: number
  installments: number
  unpaidInstallments: number
  billed: number
  paid: number
  lastInvoiceDate: string | null
  status: 'not_started' | 'billing' | 'billed' | 'complete'
  billedPct: number
  paidPct: number
  remainingToBill: number
  remainingToCollect: number
  openTickets: number
  tasksTotal: number
  tasksDone: number
  workPct: number | null
  drift:
    | { verdict: 'no_tasks' }
    | { verdict: 'bill_behind'; gap: number }
    | { verdict: 'work_behind'; gap: number }
    | { verdict: 'in_step'; gap: number }
  minutes: number
  hourlyRate: number | null
  rateSource: 'project' | 'default' | 'none'
  cost: number | null
  marginBilled: number | null
  marginProjected: number | null
}

const money = (value: number, currency: string) =>
  `${value.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ${currency}`

/** Status tokens carry their own dark-mode values — never palette shades. */
const STATUS_CLASSES: Record<ProjectRow['status'], string> = {
  not_started: 'bg-status-neutral-bg text-status-neutral-text',
  billing: 'bg-status-info-bg text-status-info-text',
  billed: 'bg-status-warning-bg text-status-warning-text',
  complete: 'bg-status-success-bg text-status-success-text',
}

/** Paid sits on top of billed on the same track: เรียกเก็บ = pale, รับแล้ว = solid. */
function ProgressTrack({ billedPct, paidPct }: { billedPct: number; paidPct: number }) {
  return (
    <div className="h-2 w-36 overflow-hidden rounded-full bg-muted" role="presentation">
      <div className="relative h-full">
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary/30" style={{ width: `${billedPct}%` }} />
        <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${paidPct}%` }} />
      </div>
    </div>
  )
}

export default function OrvaProjectsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const qc = useQueryClient()
  // Row actions that open a dialog: the project whose next งวด is being issued,
  // and the project whose hourly rate is being set.
  const [issueFor, setIssueFor] = React.useState<ProjectRow | null>(null)
  const [rateFor, setRateFor] = React.useState<ProjectRow | null>(null)
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['orva_documents.projects', scopeVersion],
    queryFn: async () => readApiResultOrThrow<{ items: ProjectRow[] }>('/api/orva_documents/projects'),
  })

  const statusLabel = React.useCallback((status: ProjectRow['status']) => {
    switch (status) {
      case 'not_started': return t('orva_documents.projects.status.notStarted', 'ยังไม่เรียกเก็บ')
      case 'billing': return t('orva_documents.projects.status.billing', 'กำลังเรียกเก็บตามงวด')
      case 'billed': return t('orva_documents.projects.status.billed', 'เรียกเก็บครบ รอรับเงิน')
      case 'complete': return t('orva_documents.projects.status.complete', 'รับเงินครบแล้ว')
    }
  }, [t])

  /**
   * A new draft carrying this project's customer and lines. The server does
   * the copying through upstream's own create route, so the new quote claims
   * its own number in the brand's series.
   */
  const duplicateQuote = async (row: ProjectRow) => {
    try {
      const res = await apiCall<{ id: string; quoteNumber: string | null; lines: number }>('/api/orva_documents/duplicate-quote', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quoteId: row.quoteId }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      flash(
        t('orva_documents.projects.duplicated', 'ทำใบใหม่ {number} จาก {source} แล้ว ({n} รายการ)')
          .replace('{number}', res.result.quoteNumber ?? '')
          .replace('{source}', row.quoteNumber)
          .replace('{n}', String(res.result.lines)),
        'success',
      )
      void qc.invalidateQueries({ queryKey: ['orva_documents.projects'] })
      router.push(`/backend/sales/quotes/${res.result.id}`)
    } catch (e) {
      flash(e instanceof Error ? e.message : String(e), 'error')
    }
  }

  const columns = React.useMemo<ColumnDef<ProjectRow>[]>(() => [
    {
      id: 'project',
      header: t('orva_documents.projects.column.project', 'โปรเจกต์'),
      cell: ({ row }: { row: { original: ProjectRow } }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.quoteNumber}</span>
          <span className="text-xs text-muted-foreground">
            {row.original.customerName ?? t('orva_documents.projects.noCustomer', 'ไม่ระบุลูกค้า')}
          </span>
        </div>
      ),
    },
    {
      id: 'total',
      header: t('orva_documents.projects.column.total', 'มูลค่าโปรเจกต์'),
      cell: ({ row }: { row: { original: ProjectRow } }) => (
        <span className="tabular-nums">{money(row.original.quoteTotal, row.original.currencyCode)}</span>
      ),
    },
    {
      id: 'progress',
      header: t('orva_documents.projects.column.progress', 'ความคืบหน้า (เรียกเก็บ/รับเงิน)'),
      cell: ({ row }: { row: { original: ProjectRow } }) => (
        <div className="flex flex-col gap-1">
          <ProgressTrack billedPct={row.original.billedPct} paidPct={row.original.paidPct} />
          <span className="text-xs tabular-nums text-muted-foreground">
            {t('orva_documents.projects.progressText', 'เรียกเก็บ {billed}% · รับแล้ว {paid}%')
              .replace('{billed}', String(row.original.billedPct))
              .replace('{paid}', String(row.original.paidPct))}
          </span>
        </div>
      ),
    },
    {
      /**
       * The reason the tasking module exists: งาน% next to เรียกเก็บ%.
       *
       * A project with no tasks written down reads "ยังไม่ได้ลงงาน", never 0% —
       * zero beside 30% billed looks alarming when the truth is only that
       * nobody has listed the work yet.
       */
      id: 'work',
      header: t('orva_documents.projects.column.work', 'งานที่ทำจริง'),
      cell: ({ row }: { row: { original: ProjectRow } }) => {
        const { workPct, drift, tasksDone, tasksTotal } = row.original
        if (workPct === null) {
          return (
            <Link
              href="/backend/tasking"
              className="text-xs text-muted-foreground hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {t('orva_documents.projects.noTasks', 'ยังไม่ได้ลงงาน')}
            </Link>
          )
        }
        const driftLabel =
          drift.verdict === 'bill_behind'
            ? t('orva_documents.projects.billBehind', 'งานนำเงิน {gap} จุด — ถึงเวลาออกงวดถัดไป')
                .replace('{gap}', String(drift.gap))
            : drift.verdict === 'work_behind'
              ? t('orva_documents.projects.workBehind', 'เงินนำงาน {gap} จุด')
                  .replace('{gap}', String(drift.gap))
              : null
        return (
          <div className="flex flex-col gap-1">
            <span className="tabular-nums text-sm">
              {t('orva_documents.projects.workText', 'ทำแล้ว {pct}% ({done}/{total})')
                .replace('{pct}', String(workPct))
                .replace('{done}', String(tasksDone))
                .replace('{total}', String(tasksTotal))}
            </span>
            {driftLabel ? (
              <span
                className={`text-xs ${drift.verdict === 'bill_behind' ? 'text-status-warning-text' : 'text-muted-foreground'}`}
              >
                {driftLabel}
              </span>
            ) : null}
          </div>
        )
      },
    },
    {
      id: 'installments',
      header: t('orva_documents.projects.column.installments', 'งวดที่ออกแล้ว'),
      cell: ({ row }: { row: { original: ProjectRow } }) => (
        <div className="flex flex-col text-sm">
          <span className="tabular-nums">{row.original.installments}</span>
          {row.original.unpaidInstallments > 0 ? (
            <span className="text-xs text-status-warning-text">
              {t('orva_documents.projects.unpaid', 'ค้างชำระ {n} งวด').replace('{n}', String(row.original.unpaidInstallments))}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'remaining',
      header: t('orva_documents.projects.column.remaining', 'ยังไม่เรียกเก็บ'),
      cell: ({ row }: { row: { original: ProjectRow } }) => (
        <span className="tabular-nums">
          {row.original.remainingToBill > 0
            ? money(row.original.remainingToBill, row.original.currencyCode)
            : <span className="text-muted-foreground">—</span>}
        </span>
      ),
    },
    {
      /**
       * Hours into money (H3). Cost is only shown against a rate someone typed;
       * without one the cell says so and offers the setting, never a 0 margin.
       */
      id: 'economics',
      header: t('orva_documents.projects.column.economics', 'เวลาที่ใช้ · ต้นทุน · กำไร'),
      cell: ({ row }: { row: { original: ProjectRow } }) => {
        const r = row.original
        const hours = t('orva_documents.projects.hours', '{hours} ชม.').replace('{hours}', formatHours(r.minutes))
        if (r.cost == null || r.hourlyRate == null) {
          return (
            <div className="flex flex-col text-sm">
              <span className="tabular-nums">{hours}</span>
              <button
                type="button"
                className="text-left text-xs text-muted-foreground hover:underline"
                onClick={(e) => { e.stopPropagation(); setRateFor(r) }}
              >
                {t('orva_documents.projects.noRate', 'ยังไม่ตั้งอัตราต่อชั่วโมง — ตั้งเพื่อดูต้นทุน')}
              </button>
            </div>
          )
        }
        const marginTone = (r.marginProjected ?? 0) < 0 ? 'text-status-error-text' : 'text-status-success-text'
        return (
          <div className="flex flex-col text-sm" data-testid={`economics-${r.quoteId}`}>
            <span className="tabular-nums">
              {hours} · {t('orva_documents.projects.cost', 'ต้นทุน {cost}').replace('{cost}', money(r.cost, r.currencyCode))}
            </span>
            <span className={`text-xs tabular-nums ${marginTone}`}>
              {t('orva_documents.projects.marginProjected', 'กำไรคาด {margin}').replace('{margin}', money(r.marginProjected ?? 0, r.currencyCode))}
              {' · '}
              {t('orva_documents.projects.marginBilled', 'เก็บแล้ว−ต้นทุน {margin}').replace('{margin}', money(r.marginBilled ?? 0, r.currencyCode))}
            </span>
            <button
              type="button"
              className="text-left text-xs text-muted-foreground hover:underline"
              onClick={(e) => { e.stopPropagation(); setRateFor(r) }}
            >
              {(r.rateSource === 'project'
                ? t('orva_documents.projects.rateProject', 'อัตราเฉพาะโปรเจกต์ {rate}/ชม.')
                : t('orva_documents.projects.rateDefault', 'อัตราบริษัท {rate}/ชม.')).replace('{rate}', money(r.hourlyRate, r.currencyCode))}
            </button>
          </div>
        )
      },
    },
    {
      id: 'status',
      header: t('orva_documents.projects.column.status', 'สถานะ'),
      cell: ({ row }: { row: { original: ProjectRow } }) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[row.original.status]}`}>
          {statusLabel(row.original.status)}
        </span>
      ),
    },
    {
      id: 'tickets',
      header: t('orva_documents.projects.column.tickets', 'เรื่องค้าง'),
      cell: ({ row }: { row: { original: ProjectRow } }) =>
        row.original.openTickets > 0 ? (
          <a
            href={`/backend/support/tickets?quoteId=${row.original.quoteId}`}
            className="inline-flex rounded-full bg-status-error-bg px-2 py-0.5 text-xs font-medium text-status-error-text hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {t('orva_documents.projects.tickets', '{n} เรื่อง').replace('{n}', String(row.original.openTickets))}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ], [t, statusLabel])

  if (error) {
    return (
      <Page>
        <PageBody>
          <div className="py-10 text-center text-sm text-destructive">
            {t('orva_documents.projects.error', 'โหลดข้อมูลโปรเจกต์ไม่สำเร็จ ลองรีเฟรชอีกครั้ง')}
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DataTable<ProjectRow>
          title={(
          <OrvaPageHeader
            embedded
            kicker={t('orva.nav.project', 'โปรเจกต์และงาน')}
            title={t('orva_documents.projects.page.title', 'โปรเจกต์')}
          />
        )}
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          refreshButton={{
            label: t('orva_documents.invoices.refresh', 'รีเฟรช'),
            onRefresh: () => { void refetch() },
            isRefreshing: isLoading,
          }}
          perspective={{ tableId: 'orva_documents.projects' }}
          rowActions={(row) => (
            <RowActions
              items={[
                ...(row.remainingToBill > 0
                  ? [{
                      id: 'issue-next',
                      label: t('orva_documents.projects.rowAction.issueNext', 'ออกใบแจ้งหนี้งวดถัดไป'),
                      onSelect: () => setIssueFor(row),
                    }]
                  : []),
                {
                  id: 'duplicate',
                  label: t('orva_documents.rowAction.duplicate', 'ทำใบเสนอราคาใหม่จากใบนี้'),
                  onSelect: () => { void duplicateQuote(row) },
                },
                {
                  id: 'set-rate',
                  label: t('orva_documents.projects.rowAction.rate', 'ตั้งอัตราต่อชั่วโมงของโปรเจกต์นี้'),
                  onSelect: () => setRateFor(row),
                },
                {
                  id: 'open-quote',
                  label: t('orva_documents.projects.rowAction.quote', 'เปิดใบเสนอราคา / ออกงวดถัดไป'),
                  href: `/backend/sales/quotes/${row.quoteId}`,
                },
                {
                  id: 'tickets',
                  label: t('orva_documents.projects.rowAction.tickets', 'ดูบั๊ก / เรื่องค้างในโปรเจกต์นี้'),
                  href: `/backend/support/tickets?quoteId=${row.quoteId}`,
                },
                {
                  id: 'review',
                  label: t('orva_documents.rowAction.review', 'ตรวจดูเอกสาร'),
                  href: `/backend/documents/preview?type=quotation&documentId=${row.quoteId}`,
                },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/sales/quotes/${row.quoteId}`)}
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('orva_documents.projects.empty', 'ยังไม่มีโปรเจกต์ — สร้างใบเสนอราคาแรกเพื่อเริ่มโปรเจกต์')}
            </div>
          }
        />
        {issueFor ? (
          <IssueInvoiceDialog
            quoteId={issueFor.quoteId}
            open
            onOpenChange={(open) => { if (!open) setIssueFor(null) }}
            // What is still unbilled, so the last งวด closes the project exactly.
            defaultPercent={issueFor.billedPct < 100 ? Math.round((100 - issueFor.billedPct) * 10) / 10 : null}
            onIssued={(invoice) => {
              setIssueFor(null)
              void qc.invalidateQueries({ queryKey: ['orva_documents.projects'] })
              router.push(`/backend/documents/preview?type=invoice&documentId=${invoice.id}`)
            }}
          />
        ) : null}
        {rateFor ? (
          <RateDialog
            project={rateFor}
            onClose={() => setRateFor(null)}
            onSaved={() => { setRateFor(null); void qc.invalidateQueries({ queryKey: ['orva_documents.projects'] }) }}
          />
        ) : null}
      </PageBody>
    </Page>
  )
}

/**
 * อัตราต่อชั่วโมงของโปรเจกต์ — the exception to the company default. Empty
 * clears the override so the default applies again; the note names that
 * default (or says none is set and where to set it) so the owner is never
 * guessing what the blank means.
 */
function RateDialog({ project, onClose, onSaved }: { project: ProjectRow; onClose: () => void; onSaved: () => void }) {
  const t = useT()
  const [value, setValue] = React.useState(project.rateSource === 'project' && project.hourlyRate != null ? String(project.hourlyRate) : '')
  const [busy, setBusy] = React.useState(false)
  const defaultRate = project.rateSource === 'default' ? project.hourlyRate : null

  const save = async (clear: boolean) => {
    const numeric = clear ? null : Number(value)
    if (!clear && (!Number.isFinite(numeric) || (numeric as number) < 0)) { flash(t('orva_documents.projects.rate.invalid', 'ใส่ตัวเลขบาทต่อชั่วโมง'), 'error'); return }
    setBusy(true)
    try {
      const res = await apiCall<{ ok: boolean }>('/api/orva_documents/project-rates', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quoteId: project.quoteId, hourlyRate: numeric }),
      })
      if (!res.ok) throw new Error('failed')
      flash(t('orva_documents.projects.rate.saved', 'บันทึกอัตราแล้ว'), 'success')
      onSaved()
    } catch {
      flash(t('orva_documents.projects.rate.failed', 'บันทึกไม่สำเร็จ'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('orva_documents.projects.rate.title', 'อัตราต่อชั่วโมงของโปรเจกต์')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{project.quoteNumber}{project.customerName ? ` · ${project.customerName}` : ''}</p>
        <p className="text-sm">
          {defaultRate != null || project.rateSource === 'none'
            ? project.rateSource === 'none' && defaultRate == null
              ? t('orva_documents.projects.rate.noDefault', 'ยังไม่ตั้งอัตราบริษัท — ตั้งได้ที่ ตั้งค่า → เอกสาร หรือใส่อัตราเฉพาะโปรเจกต์นี้ด้านล่าง')
              : t('orva_documents.projects.rate.body', 'ใช้คิดต้นทุนจากเวลาที่จับไว้ เว้นว่างเพื่อใช้อัตราบริษัท ({rate}/ชม.)').replace('{rate}', money(defaultRate ?? 0, project.currencyCode))
            : t('orva_documents.projects.rate.bodyOverride', 'โปรเจกต์นี้ใช้อัตราของตัวเอง — ลบค่าเพื่อกลับไปใช้อัตราบริษัท')}
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('orva_documents.projects.rate.label', 'บาทต่อชั่วโมง')}</span>
          <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="เช่น 800" data-testid="rate-input" />
        </label>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t('orva_documents.projects.rate.cancel', 'ยกเลิก')}</Button>
          {project.rateSource === 'project' ? (
            <Button type="button" variant="outline" onClick={() => save(true)} disabled={busy}>{t('orva_documents.projects.rate.clear', 'ใช้อัตราบริษัท')}</Button>
          ) : null}
          <Button type="button" onClick={() => save(false)} disabled={busy || !value.trim()} data-testid="rate-save">{t('orva_documents.projects.rate.save', 'บันทึก')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
