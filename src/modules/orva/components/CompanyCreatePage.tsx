"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  buildCompanyPayload,
  createCompanyFormFields,
  createCompanyFormGroups,
  createCompanyFormSchema,
  type CompanyFormValues,
} from '@open-mercato/core/modules/customers/components/formConfig'

/**
 * Orva company create screen — a route override of the installed page,
 * wired in src/modules.ts.
 *
 * Why override instead of extend: the installed field set is modelled on
 * western B2B SaaS (web domain, employee-size bucket, annual revenue,
 * LinkedIn/X handles). A Thai SME reads a long form where most rows never
 * apply, while the two fields a Thai tax invoice legally requires — the
 * 13-digit taxpayer id and the branch code — sit at the bottom inside a
 * generic custom-fields group. Removing fields is not expressible through any
 * extension seam: `crud-form:*` is only emitted as a marker attribute and
 * CrudForm never resolves itself through the component registry, so a
 * props-transform override does nothing. Owning the route is the only way.
 *
 * What this file deliberately does NOT own: the zod schema, the field
 * definitions and the payload builder are imported from upstream, so
 * validation, custom-field wiring and the save contract stay theirs. This page
 * only decides which of those fields to ask for, and in what order.
 *
 * Consequences worth knowing:
 *  - a field upstream adds later will not show up here until it is removed
 *    from DEFERRED_FIELDS' complement. That is the point of a curated form,
 *    but it does mean this list needs a look on upstream upgrades.
 *  - nothing is removed from the data model. Every deferred field still
 *    exists and stays editable on the company detail page.
 */

/** Collected later on the detail page rather than at creation time. */
const DEFERRED_FIELDS = new Set([
  'brandName',
  'domain',
  'sizeBucket',
  'annualRevenue',
  'linkedInUrl',
  'twitterUrl',
])

/** Identity first, then the Thai statutory block, then the optional rest. */
const GROUP_ORDER = ['details', 'customFields', 'profile', 'addresses', 'notes']

const CUSTOMER_ENTITY_ID = 'customers:customer_entity'
const COMPANY_PROFILE_ENTITY_ID = 'customers:customer_company_profile'

export default function OrvaCreateCompanyPage() {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { organizationId } = useOrganizationScopeDetail()

  const formSchema = React.useMemo(() => createCompanyFormSchema(), [])
  const fields = React.useMemo(
    () => createCompanyFormFields(t).filter((field) => !DEFERRED_FIELDS.has(String(field.id))),
    [t],
  )
  const groups = React.useMemo(() => {
    const rank = (id?: string) => {
      const index = GROUP_ORDER.indexOf(id ?? '')
      return index === -1 ? GROUP_ORDER.length : index
    }
    return createCompanyFormGroups(t)
      .map((group) => ({
        ...group,
        // group.fields holds ids, but the type also permits inline field
        // objects — key off whichever shape each entry actually is.
        fields: Array.isArray(group.fields)
          ? group.fields.filter((entry) =>
              typeof entry === 'string'
                ? !DEFERRED_FIELDS.has(entry)
                : !DEFERRED_FIELDS.has(String(entry?.id)))
          : group.fields,
      }))
      // a group whose every field was deferred would render as a bare header
      .filter((group) => !Array.isArray(group.fields) || group.fields.length > 0)
      .sort((a, b) => rank(a.id) - rank(b.id))
  }, [t])

  const returnTo = searchParams.get('returnTo')
  const listHref = returnTo ?? '/backend/customers/companies'

  return (
    <Page>
      <PageBody>
        <CrudForm<CompanyFormValues>
          title={t('customers.companies.create.title')}
          backHref={listHref}
          fields={fields}
          groups={groups}
          initialValues={{ addresses: [] as CompanyFormValues['addresses'] }}
          entityIds={[CUSTOMER_ENTITY_ID, COMPANY_PROFILE_ENTITY_ID]}
          submitLabel={t('customers.companies.form.submit')}
          cancelHref={listHref}
          schema={formSchema}
          onSubmit={async (values) => {
            const addresses = Array.isArray(values.addresses) ? values.addresses : []
            let payload: Record<string, unknown>
            try {
              payload = buildCompanyPayload(values, organizationId)
            } catch (err) {
              if (err instanceof Error && err.message === 'DISPLAY_NAME_REQUIRED') {
                const message = t('customers.companies.form.displayName.error')
                throw createCrudFormError(message, { displayName: message })
              }
              throw err
            }

            const { result: created } = await createCrud<{ id?: string; entityId?: string }>(
              'customers/companies',
              payload,
            )
            const newId =
              created && typeof created.id === 'string'
                ? created.id
                : typeof created?.entityId === 'string'
                  ? created.entityId
                  : null

            if (newId && addresses.length) {
              const normalize = (value?: string | null) => {
                if (typeof value !== 'string') return undefined
                const trimmed = value.trim()
                return trimmed.length ? trimmed : undefined
              }
              for (const entry of addresses) {
                const addressLine1 = normalize(entry.addressLine1)
                if (!addressLine1) continue
                const body: Record<string, unknown> = {
                  entityId: newId,
                  ...(organizationId ? { organizationId } : {}),
                  addressLine1,
                  isPrimary: entry.isPrimary ?? false,
                }
                const optional: Array<[string, string | undefined]> = [
                  ['name', normalize(entry.name)],
                  ['purpose', normalize(entry.purpose)],
                  ['addressLine2', normalize(entry.addressLine2)],
                  ['buildingNumber', normalize(entry.buildingNumber)],
                  ['flatNumber', normalize(entry.flatNumber)],
                  ['city', normalize(entry.city)],
                  ['region', normalize(entry.region)],
                  ['postalCode', normalize(entry.postalCode)],
                  ['country', normalize(entry.country)?.toUpperCase()],
                ]
                for (const [key, value] of optional) {
                  if (value !== undefined) body[key] = value
                }
                if (typeof entry.latitude === 'number') body.latitude = entry.latitude
                if (typeof entry.longitude === 'number') body.longitude = entry.longitude
                try {
                  await createCrud('customers/addresses', body)
                } catch (addressErr) {
                  const message =
                    addressErr instanceof Error && addressErr.message
                      ? addressErr.message
                      : t('customers.companies.detail.addresses.error')
                  flash(message, 'error')
                }
              }
            }

            flash(t('customers.companies.form.success'), 'success')
            if (returnTo) router.push(returnTo)
            else if (newId) router.push(`/backend/customers/companies-v2/${newId}`)
            else router.push('/backend/customers/companies')
          }}
        />
      </PageBody>
    </Page>
  )
}
