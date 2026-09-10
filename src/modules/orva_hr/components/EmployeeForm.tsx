"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
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

type EmployeeDetail = {
  id: string
  staffMemberId: string | null
  position: string | null
  hireDate: string | null
  monthlySalary: number
  status: string
  titleTh: string | null
  firstNameTh: string | null
  lastNameTh: string | null
  nationalId: string | null
  ssoNumber: string | null
  address: string | null
  bankName: string | null
  bankAccountNo: string | null
  terminationDate: string | null
  updatedAt: string | null
}

type Translate = (key: string, fallback: string) => string

/**
 * The identity the Thai payroll filings need. Kept in one place so the create
 * and the edit form cannot drift, and grouped apart from employment so the
 * screen reads as "who they are" beside "what we pay them".
 */
function statutoryFields(t: Translate): CrudField[] {
  return [
    { id: 'titleTh', label: t('orva_hr.employees.form.titleTh', 'คำนำหน้า'), type: 'text' },
    { id: 'firstNameTh', label: t('orva_hr.employees.form.firstNameTh', 'ชื่อ (ไทย)'), type: 'text' },
    { id: 'lastNameTh', label: t('orva_hr.employees.form.lastNameTh', 'นามสกุล (ไทย)'), type: 'text' },
    { id: 'nationalId', label: t('orva_hr.employees.form.nationalId', 'เลขประจำตัวประชาชน (13 หลัก)'), type: 'text' },
    { id: 'ssoNumber', label: t('orva_hr.employees.form.ssoNumber', 'เลขประกันสังคม (เว้นว่าง = ใช้เลขบัตรประชาชน)'), type: 'text' },
    { id: 'address', label: t('orva_hr.employees.form.address', 'ที่อยู่ (พิมพ์บนหนังสือรับรองหัก ณ ที่จ่าย)'), type: 'textarea' },
    { id: 'bankName', label: t('orva_hr.employees.form.bankName', 'ธนาคาร'), type: 'text' },
    { id: 'bankAccountNo', label: t('orva_hr.employees.form.bankAccountNo', 'เลขที่บัญชีรับเงินเดือน'), type: 'text' },
  ]
}

function statutoryGroups(t: Translate): CrudFormGroup[] {
  return [
    {
      id: 'statutory',
      title: t('orva_hr.employees.form.statutoryGroup', 'ข้อมูลสำหรับยื่นราชการ'),
      column: 1,
      fields: ['titleTh', 'firstNameTh', 'lastNameTh', 'nationalId', 'ssoNumber', 'address'],
    },
  ]
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
    ...statutoryFields(t),
  ], [t, members])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'employment', title: t('orva_hr.employees.form.group', 'Employment'), column: 1, fields: ['staffMemberId', 'position', 'hireDate'] },
    { id: 'compensation', title: t('orva_hr.employees.form.compGroup', 'Compensation'), column: 2, fields: ['monthlySalary', 'bankName', 'bankAccountNo'] },
    ...statutoryGroups(t),
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
    { id: 'terminationDate', label: t('orva_hr.employees.form.terminationDate', 'วันสิ้นสุดการจ้าง'), type: 'date' },
    ...statutoryFields(t),
  ], [t, members])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'employment', title: t('orva_hr.employees.form.group', 'Employment'), column: 1, fields: ['staffMemberId', 'position', 'hireDate', 'status', 'terminationDate'] },
    { id: 'compensation', title: t('orva_hr.employees.form.compGroup', 'Compensation'), column: 2, fields: ['monthlySalary', 'bankName', 'bankAccountNo'] },
    ...statutoryGroups(t),
  ], [t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        // The detail route, not the list: four statutory columns are encrypted
        // at rest, so the query index holds ciphertext for them.
        const call = await apiCall<EmployeeDetail>(`/api/orva_hr/employees/detail?id=${encodeURIComponent(String(id))}`)
        if (!call.ok || !call.result) { if (!cancelled) setIsNotFound(true); return }
        const item = call.result
        if (!cancelled) {
          setInitial({
            id: item.id,
            staffMemberId: item.staffMemberId ?? '',
            position: item.position ?? '',
            hireDate: item.hireDate ?? '',
            monthlySalary: item.monthlySalary,
            status: item.status,
            titleTh: item.titleTh ?? '',
            firstNameTh: item.firstNameTh ?? '',
            lastNameTh: item.lastNameTh ?? '',
            nationalId: item.nationalId ?? '',
            ssoNumber: item.ssoNumber ?? '',
            address: item.address ?? '',
            bankName: item.bankName ?? '',
            bankAccountNo: item.bankAccountNo ?? '',
            terminationDate: item.terminationDate ?? '',
            updatedAt: item.updatedAt ?? null,
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
