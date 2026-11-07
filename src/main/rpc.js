// discord rich presence: "Watching YouTube" on Flow Browser.
// talks to the discord app over its local pipe, no extra packages.
const net = require('net')
const path = require('path')

let sock = null
let ready = false
let appId = ''
let enabled = false
let showTitles = true
let pending = null
let lastSent = ''
let lastSendTime = 0
let sendTimer = null
let reconnectTimer = null
let started = { key: '', time: Date.now() }

// what to say for well known sites. anything else is "Browsing <site>"
const SITES = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'Watching YouTube', 3, t => t.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '')],
  [/(^|\.)twitch\.tv$/, 'Watching Twitch', 3, t => t.replace(/ - Twitch$/, '')],
  [/(^|\.)netflix\.com$/, 'Watching Netflix', 3, () => ''],
  [/(^|\.)disneyplus\.com$/, 'Watching Disney+', 3, () => ''],
  [/(^|\.)crunchyroll\.com$/, 'Watching Crunchyroll', 3, t => t.replace(/ - Watch on Crunchyroll$/, '')],
  [/(^|\.)kick\.com$/, 'Watching Kick', 3, t => t],
  [/(^|\.)music\.youtube\.com$/, 'Listening on YouTube Music', 2, t => t.replace(/ - YouTube Music$/, '')],
  [/(^|\.)open\.spotify\.com$/, 'Listening on Spotify', 2, t => t.replace(/ \| Spotify$/, '')],
  [/(^|\.)soundcloud\.com$/, 'Listening on SoundCloud', 2, t => t.replace(/ \| Listen online.*$/, '')],
  [/(^|\.)discord\.com$/, 'Chatting on Discord', 0, () => ''],
  [/(^|\.)reddit\.com$/, 'Scrolling Reddit', 0, t => t.replace(/ : r\/.*$/, '')],
  [/(^|\.)x\.com$|(^|\.)twitter\.com$/, 'Scrolling X', 0, () => ''],
  [/(^|\.)instagram\.com$/, 'Scrolling Instagram', 0, () => ''],
  [/(^|\.)tiktok\.com$/, 'Watching TikTok', 3, () => ''],
  [/(^|\.)github\.com$/, 'Coding on GitHub', 0, t => t.replace(/^GitHub - /, '')],
  [/(^|\.)stackoverflow\.com$/, 'Stuck on Stack Overflow', 0, t => t.replace(/ - Stack Overflow$/, '')],
  [/(^|\.)roblox\.com$/, 'Browsing Roblox', 0, t => t.replace(/ - Roblox$/, '')],
  [/(^|\.)wikipedia\.org$/, 'Reading Wikipedia', 0, t => t.replace(/ - Wikipedia$/, '')],
  [/(^|\.)claude\.ai$/, 'Talking to Claude', 0, () => ''],
  [/(^|\.)chatgpt\.com$/, 'Talking to ChatGPT', 0, () => ''],
  [/(^|\.)amazon\.[a-z.]+$/, 'Shopping on Amazon', 0, () => '']
]

function describe(tab) {
  if (!tab || !tab.url) return null
  if (tab.private) return { details: 'Browsing privately', type: 0, key: 'private' }
  const url = tab.url
  if (url.startsWith('flow://newtab')) return { details: 'On the new tab page', type: 0, key: 'newtab' }
  if (url.startsWith('flow://search')) {
    let q = ''
    try { q = new URL(url).searchParams.get('q') || '' } catch {}
    return { details: 'Searching with Flow Search', state: showTitles && q ? `"${q.slice(0, 100)}"` : '', type: 0, key: 'search' }
  }
  if (url.startsWith('flow://')) return { details: 'Changing settings', type: 0, key: 'flow' }
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { return null }
  for (const [re, text, type, clean] of SITES) {
    if (re.test(host)) {
      const title = showTitles ? clean(tab.title || '').trim() : ''
      return { details: text, state: title && title !== host ? title.slice(0, 120) : '', type, key: text }
    }
  }
  return { details: `Browsing ${host}`, state: '', type: 0, key: host }
}

// ---------------------------------------------------------------- pipe

function frame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload))
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

function pipePath(i) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp'
  return path.join(base, `discord-ipc-${i}`)
}

// discord, ptb and canary each have their own pipe number. some may be open but logged out, so try them all
function connect(i = 0) {
  if (!enabled || !appId || sock) return
  if (i > 9) return scheduleReconnect()
  const s = net.createConnection(pipePath(i))
  let buf = Buffer.alloc(0)
  let handshook = false
  s.on('connect', () => s.write(frame(0, { v: 1, client_id: appId })))
  s.on('data', chunk => {
    buf = Buffer.concat([buf, chunk])
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0), len = buf.readInt32LE(4)
      if (buf.length < 8 + len) break
      let msg = {}
      try { msg = JSON.parse(buf.subarray(8, 8 + len).toString()) } catch {}
      buf = buf.subarray(8 + len)
      if (op === 2) { s.destroy(); if (!handshook) connect(i + 1); return }
      if (msg.evt === 'READY') {
        handshook = true
        sock = s
        ready = true
        lastSent = ''
        flush()
      }
      if (op === 3) s.write(frame(4, msg)) // ping -> pong
    }
  })
  s.on('error', () => { if (!handshook) connect(i + 1) })
  s.on('close', () => {
    if (sock === s) { sock = null; ready = false; scheduleReconnect() }
  })
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  if (enabled && appId) reconnectTimer = setTimeout(() => connect(0), 15000)
}

function send(activity) {
  if (!ready || !sock) return
  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(Date.now()) + Math.random() }))
}

// discord only allows about 5 updates per 20 seconds, so updates are bundled
function flush() {
  if (!ready || !pending) return
  const wait = Math.max(0, 4500 - (Date.now() - lastSendTime))
  clearTimeout(sendTimer)
  sendTimer = setTimeout(() => {
    const json = JSON.stringify(pending)
    if (json === lastSent) return
    lastSent = json
    lastSendTime = Date.now()
    send(pending.clear ? null : pending)
  }, wait)
}

// ---------------------------------------------------------------- public

function configure(opts) {
  const changedId = opts.appId !== appId
  enabled = !!opts.enabled
  appId = (opts.appId || '').trim()
  showTitles = opts.showTitles !== false
  if (!enabled || !appId || changedId) {
    if (sock) { try { send(null) } catch {} sock.destroy(); sock = null; ready = false }
  }
  if (enabled && /^\d{15,25}$/.test(appId)) connect(0)
}

function update(tab) {
  if (!enabled) return
  const d = describe(tab)
  if (!d) { pending = { clear: true }; return flush() }
  if (d.key !== started.key) started = { key: d.key, time: Date.now() }
  const activity = {
    type: d.type,
    details: d.details,
    timestamps: { start: started.time },
    assets: { large_image: 'flow', large_text: 'Flow Browser' },
    instance: false
  }
  if (d.state && d.state.length >= 2) activity.state = d.state
  pending = activity
  flush()
}

module.exports = { configure, update, describe }
