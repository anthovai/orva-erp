/**
 * The payroll filings sit on top of four modules: `orva_hr` itself, the
 * installed `staff` registry an employee is a member of, `orva_finance` for
 * the posting accounts and the fiscal period, and `orva_documents` for the
 * employer identity the returns print. The runner skips the file when any of
 * them is missing.
 *
 * The figures come from the Rust payroll sidecar; when it is not running the
 * spec covers everything except the numbers and says so in its output.
 */
export const dependsOnModules = ['orva_hr', 'staff', 'orva_finance', 'orva_documents']

const meta = { dependsOnModules }

export default meta
