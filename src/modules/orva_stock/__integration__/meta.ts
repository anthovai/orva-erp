/**
 * The Marventine rehearsal touches every module in the goods cycle: the
 * installed catalog and WMS for the product and the lot, purchasing for the
 * order, stock for receipt/valuation/sale/COGS, finance for the accounts and
 * the home screen, party for the vendor, documents for the sheets. The runner
 * skips the file when any of them is missing.
 */
export const dependsOnModules = ['orva_stock', 'wms', 'catalog', 'orva_purchasing', 'orva_party', 'orva_finance', 'orva_documents']

const meta = { dependsOnModules }

export default meta
