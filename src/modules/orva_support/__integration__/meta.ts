/**
 * Integration coverage for the support inbox (G2), the knowledge base and
 * retainer invoicing (H4).
 *
 * The emailed reply travels through the installed `messages` module; the
 * retainer's invoice goes through `orva_documents` onto the installed `sales`
 * tables, against a `customers` contact. The runner skips the files when any
 * of them is missing.
 */
export const dependsOnModules = ['orva_support', 'messages', 'orva_documents', 'sales', 'customers']

const meta = { dependsOnModules }

export default meta
