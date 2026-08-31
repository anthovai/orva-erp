import { cf } from '@open-mercato/shared/modules/dsl'

/**
 * Thai statutory fields on the installed CRM company record.
 *
 * A Thai tax invoice is not valid without the counterparty's 13-digit
 * taxpayer id and its branch code ("สำนักงานใหญ่" = head office, otherwise a
 * 5-digit branch). Upstream's company profile is modelled for western B2B
 * (domain, size bucket, annual revenue) and carries neither, so Orva adds
 * them as custom fields on the installed entity rather than forking it —
 * they then persist, filter and export like any other company field.
 */
export const entities = [
  {
    id: 'customers:customer_company_profile',
    fields: [
      cf.text('th_tax_id', {
        label: 'เลขประจำตัวผู้เสียภาษี',
        description: 'เลข 13 หลักตามที่กรมสรรพากรออกให้ — ใช้ออกใบกำกับภาษี',
        filterable: true,
      }),
      cf.text('th_branch_code', {
        label: 'สาขา',
        description: 'ระบุ "สำนักงานใหญ่" หรือรหัสสาขา 5 หลัก เช่น 00001',
        filterable: true,
      }),
    ],
  },
]

export default entities
