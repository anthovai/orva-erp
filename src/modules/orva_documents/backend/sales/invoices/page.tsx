"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useQuery } from '@tanstack/react-query'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'

/**
 * The invoice list upstream never shipped: sales_invoices has entities, CRUD
 * and numbering but no screen. Invoices issued from quotes (see
 * api/issue-invoice) land here — their own list, separate from ใบเสนอราคา,
 * which was the user's core correction: an invoice is not a second quote.
 */

type InvoiceRow = {
  id: string
  invoice_number: string
  status?: string | null
  issue_date?: string | null
  due_date?: string | null
  currency_code: string
  grand_total_gross_amount?: string | number | null
  outstanding_amount?: string | number | null
  metadata?: { quoteNumber?: string | null; customerSnapshot?: { customer?: { displayName?: string } } | null } | null
}

const money = (value: unknown, currency: string) =>
  `${Number(value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })} ${currency}`

const day = (value: unknown) => (typeof value === 'string' ? value.slice(0, 10) : '')

export default function OrvaInvoicesPage() {
  const t = useT()
  const router = useRouter()
  const [page, setPage] = React.useState(1)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['orva_documents.invoices', page],
    queryFn: async () =>
      fetchCrudList<InvoiceRow>('sales/invoices', { page, pageSize: 50, sortField: 'createdAt', sortDir: 'desc' }),
  })

  const columns = React.useMemo<ColumnDef<InvoiceRow>[]>(() => [
    {
      id: 'invoice_number',
      accessorKey: 'invoice_number',
      header: t('orva_documents.invoices.column.number', 'เลขที่ใบแจ้งหนี้'),
      cell: ({ row }: { row: { original: InvoiceRow } }) => <span className="font-medium">{row.original.invoice_number}</span>,
    },
    {
      id: 'customer',
      header: t('orva_documents.invoices.column.customer', 'ลูกค้า'),
      cell: ({ row }: { row: { original: InvoiceRow } }) => row.original.metadata?.customerSnapshot?.customer?.displayName
        ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'quote',
      header: t('orva_documents.invoices.column.quote', 'จากใบเสนอราคา'),
      cell: ({ row }: { row: { original: InvoiceRow } }) => row.original.metadata?.quoteNumber ?? <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'issue_date',
      header: t('orva_documents.field.issueDate', 'วันที่'),
      cell: ({ row }: { row: { original: InvoiceRow } }) => day(row.original.issue_date),
    },
    {
      id: 'due_date',
      header: t('orva_documents.field.dueDate', 'ครบกำหนดชำระ'),
      cell: ({ row }: { row: { original: InvoiceRow } }) => day(row.original.due_date) || <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'grand_total',
      header: t('orva_documents.field.grandTotal', 'จำนวนเงินรวมทั้งสิ้น'),
      cell: ({ row }: { row: { original: InvoiceRow } }) => (
        <span className="tabular-nums">{money(row.original.grand_total_gross_amount, row.original.currency_code)}</span>
      ),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<InvoiceRow>
          title={t('orva_documents.invoices.page.title', 'ใบแจ้งหนี้')}
          columns={columns}
          data={data?.items ?? []}
          isLoading={isLoading}
          pagination={{
            page,
            pageSize: 50,
            total: data?.total ?? 0,
            totalPages: data?.totalPages ?? 1,
            onPageChange: setPage,
          }}
          refreshButton={{
            label: t('orva_documents.invoices.refresh', 'รีเฟรช'),
            onRefresh: () => { void refetch() },
            isRefreshing: isLoading,
          }}
          perspective={{ tableId: 'orva_documents.invoices' }}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'review',
                  label: t('orva_documents.rowAction.review', 'ตรวจดูเอกสาร'),
                  href: `/backend/documents/preview?type=invoice&documentId=${row.id}`,
                },
                {
                  id: 'receipt',
                  label: t('orva_documents.rowAction.receipt', 'ออกใบกำกับภาษี/ใบเสร็จ'),
                  href: `/backend/documents/preview?type=receipt&documentId=${row.id}`,
                },
              ]}
            />
          )}
          onRowClick={(row) => router.push(`/backend/documents/preview?type=invoice&documentId=${row.id}`)}
          emptyState={
            <div className="py-10 text-center text-sm text-muted-foreground">
              {t('orva_documents.invoices.empty', 'ยังไม่มีใบแจ้งหนี้ — ออกได้จากใบเสนอราคาที่ต้องการเรียกเก็บ')}
            </div>
          }
        />
      </PageBody>
    </Page>
  )
}
