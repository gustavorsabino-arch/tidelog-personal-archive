/**
 * GitHub Data Branch — Read/Write JSON cache files
 *
 * Uses GitHub Contents API for both reads and writes (works with private repos).
 */

import { revalidateTag } from 'next/cache.js'

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || ''
const GITHUB_OWNER = process.env.GITHUB_OWNER || ''
const GITHUB_REPO  = process.env.GITHUB_REPO  || ''
const DATA_BRANCH  = 'data'
const DATA_CACHE_TAG_PREFIX = 'github-data'

const API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`
const COMMITS_API_BASE = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits`

export type DataFileReadResult<T> =
  | { ok: true; found: true; data: T }
  | { ok: true; found: false; data: null }
  | { ok: false; found: false; error: string; status?: number }

export type DataDirListResult =
  | { ok: true; found: true; files: string[] }
  | { ok: true; found: false; files: [] }
  | { ok: false; found: false; error: string; status?: number }

export type DataFileHistoryEntry = {
  sha: string
  message: string
  committedAt: string | null
  authorName: string | null
}

function normalizeDataPath(path: string): string {
  return path
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/')
}

export function getDataFileCacheTag(path: string): string {
  return `${DATA_CACHE_TAG_PREFIX}:file:${normalizeDataPath(path)}`
}

export function getDataDirectoryCacheTag(dirPath: string): string {
  return `${DATA_CACHE_TAG_PREFIX}:dir:${normalizeDataPath(dirPath)}`
}

export function getDataPathRevalidationTags(path: string): string[] {
  const normalizedPath = normalizeDataPath(path)
  if (!normalizedPath) return []

  const tags = new Set<string>([getDataFileCacheTag(normalizedPath)])
  const segments = normalizedPath.split('/')

  for (let length = 1; length < segments.length; length += 1) {
    tags.add(getDataDirectoryCacheTag(segments.slice(0, length).join('/')))
  }

  return Array.from(tags)
}

function getDataFetchOptions(
  noCache: boolean,
  tags: readonly string[] = [],
): { cache: 'no-store' } | { next: { revalidate: number; tags?: string[] } } {
  if (noCache) {
    return { cache: 'no-store' }
  }

  return {
    next: {
      revalidate: 60,
      ...(tags.length > 0 ? { tags: [...tags] } : {}),
    },
  }
}

function invalidateDataPathCache(path: string) {
  for (const tag of getDataPathRevalidationTags(path)) {
    try {
      revalidateTag(tag, 'max')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown cache invalidation error'
      console.error(`[GitHub] Failed to revalidate cache tag ${tag}: ${message}`)
    }
  }
}

function getContentsHeaders(accept = 'application/vnd.github.v3+json') {
  return {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': accept,
  }
}

async function readDataFileFromRefStrict<T>(path: string, ref: string, noCache = false): Promise<DataFileReadResult<T>> {
  if (!GITHUB_TOKEN) {
    return { ok: false, found: false, error: 'GITHUB_TOKEN missing' }
  }

  try {
    const url = `${API_BASE}/${path}?ref=${encodeURIComponent(ref)}`
    const fetchOptions = {
      headers: getContentsHeaders(),
      ...getDataFetchOptions(noCache, ref === DATA_BRANCH ? [getDataFileCacheTag(path)] : []),
    }
    const res = await fetch(url, fetchOptions)

    if (res.status === 404) {
      return { ok: true, found: false, data: null }
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error(`[GitHub] Failed to read ${path} @ ${ref}: ${res.status}`, err.slice(0, 200))
      return {
        ok: false,
        found: false,
        error: `Failed to read ${path} @ ${ref}: ${res.status}`,
        status: res.status,
      }
    }

    const meta = await res.json()
    if (typeof meta?.content !== 'string') {
      console.error(`[GitHub] Invalid contents payload for ${path} @ ${ref}`)
      return { ok: false, found: false, error: `Invalid contents payload for ${path}` }
    }

    const needsRawFallback =
      meta?.encoding === 'none' ||
      (typeof meta?.size === 'number' && meta.size > 1024 * 1024) ||
      meta.content.length === 0

    const parseJson = (content: string): DataFileReadResult<T> => {
      try {
        return { ok: true, found: true, data: JSON.parse(content) as T }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error'
        console.error(`[GitHub] Failed to parse ${path} @ ${ref}:`, msg)
        return { ok: false, found: false, error: `Failed to parse ${path}: ${msg}` }
      }
    }

    if (needsRawFallback) {
      const rawRes = await fetch(url, {
        ...fetchOptions,
        headers: getContentsHeaders('application/vnd.github.raw+json'),
      })
      if (!rawRes.ok) {
        const err = await rawRes.text().catch(() => '')
        console.error(`[GitHub] Failed to read raw ${path} @ ${ref}: ${rawRes.status}`, err.slice(0, 200))
        return {
          ok: false,
          found: false,
          error: `Failed to read raw ${path}: ${rawRes.status}`,
          status: rawRes.status,
        }
      }
      return parseJson(await rawRes.text())
    }

    return parseJson(Buffer.from(meta.content, 'base64').toString('utf8'))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error(`[GitHub] Failed to read ${path} @ ${ref}:`, msg)
    return { ok: false, found: false, error: `Failed to read ${path}: ${msg}` }
  }
}

export async function readDataFileStrict<T>(path: string, noCache = false): Promise<DataFileReadResult<T>> {
  return readDataFileFromRefStrict(path, DATA_BRANCH, noCache)
}

export async function readDataFileAtRefStrict<T>(path: string, ref: string, noCache = false): Promise<DataFileReadResult<T>> {
  return readDataFileFromRefStrict(path, ref, noCache)
}

export async function listDataFilesStrict(dirPath: string, noCache = false): Promise<DataDirListResult> {
  if (!GITHUB_TOKEN) {
    return { ok: false, found: false, error: 'GITHUB_TOKEN missing' }
  }

  const apiUrl = `${API_BASE}/${dirPath}?ref=${DATA_BRANCH}`

  try {
    const res = await fetch(apiUrl, {
      headers: getContentsHeaders(),
      ...getDataFetchOptions(noCache, [getDataDirectoryCacheTag(dirPath)]),
    })

    if (res.status === 404) {
      return { ok: true, found: false, files: [] }
    }

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error(`[GitHub] Failed to list ${dirPath}: ${res.status}`, err.slice(0, 200))
      return {
        ok: false,
        found: false,
        error: `Failed to list ${dirPath}: ${res.status}`,
        status: res.status,
      }
    }

    const payload = await res.json()
    const items = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.entries)
        ? payload.entries
        : null
    if (!Array.isArray(items)) {
      return { ok: false, found: false, error: `Invalid directory payload for ${dirPath}` }
    }

    return {
      ok: true,
      found: true,
      files: items
        .map(item => item.name)
        .filter((name): name is string => typeof name === 'string' && name.endsWith('.json'))
        .sort(),
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error(`[GitHub] Failed to list ${dirPath}:`, msg)
    return { ok: false, found: false, error: `Failed to list ${dirPath}: ${msg}` }
  }
}

// ── Read a JSON file from the data branch ──────────────────────────
export async function readDataFile<T>(path: string, fallback: T, noCache = false): Promise<T> {
  const result = await readDataFileStrict<T>(path, noCache)
  if (!result.ok || !result.found) return fallback
  return result.data
}

// ── Write a JSON file to the data branch ────────────────────────────
export async function writeDataFile(path: string, data: unknown, message?: string): Promise<boolean> {
  if (!GITHUB_TOKEN) {
    console.error('[GitHub] No GITHUB_TOKEN — cannot write')
    return false
  }

  const apiUrl = `${API_BASE}/${path}`

  // Get current file SHA (needed for updates)
  let sha: string | undefined
  try {
    const existing = await fetch(`${apiUrl}?ref=${DATA_BRANCH}`, {
      headers: getContentsHeaders(),
      cache: 'no-store',
    })
    if (existing.ok) {
      const meta = await existing.json()
      sha = meta.sha
    }
  } catch { /* file doesn't exist yet */ }

  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64')
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      ...getContentsHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message || `update ${path}`,
      content,
      branch: DATA_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error(`[GitHub] Failed to write ${path}: ${res.status}`, err.slice(0, 200))
    return false
  }

  invalidateDataPathCache(path)
  return true
}

export async function deleteDataFile(path: string, message?: string): Promise<boolean> {
  if (!GITHUB_TOKEN) {
    console.error('[GitHub] No GITHUB_TOKEN — cannot delete')
    return false
  }

  const apiUrl = `${API_BASE}/${path}`
  let sha: string | undefined

  try {
    const existing = await fetch(`${apiUrl}?ref=${DATA_BRANCH}`, {
      headers: getContentsHeaders(),
      cache: 'no-store',
    })
    if (existing.status === 404) return true
    if (!existing.ok) {
      const err = await existing.text().catch(() => '')
      console.error(`[GitHub] Failed to read metadata for delete ${path}: ${existing.status}`, err.slice(0, 200))
      return false
    }
    const meta = await existing.json()
    sha = meta.sha
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error(`[GitHub] Failed to resolve ${path} before delete:`, msg)
    return false
  }

  if (!sha) return false

  const res = await fetch(apiUrl, {
    method: 'DELETE',
    headers: {
      ...getContentsHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message || `delete ${path}`,
      sha,
      branch: DATA_BRANCH,
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    console.error(`[GitHub] Failed to delete ${path}: ${res.status}`, err.slice(0, 200))
    return false
  }

  invalidateDataPathCache(path)
  return true
}

export async function listDataFileHistory(path: string, limit = 10): Promise<DataFileHistoryEntry[]> {
  if (!GITHUB_TOKEN) {
    console.error('[GitHub] No GITHUB_TOKEN — cannot read history')
    return []
  }

  try {
    const url = `${COMMITS_API_BASE}?sha=${encodeURIComponent(DATA_BRANCH)}&path=${encodeURIComponent(path)}&per_page=${limit}`
    const res = await fetch(url, {
      headers: getContentsHeaders(),
      cache: 'no-store',
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      console.error(`[GitHub] Failed to list history for ${path}: ${res.status}`, err.slice(0, 200))
      return []
    }

    const payload = await res.json()
    if (!Array.isArray(payload)) return []

    return payload.map((entry) => ({
      sha: typeof entry?.sha === 'string' ? entry.sha : '',
      message: typeof entry?.commit?.message === 'string' ? entry.commit.message : '',
      committedAt: typeof entry?.commit?.author?.date === 'string' ? entry.commit.author.date : null,
      authorName: typeof entry?.commit?.author?.name === 'string' ? entry.commit.author.name : null,
    })).filter((entry) => entry.sha)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    console.error(`[GitHub] Failed to list history for ${path}:`, msg)
    return []
  }
}

// ── List files in a directory on the data branch ────────────────────
export async function listDataFiles(dirPath: string): Promise<string[]> {
  const result = await listDataFilesStrict(dirPath)
  if (!result.ok || !result.found) return []
  return result.files
}

// ── Find the most recent file in a directory ────────────────────────
export async function getLatestDataFile<T>(dirPath: string, fallback: T): Promise<{ data: T; filename: string | null }> {
  const files = await listDataFiles(dirPath)
  if (!files.length) return { data: fallback, filename: null }

  // Files are named like YYYY-MM-DD.json — sort descending to get latest
  const sorted = files.sort().reverse()
  const data = await readDataFile<T>(`${dirPath}/${sorted[0]}`, fallback)
  return { data, filename: sorted[0] }
}
