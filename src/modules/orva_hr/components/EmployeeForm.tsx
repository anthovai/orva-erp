"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/hr/employees'
const ENTITY_ID = 'orva_hr:hr_employee'

type StaffMemberRow = { id: string; display_name: string; is_active?: boolean }

/**
 * People come from the installed staff registry — an employee IS a staff
 * member wearing a payroll hat, so there is exactly one place to spell a
 * name. Before this the picker read orva_party, a second person registry
 * that only drifted from staff.
 */
function useStaffMembers() {
  const { data } = useQuery({
    queryKey: ['orva_hr.staff-members'],
    queryFn: async () => fetchCrudList<StaffMemberRow>('staff/team-members', { page: 1, pageSize: 100, isActive: true }),
  })
  return data?.items ?? []
}

export function EmployeeCreateForm() {
  const t = useT()
  const members = useStaffMembers()
  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'staffMemberId',
      label: t('orva_hr.employees.form.staffMember', 'สมาชิกทีม (staff)'),
      type: 'select',
      required: true,
      options: members.map((m) => ({ value: m.id, label: m.display_name })),
    },
    { id: 'position', label: t('orva_hr.employees.column.position', 'Position'), type: 'text' },
    { id: 'hireDate', label: t('orva_hr.employees.form.hireDate', 'Hire date'), type: 'date' },
    { id: 'monthlySalary', label: t('orva_hr.employees.form.salary', 'Monthly salary (THB)'), type: 'number', required: true },
  ], [t, members])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'employment', title: t('orva_hr.employees.form.group', 'Employment'), column: 1, fields: ['staffMemberId', 'position', 'hireDate'] },
    { id: 'compensation', title: t('orva_hr.employees.form.compGroup', 'Compensation'), column: 2, fields: ['monthlySalary'] },
  ], [t])
  return (
    <CrudForm
      title={t('orva_hr.employees.form.create.title', 'Add employee')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={{}}
      submitLabel={t('orva_finance.form.create.submit', 'Create')}
      cancelHref={LIST_HREF}
      successRedirect={`${LIST_HREF}?flash=${encodeURIComponent(t('orva_hr.employees.flash.created', 'Employee added'))}&type=success`}
      onSubmit={async (vals) => { await createCrud('orva_hr/employees', vals) }}
    />
  )
}

export function EmployeeEditForm({ id }: { id: string }) {
  const t = useT()
  const members = useStaffMembers()
  const [initial, setInitial] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'staffMemberId',
      label: t('orva_hr.employees.form.staffMember', 'สมาชิกทีม (staff)'),
      type: 'select',
      options: members.map((m) => ({ value: m.id, label: m.display_name })),
    },
    { id: 'position', label: t('orva_hr.employees.column.position', 'Position'), type: 'text' },
    { id: 'hireDate', label: t('orva_hr.employees.form.hireDate', 'Hire date'), type: 'date' },
    { id: 'monthlySalary', label: t('orva_hr.employees.form.salary', 'Monthly salary (THB)'), type: 'number', required: true },
    {
      id: 'status',
      label: t('orva_finance.journals.column.status', 'Status'),
      type: 'select',
      options: [
        { value: 'active', label: t('orva_hr.employeeStatus.active', 'Active') },
        { value: 'inactive', label: t('orva_hr.employeeStatus.inactive', 'Inactive') },
      ],
    },
  ], [t, members])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'employment', title: t('orva_hr.employees.form.group', 'Employment'), column: 1, fields: ['staffMemberId', 'position', 'hireDate', 'status'] },
    { id: 'compensation', title: t('orva_hr.employees.form.compGroup', 'Compensation'), column: 2, fields: ['monthlySalary'] },
  ], [t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await fetchCrudList<Record<string, unknown>>('orva_hr/employees', { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) { if (!cancelled) setIsNotFound(true); return }
        if (!cancelled) {
          setInitial({
            id: item.id,
            staffMemberId: item.staff_member_id ?? '',
            position: item.position ?? '',
            hireDate: item.hire_date ?? '',
            monthlySalary: Number(item.monthly_salary ?? 0),
            status: item.status,
            updatedAt: item.updated_at ?? null,
          })
        }
      } catch (error: unknown) {
        if (!cancelled) setErr(error instanceof Error ? error.message : 'Failed to load employee')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('orva_hr.employees.error.notFound', 'Employee not found')}
        backHref={LIST_HREF}
        backLabel={t('orva_hr.employees.actions.backToList', 'Back to employees')}
      />
    )
  }
  if (err) return <ErrorMessage label={err} />
  if (loading || !initial) return null

  return (
    <CrudForm
      title={t('orva_hr.employees.form.edit.title', 'Edit employee')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial}
      submitLabel={t('orva_finance.form.edit.submit', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={`${LIST_HREF}?flash=${encodeURIComponent(t('orva_hr.employees.flash.saved', 'Employee saved'))}&type=success`}
      onSubmit={async (vals) => {
        const { staffMemberId, ...rest } = vals as Record<string, unknown>
        // legacy rows have no link; sending '' would fail the uuid check
        await updateCrud('orva_hr/employees', { ...rest, ...(staffMemberId ? { staffMemberId } : {}), id })
      }}
    />
  )
}
