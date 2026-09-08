/** @type {import('jest').Config} */
// Unit-test config for a standalone Open Mercato app.
// Integration tests run through Playwright (`yarn test:integration:ephemeral`)
// and are excluded here.
// `create-mercato-app` skips `__tests__`/`__integration__` while copying the
// template, so a freshly scaffolded app owns no test files until you write one.
module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  passWithNoTests: true,
  rootDir: '.',
  roots: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/\\.mercato/(.*)$': '<rootDir>/.mercato/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^#generated/(.*)$': '<rootDir>/.mercato/generated/$1',
  },
  // `@open-mercato/shared/lib/commands` pulls in ESM-only MikroORM, whose
  // `import.meta.resolve` cannot be parsed as CommonJS. The local transformer
  // strips those usages before delegating to ts-jest; without it every command,
  // entity, or data-engine test fails to load.
  transform: {
    '^.+\\.(t|j)sx?$': [
      '<rootDir>/scripts/jest-mikroorm-transformer.cjs',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
          isolatedModules: true,
        },
        diagnostics: false,
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!(@open-mercato|@mikro-orm|@tanstack/react-table|@tanstack/table-core|@tanstack/react-store|@tanstack/store)/)'],
  // `__integration__` holds Playwright specs run by `yarn test:integration:ephemeral`
  // against a built app. Jest would load them, fail on @playwright/test's
  // runner globals, and report two broken suites next to a green unit run —
  // which is how the first integration suite in this repo went unnoticed for
  // one commit.
  testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.mercato/', '/.ai/qa/', '/__integration__/'],
}
