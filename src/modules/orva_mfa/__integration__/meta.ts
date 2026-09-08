/**
 * MFA enrollment coverage. Only needs the module itself: enrollment writes one
 * credential row and reads nothing from another module.
 */
export const dependsOnModules = ['orva_mfa']

const meta = { dependsOnModules }

export default meta
