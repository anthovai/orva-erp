"use client"
import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/gl/accounts'
const ENTITY_ID = 'orva_finance:gl_account'

type Translate = ReturnType<typeof useT>

type AccountItem = {
  id: string
  code: string
  name: string
  account_type: string
  is_active?: boolean
  updated_at?: string | null
}

function useAccountFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'code', label: t('orva_finance.accounts.column.code', 'Code'), type: 'text', required: true },
    { id: 'name', label: t('orva_finance.accounts.column.name', 'Name'), type: 'text', required: true },
    {
      id: 'accountType',
      label: t('orva_finance.accounts.column.type', 'Type'),
      type: 'select',
      required: true,
      options: [
        { value: 'asset', label: t('orva_finance.accountType.asset', 'Asset') },
        { value: 'liability', label: t('orva_finance.accountType.liability', 'Liability') },
        { value: 'equity', label: t('orva_finance.accountType.equity', 'Equity') },
        { value: 'income', label: t('orva_finance.accountType.income', 'Income') },
        { value: 'expense', label: t('orva_finance.accountType.expense', 'Expense') },
      ],
    },
    { id: 'isActive', label: t('orva_finance.accounts.column.active', 'Active'), type: 'checkbox' },
  ], [t])
}

function useAccountGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'account',
      title: t('orva_finance.accounts.form.group', 'Account'),
      column: 1,
      fields: ['code', 'name', 'accountType', 'isActive'],
    },
  ], [t])
}

export function AccountCreateForm() {
  const t = useT()
  const fields = useAccountFields(t)
  const groups = useAccountGroups(t)
  return (
    <CrudForm
      title={t('orva_finance.accounts.form.create.title', 'Create account')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={{ isActive: true }}
      submitLabel={t('orva_finance.form.create.submit', 'Create')}
      cancelHref={LIST_HREF}
      successRedirect={`${LIST_HREF}?flash=${encodeURIComponent(t('orva_finance.accounts.flash.created', 'Account created'))}&type=success`}
      onSubmit={async (vals) => { await createCrud('orva_finance/gl/accounts', vals) }}
    />
  )
}

export function AccountEditForm({ id }: { id: string }) {
  const t = useT()
  const [initial, setInitial] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const fields = useAccountFields(t)
  const groups = useAccountGroups(t)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await fetchCrudList<AccountItem>('orva_finance/gl/accounts', { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) { if (!cancelled) setIsNotFound(true); return }
        if (!cancelled) {
          setInitial({
            id: item.id,
            code: item.code,
            name: item.name,
            accountType: item.account_type,
            isActive: Boolean(item.is_active),
            updatedAt: item.updated_at ?? null,
          })
        }
      } catch (error: unknown) {
        if (!cancelled) setErr(error instanceof Error ? error.message : 'Failed to load account')
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
        label={t('orva_finance.accounts.error.notFound', 'Account not found')}
        backHref={LIST_HREF}
        backLabel={t('orva_finance.accounts.actions.backToList', 'Back to accounts')}
      />
    )
  }
  if (err) return <ErrorMessage label={err} />
  if (loading || !initial) return null

  return (
    <CrudForm
      title={t('orva_finance.accounts.form.edit.title', 'Edit account')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial}
      submitLabel={t('orva_finance.form.edit.submit', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={`${LIST_HREF}?flash=${encodeURIComponent(t('orva_finance.accounts.flash.saved', 'Account saved'))}&type=success`}
      onSubmit={async (vals) => { await updateCrud('orva_finance/gl/accounts', { ...vals, id }) }}
    />
  )
}
