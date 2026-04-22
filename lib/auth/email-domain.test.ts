import { test, expect } from 'bun:test'
import { isEmailDomainAllowed, parseAllowedDomains } from './email-domain'

test('empty allowlist permits any email (check disabled)', () => {
  expect(isEmailDomainAllowed('anyone@anywhere.com', [])).toBe(true)
})

test('email on allowed domain passes', () => {
  expect(isEmailDomainAllowed('alice@orca.so', ['orca.so'])).toBe(true)
})

test('email on disallowed domain fails', () => {
  expect(isEmailDomainAllowed('alice@evil.com', ['orca.so'])).toBe(false)
})

test('domain match is case-insensitive', () => {
  expect(isEmailDomainAllowed('Alice@Orca.SO', ['orca.so'])).toBe(true)
  expect(isEmailDomainAllowed('alice@orca.so', ['ORCA.SO'])).toBe(true)
})

test('supports multiple allowed domains', () => {
  expect(isEmailDomainAllowed('x@partner.io', ['orca.so', 'partner.io'])).toBe(true)
  expect(isEmailDomainAllowed('x@other.io', ['orca.so', 'partner.io'])).toBe(false)
})

test('subdomains are not allowed unless explicitly listed', () => {
  expect(isEmailDomainAllowed('x@sub.orca.so', ['orca.so'])).toBe(false)
  expect(isEmailDomainAllowed('x@sub.orca.so', ['sub.orca.so'])).toBe(true)
})

test('malformed email (no @) fails', () => {
  expect(isEmailDomainAllowed('not-an-email', ['orca.so'])).toBe(false)
})

test('parseAllowedDomains handles undefined/empty', () => {
  expect(parseAllowedDomains(undefined)).toEqual([])
  expect(parseAllowedDomains('')).toEqual([])
})

test('parseAllowedDomains trims, lowercases, and filters blanks', () => {
  expect(parseAllowedDomains(' Orca.so , ,partner.IO ')).toEqual(['orca.so', 'partner.io'])
})
