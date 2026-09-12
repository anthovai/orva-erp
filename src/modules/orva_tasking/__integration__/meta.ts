/**
 * Integration coverage for tasking's own daily loop and its seams onto the
 * rest of the app.
 *
 * Seeding a project's tasks from its quotation reads the installed `sales`
 * tables through the project's own `quoteId`, and the fixture needs a
 * `customers` company to hang the quote on. The customer-visibility half of
 * the board spec signs in through `customer_accounts`. The runner skips the
 * files when any of them is missing.
 */
export const dependsOnModules = ['orva_tasking', 'sales', 'customers', 'customer_accounts']

const meta = { dependsOnModules }

export default meta
