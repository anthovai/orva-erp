/**
 * The broadcast is composed through the installed `messages` module and the
 * contacts live in the installed `customers` module (consent is a custom
 * field there, written by `entities`). The runner skips the file when any of
 * them is missing.
 */
export const dependsOnModules = ['orva_marketing', 'orva', 'messages', 'customers', 'entities']

const meta = { dependsOnModules }

export default meta
