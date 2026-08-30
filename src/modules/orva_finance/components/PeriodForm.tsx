"use client"
import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LIST_HREF = '/backend/gl/periods'

export function PeriodCreateForm() {
  const t = useT()
  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'code',
      label: t('orva_finance.periods.column.code', 'Period'),
      type: 'text',
      required: true,
      placeholder: '2026-08',
    },
    { id: 'startsOn', label: t('orva_finance.periods.column.startsOn', 'From'), type: 'date', required: true },
    { id: 'endsOn', label: t('orva_finance.periods.column.endsOn', 'To'), type: 'date', required: true },
  ], [t])
  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'period', title: t('orva_finance.periods.form.group', 'Period'), column: 1, fields: ['code', 'startsOn', 'endsOn'] },
  ], [t])
  return (
    <CrudForm
      title={t('orva_finance.periods.form.create.title', 'Create fiscal period')}
      backHref={LIST_HREF}
      entityId="orva_finance:fiscal_period"
      fields={fields}
      groups={groups}
      submitLabel={t('orva_finance.form.create.submit', 'Create')}
      cancelHref={LIST_HREF}
      successRedirect={`${LIST_HREF}?flash=${encodeURIComponent(t('orva_finance.periods.flash.created', 'Period created'))}&type=success`}
      onSubmit={async (vals) => { await createCrud('orva_finance/gl/periods', vals) }}
    />
  )
}
