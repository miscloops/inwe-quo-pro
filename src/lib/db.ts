// Cloudflare D1 database access layer.
// Replaces the previous Prisma client. On Cloudflare Workers (via OpenNext /
// @cloudflare/next-on-pages), D1 is accessed through getRequestContext().env.DB.
//
// During local `bun run dev` (non-Cloudflare), we fall back to an in-memory
// Map so the app still runs for development/testing.

export interface InweSessionRow {
  id: string
  username: string
  cookie: string
  authToken: string | null
  level: number | null
  pointPct: number | null
  hoursLeft: number | null
  referred: number | null
  status: string
  lastChecked: string  // ISO string
  createdAt: string    // ISO string
}

export interface InweSessionInput {
  username: string
  cookie: string
  authToken?: string | null
  level?: number | null
  pointPct?: number | null
  hoursLeft?: number | null
  referred?: number | null
  status?: string
}

// ---- D1 binding access ----
// On Cloudflare Workers, getRequestContext() gives us the env bindings.
// We use a dynamic import to avoid breaking local dev where the package
// isn't installed.
async function getD1(): Promise<any | null> {
  try {
    // @ts-expect-error — this package only exists in the Cloudflare/OpenNext build
    const { getRequestContext } = await import('@cloudflare/next-on-pages')
    const ctx = getRequestContext()
    return (ctx.env as any).DB ?? null
  } catch {
    return null
  }
}

// ---- In-memory fallback for local dev ----
// IMPORTANT: Use globalThis so the Map is shared across all module instances
// (Next.js Turbopack dev mode can load different copies of this module for different routes).
const globalForDb = globalThis as unknown as { __inweMemStore?: Map<string, InweSessionRow>; __inweMemId?: number }
if (!globalForDb.__inweMemStore) globalForDb.__inweMemStore = new Map<string, InweSessionRow>()
if (!globalForDb.__inweMemId) globalForDb.__inweMemId = 0
const memStore = globalForDb.__inweMemStore
let memIdCounter = 0

function genId(): string {
  return `sess_${Date.now()}_${globalForDb.__inweMemId!++}`
}

// ---- Public API ----
export const db = {
  // ── User registration / login ──────────────────────────────────────
  async findUser(username: string): Promise<{ id: number; username: string; password_hash: string; created_at: string } | null> {
    const d1 = await getD1()
    if (d1) {
      const row = await d1.prepare('SELECT * FROM users WHERE username = ?').bind(username).first()
      return row || null
    }
    // Local dev fallback
    const session = memStore.get(username)
    if (session) {
      return { id: 0, username: session.username, password_hash: '', created_at: session.createdAt }
    }
    return null
  },

  async createUser(username: string, passwordHash: string): Promise<void> {
    const d1 = await getD1()
    if (d1) {
      await d1.prepare(
        'INSERT INTO users (username, password_hash) VALUES (?, ?)'
      ).bind(username, passwordHash).run()
    }
    // Local dev: nothing to persist
  },

  // ── Session management ─────────────────────────────────────────────
  async upsert(username: string, update: Partial<InweSessionInput>, create: InweSessionInput): Promise<InweSessionRow> {
    const d1 = await getD1()
    if (d1) {
      // Check existing
      const existing = await d1.prepare('SELECT * FROM InweSession WHERE username = ?').bind(username).first()
      if (existing) {
        await d1.prepare(
          `UPDATE InweSession SET cookie = ?, authToken = ?, status = ?, lastChecked = ?, level = ?, pointPct = ?, hoursLeft = ?, referred = ? WHERE username = ?`
        ).bind(
          update.cookie ?? existing.cookie,
          update.authToken ?? existing.authToken,
          update.status ?? existing.status,
          new Date().toISOString(),
          update.level ?? existing.level,
          update.pointPct ?? existing.pointPct,
          update.hoursLeft ?? existing.hoursLeft,
          update.referred ?? existing.referred,
          username
        ).run()
        return this.findUnique(username)!
      } else {
        const id = genId()
        await d1.prepare(
          `INSERT INTO InweSession (id, username, cookie, authToken, level, pointPct, hoursLeft, referred, status, lastChecked, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          id, create.username, create.cookie, create.authToken ?? null,
          create.level ?? null, create.pointPct ?? null, create.hoursLeft ?? null, create.referred ?? null,
          create.status ?? 'active', new Date().toISOString(), new Date().toISOString()
        ).run()
        return this.findUnique(username)!
      }
    } else {
      // In-memory fallback
      let row = memStore.get(username)
      if (row) {
        row = { ...row, ...update, lastChecked: new Date().toISOString() }
        memStore.set(username, row)
      } else {
        row = {
          id: genId(),
          username: create.username,
          cookie: create.cookie,
          authToken: create.authToken ?? null,
          level: create.level ?? null,
          pointPct: create.pointPct ?? null,
          hoursLeft: create.hoursLeft ?? null,
          referred: create.referred ?? null,
          status: create.status ?? 'active',
          lastChecked: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        }
        memStore.set(username, row)
      }
      return row
    }
  },

  async findUnique(username: string): Promise<InweSessionRow | null> {
    const d1 = await getD1()
    if (d1) {
      const row = await d1.prepare('SELECT * FROM InweSession WHERE username = ?').bind(username).first()
      return row as InweSessionRow | null
    }
    return memStore.get(username) ?? null
  },

  async findMany(usernames?: string[]): Promise<InweSessionRow[]> {
    const d1 = await getD1()
    if (d1) {
      if (usernames && usernames.length > 0) {
        const placeholders = usernames.map(() => '?').join(',')
        const result = await d1.prepare(`SELECT * FROM InweSession WHERE username IN (${placeholders})`).bind(...usernames).all()
        return result.results as InweSessionRow[]
      }
      const result = await d1.prepare('SELECT * FROM InweSession ORDER BY createdAt DESC').all()
      return result.results as InweSessionRow[]
    }
    let rows = Array.from(memStore.values())
    if (usernames) rows = rows.filter(r => usernames.includes(r.username))
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },

  async update(username: string, data: Partial<InweSessionInput>): Promise<void> {
    const d1 = await getD1()
    if (d1) {
      const sets: string[] = []
      const binds: any[] = []
      if (data.cookie !== undefined) { sets.push('cookie = ?'); binds.push(data.cookie) }
      if (data.authToken !== undefined) { sets.push('authToken = ?'); binds.push(data.authToken) }
      if (data.status !== undefined) { sets.push('status = ?'); binds.push(data.status) }
      if (data.level !== undefined) { sets.push('level = ?'); binds.push(data.level) }
      if (data.pointPct !== undefined) { sets.push('pointPct = ?'); binds.push(data.pointPct) }
      if (data.hoursLeft !== undefined) { sets.push('hoursLeft = ?'); binds.push(data.hoursLeft) }
      if (data.referred !== undefined) { sets.push('referred = ?'); binds.push(data.referred) }
      sets.push('lastChecked = ?'); binds.push(new Date().toISOString())
      binds.push(username)
      await d1.prepare(`UPDATE InweSession SET ${sets.join(', ')} WHERE username = ?`).bind(...binds).run()
    } else {
      const row = memStore.get(username)
      if (row) { memStore.set(username, { ...row, ...data, lastChecked: new Date().toISOString() }) }
    }
  },

  async deleteMany(usernames?: string[]): Promise<void> {
    const d1 = await getD1()
    if (d1) {
      if (usernames && usernames.length > 0) {
        const placeholders = usernames.map(() => '?').join(',')
        await d1.prepare(`DELETE FROM InweSession WHERE username IN (${placeholders})`).bind(...usernames).run()
      } else {
        await d1.prepare('DELETE FROM InweSession').run()
      }
    } else {
      if (usernames) {
        for (const u of usernames) memStore.delete(u)
      } else {
        memStore.clear()
      }
    }
  },
}
