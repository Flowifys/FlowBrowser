// Flow VPN: routes the browser's tabs through the Tor network.
//
// the first time it's switched on, Flow downloads the official Tor Expert Bundle from torproject.org,
// checks it against the checksum Tor publishes next to it, and unpacks it into Flow's own folder.
// after that, turning the VPN on starts tor.exe in the background and points the tab sessions at it.
// side panel apps (Spotify, Discord...) stay on your normal connection so they keep working.

const { app, session } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const crypto = require('crypto')
const { spawn } = require('child_process')

const DIST = 'https://dist.torproject.org/torbrowser/'

// tor names countries by their two letter code. '' = let tor pick the fastest route
const COUNTRIES = {
  '': 'Fastest', us: 'United States', ca: 'Canada', gb: 'United Kingdom', de: 'Germany', nl: 'Netherlands',
  fr: 'France', ch: 'Switzerland', se: 'Sweden', fi: 'Finland', no: 'Norway', ro: 'Romania', pl: 'Poland',
  at: 'Austria', jp: 'Japan', sg: 'Singapore', au: 'Australia'
}

let proc = null
let port = 0
let sessions = []
let onChange = () => {}
let startedFor = 0                 // bumps every start so stale callbacks are ignored
const state = { status: 'off', progress: 0, country: '', ip: '', where: '', error: '' }

const dir = () => path.join(app.getPath('userData'), 'flow-vpn')
const set = patch => { Object.assign(state, patch); onChange({ ...state }) }

function init(tabSessions, changed) {
  sessions = tabSessions
  onChange = changed || onChange
}

// ------------------------------------------------------------------ getting tor

function newestVersions(html) {
  const seen = new Set()
  for (const m of html.matchAll(/href="(\d+(?:\.\d+){1,3})\/"/g)) seen.add(m[1])
  const num = v => v.split('.').map(Number)
  return [...seen].sort((a, b) => {
    const x = num(a), y = num(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0)
    return 0
  })
}

function findBundle(sums) {
  const m = sums.match(/([0-9a-f]{64})\s+\*?(tor-expert-bundle-(?:windows-x86_64-[\d.]+|[\d.]+-windows-x86_64)\.tar\.gz)/i)
  return m ? { hash: m[1].toLowerCase(), file: m[2] } : null
}

// a small tar reader: enough for the expert bundle (plain files and folders, gnu long names)
function untar(buf, dest) {
  const out = []
  let off = 0, longName = null
  const str = (o, n) => buf.toString('utf8', o, o + n).replace(/\0.*$/s, '')
  while (off + 512 <= buf.length) {
    const head = buf.subarray(off, off + 512)
    if (head.every(b => b === 0)) break
    let name = str(off, 100)
    const prefix = str(off + 345, 155)
    if (prefix && !longName) name = prefix + '/' + name
    if (longName) { name = longName; longName = null }
    const size = parseInt(str(off + 124, 12).trim() || '0', 8) || 0
    const type = String.fromCharCode(buf[off + 156] || 48)
    const body = buf.subarray(off + 512, off + 512 + size)
    off += 512 + Math.ceil(size / 512) * 512
    if (type === 'L') { longName = body.toString('utf8').replace(/\0.*$/s, ''); continue }
    const target = path.resolve(dest, name)
    if (!target.startsWith(path.resolve(dest) + path.sep)) continue          // never write outside our folder
    if (type === '5') { fs.mkdirSync(target, { recursive: true }); continue }
    if (type !== '0' && type !== '\0') continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, body)
    out.push(target)
  }
  return out
}

async function get(url, asText) {
  const r = await session.defaultSession.fetch(url, { cache: 'no-store' })
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return asText ? r.text() : Buffer.from(await r.arrayBuffer())
}

async function ensureTor() {
  if (process.env.FLOW_TOR) return { exe: process.env.FLOW_TOR }
  const info = path.join(dir(), 'install.json')
  try {
    const saved = JSON.parse(fs.readFileSync(info, 'utf8'))
    if (saved.exe && fs.existsSync(saved.exe)) return saved
  } catch {}

  set({ status: 'installing', progress: 0, error: '' })
  const versions = newestVersions(await get(DIST, true))
  let found = null, version = null
  for (const v of versions.slice(0, 4)) {
    try {
      const b = findBundle(await get(`${DIST}${v}/sha256sums-signed-build.txt`, true))
      if (b) { found = b; version = v; break }
    } catch {}
  }
  if (!found) throw new Error("couldn't find the Tor download on torproject.org")
  set({ progress: 20 })
  const tgz = await get(`${DIST}${version}/${found.file}`)
  set({ progress: 70 })
  const hash = crypto.createHash('sha256').update(tgz).digest('hex')
  if (hash !== found.hash) throw new Error('the Tor download was damaged or tampered with (checksum mismatch), try again')

  const bin = path.join(dir(), 'bin')
  fs.rmSync(bin, { recursive: true, force: true })
  const files = untar(zlib.gunzipSync(tgz), bin)
  const pick = name => files.find(f => path.basename(f).toLowerCase() === name)
  const saved = { version, exe: pick('tor.exe'), geoip: pick('geoip'), geoip6: pick('geoip6') }
  if (!saved.exe) throw new Error('the Tor download had no tor.exe in it')
  fs.writeFileSync(info, JSON.stringify(saved, null, 2))
  set({ progress: 90 })
  return saved
}

// ------------------------------------------------------------------ on / off

async function applyProxy(on) {
  for (const ses of sessions) {
    if (on) await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<local>' })
    else await ses.setProxy({ mode: 'direct' })
    try { await ses.closeAllConnections() } catch {}
  }
}

async function lookup(run) {
  try {
    const r = await session.defaultSession.fetch('https://check.torproject.org/api/ip', { cache: 'no-store' })
    const j = await r.json()
    if (run !== startedFor) return
    let where = ''
    try {
      const c = await (await session.defaultSession.fetch(`https://api.country.is/${j.IP}`, { cache: 'no-store' })).json()
      where = c.country ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(c.country) || c.country) : ''
    } catch {}
    if (run === startedFor) set({ ip: j.IP || '', where, error: j.IsTor ? '' : "connected, but sites can't see it's going through Tor yet" })
  } catch {}
}

async function start(country = '') {
  await stop(true)
  const run = ++startedFor
  set({ status: 'connecting', progress: 0, country, ip: '', where: '', error: '' })
  let tor
  try { tor = await ensureTor() } catch (e) {
    if (run === startedFor) set({ status: 'off', error: e.message })
    return
  }
  if (run !== startedFor) return

  port = 20000 + Math.floor(Math.random() * 20000)
  const data = path.join(dir(), 'data')
  fs.mkdirSync(data, { recursive: true })
  const args = ['--SocksPort', `127.0.0.1:${port}`, '--DataDirectory', data, '--ClientOnly', '1',
    '--Log', 'notice stdout', '--AvoidDiskWrites', '1']
  if (tor.geoip) args.push('--GeoIPFile', tor.geoip)
  if (tor.geoip6) args.push('--GeoIPv6File', tor.geoip6)
  if (country) args.push('--ExitNodes', `{${country}}`, '--StrictNodes', '1')

  set({ status: 'connecting', progress: 5 })
  const p = spawn(tor.exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  proc = p
  const timer = setTimeout(() => {
    if (run === startedFor && state.status === 'connecting') {
      set({ error: "Tor is taking too long to connect. your network might be blocking it" })
      stop()
    }
  }, 120000)

  let buffer = ''
  p.stdout.on('data', async chunk => {
    buffer = (buffer + chunk.toString()).slice(-4000)
    const all = [...buffer.matchAll(/Bootstrapped (\d+)%/g)]
    if (!all.length || run !== startedFor) return
    const pct = Number(all[all.length - 1][1])
    if (pct < 100 && state.status === 'connecting') set({ progress: Math.max(state.progress, pct) })
    if (pct >= 100 && state.status === 'connecting') {
      clearTimeout(timer)
      await applyProxy(true)
      set({ status: 'on', progress: 100 })
      lookup(run)
    }
  })
  p.on('error', e => { if (run === startedFor) { clearTimeout(timer); set({ status: 'off', error: `couldn't start Tor: ${e.message}` }) } })
  p.on('exit', async code => {
    clearTimeout(timer)
    if (proc === p) proc = null
    if (run !== startedFor) return
    if (state.status !== 'off') {
      await applyProxy(false)
      set({ status: 'off', ip: '', where: '', error: state.error || (code ? `Tor stopped (code ${code})` : '') })
    }
  })
}

async function stop(quiet) {
  startedFor++
  const p = proc
  proc = null
  if (p) { try { p.kill() } catch {} }
  await applyProxy(false)
  if (!quiet) set({ status: 'off', progress: 0, ip: '', where: '' })
}

function kill() { if (proc) { try { proc.kill() } catch {} } }

module.exports = { COUNTRIES, init, start, stop, kill, state: () => ({ ...state }), _test: { newestVersions, findBundle, untar } }
