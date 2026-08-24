// Safe HTTP/JSON utilities for Cloudflare Workers compatibility.
// Every upstream fetch response is read as text first, then JSON.parse'd
// safely. Plain-text errors like "error code: 1003" no longer crash the app.

export interface SafeJsonResult<T = any> {
  ok: boolean
  data: T | null
  text: string
  error?: string
}

/**
 * Read a fetch Response safely: always read text first, then try JSON.parse.
 * Returns { ok, data, text, error } — never throws on non-JSON bodies.
 */
export async function safeJson<T = any>(res: Response): Promise<SafeJsonResult<T>> {
  const text = await res.text().catch(() => '')
  if (!text) {
    return { ok: false, data: null, text: '', error: `HTTP ${res.status}: empty response body` }
  }
  try {
    const data = JSON.parse(text) as T
    return { ok: true, data, text }
  } catch {
    // Not JSON — return the raw text as the error, truncated to 300 chars
    const preview = text.slice(0, 300)
    return { ok: false, data: null, text, error: `HTTP ${res.status}: non-JSON response — ${preview}` }
  }
}

/**
 * Fetch a URL and return a safe JSON result. If the fetch itself fails
 * (network error, DNS failure, etc.), returns { ok: false, error }.
 */
export async function fetchSafeJson<T = any>(
  url: string,
  init?: RequestInit,
): Promise<{ res: Response; json: SafeJsonResult<T> }> {
  const res = await fetch(url, init)
  const json = await safeJson<T>(res)
  return { res, json }
}
