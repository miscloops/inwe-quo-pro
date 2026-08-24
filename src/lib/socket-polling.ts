// Manual Socket.IO polling client — no socket.io-client dependency.
// Uses raw fetch() to implement the Socket.IO v4 Engine.IO polling handshake.
// Works on Cloudflare Workers (no WebSocket needed, no external packages).

const SOCKET_HOST = 'https://socket.inweapp.com'
const ROOM_ID = '42081'

interface PollResult {
  ok: boolean
  sid: string | null
  error?: string
}

/**
 * Step 1: GET /socket.io/?EIO=4&transport=polling
 * Returns the session ID (sid) for the polling connection.
 */
async function engineIoHandshake(): Promise<PollResult> {
  const res = await fetch(`${SOCKET_HOST}/socket.io/?EIO=4&transport=polling`, {
    headers: { 'Accept': '*/*' },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, sid: null, error: `Handshake HTTP ${res.status}: ${text.slice(0, 200)}` }
  }
  const text = await res.text()
  // Engine.IO v4 response format: "0{\"sid\":\"...\",\"upgrades\":[\"websocket\"],\"pingInterval\":25000,\"pingTimeout\":20000,\"maxPayload\":1000000}"
  const match = text.match(/"sid":"([^"]+)"/)
  if (!match) return { ok: false, sid: null, error: `No sid in handshake response: ${text.slice(0, 200)}` }
  return { ok: true, sid: match[1] }
}

/**
 * Step 2: POST the auth packet (connect with auth token).
 * Socket.IO v4 packet format: 40{"token":"..."} → 2 for engine.io upgrade, 40 for socket.io connect
 */
async function sendAuthPacket(sid: string, authToken: string): Promise<{ ok: boolean; error?: string }> {
  // Engine.IO packet type 2 (message) + Socket.IO packet type 0 (connect) with auth
  // Format: 40{"token":"<authToken>"}
  const packet = `40${JSON.stringify({ token: authToken })}`

  const res = await fetch(`${SOCKET_HOST}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: packet,
  })
  if (!res.ok) return { ok: false, error: `Auth POST HTTP ${res.status}` }
  return { ok: true }
}

/**
 * Step 3: Poll for the connect acknowledgment.
 */
async function pollForConnect(sid: string, timeoutMs = 5000): Promise<{ ok: boolean; error?: string }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${SOCKET_HOST}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
      headers: { 'Accept': '*/*' },
    })
    if (!res.ok) { await new Promise(r => setTimeout(r, 500)); continue }

    const text = await res.text()
    // Look for "40" (Socket.IO connect acknowledgment) or "40{...}" (with auth data)
    if (text.includes('40')) {
      return { ok: true }
    }
    // Look for error packets (44 = error, 4"..." = error message)
    if (text.startsWith('4') && text.length > 1) {
      const sub = text.substring(1, 2)
      if (sub === '4') {
        // 44 = error event
        return { ok: false, error: `Socket.IO connect error: ${text.slice(0, 200)}` }
      }
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return { ok: false, error: 'Connect poll timeout' }
}

/**
 * Step 4: Emit the join_room event and poll for the response.
 * Socket.IO event format: 42["join_room",{"room_id":"42081"}]
 */
async function emitJoinRoom(sid: string, timeoutMs = 8000): Promise<{ ok: boolean; error?: string; log: string[] }> {
  const logs: string[] = []
  // Socket.IO packet: 42[event_name, data]
  const packet = `42${JSON.stringify(['join_room', { room_id: ROOM_ID }])}`

  const res = await fetch(`${SOCKET_HOST}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: packet,
  })
  if (!res.ok) {
    return { ok: false, error: `Emit POST HTTP ${res.status}`, log: logs }
  }

  // Poll for the response
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const pollRes = await fetch(`${SOCKET_HOST}/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
      headers: { 'Accept': '*/*' },
    })
    if (!pollRes.ok) { await new Promise(r => setTimeout(r, 500)); continue }

    const text = await pollRes.text()

    // Look for error packet (44["error", {...}] or 4{...}error)
    if (text.includes('"JOIN_API_FAILED"') || text.includes('"Failed to join room')) {
      const errMatch = text.match(/"message":"([^"]+)"/)
      return { ok: false, error: errMatch?.[1] ?? 'Failed to join room via API', log: logs }
    }

    // Look for join_room broadcast (42["join_room",{...}])
    if (text.includes('"join_room"') && text.includes(ROOM_ID)) {
      logs.push(`Room join broadcast confirmed`)
      return { ok: true, log: logs }
    }

    // Look for server callback acknowledgment (451[...])
    if (text.startsWith('45') || text.startsWith('43')) {
      // 43 = ack, 451 = error ack
      if (text.includes('"error"') || text.includes('"success":false')) {
        const errMatch = text.match(/"message":"([^"]+)"/) || text.match(/"error":"([^"]+)"/)
        return { ok: false, error: errMatch?.[1] ?? text.slice(0, 200), log: logs }
      }
      // 43[...] = ack with data — success
      return { ok: true, log: logs }
    }

    await new Promise(r => setTimeout(r, 500))
  }

  // Timeout — but the emit was sent, the server might have processed it.
  // Return ok=true (optimistic) so we try sending the gift via REST.
  logs.push('Join callback timeout — proceeding optimistically')
  return { ok: true, log: logs }
}

/**
 * Full flow: handshake → auth → connect → join_room → disconnect.
 * Returns { ok, error, log }.
 */
export async function joinRoomViaPolling(
  username: string,
  authToken: string,
): Promise<{ ok: boolean; error?: string; log: { ts: string; kind: string; msg: string }[] }> {
  const logs: { ts: string; kind: string; msg: string }[] = []
  const botLog = (kind: string, msg: string) => logs.push({ ts: new Date().toLocaleTimeString(), kind, msg })

  try {
    // Step 1: Handshake
    botLog('info', `${username}: Socket.IO handshake...`)
    const handshake = await engineIoHandshake()
    if (!handshake.ok || !handshake.sid) {
      botLog('error', `${username}: handshake failed — ${handshake.error}`)
      return { ok: false, error: handshake.error, log: logs }
    }
    botLog('info', `${username}: handshake OK (sid=${handshake.sid.slice(0, 12)}...)`)

    // Step 2: Send auth packet
    botLog('info', `${username}: sending auth...`)
    const authResult = await sendAuthPacket(handshake.sid, authToken)
    if (!authResult.ok) {
      botLog('error', `${username}: auth failed — ${authResult.error}`)
      return { ok: false, error: authResult.error, log: logs }
    }

    // Step 3: Poll for connect ack
    botLog('info', `${username}: waiting for connect...`)
    const connectResult = await pollForConnect(handshake.sid, 5000)
    if (!connectResult.ok) {
      botLog('error', `${username}: connect failed — ${connectResult.error}`)
      return { ok: false, error: connectResult.error, log: logs }
    }
    botLog('success', `${username}: Socket.IO connected`)

    // Step 4: Emit join_room and wait for response
    botLog('info', `${username}: emitting join_room {room_id: "${ROOM_ID}"}...`)
    const joinResult = await emitJoinRoom(handshake.sid, 8000)
    for (const msg of joinResult.log) botLog('info', msg)

    if (!joinResult.ok) {
      botLog('error', `${username}: join_room failed — ${joinResult.error}`)
      return { ok: false, error: joinResult.error, log: logs }
    }
    botLog('success', `${username}: ✓ entered room "QUO PRO"`)

    return { ok: true, log: logs }
  } catch (e: any) {
    botLog('error', `${username}: exception — ${e?.message || String(e)}`)
    return { ok: false, error: e?.message || 'Unknown error', log: logs }
  }
}
