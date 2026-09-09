// Flat ESLint config for a standalone Open Mercato app.
// `next lint` was removed in Next 16, so `yarn lint` runs the ESLint CLI
// against this config instead.
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

const ignores = [
  'node_modules/**',
  '.next/**',
  '.mercato/**',
  // vendor/ holds submodules with their own repo, toolchain and lint rules
  // (KKG-Tasking is Go + Vue). Linting them here reports 34 errors that belong
  // to another project and cannot be fixed from this one.
  'vendor/**',
  '.ai/framework-context/**',
  // Playwright writes its HTML report and traces here on every failing
  // integration run. The bundle is minified vendor JS: linting it reports
  // ~180 rules-of-hooks errors that belong to Playwright's own UI, so a
  // failed test run would otherwise also fail `yarn lint`.
  '.ai/qa/test-results/**',
  'dist/**',
  'out/**',
  'build/**',
  'next-env.d.ts',
]

const ruleOverrides = {
  'react/display-name': 'off',
  'react-hooks/immutability': 'off',
  'react-hooks/preserve-manual-memoization': 'off',
  'react-hooks/purity': 'off',
  'react-hooks/refs': 'off',
  'react-hooks/set-state-in-effect': 'off',
  'react-hooks/static-components': 'off',
}

export default [
  ...nextCoreWebVitals,
  { ignores },
  { name: 'app/rule-overrides', rules: ruleOverrides },
]
