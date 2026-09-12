/**
 * Integration coverage for the vendor registry and the seam where it decides
 * whether money may be committed.
 *
 * Needs `orva_party` for the registry itself and `orva_purchasing` for the
 * question it exists to answer — a purchase order is the cheapest real write
 * that calls `assertVendorRole` — and `orva_finance` because the ephemeral
 * tenant has no chart of accounts until the fixture creates the expense
 * account an order line has to post against. The runner skips the files when
 * any of them is missing.
 */
export const dependsOnModules = ['orva_party', 'orva_purchasing', 'orva_finance']

const meta = { dependsOnModules }

export default meta
