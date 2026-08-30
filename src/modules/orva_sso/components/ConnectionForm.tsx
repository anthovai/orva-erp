"use client"
import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/settings/sso'
const ENTITY_ID = 'orva_sso:sso_connection'

function useConnectionFields(mode: 'create' | 'edit') {
  const t = useT()
  return React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('orva_sso.form.name', 'Connection name'), type: 'text', required: true },
    { id: 'emailDomains', label: t('orva_sso.form.domains', 'Email domains (comma-separated)'), type: 'text', required: true },
    { id: 'issuerUrl', label: t('orva_sso.form.issuer', 'Issuer URL (OIDC)'), type: 'text', required: true },
    { id: 'clientId', label: t('orva_sso.form.clientId', 'Client ID'), type: 'text', required: true },
    {
      id: 'clientSecret',
      label: mode === 'create'
        ? t('orva_sso.form.clientSecret', 'Client secret')
        : t('orva_sso.form.clientSecretKeep', 'Client secret (blank keeps the stored one)'),
      type: 'text',
      required: mode === 'create',
    },
    { id: 'enabled', label: t('orva_sso.form.enabled', 'Enabled'), type: 'checkbox' },
  ], [t, mode])
}

function useConnectionGroups() {
  const t = useT()
  return React.useMemo<CrudFormGroup[]>(() => [
    { id: 'identity', title: t('orva_sso.form.groupIdentity', 'Identity provider'), column: 1, fields: ['name', 'emailDomains', 'enabled'] },
    { id: 'oidc', title: t('orva_sso.form.groupOidc', 'OIDC client'), column: 2, fields: ['issuerUrl', 'clientId', 'clientSecret'] },
  ], [t])
}

export function ConnectionCreateForm() {
  const t = useT()
  const fields = useConnectionFields('create')
  const groups = useConnectionGroups()
  return (
    <CrudForm
      title={t('orva_sso.form.create.title', 'Add SSO connection')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={{ enabled: true }}
      submitLabel={t('orva_finance.form.create.submit', 'Create')}
      cancelHref={LIST_HREF}
      successRedirect={`${LIST_HREF}?flash=${encodeURIComponent(t('orva_sso.flash.created', 'Connection added'))}&type=success`}
      onSubmit={async (vals) => { await createCrud('orva_sso/connections', vals) }}
    />
  )
}

export function ConnectionEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = useConnectionFields('edit')
  const groups = useConnectionGroups()
  const [initial, setInitial] = React.useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [err, setErr] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await fetchCrudList<Record<string, unknown>>('orva_sso/connections', { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) { if (!cancelled) setIsNotFound(true); return }
        if (!cancelled) {
          setInitial({
            id: item.id,
            name: item.name ?? '',
            emailDomains: item.email_domains ?? '',
            issuerUrl: item.issuer_url ?? '',
            clientId: item.client_id ?? '',
            clientSecret: '',
            enabled: Boolean(item.enabled),
            updatedAt: item.updated_at ?? null,
          })
        }
      } catch (error: unknown) {
        if (!cancelled) setErr(error instanceof Error ? error.message : 'Failed to load connection')
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
        label={t('orva_sso.error.notFound', 'Connection not found')}
        backHref={LIST_HREF}
        backLabel={t('orva_sso.actions.backToList', 'Back to SSO connections')}
      />
    )
  }
  if (err) return <ErrorMessage label={err} />
  if (loading || !initial) return null

  return (
    <CrudForm
      title={t('orva_sso.form.edit.title', 'Edit SSO connection')}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial}
      submitLabel={t('orva_finance.form.edit.submit', 'Save')}
      cancelHref={LIST_HREF}
      successRedirect={`${LIST_HREF}?flash=${encodeURIComponent(t('orva_sso.flash.saved', 'Connection saved'))}&type=success`}
      onSubmit={async (vals) => {
        const payload: Record<string, unknown> = { ...vals, id }
        if (typeof payload.clientSecret === 'string' && payload.clientSecret.length === 0) delete payload.clientSecret
        await updateCrud('orva_sso/connections', payload)
      }}
    />
  )
}
