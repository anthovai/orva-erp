/**
 * Lead capture coverage needs the CRM it writes into, the notifications
 * module it raises through, and orva_finance because the home overview is
 * where an unanswered enquiry surfaces. The screens smoke walks every Orva
 * module's pages, so it needs them all registered; a trimmed install skips
 * this folder rather than failing on screens it does not have.
 */
export const dependsOnModules = [
  'orva', 'customers', 'notifications',
  'orva_documents', 'orva_finance', 'orva_hr', 'orva_mfa', 'orva_party', 'orva_purchasing',
  'orva_sso', 'orva_stock', 'orva_support', 'orva_tasking', 'orva_time',
]

const meta = { dependsOnModules }

export default meta
