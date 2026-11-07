// shared bits for flow:// pages
const $ = s => document.querySelector(s)
const $$ = s => [...document.querySelectorAll(s)]

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  close: '<path d="M7 7l10 10M17 7L7 17"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  edit: '<path d="M5 19h4L19 9l-4-4L5 15z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folder: '<path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  open: '<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4h4"/><path d="M12 8v4.5l3 2"/>',
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5S9.4 5.9 12 3.5z"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-8 8"/>',
  news: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 12h8M8 15h5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
}

function icon(name) {
  return `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ''}</svg>`
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

function favicon(url) {
  return `https://icons.duckduckgo.com/ip3/${host(url)}.ico`
}

// same colour maths as the browser chrome: the second colour is the accent turned round the colour wheel
function partner(hex) {
  const n = parseInt(hex.slice(1), 16)
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360 - 70) % 360
  const s = d === 0 ? 0 : d / (1 - Math.abs(max + min - 1)), l = (max + min) / 2
  const c = (1 - Math.abs(2 * l - 1)) * Math.max(s, .75), x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return `rgb(${Math.round((R + m) * 255)},${Math.round((G + m) * 255)},${Math.round((B + m) * 255)})`
}

function accent(hex) {
  hex = hex || '#7c5cff'
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const st = document.documentElement.style
  st.setProperty('--accent', hex)
  st.setProperty('--accent-2', partner(hex))
  st.setProperty('--accent-soft', `rgba(${r},${g},${b},.14)`)
  st.setProperty('--accent-glow', `rgba(${r},${g},${b},.4)`)
}

function theme(s) {
  const c = s.colors
  if (c) {
    const st = document.documentElement.style
    st.setProperty('--bg', c.bg)
    st.setProperty('--panel', c.bar)
    st.setProperty('--raise', c.raise)
    st.setProperty('--raise-2', c.raise2)
    st.setProperty('--line', c.line)
  }
  accent(s.accent)
}

function ago(t) {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function dayLabel(t) {
  const d = new Date(t), now = new Date()
  const start = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = (start(now) - start(d)) / 86400000
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

function bytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return n.toFixed(i ? 1 : 0) + ' ' + u[i]
}

let SETTINGS = {}
async function boot(fn) {
  if (!window.flow) return
  SETTINGS = await window.flow.settings()
  theme(SETTINGS)
  window.flow.onSettings(s => { SETTINGS = s; theme(s); if (window.onSettingsChanged) window.onSettingsChanged(s) })
  fn && fn(SETTINGS)
}
