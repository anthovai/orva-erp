/**
 * Integration coverage for tasking's seams onto the rest of the app.
 *
 * Seeding a project's tasks from its quotation reads the installed `sales`
 * tables through the project's own `quoteId`, and the fixture needs a
 * `customers` company to hang the quote on. The runner skips the files when
 * any of them is missing.
 */
export const dependsOnModules = ['orva_tasking', 'sales', 'customers']

const meta = { dependsOnModules }

export default meta
