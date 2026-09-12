/**
 * Integration coverage for the finance screens. The expenses screen posts a
 * journal and attaches a receipt, so it needs the GL it posts into and the
 * attachments module the image goes to. The home screen's work-vs-billing row
 * joins a quote to its tasks and its งวด, so it needs sales, customers,
 * orva_tasking and orva_documents as well.
 */
export const dependsOnModules = ['orva_finance', 'attachments', 'sales', 'customers', 'orva_tasking', 'orva_documents']

const meta = { dependsOnModules }

export default meta
