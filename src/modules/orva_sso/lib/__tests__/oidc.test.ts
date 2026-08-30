import { describe, expect, test } from '@jest/globals'
import { createHash } from 'node:crypto'
import {
  buildAuthorizeUrl,
  constantTimeEquals,
  domainsMatchEmail,
  extractEmailDomain,
  generatePkcePair,
  generateStateToken,
  sanitizeRedirectPath,
} from '../oidc'
import { normalizeEmailDomains } from '../../data/validators'

describe('email domain matching', () => {
  test('extracts and lowercases the domain', () => {
    expect(extractEmailDomain('User@ACME.Co.TH')).toBe('acme.co.th')
    expect(extractEmailDomain('no-at-sign')).toBeNull()
    expect(extractEmailDomain('trailing@')).toBeNull()
  })
  test('matches against the stored comma-separated list', () => {
    expect(domainsMatchEmail('acme.co.th,acme.com', 'a@acme.com')).toBe(true)
    expect(domainsMatchEmail('acme.co.th, acme.com', 'a@ACME.CO.TH')).toBe(true)
    expect(domainsMatchEmail('acme.com', 'a@evil-acme.com')).toBe(false)
    expect(domainsMatchEmail('', 'a@acme.com')).toBe(false)
  })
  test('normalizeEmailDomains lowercases, trims, strips @, dedupes', () => {
    expect(normalizeEmailDomains(' @Acme.COM, acme.com , acme.co.th ')).toBe('acme.com,acme.co.th')
  })
})

describe('pkce', () => {
  test('challenge is the S256 of the verifier, base64url', () => {
    const { verifier, challenge } = generatePkcePair()
    const expected = createHash('sha256').update(verifier).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
    expect(challenge).toBe(expected)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,}$/)
  })
  test('state tokens are unique and url-safe', () => {
    const one = generateStateToken()
    expect(one).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(generateStateToken()).not.toBe(one)
  })
})

describe('authorize url', () => {
  test('carries all code-flow parameters', () => {
    const url = new URL(buildAuthorizeUrl({
      discovery: {
        issuer: 'https://idp.example',
        authorization_endpoint: 'https://idp.example/authorize',
        token_endpoint: 'https://idp.example/token',
        jwks_uri: 'https://idp.example/jwks',
      },
      clientId: 'orva',
      redirectUri: 'https://app.orva.co/api/orva_sso/callback',
      state: 's1',
      nonce: 'n1',
      codeChallenge: 'c1',
    }))
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('state')).toBe('s1')
    expect(url.searchParams.get('nonce')).toBe('n1')
    expect(url.searchParams.get('scope')).toBe('openid email profile')
  })
})

describe('guards', () => {
  test('constantTimeEquals', () => {
    expect(constantTimeEquals('abc', 'abc')).toBe(true)
    expect(constantTimeEquals('abc', 'abd')).toBe(false)
    expect(constantTimeEquals('abc', 'ab')).toBe(false)
  })
  test('sanitizeRedirectPath rejects external and protocol-relative targets', () => {
    expect(sanitizeRedirectPath('/backend/gl')).toBe('/backend/gl')
    expect(sanitizeRedirectPath('https://evil.example')).toBe('/backend')
    expect(sanitizeRedirectPath('//evil.example')).toBe('/backend')
    expect(sanitizeRedirectPath(undefined)).toBe('/backend')
  })
})
