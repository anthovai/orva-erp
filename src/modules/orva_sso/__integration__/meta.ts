/**
 * Integration coverage for the SSO login doors.
 *
 * Needs only `orva_sso` itself: every path exercised here is reached before
 * the token exchange, so no identity provider is involved and none is faked.
 * The runner skips the file when the module is missing.
 */
export const dependsOnModules = ['orva_sso']

const meta = { dependsOnModules }

export default meta
