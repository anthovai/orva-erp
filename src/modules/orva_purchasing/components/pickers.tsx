"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@open-mercato/ui/primitives/input'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useVariantSearch } from '@/modules/orva_stock/components/VariantPicker'

/**
 * The three references a purchase-order line makes, each rendered as a
 * selection over display names — a uuid is never typed or read on this screen.
 * Every option source belongs to the module that owns the record: parties from
 * orva_party, accounts from orva_finance, variants from the installed catalog.
 *
 * `PAGE_SIZE` is the ceiling those list contracts allow (`pageSize.max(100)`
 * in orva_party's and orva_finance's validators, as every finance picker
 * already respects). Asking for more is not merely capped — the query fails
 * validation with a 400, the react-query call throws, and the select renders
 * with nothing in it but its placeholder. That is how this screen shipped:
 * both dropdowns were empty on every tenant, and the form even advised the
 * operator to go and add a vendor role they already had.
 *
 * A tenant that passes 100 vendors or 100 active accounts needs a
 * search-as-you-type picker like `VariantSearch` below, not a bigger page.
 */
const PAGE_SIZE = 100
export const selectClass =
  'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

export type AccountRow = { id: string; code: string; name: string; account_type?: string }
export type Variant = { id: string; name: string | null; sku: string | null; barcode: string | null }

/**
 * Vendors and accounts come from the modules that own them — one hook, one
 * cache entry, one shape per key (see src/lib/__tests__/queryKeyOwnership.test.ts).
 * Re-exported here so this module's screens keep importing from their pickers.
 */
export { useVendors } from '@/modules/orva_party/components/queries'
export { useActiveAccounts as useAccounts } from '@/modules/orva_finance/components/queries'

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
  const [term, setTerm] = React.useState('')
  const { data } = useVariantSearch(term, value == null)

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
