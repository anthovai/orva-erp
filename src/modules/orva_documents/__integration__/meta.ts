/**
 * Integration coverage for ใบส่งของ (Track B).
 *
 * Needs `orva_documents` for the sheet and the delivery-facts route, and the
 * installed `sales` module for the invoice the note prints from. The runner
 * skips the file when either is missing.
 */
export const dependsOnModules = ['orva_documents', 'sales']

const meta = { dependsOnModules }

export default meta
