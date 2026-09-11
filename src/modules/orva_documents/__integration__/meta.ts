/**
 * Integration coverage for ใบส่งของ (Track B) and โปรเจกต์ economics (H3).
 *
 * Needs `orva_documents` for the sheet and the delivery-facts route, the
 * installed `sales` module for the quote and the invoice, and — for the
 * hours-into-cost path — `orva_tasking` (the project), `orva_time` (its
 * timesheet mirror) and `staff` (the time entry). The runner skips the files
 * when any of them is missing.
 */
export const dependsOnModules = ['orva_documents', 'sales', 'customers', 'orva_tasking', 'orva_time', 'staff']

const meta = { dependsOnModules }

export default meta
