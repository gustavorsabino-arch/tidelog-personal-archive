// Bun test preload hook — runs before any test file.
// Explicitly loads .env.local so integration tests that import lib/db
// have DATABASE_URL available at module-evaluation time. Also stubs out
// Next.js runtime-only modules (`server-only`, etc.) so we can import
// server route handlers directly from Bun tests.

import { readFileSync } from 'node:fs'
import { mock } from 'bun:test'

try {
  const content = readFileSync('.env.local', 'utf-8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch {
  // .env.local not present — tests that need env will fail with a clear message
}

// Next.js `server-only` package is a no-op marker at runtime but its
// package.json has a server-side enforcement that throws in browsers. For Bun
// tests we just need the import to resolve.
mock.module('server-only', () => ({}))
