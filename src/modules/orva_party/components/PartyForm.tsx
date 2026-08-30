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

function usePartyFields(t: Translate, forCreate: boolean): CrudField[] {
  return React.useMemo<CrudField[]>(() => {
    const fields: CrudField[] = [
      {
        id: 'kind',
        label: t('orva_party.form.fields.kind.label', 'Type'),
        type: 'select',
        required: true,
        options: [
          { value: 'person', label: t('orva_party.kind.person', 'Person') },
          { value: 'company', label: t('orva_party.kind.company', 'Company') },
        ],
      },
      {
        id: 'displayName',
        label: t('orva_party.form.fields.displayName.label', 'Display name'),
        type: 'text',
        required: true,
      },
      { id: 'legalName', label: t('orva_party.form.fields.legalName.label', 'Legal name'), type: 'text' },
      { id: 'taxId', label: t('orva_party.form.fields.taxId.label', 'Tax ID'), type: 'text' },
      { id: 'email', label: t('orva_party.form.fields.email.label', 'Email'), type: 'text' },
      { id: 'phone', label: t('orva_party.form.fields.phone.label', 'Phone'), type: 'text' },
      { id: 'notes', label: t('orva_party.form.fields.notes.label', 'Notes'), type: 'textarea' },
    ]
    if (forCreate) {
      fields.push({
        id: 'role',
        label: t('orva_party.form.fields.role.label', 'Initial role'),
        type: 'select',
        options: [
          { value: '', label: t('orva_party.form.fields.role.none', '— none —') },
          { value: 'customer', label: t('orva_party.role.customer', 'Customer') },
          { value: 'vendor', label: t('orva_party.role.vendor', 'Vendor') },
          { value: 'employee', label: t('orva_party.role.employee', 'Employee') },
          { value: 'contact', label: t('orva_party.role.contact', 'Contact') },
        ],
      })
    }
    return fields
  }, [t, forCreate])
}

function usePartyGroups(t: Translate, forCreate: boolean): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identity',
      title: t('orva_party.form.groups.identity', 'Identity'),
      column: 1,
      fields: ['kind', 'displayName', 'legalName', 'taxId'],
    },
    {
      id: 'contact',
      title: t('orva_party.form.groups.contact', 'Contact'),
      column: 2,
      fields: forCreate ? ['email', 'phone', 'role'] : ['email', 'phone'],
    },
    {
      id: 'notes',
      title: t('orva_party.form.groups.notes', 'Notes'),
      column: 1,
      fields: ['notes'],
    },
  ], [t, forCreate])
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
  const fields = usePartyFields(t, true)
  const groups = usePartyGroups(t, true)
  const successRedirect = React.useMemo(
    () => `${LIST_HREF}?flash=${encodeURIComponent(t('orva_party.form.flash.created', 'Party created'))}&type=success`,
    [t],
  )
  return (
    <CrudForm
      title={t('orva_party.form.create.title', 'Create party')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      submitLabel={t('orva_party.form.create.submit', 'Create')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (vals) => {
        const { role, ...rest } = vals as PartyFormValues
        await createCrud('orva_party/parties', {
          ...rest,
          roles: role ? [role] : undefined,
        })
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
  const fields = usePartyFields(t, false)
  const groups = usePartyGroups(t, false)
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
      title={t('orva_party.form.edit.title', 'Edit party')}
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
