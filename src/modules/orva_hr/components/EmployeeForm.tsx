"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/hr/employees'
const ENTITY_ID = 'orva_hr:employee'

type PartyRoleRow = { id: string; party_id: string }
type PartyRow = { id: string; display_name: string }

function useEmployeeParties() {
  const { data: rolesData } = useQuery({
    queryKey: ['orva_party.employee-roles'],
    queryFn: async () => fetchCrudList<PartyRoleRow>('orva_party/party-roles', { page: 1, pageSize: 100, role: 'employee' }),
  })
  const partyIds = React.useMemo(
    () => Array.from(new Set((rolesData?.items ?? []).map((r) => r.party_id))),
    [rolesData?.items],
  )
  const { data: partiesData } = useQuery({
    queryKey: ['orva_party.employee-parties', partyIds.join(',')],
    queryFn: async () => fetchCrudList<PartyRow>('orva_party/parties', { ids: partyIds.join(','), pageSize: 100 }),
    enabled: partyIds.length > 0,
  })
  return partiesData?.items ?? []
}

export function EmployeeCreateForm() {
  const t = useT()
  const parties = useEmployeeParties()
  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'partyId',
      label: t('orva_hr.employees.form.party', 'Person (party with employee role)'),
      type: 'select',
      required: true,
      options: parties.map((p) => ({ value: p.id, label: p.display_name })),
    },
    { id: 'position', label: t('orva_hr.employees.column.position', 'Position'), type: 'text' },
    { id: 'hireDate', label: t('orva_hr.employees.form.hireDate', 'Hire date'), type: 'date' },
    { id: 'monthlySalary', label: t('orva_hr.employees.form.salary', 'Monthly salary (THB)'), type: 'number', required: true },
    { id: 'whtRate', label: t('orva_hr.employees.form.whtRate', 'Withholding tax rate (%)'), type: 'number' },
  ], [t, parties])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'employment', title: t('orva_hr.employees.form.group', 'Employment'), column: 1, fields: ['partyId', 'position', 'hireDate'] },
    { id: 'compensation', title: t('orva_hr.employees.form.compGroup', 'Compensation'), column: 2, fields: ['monthlySalary', 'whtRate'] },
  ], [t])
  return (
    <CrudForm
      title={t('orva_hr.employees.form.create.title', 'Add employee')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={{ whtRate: 0 }}
      submitLabel={t('orva_finance.form.create.submit', 'Create')}
      cancelHref={LIST_HREF}
      successRedirect={`${LIST_HREF}?flash=${encodeURIComponent(t('orva_hr.employees.flash.created', 'Employee added'))}&type=success`}
      onSubmit={async (vals) => { await createCrud('orva_hr/employees', vals) }}
    />
  )
}

export function EmployeeEditForm({ id }: { id: string }) {
  const t = useT()
  const [initial, setInitial] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'position', label: t('orva_hr.employees.column.position', 'Position'), type: 'text' },
    { id: 'hireDate', label: t('orva_hr.employees.form.hireDate', 'Hire date'), type: 'date' },
    { id: 'monthlySalary', label: t('orva_hr.employees.form.salary', 'Monthly salary (THB)'), type: 'number', required: true },
    { id: 'whtRate', label: t('orva_hr.employees.form.whtRate', 'Withholding tax rate (%)'), type: 'number' },
    {
      id: 'status',
      label: t('orva_finance.journals.column.status', 'Status'),
      type: 'select',
      options: [
        { value: 'active', label: t('orva_hr.employeeStatus.active', 'Active') },
        { value: 'inactive', label: t('orva_hr.employeeStatus.inactive', 'Inactive') },
      ],
    },
  ], [t])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'employment', title: t('orva_hr.employees.form.group', 'Employment'), column: 1, fields: ['position', 'hireDate', 'status'] },
    { id: 'compensation', title: t('orva_hr.employees.form.compGroup', 'Compensation'), column: 2, fields: ['monthlySalary', 'whtRate'] },
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
            position: item.position ?? '',
            hireDate: item.hire_date ?? '',
            monthlySalary: Number(item.monthly_salary ?? 0),
            whtRate: Number(item.wht_rate ?? 0),
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
      onSubmit={async (vals) => { await updateCrud('orva_hr/employees', { ...vals, id }) }}
    />
  )
}
