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
    // Marventine (cosmetics): every product sold in Thailand carries an FDA
    // notification number (เลขที่ใบรับจดแจ้ง, 10 digits) that must appear on
    // the label; shelf life drives lot expiry when stock is received.
    id: 'catalog:catalog_product',
    fields: [
      cf.text('th_fda_notification', {
        label: 'เลขที่ใบรับจดแจ้ง (อย.)',
        description: 'เลข 10 หลักจากใบรับจดแจ้งเครื่องสำอาง — พิมพ์บนฉลากและเอกสารขาย',
        filterable: true,
      }),
      cf.integer('shelf_life_months', {
        label: 'อายุสินค้า (เดือน)',
        description: 'ใช้คำนวณวันหมดอายุของล็อตเมื่อรับเข้าคลัง',
      }),
      cf.select('product_brand', ['KKG', 'MRV'], {
        label: 'แบรนด์',
        description: 'KKG = Kaiser (บริการซอฟต์แวร์), MRV = Marventine (สินค้า)',
        filterable: true,
      }),
    ],
  },
  {
    // การตลาด: which channel brought the deal in. A one-person company can't
    // afford full UTM plumbing, but knowing ช่องทางที่มา per deal is enough
    // to see which channel actually converts. Thai values double as labels —
    // this is a Thai-only tenant and the value prints as entered.
    id: 'customers:customer_deal',
    fields: [
      cf.select(
        'lead_source',
        ['เพื่อนแนะนำ/ปากต่อปาก', 'ลูกค้าเก่า', 'Facebook', 'LINE', 'เว็บไซต์', 'อีเวนต์/ออกบูธ', 'อื่นๆ'],
        {
          label: 'ช่องทางที่มา',
          description: 'ลูกค้ารายนี้รู้จักเรามาจากช่องทางไหน — ใช้ดูว่าช่องทางใดปิดการขายได้จริง',
          filterable: true,
        },
      ),
    ],
  },
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
