/**
 * Integration coverage for ใบสั่งซื้อ.
 *
 * These specs need purchasing itself plus the three modules it orchestrates:
 * `orva_party` for the vendor, `orva_finance` for the GL account a line posts
 * to, and `orva_stock`/`wms` for the goods half of a receipt. The runner skips
 * the file when any of them is not registered, so a trimmed install does not
 * fail on tests for capabilities it does not have.
 */
export const dependsOnModules = ['orva_purchasing', 'orva_party', 'orva_finance', 'orva_stock', 'wms']

const meta = { dependsOnModules }

export default meta
