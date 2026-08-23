// Inwe Gift Bot — Socket.IO mini-service for chat.inweapp.com
//
// Connects each logged-in user to socket.inweapp.com using their JWT auth-token,
// joins room 42081 ("QUO PRO"), and sends /gift messages to other logged-in users
// round-robin until each reaches 99% level progress.
//
// Port: 3001 (internal). The Next.js frontend talks to this via the gateway's
// XTransformPort query param.
//
// REST endpoints (called by the Next.js panel):
//   POST /start   { usernames: string[], sender: string, gifts: [{id,name,price}] }
//     → { ok: true, status: 'joined'|'failed', message: string, joined: string[], failed: string[] }
//   POST /stop    {} → { ok: true }
//   POST /status  {} → { running: boolean, joined: string[], failed: string[], log: [...] }

import { createServer } from 'http'
import { io as clientIo } from 'socket.io-client'

const PORT = 3001
const INWE_SOCKET_HOST = 'https://socket.inweapp.com'
const ROOM_ID = '42081'
const ROOM_NAME = 'QUO PRO'
const GUARD_THRESHOLD = 99
const GIFT_INTERVAL_MS = 4000  // 4s between gifts — slower than 2s to avoid inweapp flooding detection

// In-memory state — single gift-bot instance per panel
const state = {
  running: false,
  // Each connected client: { socket, username, joined }
  clients: new Map<string, { socket: any; username: string; joined: boolean; failed: boolean }>(),
  joined: [] as string[],
  failed: [] as string[],
  log: [] as { ts: string; kind: string; msg: string }[],
  // Bot loop state
  giftQueue: [] as { id: string; name: string; price: number }[],
  sender: '' as string,
  usernames: [] as string[],
  loopHandle: null as any,
  consecutiveFailures: 0,
}

function log(kind: string, msg: string) {
  const entry = { ts: new Date().toLocaleTimeString(), kind, msg }
  state.log.push(entry)
  if (state.log.length > 200) state.log.shift()
  console.log(`[${entry.ts}] [${kind}] ${msg}`)
}

// Connect one user to socket.inweapp.com and join room 42081.
// Returns { ok: true } on success, { ok: false, error } on failure.
async function connectAndJoin(username: string, authToken: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false
    const finish = (ok: boolean, error?: string) => {
      if (resolved) return
      resolved = true
      resolve({ ok, error })
    }

    try {
      const socket = clientIo(INWE_SOCKET_HOST, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        auth: { token: authToken },
        timeout: 10000,
      })

      // Connection timeout
      const connectTimer = setTimeout(() => {
        finish(false, 'Connection timeout (10s)')
        socket.disconnect()
      }, 10000)

      socket.on('connect', () => {
        clearTimeout(connectTimer)
        log('info', `${username}: socket connected (id=${socket.id})`)

        // Log every event from the server so we can see what inweapp actually sends
        // (one-shot debug listener — removed after 30s to avoid spam)
        const debugListener = (event: string, ...args: any[]) => {
          // Skip noisy events we already handle
          if (['join_room', 'disconnect', 'connect_error'].includes(event)) return
          if (event === 'typing' || event === 'message_delivered' || event === 'message_read') return
          const preview = JSON.stringify(args).slice(0, 200)
          log('info', `${username}: ← event "${event}" ${preview}`)
        }
        socket.onAny(debugListener)
        setTimeout(() => socket.offAny(debugListener), 30_000)

        // Listen for the server's 'error' event — inweapp sends this when join_room fails
        // Example payload: {"message":"Failed to join room via API","code":"JOIN_API_FAILED"}
        socket.on('error', (err: any) => {
          log('error', `${username}: ← server error: ${JSON.stringify(err).slice(0, 200)}`)
          if (err && (err.code === 'JOIN_API_FAILED' || (err.message && err.message.toLowerCase().includes('join')))) {
            finish(false, err.message || 'Failed to join chatroom (server error event)')
          }
        })

        // Emit join_room for room 42081
        log('info', `${username}: → emitting join_room {room_id: "${ROOM_ID}"}`)
        socket.emit('join_room', { room_id: ROOM_ID }, (response: any) => {
          log('info', `${username}: ← join_room callback response: ${JSON.stringify(response).slice(0, 200)}`)
          if (response && response.error) {
            log('error', `${username}: join_room error: ${response.error}`)
            finish(false, response.error)
            return
          }
          if (response && response.success === false) {
            log('error', `${username}: join_room failed: ${response.message || 'unknown'}`)
            finish(false, response.message || 'Failed to join chatroom')
            return
          }
          log('success', `${username}: ✓ entered room "${ROOM_NAME}" (server confirmed via callback)`)
          state.clients.set(username, { socket, username, joined: true, failed: false })
          finish(true)
        })

        // Listen for the join_room broadcast event — inweapp broadcasts this when
        // a user actually appears in the room (visible to other room members).
        socket.on('join_room', (payload: any) => {
          log('info', `${username}: ← join_room broadcast: ${JSON.stringify(payload).slice(0, 200)}`)
          if (payload && payload.room_id && payload.room_id.toString() === ROOM_ID) {
            log('success', `${username}: ✓ room join broadcast confirmed (room "${payload.room?.name ?? ROOM_NAME}")`)
            if (!state.clients.has(username)) {
              state.clients.set(username, { socket, username, joined: true, failed: false })
              finish(true)
            }
          }
        })

        // Listen for new_message broadcasts — when the server echoes back a message
        // we just sent, it confirms the gift was actually delivered to the room.
        socket.on('new_message', (payload: any) => {
          // Only log messages from us (the sender)
          const senderId = payload?.sender_id || payload?.user_id || payload?.sender?.id
          if (senderId && payload?.message?.includes('/gift')) {
            log('success', `${username}: ✓ GIFT APPEARED IN ROOM: ${payload.message.slice(0, 80)}`)
          }
        })

        // Fallback: if the join_room callback doesn't fire within 8s, mark as failed.
        // (inweapp sends an 'error' event with code JOIN_API_FAILED when the join fails,
        // so we should already have finished by then. This timeout is the last resort.)
        setTimeout(() => {
          if (!resolved) {
            finish(false, 'Failed to enter chatroom (no response from server — session may be expired, click Start to re-login)')
          }
        }, 8000)
      })

      socket.on('connect_error', (err: any) => {
        clearTimeout(connectTimer)
        log('error', `${username}: connect_error: ${err.message || err}`)
        finish(false, err.message || 'Connection failed')
      })

      socket.on('disconnect', (reason: any) => {
        log('info', `${username}: socket disconnected: ${reason}`)
      })
    } catch (e: any) {
      finish(false, e?.message || 'Unknown error during socket connect')
    }
  })
}

// Send a /gift message via the REST /send_message API (more reliable than socket).
// Uses the sender's stored session cookie + CSRF token.
async function sendGiftViaRestApi(sender: string, giftName: string, recipientUsername: string): Promise<{ ok: boolean; error?: string }> {
  // Fetch the sender's session from the Next.js API (which has access to the DB)
  // We call back into the Next.js app to get the cookie + CSRF.
  const giftText = `/gift ${recipientUsername} ${giftName}`
  try {
    const r = await fetch('http://localhost:3000/api/inwe/send-gift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'send_message',
        username: sender,
        roomId: ROOM_ID,
        message: giftText,
        type: 'gift',
        mentionedUsersIds: [recipientUsername],
      }),
    })
    const j = await r.json()
    if (!r.ok || !j.ok) {
      return { ok: false, error: j.error || 'REST API send failed' }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'REST API error' }
  }
}

// Send a /gift message to the room as the sender.
// The correct inwe command format is: /gift <recipient_username> <gift_name>
// Example: /gift mindstorm neko
//
// We try TWO methods:
//   1. Socket.IO 'send_message_to_room' (with the exact payload shape from the inweapp JS bundle)
//   2. REST API POST /send_message (more reliable — used as fallback if socket doesn't ack)
async function sendGiftAs(sender: string, giftName: string, recipientUsername: string): Promise<{ ok: boolean; error?: string }> {
  const client = state.clients.get(sender)

  // The /gift chat command — message text the user would type in the chat input.
  const giftText = `/gift ${recipientUsername} ${giftName}`

  // Method 1: Socket.IO send_message_to_room (the primary path)
  // We race it against a 3s timeout — if the server doesn't ack, we fall back to REST.
  if (client && client.socket && client.joined) {
    const socketResult = await new Promise<{ ok: boolean; error?: string; via: 'socket' | 'timeout' }>((resolve) => {
      let resolved = false
      const finish = (ok: boolean, error?: string, via: 'socket' | 'timeout' = 'socket') => {
        if (resolved) return
        resolved = true
        resolve({ ok, error, via })
      }

      try {
        // Match the EXACT payload shape from the inweapp JS bundle:
        //   { room_id, message, type, category, mentionedUsersIds, to_reply, base64_file, file_name }
        // Note: there's NO 'id' field in the socket path (only in the REST path).
        // type='gift' is detected by the server parsing the "/gift" prefix.
        client.socket.emit(
          'send_message_to_room',
          {
            room_id: ROOM_ID,
            message: giftText,
            type: 'gift',
            category: undefined,  // explicitly undefined — bundle passes t.category which is undefined for normal messages
            mentionedUsersIds: [recipientUsername],
            to_reply: null,
            base64_file: null,
            file_name: null,
          },
          (response: any) => {
            log('info', `${sender}: ← socket send_message_to_room callback: ${JSON.stringify(response).slice(0, 300)}`)
            if (response && response.error) {
              finish(false, response.error)
              return
            }
            if (response && response.success === false) {
              finish(false, response.message || 'send failed')
              return
            }
            finish(true)
          }
        )

        // 3s timeout — if no ack, fall back to REST
        setTimeout(() => finish(false, 'socket timeout (no ack)', 'timeout'), 3000)
      } catch (e: any) {
        finish(false, e?.message || 'socket error')
      }
    })

    if (socketResult.ok) {
      return { ok: true }
    }
    // If socket failed (incl. timeout), fall through to REST
    log('info', `${sender}: socket send failed (${socketResult.error}), falling back to REST /send_message`)
  } else {
    log('info', `${sender}: not joined via socket, using REST /send_message directly`)
  }

  // Method 2: REST API fallback
  return sendGiftViaRestApi(sender, giftName, recipientUsername)
}

// The main gifting loop — round-robin send gifts from queue to recipients
async function giftingLoop() {
  if (!state.running) return

  const recipients = state.usernames.filter((u) => u !== state.sender)
  if (recipients.length === 0) {
    log('error', 'No recipients — stopping')
    state.running = false
    return
  }

  if (state.giftQueue.length === 0) {
    log('error', 'Gift queue empty — stopping')
    state.running = false
    return
  }

  // Pick next recipient (round-robin)
  // We use a state on the loop to track current recipient index
  if (!(giftingLoop as any)._idx) (giftingLoop as any)._idx = 0
  if (!(giftingLoop as any)._giftIdx) (giftingLoop as any)._giftIdx = 0
  const idx = (giftingLoop as any)._idx
  const giftIdx = (giftingLoop as any)._giftIdx
  ;(giftingLoop as any)._idx = (idx + 1) % recipients.length
  ;(giftingLoop as any)._giftIdx = (giftIdx + 1) % state.giftQueue.length

  const recipient = recipients[idx % recipients.length]
  const gift = state.giftQueue[giftIdx % state.giftQueue.length]

  // Send the gift
  log('info', `→ ${state.sender} sending: /gift ${recipient} ${gift.name}`)
  const result = await sendGiftAs(state.sender, gift.name, recipient)
  if (result.ok) {
    log('success', `✓ ${gift.name} sent to ${recipient}`)
    state.consecutiveFailures = 0
  } else {
    log('error', `✗ Failed to send to ${recipient}: ${result.error}`)
    state.consecutiveFailures++
    if (state.consecutiveFailures >= 3) {
      log('error', '3 consecutive failures — stopping bot')
      state.running = false
      return
    }
  }

  // Schedule next iteration (4s pause between sends — avoids inweapp flooding detection)
  if (state.running) {
    state.loopHandle = setTimeout(() => { giftingLoop().catch(console.error) }, GIFT_INTERVAL_MS)
  }
}

// HTTP server — receives start/stop/status from the Next.js panel
const httpServer = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }

  // CORS preflight
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.statusCode = 405; res.end(JSON.stringify({ error: 'method not allowed' })); return
  }

  // Parse body
  let body: any = {}
  if (req.method === 'POST') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { body = {} }
  }

  const url = req.url || ''

  // POST /start — start the bot
  if (url === '/start' && req.method === 'POST') {
    const { sessions, sender, gifts } = body as {
      sessions: { username: string; authToken: string }[]
      sender: string
      gifts: { id: string; name: string; price: number }[]
    }

    if (!sessions?.length || !sender || !gifts?.length) {
      res.statusCode = 400
      res.end(JSON.stringify({ ok: false, error: 'sessions, sender, gifts required' }))
      return
    }

    if (state.running) {
      res.statusCode = 409
      res.end(JSON.stringify({ ok: false, error: 'Bot already running' }))
      return
    }

    // Reset state
    state.running = false
    state.clients.clear()
    state.joined = []
    state.failed = []
    state.log = []
    state.giftQueue = gifts
    state.sender = sender
    state.usernames = sessions.map((s) => s.username)
    state.consecutiveFailures = 0
    ;(giftingLoop as any)._idx = 0
    ;(giftingLoop as any)._giftIdx = 0

    log('info', `▶ Starting gift bot — sender: ${sender}, recipients: ${state.usernames.filter(u => u !== sender).join(', ')}, gifts: ${gifts.length}, room: "${ROOM_NAME}" (${ROOM_ID})`)

    // Connect all users in parallel
    const connectResults = await Promise.all(
      sessions.map(async (s) => {
        const result = await connectAndJoin(s.username, s.authToken)
        if (result.ok) {
          state.joined.push(s.username)
        } else {
          state.failed.push(s.username)
          log('error', `${s.username}: FAILED to enter chatroom — ${result.error}`)
        }
        return { username: s.username, ok: result.ok, error: result.error }
      })
    )

    // Determine status — sender must have joined successfully
    const senderJoined = state.joined.includes(sender)
    const status = senderJoined ? 'joined' : 'failed'
    const message = senderJoined
      ? `Entered to Quo Pro.. and gifting started`
      : `Failed to enter chatroom`

    if (!senderJoined) {
      log('error', `Sender "${sender}" failed to join — cannot start gifting`)
      res.end(JSON.stringify({ ok: true, status, message, joined: state.joined, failed: state.failed, log: state.log }))
      return
    }

    // If at least the sender joined, start the gifting loop
    state.running = true
    log('success', `✓ Bot active — sender "${sender}" entered QUO PRO, gifting started`)
    res.end(JSON.stringify({ ok: true, status, message, joined: state.joined, failed: state.failed, log: state.log }))

    // Kick off the loop after responding
    state.loopHandle = setTimeout(() => { giftingLoop().catch(console.error) }, 1000)
    return
  }

  // POST /stop — stop the bot
  if (url === '/stop' && req.method === 'POST') {
    state.running = false
    if (state.loopHandle) clearTimeout(state.loopHandle)
    // Disconnect all clients
    for (const [, c] of state.clients) {
      try { c.socket.disconnect() } catch {}
    }
    state.clients.clear()
    log('info', '■ Bot stopped')
    res.end(JSON.stringify({ ok: true }))
    return
  }

  // GET /status — current bot state
  if (url === '/status' && req.method === 'GET') {
    res.end(JSON.stringify({
      ok: true,
      running: state.running,
      joined: state.joined,
      failed: state.failed,
      log: state.log.slice(-50),  // last 50 entries
    }))
    return
  }

  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})

httpServer.listen(PORT, () => {
  console.log(`[inwe-gift-bot] listening on http://localhost:${PORT}`)
  console.log(`[inwe-gift-bot] target room: "${ROOM_NAME}" (${ROOM_ID})`)
})

// Handle shutdown
process.on('SIGTERM', () => {
  state.running = false
  if (state.loopHandle) clearTimeout(state.loopHandle)
  for (const [, c] of state.clients) { try { c.socket.disconnect() } catch {} }
  httpServer.close()
})
