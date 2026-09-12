"use client"
import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/parties'
const ENTITY_ID = 'orva_party:party'

type Translate = ReturnType<typeof useT>

type PartyItem = {
  id: string
  kind: string
  display_name: string
  legal_name?: string | null
  tax_id?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
  updated_at?: string | null
}

function usePartyFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => {
    const fields: CrudField[] = [
      // `layout` sizes a field to its content. Every field here used to be
      // full width, so a 13-digit tax id and a two-letter type sat in the same
      // 340px box as a company name — the form asked the same question width
      // of every answer.
      {
        id: 'kind',
        label: t('orva_party.form.fields.kind.label', 'Type'),
        type: 'select',
        required: true,
        layout: 'half',
        options: [
          { value: 'person', label: t('orva_party.kind.person', 'Person') },
          { value: 'company', label: t('orva_party.kind.company', 'Company') },
        ],
      },
      {
        id: 'taxId',
        label: t('orva_party.form.fields.taxId.label', 'Tax ID'),
        type: 'text',
        layout: 'half',
        placeholder: '0105500000000',
        description: t('orva_party.form.fields.taxId.help', 'เลข 13 หลักตามหนังสือรับรอง — ใช้พิมพ์บนใบกำกับภาษีและใบหัก ณ ที่จ่าย'),
      },
      {
        id: 'displayName',
        label: t('orva_party.form.fields.displayName.label', 'Display name'),
        type: 'text',
        required: true,
        description: t('orva_party.form.fields.displayName.help', 'ชื่อที่ใช้เรียกในระบบและในรายการเลือกผู้ขาย'),
      },
      {
        id: 'legalName',
        label: t('orva_party.form.fields.legalName.label', 'Legal name'),
        type: 'text',
        description: t('orva_party.form.fields.legalName.help', 'ชื่อตามหนังสือรับรอง ถ้าต่างจากชื่อเรียก — ชื่อนี้คือชื่อที่ขึ้นบนเอกสาร'),
      },
      { id: 'email', label: t('orva_party.form.fields.email.label', 'Email'), type: 'text' },
      { id: 'phone', label: t('orva_party.form.fields.phone.label', 'Phone'), type: 'text', layout: 'half' },
      { id: 'notes', label: t('orva_party.form.fields.notes.label', 'Notes'), type: 'textarea' },
    ]
    return fields
  }, [t])
}

function usePartyGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    // Two columns that both carry weight. The old split put four fields on
    // the left and two on the right, so the right column ran out half way
    // down and the page ended in a column of nothing — then "Notes" was sent
    // back to the left, under a heading whose only field was also called
    // Notes. The groups are named for what the operator is filling in.
    {
      id: 'identity',
      title: t('orva_party.form.groups.identity', 'ผู้ขายรายนี้คือใคร'),
      description: t('orva_party.form.groups.identityHelp', 'ชื่อและเลขประจำตัวผู้เสียภาษีที่จะขึ้นบนใบสั่งซื้อและบิล'),
      column: 1,
      fields: ['kind', 'taxId', 'displayName', 'legalName'],
    },
    {
      id: 'contact',
      title: t('orva_party.form.groups.contact', 'ติดต่อที่ไหน'),
      description: t('orva_party.form.groups.contactHelp', 'ใช้ส่งใบสั่งซื้อ และเป็นที่ติดต่อเวลาของยังไม่มา'),
      column: 2,
      fields: ['email', 'phone'],
    },
    {
      id: 'notes',
      title: t('orva_party.form.groups.notes', 'บันทึกภายใน'),
      description: t('orva_party.form.groups.notesHelp', 'เห็นเฉพาะในระบบ ไม่ขึ้นบนเอกสารที่ส่งออกไป'),
      column: 2,
      fields: ['notes'],
    },
  ], [t])
}

type PartyFormValues = {
  id?: string
  kind: string
  displayName: string
  legalName?: string | null
  taxId?: string | null
  email?: string | null
  phone?: string | null
  notes?: string | null
  role?: string
  updatedAt?: string | null
}

export function PartyCreateForm() {
  const t = useT()
  const fields = usePartyFields(t)
  const groups = usePartyGroups(t)
  const successRedirect = React.useMemo(
    () => `${LIST_HREF}?flash=${encodeURIComponent(t('orva_party.form.flash.created', 'Party created'))}&type=success`,
    [t],
  )
  return (
    <CrudForm
      title={t('orva_party.form.create.title', 'Add vendor')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      submitLabel={t('orva_party.form.create.submit', 'Create')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (vals) => {
        const { role: _ignored, ...rest } = vals as PartyFormValues
        // This screen is the vendor registry. Customers live in the customers
        // module; people live in staff/HR — a second copy of either only
        // drifts, so the role is no longer a choice here.
        await createCrud('orva_party/parties', { ...rest, roles: ['vendor'] })
      }}
    />
  )
}

export function PartyEditForm({ id }: { id: string }) {
  const t = useT()
  const [initial, setInitial] = React.useState<PartyFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const fields = usePartyFields(t)
  const groups = usePartyGroups(t)
  const successRedirect = React.useMemo(
    () => `${LIST_HREF}?flash=${encodeURIComponent(t('orva_party.form.flash.saved', 'Party saved'))}&type=success`,
    [t],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setErr(null)
      setIsNotFound(false)
      try {
        const data = await fetchCrudList<PartyItem>('orva_party/parties', { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setIsNotFound(true)
          return
        }
        if (!cancelled) {
          setInitial({
            id: item.id,
            kind: item.kind,
            displayName: item.display_name,
            legalName: item.legal_name ?? '',
            taxId: item.tax_id ?? '',
            email: item.email ?? '',
            phone: item.phone ?? '',
            notes: item.notes ?? '',
            // CrudForm derives the optimistic-lock header from initialValues.updatedAt.
            updatedAt: item.updated_at ?? null,
          })
        }
      } catch (error: unknown) {
        if (!cancelled) {
          if ((error as { status?: number }).status === 404) setIsNotFound(true)
          else setErr(error instanceof Error ? error.message : t('orva_party.form.error.load', 'Failed to load party'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id, t])

  if (isNotFound) {
    return (
      <RecordNotFoundState
        label={t('orva_party.form.error.notFound', 'Party not found')}
        backHref={LIST_HREF}
        backLabel={t('orva_party.form.actions.backToList', 'Back to parties')}
      />
    )
  }
  if (err) return <ErrorMessage label={err} />
  if (loading || !initial) return null

  return (
    <CrudForm
      title={t('orva_party.form.edit.title', 'Edit vendor')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial}
      submitLabel={t('orva_party.form.edit.submit', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (vals) => {
        const values = vals as PartyFormValues
        await updateCrud('orva_party/parties', { ...values, id })
      }}
    />
  )
}
