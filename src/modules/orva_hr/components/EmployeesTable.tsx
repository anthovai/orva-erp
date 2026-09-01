"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { OrvaEmptyState } from '@/components/orva/NodeMark'

type EmployeeRow = {
  id: string
  employee_no?: string | null
  party_id: string | null
  staff_member_id?: string | null
  display_name?: string | null
  position?: string | null
  hire_date?: string | null
  monthly_salary?: string | number
  wht_rate?: string | number
  status: string
  updated_at?: string | null
}


export default function EmployeesTable() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const scopeVersion = useOrganizationScopeVersion()
  const [page, setPage] = React.useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['orva_hr.employees', page, scopeVersion],
    queryFn: async () =>
      fetchCrudList<EmployeeRow>('orva_hr/employees', {
        page, pageSize: 50, sortField: 'employee_no', sortDir: 'asc',
      }),
  })

  const fmt = (v: string | number | undefined) =>
    Number(v ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const columns: ColumnDef<EmployeeRow>[] = React.useMemo(() => [
    { accessorKey: 'employee_no', header: t('orva_hr.employees.column.no', 'Employee #'), meta: { priority: 1 } },
    {
      // name snapshot taken at link time — no second fetch, no drift
      accessorKey: 'display_name',
      header: t('orva_hr.employees.column.name', 'Name'),
      enableSorting: false,
      meta: { priority: 1 },
      cell: ({ getValue }) => String(getValue() ?? '') || '—',
    },
    { accessorKey: 'position', header: t('orva_hr.employees.column.position', 'Position'), meta: { priority: 3 } },
    {
      accessorKey: 'monthly_salary',
      header: t('orva_hr.employees.column.salary', 'Salary'),
      meta: { priority: 2 },
      cell: ({ getValue }) => <span className="tabular-nums">{fmt(getValue() as string)}</span>,
    },
    {
      accessorKey: 'status',
      header: t('orva_finance.journals.column.status', 'Status'),
      meta: { priority: 2 },
      cell: ({ getValue }) => {
        const status = String(getValue())
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${status === 'active' ? 'bg-accent/50' : 'bg-muted text-muted-foreground'}`}>
            {t(`orva_hr.employeeStatus.${status}`, status)}
          </span>
        )
      },
    },
  ], [t])

  return (
    <>
      <DataTable
        title={t('orva_hr.employees.page.title', 'Employees')}
        emptyState={(
          <OrvaEmptyState
            title={t('orva_hr.employees.empty.title', "No employees yet")}
            description={t('orva_hr.employees.empty.description', 'Add the people on your payroll — each one links to a staff team member.')}
          />
        )}
        actions={(
          <Button asChild>
            <Link href="/backend/hr/employees/create">{t('orva_hr.employees.actions.create', 'Add employee')}</Link>
          </Button>
        )}
        columns={columns}
        data={data?.items ?? []}
        entityId="orva_hr:hr_employee"
        perspective={{ tableId: 'orva_hr.employees.list' }}
        rowActions={(row) => (
          <RowActions
            items={[
              { label: t('orva_finance.actions.edit', 'Edit'), href: `/backend/hr/employees/${row.id}/edit` },
              {
                label: t('orva_finance.actions.delete', 'Delete'),
                destructive: true,
                onSelect: async () => {
                  const confirmed = await confirm({
                    title: t('orva_hr.employees.confirmDelete', 'Delete employment record?'),
                    variant: 'destructive',
                  })
                  if (!confirmed) return
                  await withScopedApiRequestHeaders(
                    buildOptimisticLockHeader(row.updated_at),
                    () => deleteCrud('orva_hr/employees', row.id),
                  )
                  flash(t('orva_hr.employees.flash.deleted', 'Employment record deleted'), 'success')
                  queryClient.invalidateQueries({ queryKey: ['orva_hr.employees'] })
                },
              },
            ]}
          />
        )}
        pagination={{
          page, pageSize: 50,
          total: data?.total || 0,
          totalPages: data?.totalPages || 0,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
      />
      {ConfirmDialogElement}
    </>
  )
}
