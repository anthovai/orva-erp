/**
 * Integration coverage for the support inbox. The emailed reply travels
 * through the installed `messages` module, so it has to be registered too.
 */
export const dependsOnModules = ['orva_support', 'messages']

const meta = { dependsOnModules }

export default meta
