"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery } from '@tanstack/react-query'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

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
}

const money = (value: number, currency: string) =>
  `${value.toLocaleString('th-TH', { minimumFractionDigits: 2 })} ${currency}`

const STATUS_CLASSES: Record<ProjectRow['status'], string> = {
  not_started: 'bg-muted text-muted-foreground',
  billing: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  billed: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  complete: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
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
      id: 'installments',
      header: t('orva_documents.projects.column.installments', 'งวดที่ออกแล้ว'),
      cell: ({ row }: { row: { original: ProjectRow } }) => (
        <div className="flex flex-col text-sm">
          <span className="tabular-nums">{row.original.installments}</span>
          {row.original.unpaidInstallments > 0 ? (
            <span className="text-xs text-amber-700 dark:text-amber-400">
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
          title={t('orva_documents.projects.page.title', 'โปรเจกต์')}
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
      </PageBody>
    </Page>
  )
}
