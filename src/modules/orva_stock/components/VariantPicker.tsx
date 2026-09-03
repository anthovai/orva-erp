"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Input } from '@open-mercato/ui/primitives/input'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export type Variant = { id: string; product_id: string; name: string | null; sku: string | null; barcode: string | null }

/** Search-as-you-type over catalog variants (name / SKU / barcode). */
export function VariantPicker({ value, onChange, t }: { value: Variant | null; onChange: (v: Variant | null) => void; t: (k: string, f: string) => string }) {
  const scopeVersion = useOrganizationScopeVersion()
  const [q, setQ] = React.useState('')
  const { data } = useQuery({
    queryKey: ['catalog.variants.pick', q, scopeVersion],
    queryFn: async () => (await readApiResultOrThrow<{ items: Variant[] }>(`/api/catalog/variants?pageSize=20${q ? `&search=${encodeURIComponent(q)}` : ''}`)).items,
  })
  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
        <span className="font-medium">{value.name ?? value.sku ?? value.id}</span>
        {value.sku ? <span className="text-xs text-muted-foreground">{value.sku}</span> : null}
        <button type="button" className="ml-auto text-xs text-primary hover:underline" onClick={() => onChange(null)}>{t('orva_stock.variant.change', 'เปลี่ยน')}</button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('orva_stock.variant.search', 'ค้นหาชื่อสินค้า / SKU / บาร์โค้ด')} />
      <div className="max-h-48 overflow-y-auto rounded-md border text-sm">
        {(data ?? []).length === 0 ? (
          <div className="px-3 py-2 text-muted-foreground">{t('orva_stock.variant.empty', 'ไม่พบสินค้า — สร้างสินค้าและ variant ในแค็ตตาล็อกก่อน')}</div>
        ) : (data ?? []).map((v) => (
          <button key={v.id} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50" onClick={() => onChange(v)}>
            <span className="font-medium">{v.name ?? '—'}</span>
            {v.sku ? <span className="text-xs text-muted-foreground">{v.sku}</span> : null}
            {v.barcode ? <span className="ml-auto text-xs tabular-nums text-muted-foreground">{v.barcode}</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
