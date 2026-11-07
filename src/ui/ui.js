// browser chrome: tabs, toolbar, address bar
const $ = s => document.querySelector(s)
const send = (...a) => window.flow.send(...a)

const LOGO = `<svg viewBox="0 0 64 64" fill="none" stroke-linecap="round">
  <defs><linearGradient id="lg" x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
    <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/></linearGradient></defs>
  <path d="M19 53V27c0-10 6-16 16-16h12" stroke="url(#lg)" stroke-width="8.5"/>
  <path d="M19 33h19" stroke="url(#lg)" stroke-width="8.5"/>
  <path d="M32 53c7 0 12-3.5 14.5-10" stroke="url(#lg)" stroke-width="5" opacity=".75"/>
</svg>`

let state = { tabs: [], active: null }
let settings = {}
let editing = false
let dragId = null

// ---------------------------------------------------------------- static icons

$('#logo').innerHTML = LOGO
$('#newtab').innerHTML = icon('plus')
$('#win-min').innerHTML = icon('min')
$('#win-max').innerHTML = icon('max')
$('#win-close').innerHTML = icon('close')
$('#back').innerHTML = icon('back')
$('#forward').innerHTML = icon('forward')
$('#reload').innerHTML = icon('reload')
$('#star').innerHTML = icon('star')
$('#apps').innerHTML = icon('grid')
$('#dl').insertAdjacentHTML('beforeend', icon('download'))
$('#more').innerHTML = icon('dots')
$('#find-prev').innerHTML = icon('up')
$('#find-next').innerHTML = icon('down')
$('#find-close').innerHTML = icon('close')
$('#panelclose').innerHTML = icon('close')
$('#panelwiden').innerHTML = icon('widen')
$('#music').innerHTML = icon('music')
$('#np-prev').innerHTML = icon('prev')
$('#np-next').innerHTML = icon('next')
$('#np-play').innerHTML = icon('play')

// ---------------------------------------------------------------- window buttons

$('#win-min').onclick = () => send('win:min')
$('#win-max').onclick = () => send('win:max')
$('#win-close').onclick = () => send('win:close')
$('#titlebar').ondblclick = e => { if (e.target.closest('.drag-fill') || e.target === $('#titlebar')) send('win:max') }
window.flow.onWindowState(s => { $('#win-max').innerHTML = icon(s.maximized ? 'restore' : 'max') })

const below = el => { const r = el.getBoundingClientRect(); return [r.left, r.bottom + 4] }
$('#logo').onclick = () => send('menu:main', ...below($('#logo')))
$('#more').onclick = () => { const r = $('#more').getBoundingClientRect(); send('menu:main', r.right - 240, r.bottom + 4) }
$('#apps').onclick = () => { const r = $('#apps').getBoundingClientRect(); send('menu:apps', r.right - 220, r.bottom + 4) }
$('#newtab').onclick = () => send('tab:new')
$('#panelclose').onclick = () => openPanel && send('panel', openPanel)
$('#panelwiden').onclick = () => send('panel:width')
$('#music').onclick = () => send('spotify', 'toggle')
$('#np-open').onclick = () => send('spotify', 'toggle')
$('#np-play').onclick = () => send('spotify', 'play')
$('#np-next').onclick = () => send('spotify', 'next')
$('#np-prev').onclick = () => send('spotify', 'prev')

// ---------------------------------------------------------------- tabs

function renderTabs() {
  if (dragId) return
  const box = $('#tabs')
  box.innerHTML = ''
  for (const t of state.tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (t.id === state.active ? ' active' : '') + (t.private ? ' private' : '')
    el.draggable = true
    el.title = t.title

    const fav = document.createElement('div')
    fav.className = 'fav'
    if (t.loading && !t.internal) fav.innerHTML = '<div class="spin"></div>'
    else if (t.private && t.internal) fav.innerHTML = icon('mask')
    else if (t.internal) fav.innerHTML = LOGO
    else if (t.favicon) {
      const img = new Image()
      img.src = t.favicon
      img.onerror = () => { fav.innerHTML = icon('globe') }
      fav.appendChild(img)
    } else fav.innerHTML = icon('globe')

    const title = document.createElement('div')
    title.className = 'title'
    title.textContent = t.title
    el.append(fav, title)

    if (t.audible || t.muted) {
      const a = document.createElement('button')
      a.className = 'audio'
      a.innerHTML = icon(t.muted ? 'mute' : 'volume')
      a.title = t.muted ? 'Unmute tab' : 'Mute tab'
      a.onclick = e => { e.stopPropagation(); send('tab:mute', t.id) }
      el.append(a)
    }
    const x = document.createElement('button')
    x.className = 'x'
    x.innerHTML = icon('close')
    x.title = 'Close tab (Ctrl+W)'
    x.onclick = e => { e.stopPropagation(); send('tab:close', t.id) }
    el.append(x)

    el.onmousedown = e => {
      if (e.button === 0 && !e.target.closest('button')) send('tab:select', t.id)
      if (e.button === 1) e.preventDefault()
    }
    el.onauxclick = e => { if (e.button === 1) send('tab:close', t.id) }
    el.oncontextmenu = e => { e.preventDefault(); send('tab:menu', t.id) }

    el.ondragstart = e => { dragId = t.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move' }
    el.ondragend = () => { dragId = null; renderTabs() }
    el.ondragover = e => {
      e.preventDefault()
      box.querySelectorAll('.drop-before').forEach(n => n.classList.remove('drop-before'))
      el.classList.add('drop-before')
    }
    el.ondrop = e => {
      e.preventDefault()
      const from = state.tabs.findIndex(x => x.id === dragId)
      let to = state.tabs.findIndex(x => x.id === t.id)
      if (from < to) to--
      const id = dragId
      dragId = null
      send('tab:move', id, to)
    }
    box.appendChild(el)
  }
  fitTabs()
}

function fitTabs() {
  const all = [...document.querySelectorAll('.tab')]
  const width = all[0] ? all[0].getBoundingClientRect().width : 210
  all.forEach(el => el.classList.toggle('narrow', width < 76))
}
window.addEventListener('resize', fitTabs)

// ---------------------------------------------------------------- toolbar

function current() {
  return state.tabs.find(t => t.id === state.active)
}

function prettyUrl(t) {
  if (!t || !t.url) return ''
  if (t.url.startsWith('flow://newtab')) return ''
  const param = name => { try { return new URL(t.url).searchParams.get(name) || '' } catch { return '' } }
  if (t.url.startsWith('flow://search')) return param('q')
  if (t.url.startsWith('flow://error')) return param('url')
  return t.url.replace(/^https:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')
}

function renderToolbar() {
  const t = current()
  $('#back').disabled = !t || !t.canBack
  $('#forward').disabled = !t || !t.canForward
  $('#reload').innerHTML = icon(t && t.loading ? 'stop' : 'reload')
  $('#reload').title = t && t.loading ? 'Stop' : 'Reload (Ctrl+R)'

  if (!editing) $('#address').value = prettyUrl(t)

  const site = $('#site')
  site.className = ''
  if (!t || !t.url) site.innerHTML = icon('search')
  else if (t.private) { site.className = 'private'; site.innerHTML = icon('mask') + '<span>Private</span>' }
  else if (t.url.startsWith('flow://search')) { site.className = 'internal'; site.innerHTML = icon('search') + '<span>Flow Search</span>' }
  else if (t.internal) { site.className = 'internal'; site.innerHTML = icon('flow') + '<span>Flow</span>' }
  else if (t.url.startsWith('https:')) { site.className = 'secure'; site.innerHTML = icon('lock') }
  else if (t.url.startsWith('http:')) { site.className = 'insecure'; site.innerHTML = icon('warn') + '<span>Not secure</span>' }
  else site.innerHTML = icon('globe')

  const star = $('#star')
  star.classList.toggle('hidden', !t || t.internal)
  star.classList.toggle('on', !!(t && t.bookmarked))

  const shield = $('#shield')
  shield.classList.toggle('hidden', !t || t.internal || !settings.adblock)
  shield.classList.toggle('active', !!(t && t.blocked))
  shield.innerHTML = icon('shield') + `<span>${t ? t.blocked : 0}</span>`
  shield.title = `${t ? t.blocked : 0} ads and trackers blocked on this page`

  const zc = $('#zoomchip')
  zc.classList.toggle('hidden', !t || t.zoom === 100)
  zc.textContent = t ? t.zoom + '%' : ''

  const bar = $('#loadbar')
  if (t && t.loading) { bar.classList.remove('done'); bar.classList.add('loading') }
  else if (bar.classList.contains('loading')) { bar.classList.remove('loading'); bar.classList.add('done') }
}

$('#back').onclick = () => send('nav:back')
$('#forward').onclick = () => send('nav:forward')
$('#reload').onclick = () => send(current() && current().loading ? 'nav:stop' : 'nav:reload')
$('#star').onclick = () => send('bookmark:toggle')
$('#zoomchip').onclick = () => send('zoom', 0)
$('#dl').onclick = () => send('open', 'downloads')
$('#shield').onclick = () => send('open', 'settings')

// ---------------------------------------------------------------- address bar + suggestions

const address = $('#address')
const box = $('#suggest')
let items = []
let sel = -1
let typed = ''
let reqId = 0

address.onfocus = () => {
  editing = true
  $('#omnibox').classList.add('focus')
  const t = current()
  if (t && t.url && !t.url.startsWith('flow://newtab') && !t.url.startsWith('flow://search')) address.value = t.url
  setTimeout(() => address.select(), 0)
}

address.onblur = () => {
  setTimeout(() => {
    editing = false
    $('#omnibox').classList.remove('focus')
    closeSuggest()
    renderToolbar()
  }, 120)
}

address.oninput = async () => {
  typed = address.value
  const id = ++reqId
  if (!typed.trim()) return closeSuggest()
  const list = await window.flow.suggest(typed)
  if (id !== reqId || !editing) return
  items = [{ type: 'go', text: typed }, ...list.filter(x => x.text !== typed)]
  sel = 0
  openSuggest()
}

address.onkeydown = e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return
    e.preventDefault()
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    const it = items[sel]
    address.value = it.url || it.text
    drawSuggest()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const it = items[sel]
    let value = address.value
    if (it && sel > 0) value = it.url || it.text
    // ctrl+enter turns "youtube" into www.youtube.com
    if (e.ctrlKey && !/[./\s]/.test(value)) value = `www.${value}.com`
    go(value, e.altKey)
  } else if (e.key === 'Escape') {
    if (!box.classList.contains('hidden')) closeSuggest()
    else { editing = false; renderToolbar(); send('focus-page') }
  }
}

function go(value, newTab) {
  closeSuggest()
  editing = false
  address.blur()
  if (!value.trim()) return
  if (newTab) send('tab:new', value)
  else send('nav:go', value)
}

function openSuggest() {
  if (!items.length) return closeSuggest()
  if (box.classList.contains('hidden')) {
    box.classList.remove('hidden')
    $('#omnibox').classList.add('open')
    send('overlay', true)
  }
  drawSuggest()
}

function closeSuggest() {
  items = []
  sel = -1
  if (!box.classList.contains('hidden')) {
    box.classList.add('hidden')
    $('#omnibox').classList.remove('open')
    send('overlay', false)
  }
}

function highlight(text, q) {
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (i < 0) return esc(text)
  return esc(text.slice(0, i)) + '<b>' + esc(text.slice(i, i + q.length)) + '</b>' + esc(text.slice(i + q.length))
}

function drawSuggest() {
  const engine = (settings.engines || {})[settings.searchEngine] || 'Flow Search'
  box.innerHTML = ''
  items.forEach((it, i) => {
    const row = document.createElement('div')
    row.className = 'sug' + (i === sel ? ' sel' : '')
    if (it.type === 'go') {
      const looksLikeUrl = /^\S+\.\S+$/.test(it.text) || /^\w+:\/\//.test(it.text)
      row.innerHTML = icon(looksLikeUrl ? 'globe' : 'search') + `<span class="t">${highlight(it.text, '')}</span><span class="u">${looksLikeUrl ? '' : '&mdash; ' + engine}</span>`
    } else if (it.type === 'search') {
      row.innerHTML = icon('search') + `<span class="t">${highlight(it.text, typed)}</span>`
    } else {
      row.innerHTML = icon(it.type === 'bookmark' ? 'star' : 'history') +
        `<span class="t">${highlight(it.title || it.url, typed)}</span><span class="u">${highlight(it.url.replace(/^https?:\/\/(www\.)?/, ''), typed)}</span>`
    }
    row.onmousedown = e => { e.preventDefault(); go(it.url || it.text, e.button === 1) }
    row.onmousemove = () => { if (sel !== i) { sel = i; drawSuggest() } }
    box.appendChild(row)
  })
}

// clicking anywhere else while suggestions are open just closes them
document.addEventListener('mousedown', e => {
  if (!box.classList.contains('hidden') && !e.target.closest('#omnibox')) address.blur()
})

window.flow.onFocusAddress(() => { address.focus(); address.select() })

// ---------------------------------------------------------------- find on page

const findbar = $('#findbar')
const find = $('#find')
let findOpen = false

function setFind(open) {
  findOpen = open
  findbar.classList.toggle('hidden', !open)
  updateLayout()
  if (open) { find.focus(); find.select(); if (find.value) send('find', find.value) }
  else { send('find:stop'); $('#findcount').textContent = '' }
}

window.flow.onFindOpen(() => setFind(true))
find.oninput = () => send('find', find.value)
find.onkeydown = e => {
  if (e.key === 'Enter') send('find', find.value, !e.shiftKey, true)
  if (e.key === 'Escape') setFind(false)
}
$('#find-next').onclick = () => send('find', find.value, true, true)
$('#find-prev').onclick = () => send('find', find.value, false, true)
$('#find-close').onclick = () => setFind(false)
window.flow.onFindResult(r => { $('#findcount').textContent = find.value ? `${r.active} of ${r.total}` : '' })

// ---------------------------------------------------------------- side app panel (sits on the right)

let openPanel = null
window.flow.onPanel(id => {
  openPanel = id
  $('#apps').classList.toggle('on', !!id && id !== 'spotify')
  $('#music').classList.toggle('on', id === 'spotify')
  $('#np').classList.toggle('panel-open', id === 'spotify')
  $('#panelframe').classList.toggle('hidden', !id)
  $('#panelname').textContent = id && settings.apps && settings.apps[id] ? settings.apps[id].name : ''
})

// Flow VPN chip in the address bar
$('#vpn').onclick = () => { const r = $('#vpn').getBoundingClientRect(); send('vpn:menu', r.left, r.bottom + 6) }
window.flow.onVpn(st => {
  const chip = $('#vpn')
  chip.className = 'chip vpn ' + st.status + (st.error && st.status === 'off' ? ' err' : '')
  const busy = st.status === 'connecting' || st.status === 'installing'
  $('#vpnlabel').textContent = busy ? `VPN ${st.progress}%` : 'VPN'
  chip.title = st.status === 'on' ? `Flow VPN on${st.where ? ' · ' + st.where : ''}${st.ip ? ' · ' + st.ip : ''}`
    : busy ? 'Flow VPN is connecting...' : st.error ? `Flow VPN: ${st.error}` : 'Flow VPN is off'
})
send('vpn:get')

// spotify mini player in the toolbar
window.flow.onNowPlaying(np => {
  const box = $('#np')
  box.classList.toggle('hidden', !np)
  if (!np) return
  $('#np-title').textContent = np.title
  $('#np-artist').textContent = np.artist
  $('#np-open').title = `${np.title} - ${np.artist}`
  const img = $('#np-art')
  if (np.art && img.getAttribute('src') !== np.art) img.src = np.art
  img.style.visibility = np.art ? 'visible' : 'hidden'
  $('#np-play').innerHTML = icon(np.playing ? 'pause' : 'play')
  box.classList.toggle('playing', !!np.playing)
})

// main tells us exactly where the page and panel ended up so the glow frames line up
window.flow.onFrames(f => {
  const place = (el, r) => { if (!r) return; Object.assign(el.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' }) }
  place($('#frame'), f.content)
  place($('#panelframe'), f.panel)
})

// ---------------------------------------------------------------- downloads indicator

window.flow.onDownloads(d => {
  const btn = $('#dl')
  btn.classList.toggle('hidden', d.count === 0)
  btn.classList.toggle('running', d.running > 0)
  btn.querySelector('.ring circle').style.strokeDashoffset = d.running ? 94.25 * (1 - Math.max(0.03, d.progress)) : 94.25
})

// ---------------------------------------------------------------- settings / layout

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// the second colour is the accent swung round the colour wheel, so every accent gets its own gradient
function partner(hex) {
  let [r, g, b] = hexToRgb(hex).map(v => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360 - 70) % 360
  const s = d === 0 ? 0 : d / (1 - Math.abs(max + min - 1)), l = (max + min) / 2
  const c = (1 - Math.abs(2 * l - 1)) * Math.max(s, .75), x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return `rgb(${Math.round((R + m) * 255)},${Math.round((G + m) * 255)},${Math.round((B + m) * 255)})`
}

function applyAccent(hex) {
  const [r, g, b] = hexToRgb(hex)
  const root = document.documentElement.style
  root.setProperty('--accent', hex)
  root.setProperty('--accent-2', partner(hex))
  root.setProperty('--accent-soft', `rgba(${r},${g},${b},.16)`)
  root.setProperty('--accent-glow', `rgba(${r},${g},${b},.45)`)
}

function updateLayout() {
  send('layout', { top: 42 + 48 + (findOpen ? 40 : 0), margin: 8 })
}

function applyTheme(c) {
  if (!c) return
  const root = document.documentElement.style
  root.setProperty('--bg', c.bg)
  root.setProperty('--bar', c.bar)
  root.setProperty('--raise', c.raise)
  root.setProperty('--raise-2', c.raise2)
  root.setProperty('--line', c.line)
}

window.flow.onSettings(s => {
  settings = s
  applyTheme(s.colors)
  applyAccent(s.accent || '#7c5cff')
  updateLayout()
  renderToolbar()
})

window.flow.onTabs(s => {
  state = s
  renderTabs()
  renderToolbar()
})

window.flow.onFullscreen(on => document.body.classList.toggle('fullscreen', on))

updateLayout()
