/**
 * Lead capture coverage. Needs the CRM it writes into, the notifications
 * module it raises through, and orva_finance because the home overview is
 * where an unanswered enquiry surfaces.
 */
export const dependsOnModules = ['orva', 'customers', 'notifications', 'orva_finance']

const meta = { dependsOnModules }

export default meta
