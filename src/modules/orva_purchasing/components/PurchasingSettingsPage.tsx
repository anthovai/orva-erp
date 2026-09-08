"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AccountSelect, selectClass, useAccounts } from './pickers'

type Settings = {
  poNumberFormat: string
  vatDefault: string
  defaultGoodsAccountId: string | null
  defaultServiceAccountId: string | null
  nextPoNumber: string
  updatedAt: string
}

/**
 * Numbering and the two account defaults.
 *
 * The screen shows what the next number would actually be rather than
 * explaining the tokens, because that is the question anyone editing a format
 * is really asking.
 */
export default function PurchasingSettingsPage() {
  const t = useT()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { accounts } = useAccounts()
  const [form, setForm] = React.useState<Settings | null>(null)
  const [saving, setSaving] = React.useState(false)

  const query = useQuery({
    queryKey: ['orva_purchasing.settings', scopeVersion],
    queryFn: () => readApiResultOrThrow<Settings>('/api/orva_purchasing/settings'),
  })

  React.useEffect(() => {
    if (query.data) setForm(query.data)
  }, [query.data])

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const res = await apiCall<Settings & { ok: true }>('/api/orva_purchasing/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          poNumberFormat: form.poNumberFormat,
          vatDefault: form.vatDefault,
          defaultGoodsAccountId: form.defaultGoodsAccountId,
          defaultServiceAccountId: form.defaultServiceAccountId,
        }),
      })
      if (!res.ok || !res.result) throw new Error((res.result as { error?: string } | undefined)?.error ?? 'failed')
      setForm(res.result)
      flash(t('orva_purchasing.settings.saved', 'บันทึกการตั้งค่าแล้ว'), 'success')
      await queryClient.invalidateQueries({ queryKey: ['orva_purchasing.settings'] })
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('orva_purchasing.settings.page.title', 'ตั้งค่าจัดซื้อ')}
        description={t(
          'orva_purchasing.settings.page.description',
          'รูปแบบเลขที่ใบสั่งซื้อ และบัญชีที่บรรทัดใหม่จะใช้เป็นค่าเริ่มต้น',
        )}
      />
      <PageBody>
        {query.isLoading || !form ? (
          <LoadingMessage label={t('orva_purchasing.loading', 'กำลังโหลด…')} />
        ) : query.isError ? (
          <ErrorMessage
            label={t('orva_purchasing.settings.error', 'โหลดการตั้งค่าไม่ได้')}
            description={query.error instanceof Error ? query.error.message : undefined}
          />
        ) : (
          <div className="flex max-w-2xl flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_purchasing.settings.format', 'รูปแบบเลขที่')}</span>
              <Input
                value={form.poNumberFormat}
                onChange={(event) => setForm({ ...form, poNumberFormat: event.target.value })}
              />
              <span className="text-xs text-muted-foreground">
                {t('orva_purchasing.settings.formatHint', 'ใช้ได้: {yyyy} {yy} {mm} {dd} และ {seq:4} — ตัวเลขจะเริ่มนับใหม่เมื่อส่วนวันที่เปลี่ยน')}
              </span>
              <span className="text-xs">
                {t('orva_purchasing.settings.next', 'ใบถัดไปจะได้เลขที่')}: <strong>{form.nextPoNumber}</strong>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_purchasing.settings.vatDefault', 'VAT เริ่มต้นของบรรทัดใหม่')}</span>
              <select
                className={selectClass}
                value={form.vatDefault}
                onChange={(event) => setForm({ ...form, vatDefault: event.target.value })}
              >
                <option value="7">7%</option>
                <option value="none">{t('orva_purchasing.field.vatNone', 'ไม่มี')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_purchasing.settings.goodsAccount', 'บัญชีเริ่มต้นสำหรับสินค้า')}</span>
              <AccountSelect
                value={form.defaultGoodsAccountId ?? ''}
                onChange={(value) => setForm({ ...form, defaultGoodsAccountId: value || null })}
                accounts={accounts}
                placeholder={t('orva_purchasing.field.accountPick', 'เลือกบัญชี')}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{t('orva_purchasing.settings.serviceAccount', 'บัญชีเริ่มต้นสำหรับบริการ')}</span>
              <AccountSelect
                value={form.defaultServiceAccountId ?? ''}
                onChange={(value) => setForm({ ...form, defaultServiceAccountId: value || null })}
                accounts={accounts}
                placeholder={t('orva_purchasing.field.accountPick', 'เลือกบัญชี')}
              />
            </label>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving ? t('orva_purchasing.saving', 'กำลังบันทึก…') : t('orva_purchasing.settings.save', 'บันทึก')}
              </Button>
            </div>
          </div>
        )}
      </PageBody>
    </Page>
  )
}
