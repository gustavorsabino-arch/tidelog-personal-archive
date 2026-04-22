import { defineConfig } from 'drizzle-kit'
import { readFileSync } from 'node:fs'

// Explicitly load .env.local so drizzle-kit picks up DATABASE_URL even when
// it's spawned as a child process that doesn't inherit Bun's auto env loading.
try {
  const content = readFileSync('.env.local', 'utf-8')
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) {
      // Strip surrounding quotes if present
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
} catch {
  // .env.local not present or unreadable — fall through to process.env
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema/index.ts',
  out: './lib/db/migrations',
  dbCredentials: {
    url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
})
