"use client"
import * as React from 'react'
import type { DashboardWidgetComponentProps } from '@open-mercato/shared/modules/dashboard/widgets'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { FourQuestions, useHomeOverview } from '../../../components/FourQuestions'
import { DEFAULT_SETTINGS, hydrateOwnerHomeSettings, type OwnerHomeSettings } from './config'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export default function OwnerHomeWidget({ settings, onSettingsChange, mode, refreshToken, onRefreshStateChange }: DashboardWidgetComponentProps<OwnerHomeSettings>) {
  const t = useT()
  const resolved = React.useMemo(() => hydrateOwnerHomeSettings(settings ?? DEFAULT_SETTINGS), [settings])
  const { data, loading, failed } = useHomeOverview(refreshToken)
  React.useEffect(() => { onRefreshStateChange?.(loading) }, [loading, onRefreshStateChange])

  if (mode === 'settings') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={resolved.showInvoiceList} onChange={(e) => onSettingsChange?.({ showInvoiceList: e.target.checked })} />
        {t('orva_finance.home.settings.showInvoiceList', 'แสดงรายการใบแจ้งหนี้ค้างชำระทีละใบ')}
      </label>
    )
  }
  if (loading) return <div className="flex items-center justify-center py-8"><Spinner /></div>
  if (failed || !data) return <p className="py-6 text-center text-sm text-muted-foreground">{t('orva_finance.home.unavailable', 'ยังดึงตัวเลขไม่ได้ในขณะนี้')}</p>
  return <FourQuestions data={data} showInvoiceList={resolved.showInvoiceList} />
}
