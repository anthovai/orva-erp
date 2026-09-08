"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@open-mercato/ui/primitives/input'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

/**
 * The three references a purchase-order line makes, each rendered as a
 * selection over display names — a uuid is never typed or read on this screen.
 * Every option source belongs to the module that owns the record: parties from
 * orva_party, accounts from orva_finance, variants from the installed catalog.
 */
export const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

type PartyRoleRow = { id: string; party_id: string }
type PartyRow = { id: string; display_name: string }
export type AccountRow = { id: string; code: string; name: string; account_type?: string }
export type Variant = { id: string; name: string | null; sku: string | null; barcode: string | null }

/** Parties holding an active vendor role — the same source AP bills use. */
export function useVendors() {
  const scopeVersion = useOrganizationScopeVersion()
  const roles = useQuery({
    queryKey: ['orva_party.vendor-roles', scopeVersion],
    queryFn: async () => fetchCrudList<PartyRoleRow>('orva_party/party-roles', { page: 1, pageSize: 200, role: 'vendor' }),
  })
  const ids = React.useMemo(
    () => Array.from(new Set((roles.data?.items ?? []).map((row) => row.party_id))),
    [roles.data?.items],
  )
  const parties = useQuery({
    queryKey: ['orva_party.vendors', ids.join(','), scopeVersion],
    queryFn: async () => fetchCrudList<PartyRow>('orva_party/parties', { ids: ids.join(','), pageSize: 200 }),
    enabled: ids.length > 0,
  })
  return {
    vendors: parties.data?.items ?? [],
    isLoading: roles.isLoading || (ids.length > 0 && parties.isLoading),
  }
}

/** Active GL accounts, ordered by code, for the account a line will post to. */
export function useAccounts() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['orva_finance.accounts.active', scopeVersion],
    queryFn: async () =>
      fetchCrudList<AccountRow>('orva_finance/gl/accounts', {
        page: 1,
        pageSize: 200,
        sortField: 'code',
        sortDir: 'asc',
        isActive: true,
      }),
  })
  return { accounts: query.data?.items ?? [], isLoading: query.isLoading }
}

export function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder,
  id,
}: {
  value: string
  onChange: (value: string) => void
  accounts: AccountRow[]
  placeholder: string
  id?: string
}) {
  return (
    <select id={id} className={selectClass} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.code} · {account.name}
        </option>
      ))}
    </select>
  )
}

/** Search-as-you-type over catalog variants (name / SKU / barcode). */
export function VariantSearch({
  value,
  onChange,
  t,
}: {
  value: Variant | null
  onChange: (variant: Variant | null) => void
  t: (key: string, fallback: string) => string
}) {
  const scopeVersion = useOrganizationScopeVersion()
  const [term, setTerm] = React.useState('')
  const { data } = useQuery({
    queryKey: ['catalog.variants.pick', term, scopeVersion],
    queryFn: async () =>
      (
        await readApiResultOrThrow<{ items: Variant[] }>(
          `/api/catalog/variants?pageSize=20${term ? `&search=${encodeURIComponent(term)}` : ''}`,
        )
      ).items,
    enabled: value == null,
  })

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
        <span className="font-medium">{value.name ?? value.sku ?? '—'}</span>
        {value.sku ? <span className="text-xs text-muted-foreground">{value.sku}</span> : null}
        <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={() => onChange(null)}>
          {t('orva_purchasing.variant.change', 'เปลี่ยน')}
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t('orva_purchasing.variant.search', 'ค้นหาชื่อสินค้า / SKU')}
      />
      <div className="max-h-40 overflow-y-auto rounded-md border text-sm">
        {(data ?? []).length === 0 ? (
          <div className="px-2 py-1.5 text-muted-foreground">
            {t('orva_purchasing.variant.empty', 'ไม่พบสินค้า — สร้างสินค้าในแค็ตตาล็อกก่อน')}
          </div>
        ) : (
          (data ?? []).map((variant) => (
            <button
              key={variant.id}
              type="button"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50"
              onClick={() => onChange(variant)}
            >
              <span className="font-medium">{variant.name ?? '—'}</span>
              {variant.sku ? <span className="text-xs text-muted-foreground">{variant.sku}</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
