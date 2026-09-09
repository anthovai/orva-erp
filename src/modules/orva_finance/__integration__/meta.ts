/**
 * Integration coverage for the finance screens. The expenses screen posts a
 * journal and attaches a receipt, so it needs the GL it posts into and the
 * attachments module the image goes to.
 */
export const dependsOnModules = ['orva_finance', 'attachments']

const meta = { dependsOnModules }

export default meta
