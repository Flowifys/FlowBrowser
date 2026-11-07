// Flow Browser - main process
// one window. the browser chrome (tabs, toolbar, sidebar) is a web page in its own view,
// every tab is a separate view stacked on top of it in the content area.

const { app, BaseWindow, WebContentsView, ipcMain, session, protocol, net, Menu, clipboard,
  shell, dialog, nativeImage, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const store = require('./store')
const { ENGINES, SIDEBAR_APPS, THEMES } = require('./data')
const rpc = require('./rpc')
const adblock = require('./adblock')
const search = require('./search')
const vpn = require('./vpn')
// the castlabs build of electron adds the widevine CDM so DRM music (spotify) can play. stock electron has no `components`
let components = null
try { components = require('electron').components || null } catch {}

const ROOT = path.join(__dirname, '..')
const PAGES = path.join(ROOT, 'pages')
const NEWTAB = 'flow://newtab/'
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`

// google refuses to sign you in from "embedded" chromium browsers. firefox's user agent gets the normal
// sign in page, so google's login pages (and only those) see flow as firefox
// google turns away firefox versions that are too old, so work out roughly what the current one is
// (a new firefox ships every 4 weeks; 140 came out 2025-06-24). stay one version behind to be safe
const FIREFOX_VERSION = 140 + Math.max(0, Math.floor((Date.now() - Date.UTC(2025, 5, 24)) / (28 * 864e5)) - 1)
const FIREFOX_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:${FIREFOX_VERSION}.0) Gecko/20100101 Firefox/${FIREFOX_VERSION}.0`
// every google host that takes part in signing in (adding a second account goes through more of them)
const GOOGLE_LOGIN_HOSTS = ['accounts.google.com', 'accounts.youtube.com', 'accounts.google.co.uk']
const isGoogleLogin = url => { try { return GOOGLE_LOGIN_HOSTS.includes(new URL(url).hostname) } catch { return false } }

function uaSwitch(wc) {
  wc.on('did-start-navigation', details => {
    if (!details.isMainFrame || details.isSameDocument) return
    const want = isGoogleLogin(details.url) ? FIREFOX_UA : CHROME_UA
    if (wc.getUserAgent() !== want) wc.setUserAgent(want)
  })
}

app.setName('Flow Browser')
app.userAgentFallback = CHROME_UA
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling')
if (store.settings.data.smoothScroll) app.commandLine.appendSwitch('enable-smooth-scrolling')

protocol.registerSchemesAsPrivileged([
  { scheme: 'flow', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
])

if (!app.requestSingleInstanceLock()) {
  app.quit()
  return
}

let win = null
let ui = null                 // the chrome view
let tabs = []                 // { id, view, private, blocked, pinned }
let activeId = null
let nextId = 1
let closedTabs = []           // for ctrl+shift+t
let layout = { top: 90, margin: 8 }
const RADIUS = 14
let panel = null              // { app, view, width }
const PANEL_WIDTHS = [360, 460, 620]
const panelViews = {}
let overlayOpen = false
let htmlFullscreen = false
const downloads = []          // { id, name, path, url, total, received, state, startTime }
let nextDownloadId = 1

// ---------------------------------------------------------------- helpers

const S = () => store.settings.data

function engine() {
  return ENGINES[S().searchEngine] || ENGINES.duckduckgo
}

function toUrl(input) {
  const text = input.trim()
  if (!text) return NEWTAB
  if (/^(https?|file|flow|about|chrome|data|view-source):/i.test(text)) return text
  if (/^localhost(:\d+)?(\/|$)/i.test(text) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(text)) return 'http://' + text
  // looks like a domain: has a dot, no spaces, a sane ending
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(text)) return 'https://' + text
  return engine().search.replace('%s', encodeURIComponent(text))
}

function tab(id) {
  return tabs.find(t => t.id === id)
}

function active() {
  return tab(activeId)
}

function sendUI(channel, ...args) {
  if (ui && !ui.webContents.isDestroyed()) ui.webContents.send(channel, ...args)
}

function isInternal(url) {
  return (url || '').startsWith('flow://')
}

// ---------------------------------------------------------------- flow:// pages

function servePages() {
  protocol.handle('flow', async request => {
    const u = new URL(request.url)
    let file
    if (u.host === 'wallpaper') {
      file = S().wallpaperFile
      if (!file || !fs.existsSync(file)) return new Response('', { status: 404 })
    } else if (u.pathname === '/' || u.pathname === '') {
      file = path.join(PAGES, u.host + '.html')
    } else {
      file = path.join(PAGES, path.normalize(u.pathname).replace(/^([/\\])+/, ''))
    }
    if (!file.startsWith(PAGES) && u.host !== 'wallpaper') return new Response('', { status: 403 })
    if (!fs.existsSync(file)) file = path.join(PAGES, 'error.html')
    return net.fetch(pathToFileURL(file).toString())
  })
}

// ---------------------------------------------------------------- window

function createWindow() {
  const w = S().window
  const area = screen.getPrimaryDisplay().workAreaSize
  win = new BaseWindow({
    width: Math.min(w.width || 1360, area.width),
    height: Math.min(w.height || 860, area.height),
    x: w.x, y: w.y,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    backgroundColor: theme().bg,
    title: 'Flow Browser',
    icon: path.join(ROOT, '..', 'build', 'icon.png'),
    show: false
  })

  ui = new WebContentsView({
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'ui.js'),
      contextIsolation: true,
      sandbox: true
    }
  })
  ui.setBackgroundColor('#00000000')
  win.contentView.addChildView(ui)
  ui.webContents.loadFile(path.join(ROOT, 'ui', 'index.html'))
  hookShortcuts(ui.webContents)

  ui.webContents.once('did-finish-load', () => {
    if (w.maximized) win.maximize()
    win.show()
    pushTabs()
    sendUI('settings', publicSettings())
  })

  win.on('resize', relayout)
  win.on('maximize', () => sendUI('window-state', { maximized: true }))
  win.on('unmaximize', () => sendUI('window-state', { maximized: false }))
  win.on('app-command', (_, cmd) => {
    if (cmd === 'browser-backward') goBack()
    if (cmd === 'browser-forward') goForward()
  })
  win.on('close', () => {
    saveWindow()
    saveSession(true)
  })
  win.on('closed', () => { win = null })

  relayout()
}

function saveWindow() {
  if (!win) return
  const b = win.getNormalBounds()
  S().window = { ...b, maximized: win.isMaximized() }
  store.settings.save(true)
}

function relayout() {
  if (!win) return
  const { width, height } = win.getContentBounds()
  ui.setBounds({ x: 0, y: 0, width, height })
  const t = active()
  if (htmlFullscreen) {
    if (t) { t.view.setBorderRadius(0); t.view.setBounds({ x: 0, y: 0, width, height }) }
    return
  }
  const m = layout.margin
  const top = layout.top
  let right = width - m
  let panelRect = null
  if (panel) {
    // side apps dock on the right with a small header the chrome draws
    panelRect = { x: right - panel.width, y: top, width: panel.width, height: Math.max(0, height - top - m) }
    panel.view.setBounds({ x: panelRect.x, y: panelRect.y + 30, width: panelRect.width, height: Math.max(0, panelRect.height - 30) })
    right = panelRect.x - m
  }
  const content = { x: m, y: top, width: Math.max(0, right - m), height: Math.max(0, height - top - m) }
  if (t) { t.view.setBorderRadius(RADIUS); t.view.setBounds(content) }
  sendUI('frames', { content, panel: panelRect })
}

// views that are added later end up on top. the chrome only goes on top while a dropdown is open
function restack() {
  if (!win) return
  const t = active()
  if (overlayOpen) {
    win.contentView.addChildView(ui)
  } else {
    if (panel) win.contentView.addChildView(panel.view)
    if (t) win.contentView.addChildView(t.view)
  }
}

// ---------------------------------------------------------------- tabs

function createTab(url = NEWTAB, { background = false, isPrivate = false, index = null, opener = null } = {}) {
  const id = nextId++
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'page.js'),
      contextIsolation: true,
      sandbox: true,
      partition: isPrivate ? 'flow-private' : undefined,
      spellcheck: true,
      scrollBounce: true
    }
  })
  view.setBackgroundColor(theme().bg)
  view.setBorderRadius(RADIUS)
  const t = { id, view, private: isPrivate, blocked: 0, crashed: false }

  if (index == null && opener) {
    // links opened from a tab go right next to it, like every other browser
    index = tabs.indexOf(opener) + 1
    while (index < tabs.length && tabs[index].openerId === opener.id) index++
    t.openerId = opener.id
  }
  if (index == null || index > tabs.length) tabs.push(t)
  else tabs.splice(index, 0, t)

  wireTab(t)
  view.webContents.loadURL(url)
  if (!background) selectTab(id)
  else {
    win.contentView.addChildView(view)
    view.setVisible(false)
    pushTabs()
  }
  return t
}

function wireTab(t) {
  const wc = t.view.webContents
  hookShortcuts(wc)
  uaSwitch(wc)
  webrtcPolicy(wc)
  wc.on('did-create-window', popup => { uaSwitch(popup.webContents); webrtcPolicy(popup.webContents) })

  const update = () => pushTabs()
  wc.on('page-title-updated', update)
  wc.on('did-start-loading', update)
  wc.on('did-stop-loading', update)
  wc.on('audio-state-changed', update)
  wc.on('page-favicon-updated', (_, icons) => { t.favicon = icons[0]; update() })
  wc.on('did-navigate', (_, url) => {
    t.favicon = null
    t.blocked = 0
    t.crashed = false
    addHistory(url, wc.getTitle())
    update()
  })
  wc.on('did-navigate-in-page', (_, url, isMain) => { if (isMain) { addHistory(url, wc.getTitle()); update() } })
  wc.on('page-title-updated', (_, title) => updateHistoryTitle(wc.getURL(), title))
  wc.on('did-fail-load', (_, code, desc, url, isMain) => {
    if (!isMain || code === -3) return // -3 = aborted, happens all the time
    wc.loadURL(`flow://error/?code=${code}&desc=${encodeURIComponent(desc)}&url=${encodeURIComponent(url)}`)
  })
  wc.on('render-process-gone', () => { t.crashed = true; update() })
  wc.on('found-in-page', (_, r) => sendUI('find-result', { active: r.activeMatchOrdinal, total: r.matches }))
  wc.on('enter-html-full-screen', () => setHtmlFullscreen(true))
  wc.on('leave-html-full-screen', () => setHtmlFullscreen(false))
  wc.on('context-menu', (_, params) => pageMenu(t, params))
  wc.on('zoom-changed', (_, dir) => zoom(dir === 'in' ? 1 : -1))

  wc.setWindowOpenHandler(({ url, disposition, features }) => {
    // real popups (sign in with google etc) need an actual window or they break
    if (disposition === 'new-window' && features) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 700, autoHideMenuBar: true, backgroundColor: '#0c0d11',
          webPreferences: { partition: t.private ? 'flow-private' : undefined, preload: path.join(ROOT, 'preload', 'page.js'), contextIsolation: true, sandbox: true, nodeIntegrationInSubFrames: true }
        }
      }
    }
    createTab(url, { background: disposition === 'background-tab', isPrivate: t.private, opener: t })
    return { action: 'deny' }
  })
}

function selectTab(id) {
  const t = tab(id)
  if (!t || !win) return
  for (const other of tabs) {
    if (other.id !== id && other.view.getVisible && other.view.getVisible()) other.view.setVisible(false)
  }
  activeId = id
  win.contentView.addChildView(t.view)
  t.view.setVisible(true)
  if (overlayOpen) win.contentView.addChildView(ui)
  relayout()
  pushTabs()
  const url = t.view.webContents.getURL()
  if (!url || url === NEWTAB) sendUI('focus-address')
  else t.view.webContents.focus()
}

function closeTab(id) {
  const i = tabs.findIndex(t => t.id === id)
  if (i < 0) return
  const t = tabs[i]
  const url = t.view.webContents.getURL()
  if (url && !t.private) closedTabs.push({ url, index: i })
  if (closedTabs.length > 25) closedTabs.shift()

  tabs.splice(i, 1)
  win.contentView.removeChildView(t.view)
  t.view.webContents.close()

  if (!tabs.length) {
    createTab()
    return
  }
  if (activeId === id) {
    // go back to whoever opened it if that's still around, otherwise the neighbour
    const opener = t.openerId && tab(t.openerId)
    selectTab(opener ? opener.id : tabs[Math.min(i, tabs.length - 1)].id)
  } else pushTabs()
  saveSession()
}

function moveTab(id, to) {
  const i = tabs.findIndex(t => t.id === id)
  if (i < 0) return
  const [t] = tabs.splice(i, 1)
  tabs.splice(Math.max(0, Math.min(to, tabs.length)), 0, t)
  pushTabs()
  saveSession()
}

function tabState(t) {
  const wc = t.view.webContents
  const url = wc.getURL()
  const nav = wc.navigationHistory
  return {
    id: t.id,
    title: t.crashed ? 'This tab crashed' : (wc.getTitle() || url || 'New Tab'),
    url,
    favicon: t.favicon || null,
    loading: wc.isLoading(),
    audible: wc.isCurrentlyAudible(),
    muted: wc.isAudioMuted(),
    canBack: nav.canGoBack(),
    canForward: nav.canGoForward(),
    private: t.private,
    internal: isInternal(url),
    bookmarked: store.bookmarks.data.some(b => b.url === url),
    blocked: t.blocked,
    zoom: Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100),
    crashed: t.crashed
  }
}

let pushQueued = false
function pushTabs() {
  // lots of events fire together while a page loads, send one update per frame
  if (pushQueued) return
  pushQueued = true
  setTimeout(() => {
    pushQueued = false
    const list = tabs.map(tabState)
    sendUI('tabs', { tabs: list, active: activeId })
    rpc.update(list.find(x => x.id === activeId))
  }, 16)
  saveSession()
}

let sessionTimer = null
function saveSession(now = false) {
  const write = () => {
    store.session.data = {
      tabs: tabs.filter(t => !t.private).map(t => t.view.webContents.getURL()).filter(u => u && !u.startsWith('flow://error')),
      active: Math.max(0, tabs.filter(t => !t.private).findIndex(t => t.id === activeId))
    }
    store.session.save(now)
  }
  clearTimeout(sessionTimer)
  if (now) write()
  else sessionTimer = setTimeout(write, 1500)
}

function setHtmlFullscreen(on) {
  htmlFullscreen = on
  if (!win) return
  win.setFullScreen(on)
  sendUI('fullscreen', on)
  if (on) {
    const t = active()
    if (t) win.contentView.addChildView(t.view)
  }
  setTimeout(relayout, 50)
}

// ---------------------------------------------------------------- navigation

function navigate(input) {
  const t = active()
  const url = toUrl(input)
  if (!t) return createTab(url)
  t.view.webContents.loadURL(url)
  t.view.webContents.focus()
}

function goBack() {
  const t = active()
  if (t && t.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack()
}

function goForward() {
  const t = active()
  if (t && t.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward()
}

function zoom(step) {
  const t = active()
  if (!t) return
  const wc = t.view.webContents
  const level = step === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + step * 0.5))
  wc.setZoomLevel(level)
  pushTabs()
}

// ---------------------------------------------------------------- history + bookmarks

function addHistory(url, title) {
  if (!url || isInternal(url) || url.startsWith('about:') || url.startsWith('data:')) return
  const t = tabs.find(x => x.view.webContents.getURL() === url)
  if (t && t.private) return
  const h = store.history.data
  if (h.length && h[0].url === url) { h[0].time = Date.now(); return store.history.save() }
  h.unshift({ url, title: title || url, time: Date.now() })
  if (h.length > 8000) h.length = 8000
  store.history.save()
}

function updateHistoryTitle(url, title) {
  const e = store.history.data.find(x => x.url === url)
  if (e && title) { e.title = title; store.history.save() }
}

function toggleBookmark() {
  const t = active()
  if (!t) return
  const wc = t.view.webContents
  const url = wc.getURL()
  if (!url || isInternal(url)) return
  const list = store.bookmarks.data
  const i = list.findIndex(b => b.url === url)
  if (i >= 0) list.splice(i, 1)
  else list.unshift({ url, title: wc.getTitle() || url, favicon: t.favicon || null, time: Date.now() })
  store.bookmarks.save()
  pushTabs()
  broadcastPages('bookmarks-changed')
}

function broadcastPages(channel, data) {
  for (const t of tabs) {
    if (isInternal(t.view.webContents.getURL())) t.view.webContents.send(channel, data)
  }
}

// ---------------------------------------------------------------- suggestions

async function suggest(text) {
  const q = text.trim().toLowerCase()
  if (!q) return []
  const out = []
  const seen = new Set()
  const push = item => {
    if (seen.has(item.url || item.text)) return
    seen.add(item.url || item.text)
    out.push(item)
  }

  for (const b of store.bookmarks.data) {
    if (out.length >= 3) break
    if (b.url.toLowerCase().includes(q) || (b.title || '').toLowerCase().includes(q)) push({ type: 'bookmark', title: b.title, url: b.url })
  }
  let n = 0
  for (const h of store.history.data) {
    if (n >= 4) break
    if (h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)) { push({ type: 'history', title: h.title, url: h.url }); n++ }
  }

  const eng = engine()
  if (S().suggestions && eng.suggest) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 1500)
      const res = await net.fetch(eng.suggest.replace('%s', encodeURIComponent(text)), { signal: ctrl.signal })
      clearTimeout(timer)
      const data = await res.json()
      const list = Array.isArray(data) ? (Array.isArray(data[1]) ? data[1] : data.map(x => x.phrase)) : []
      for (const s of list.slice(0, 6)) if (typeof s === 'string') push({ type: 'search', text: s })
    } catch {}
  }
  return out.slice(0, 10)
}

// ---------------------------------------------------------------- side panel apps

function togglePanel(appId) {
  if (panel && panel.app === appId) {
    win.contentView.removeChildView(panel.view)
    panel.view.setVisible(false)
    panel = null
  } else {
    if (panel) {
      win.contentView.removeChildView(panel.view)
      panel.view.setVisible(false)
    }
    let view = panelViews[appId]
    if (!view) {
      const a = SIDEBAR_APPS[appId]
      if (!a) return
      view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, partition: 'persist:flow-panels',
        preload: path.join(ROOT, 'preload', 'page.js'), nodeIntegrationInSubFrames: true } })
      view.setBackgroundColor(theme().bg)
      view.setBorderRadius(RADIUS)
      view.webContents.setUserAgent(CHROME_UA)
      uaSwitch(view.webContents)
      view.webContents.loadURL(a.url)
      view.webContents.setWindowOpenHandler(({ url }) => { createTab(url); return { action: 'deny' } })
      view.webContents.on('context-menu', (_, params) => pageMenu(null, params, view.webContents))
      hookShortcuts(view.webContents)
      panelViews[appId] = view
    }
    win.contentView.addChildView(view)
    view.setVisible(true)
    panel = { app: appId, view, width: S().panelWidth || 420 }
  }
  sendUI('panel', panel ? panel.app : null)
  restack()
  relayout()
}

function cyclePanelWidth() {
  if (!panel) return
  const i = PANEL_WIDTHS.findIndex(w => w > panel.width)
  panel.width = PANEL_WIDTHS[i < 0 ? 0 : i]
  S().panelWidth = panel.width
  store.settings.save()
  relayout()
}

// ---------------------------------------------------------------- spotify mini player
// spotify lives in the side panel. it keeps playing when the panel is closed, and the toolbar
// shows what's on with play / skip buttons. we read the page's media session and press its own buttons.

const SPOTIFY_STATE = `(() => {
  const btn = s => document.querySelector('[data-testid="control-button-' + s + '"]')
  const ms = navigator.mediaSession, md = ms && ms.metadata
  const pp = btn('playpause')
  const label = pp ? (pp.getAttribute('aria-label') || '') : ''
  if (!md || !md.title) return null
  const art = (md.artwork || []).slice().sort((a, b) => parseInt(a.sizes) - parseInt(b.sizes))[0]
  return { title: md.title, artist: md.artist || '', art: art ? art.src : '',
           playing: ms.playbackState === 'playing' || /pause/i.test(label) }
})()`

let nowPlaying = null
async function pollSpotify() {
  const v = panelViews.spotify
  let np = null
  if (v && !v.webContents.isDestroyed()) {
    try { np = await v.webContents.executeJavaScript(SPOTIFY_STATE, true) } catch { np = null }
  }
  if (np) np.panelOpen = !!(panel && panel.app === 'spotify')
  const key = JSON.stringify(np)
  if (key !== JSON.stringify(nowPlaying)) { nowPlaying = np; sendUI('nowplaying', np) }
}

function spotify(action) {
  if (action === 'toggle' || !panelViews.spotify) return togglePanel('spotify')
  const ids = { play: 'playpause', next: 'skip-forward', prev: 'skip-back' }
  if (!ids[action]) return
  panelViews.spotify.webContents.executeJavaScript(
    `(() => { const b = document.querySelector('[data-testid="control-button-${ids[action]}"]'); if (b) b.click() })()`, true)
    .catch(() => {}).then(() => setTimeout(pollSpotify, 250))
}

// ---------------------------------------------------------------- Flow VPN (tor)

let vpnState = vpn.state()

// with the vpn on, WebRTC (video calls) could still reveal your real address. only allow it through the proxy
function webrtcPolicy(wc) {
  try { wc.setWebRTCIPHandlingPolicy(vpnState.status === 'on' ? 'disable_non_proxied_udp' : 'default') } catch {}
}

function vpnChanged(st) {
  const wasOn = vpnState.status === 'on'
  vpnState = st
  sendUI('vpn', st)
  if (wasOn !== (st.status === 'on')) for (const t of tabs) if (!t.view.webContents.isDestroyed()) webrtcPolicy(t.view.webContents)
}

function vpnToggle(on) {
  S().vpn = on
  store.settings.save()
  if (on) vpn.start(S().vpnCountry || '')
  else vpn.stop()
}

function vpnMenu(x, y) {
  const st = vpnState
  const busy = st.status === 'connecting' || st.status === 'installing'
  const line = st.status === 'on' ? `Connected${st.where ? ' · ' + st.where : ''}${st.ip ? ' · ' + st.ip : ''}`
    : st.status === 'installing' ? `Setting up Flow VPN... ${st.progress}%`
    : st.status === 'connecting' ? `Connecting... ${st.progress}%`
    : st.error ? `Off · ${st.error}` : 'Off'
  const cur = S().vpnCountry || ''
  Menu.buildFromTemplate([
    { label: 'Flow VPN', enabled: false },
    { label: line, enabled: false },
    { type: 'separator' },
    { label: st.status === 'off' ? 'Turn on' : 'Turn off', click: () => vpnToggle(st.status === 'off') },
    { label: 'Location', submenu: Object.entries(vpn.COUNTRIES).map(([code, name]) => ({
      label: name, type: 'radio', checked: code === cur,
      click: () => { S().vpnCountry = code; store.settings.save(); if (S().vpn) vpn.start(code) }
    })) },
    { label: 'New address', enabled: st.status === 'on' && !busy, click: () => vpn.start(S().vpnCountry || '') },
    { type: 'separator' },
    { label: 'Runs on the Tor network: sites see a Tor address, not yours.', enabled: false },
    { label: 'Side apps (Spotify, Discord...) stay on your normal connection.', enabled: false }
  ]).popup({ window: win, x: Math.round(x), y: Math.round(y) })
}

// ---------------------------------------------------------------- downloads

function setupDownloads(ses) {
  ses.on('will-download', (_, item) => {
    const dir = app.getPath('downloads')
    let name = item.getFilename()
    let target = path.join(dir, name)
    const ext = path.extname(name)
    const base = path.basename(name, ext)
    for (let i = 1; fs.existsSync(target); i++) target = path.join(dir, `${base} (${i})${ext}`)
    item.setSavePath(target)

    const d = { id: nextDownloadId++, name: path.basename(target), path: target, url: item.getURL(), total: item.getTotalBytes(),
      received: 0, state: 'progressing', startTime: Date.now(), item }
    downloads.unshift(d)
    pushDownloads()

    item.on('updated', (_, state) => {
      d.received = item.getReceivedBytes()
      d.total = item.getTotalBytes()
      d.state = item.isPaused() ? 'paused' : state
      pushDownloads()
    })
    item.once('done', (_, state) => {
      d.state = state
      d.received = item.getReceivedBytes()
      d.item = null
      pushDownloads()
    })
  })
}

function downloadList() {
  return downloads.map(({ item, ...d }) => d)
}

let dlQueued = false
function pushDownloads() {
  if (dlQueued) return
  dlQueued = true
  setTimeout(() => {
    dlQueued = false
    const running = downloads.filter(d => d.state === 'progressing')
    const total = running.reduce((a, d) => a + (d.total || 0), 0)
    const got = running.reduce((a, d) => a + d.received, 0)
    sendUI('downloads', { running: running.length, progress: total ? got / total : 0, count: downloads.length })
    if (win) win.setProgressBar(running.length ? (total ? got / total : 2) : -1)
    broadcastPages('downloads', downloadList())
  }, 150)
}

// ---------------------------------------------------------------- permissions

function setupPermissions(ses) {
  const ask = ['media', 'geolocation', 'notifications', 'midiSysex', 'pointerLock', 'openExternal', 'display-capture']
  ses.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (!ask.includes(permission)) return callback(true)
    let origin
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin } catch { return callback(false) }
    const key = origin + '|' + permission
    const saved = store.permissions.data[key]
    if (saved !== undefined) return callback(saved)
    const labels = { media: 'use your camera / microphone', geolocation: 'know your location', notifications: 'show notifications',
      midiSysex: 'use MIDI devices', pointerLock: 'lock your mouse', openExternal: 'open an app on your computer', 'display-capture': 'share your screen' }
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      title: 'Flow Browser',
      message: `${new URL(origin).host} wants to ${labels[permission] || permission}`,
      checkboxLabel: 'Remember for this site',
      checkboxChecked: true
    }).then(r => ({ response: r.response, remember: r.checkboxChecked }))
    const allow = response === 0
    store.permissions.data[key] = allow
    store.permissions.save()
    callback(allow)
  })
}

// ---------------------------------------------------------------- menus

function pageMenu(t, p, wcOverride) {
  const wc = wcOverride || t.view.webContents
  const items = []
  const searchFor = text => () => createTab(toUrl(text), { opener: t, isPrivate: t ? t.private : false })

  if (p.misspelledWord) {
    for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) })
    items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) })
    items.push({ type: 'separator' })
  }
  if (p.linkURL) {
    items.push({ label: 'Open link in new tab', click: () => createTab(p.linkURL, { background: true, opener: t, isPrivate: t ? t.private : false }) })
    items.push({ label: 'Open link in private tab', click: () => createTab(p.linkURL, { isPrivate: true }) })
    items.push({ label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) })
    items.push({ label: 'Save link as...', click: () => wc.downloadURL(p.linkURL) })
    items.push({ type: 'separator' })
  }
  if (p.mediaType === 'image') {
    items.push({ label: 'Open image in new tab', click: () => createTab(p.srcURL, { background: true, opener: t }) })
    items.push({ label: 'Save image as...', click: () => wc.downloadURL(p.srcURL) })
    items.push({ label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) })
    items.push({ label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) })
    items.push({ type: 'separator' })
  }
  if (p.mediaType === 'video' || p.mediaType === 'audio') {
    items.push({ label: 'Save video as...', click: () => wc.downloadURL(p.srcURL) })
    items.push({ label: 'Copy video address', click: () => clipboard.writeText(p.srcURL) })
    items.push({ type: 'separator' })
  }
  if (p.isEditable) {
    items.push({ label: 'Undo', role: 'undo', enabled: p.editFlags.canUndo }, { label: 'Redo', role: 'redo', enabled: p.editFlags.canRedo }, { type: 'separator' })
    items.push({ label: 'Cut', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Copy', role: 'copy', enabled: p.editFlags.canCopy },
      { label: 'Paste', role: 'paste', enabled: p.editFlags.canPaste }, { label: 'Select all', role: 'selectAll' })
    items.push({ type: 'separator' })
  } else if (p.selectionText) {
    const sel = p.selectionText.trim()
    items.push({ label: 'Copy', role: 'copy' })
    items.push({ label: `Search ${engine().name} for "${sel.length > 24 ? sel.slice(0, 24) + '...' : sel}"`, click: searchFor(sel) })
    items.push({ type: 'separator' })
  }
  if (!p.linkURL && !p.mediaType.match(/image|video|audio/) && !p.isEditable && !p.selectionText) {
    items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() })
    items.push({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() })
    items.push({ label: 'Reload', click: () => wc.reload() })
    items.push({ type: 'separator' })
    items.push({ label: 'Save page as...', click: () => savePage(wc) })
    items.push({ label: 'Print...', click: () => wc.print() })
    items.push({ type: 'separator' })
  }
  items.push({ label: 'Inspect', click: () => { wc.inspectElement(p.x, p.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus() } })
  Menu.buildFromTemplate(items).popup({ window: win })
}

async function savePage(wc) {
  const { filePath, canceled } = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('downloads'), (wc.getTitle() || 'page').replace(/[\\/:*?"<>|]/g, '') + '.html'),
    filters: [{ name: 'Web page', extensions: ['html'] }]
  })
  if (!canceled && filePath) wc.savePage(filePath, 'HTMLComplete').catch(() => {})
}

function tabMenu(id) {
  const t = tab(id)
  if (!t) return
  const wc = t.view.webContents
  Menu.buildFromTemplate([
    { label: 'New tab', click: () => createTab(NEWTAB, { index: tabs.indexOf(t) + 1 }) },
    { type: 'separator' },
    { label: 'Reload', click: () => wc.reload() },
    { label: 'Duplicate', click: () => createTab(wc.getURL(), { index: tabs.indexOf(t) + 1, isPrivate: t.private }) },
    { label: wc.isAudioMuted() ? 'Unmute site' : 'Mute site', click: () => { wc.setAudioMuted(!wc.isAudioMuted()); pushTabs() } },
    { type: 'separator' },
    { label: 'Close tab', click: () => closeTab(id) },
    { label: 'Close other tabs', click: () => tabs.filter(x => x.id !== id).forEach(x => closeTab(x.id)) },
    { label: 'Close tabs to the right', click: () => tabs.slice(tabs.indexOf(t) + 1).forEach(x => closeTab(x.id)) },
    { type: 'separator' },
    { label: 'Reopen closed tab', enabled: closedTabs.length > 0, click: reopenTab }
  ]).popup({ window: win })
}

function mainMenu(x, y) {
  const t = active()
  Menu.buildFromTemplate([
    { label: 'New tab', accelerator: 'Ctrl+T', click: () => createTab() },
    { label: 'New private tab', accelerator: 'Ctrl+Shift+N', click: () => createTab(NEWTAB, { isPrivate: true }) },
    { type: 'separator' },
    { label: 'History', accelerator: 'Ctrl+H', click: () => openInternal('history') },
    { label: 'Downloads', accelerator: 'Ctrl+J', click: () => openInternal('downloads') },
    { label: 'Bookmarks', accelerator: 'Ctrl+Shift+O', click: () => openInternal('bookmarks') },
    { type: 'separator' },
    { label: 'Zoom in', accelerator: 'Ctrl+=', click: () => zoom(1) },
    { label: 'Zoom out', accelerator: 'Ctrl+-', click: () => zoom(-1) },
    { label: 'Reset zoom', accelerator: 'Ctrl+0', click: () => zoom(0) },
    { label: 'Full screen', accelerator: 'F11', click: () => win.setFullScreen(!win.isFullScreen()) },
    { type: 'separator' },
    { label: 'Find on page', accelerator: 'Ctrl+F', click: () => sendUI('find-open') },
    { label: 'Print...', accelerator: 'Ctrl+P', enabled: !!t, click: () => t.view.webContents.print() },
    { label: 'Save page as...', accelerator: 'Ctrl+S', enabled: !!t, click: () => savePage(t.view.webContents) },
    { label: 'Developer tools', accelerator: 'F12', enabled: !!t, click: () => t.view.webContents.toggleDevTools() },
    { type: 'separator' },
    { label: 'Settings', click: () => openInternal('settings') },
    { label: 'About Flow Browser', click: () => openInternal('settings', '#about') },
    { type: 'separator' },
    { label: 'Exit', click: () => app.quit() }
  ]).popup({ window: win, x: Math.round(x), y: Math.round(y) })
}

function appsMenu(x, y) {
  const items = (S().sidebarApps || []).filter(id => SIDEBAR_APPS[id]).map(id => ({
    label: SIDEBAR_APPS[id].name,
    type: 'checkbox',
    checked: !!(panel && panel.app === id),
    click: () => togglePanel(id)
  }))
  if (!items.length) items.push({ label: 'No side apps picked', enabled: false })
  items.push({ type: 'separator' }, { label: 'Choose side apps...', click: () => openInternal('settings', '#apps') })
  Menu.buildFromTemplate(items).popup({ window: win, x: Math.round(x), y: Math.round(y) })
}

function openInternal(name, hash = '') {
  const url = `flow://${name}/${hash}`
  const existing = tabs.find(t => t.view.webContents.getURL().startsWith(`flow://${name}/`))
  if (existing) { selectTab(existing.id); return }
  const t = active()
  if (t && t.view.webContents.getURL() === NEWTAB) t.view.webContents.loadURL(url)
  else createTab(url)
}

function reopenTab() {
  const c = closedTabs.pop()
  if (c) createTab(c.url, { index: c.index })
}

// ---------------------------------------------------------------- keyboard shortcuts (work no matter what has focus)

function hookShortcuts(wc) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const ctrl = input.control || input.meta
    const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
    const shift = input.shift
    const run = fn => { event.preventDefault(); fn() }
    const t = active()

    if (ctrl && !shift && key === 't') return run(() => createTab())
    if (ctrl && shift && key === 't') return run(reopenTab)
    if (ctrl && shift && key === 'n') return run(() => createTab(NEWTAB, { isPrivate: true }))
    if (ctrl && (key === 'w' || key === 'F4')) return run(() => t && closeTab(t.id))
    if (ctrl && key === 'Tab') return run(() => cycle(shift ? -1 : 1))
    if (ctrl && key === 'PageDown') return run(() => cycle(1))
    if (ctrl && key === 'PageUp') return run(() => cycle(-1))
    if (ctrl && !shift && /^[1-9]$/.test(key)) return run(() => {
      const n = Number(key)
      const target = n === 9 ? tabs[tabs.length - 1] : tabs[n - 1]
      if (target) selectTab(target.id)
    })
    if ((ctrl && key === 'l') || key === 'F6' || (input.alt && key === 'd')) return run(() => sendUI('focus-address'))
    if ((ctrl && !shift && key === 'r') || key === 'F5') return run(() => t && t.view.webContents.reload())
    if ((ctrl && shift && key === 'r') || (ctrl && key === 'F5')) return run(() => t && t.view.webContents.reloadIgnoringCache())
    if (ctrl && key === 'f') return run(() => sendUI('find-open'))
    if (ctrl && key === 'd') return run(toggleBookmark)
    if (ctrl && key === 'h') return run(() => openInternal('history'))
    if (ctrl && key === 'j') return run(() => openInternal('downloads'))
    if (ctrl && shift && key === 'o') return run(() => openInternal('bookmarks'))
    if (ctrl && (key === '=' || key === '+')) return run(() => zoom(1))
    if (ctrl && key === '-') return run(() => zoom(-1))
    if (ctrl && key === '0') return run(() => zoom(0))
    if (ctrl && key === 'p') return run(() => t && t.view.webContents.print())
    if (ctrl && key === 's') return run(() => t && savePage(t.view.webContents))
    if (key === 'F11') return run(() => win.setFullScreen(!win.isFullScreen()))
    if (key === 'F12' || (ctrl && shift && key === 'i')) return run(() => t && t.view.webContents.toggleDevTools())
    if (input.alt && key === 'ArrowLeft') return run(goBack)
    if (input.alt && key === 'ArrowRight') return run(goForward)
    if (input.alt && key === 'Home') return run(() => navigate(NEWTAB))
    if (key === 'Escape' && htmlFullscreen && t) return t.view.webContents.executeJavaScript('document.exitFullscreen && document.exitFullscreen()').catch(() => {})
  })
}

function cycle(dir) {
  if (tabs.length < 2) return
  const i = tabs.findIndex(t => t.id === activeId)
  selectTab(tabs[(i + dir + tabs.length) % tabs.length].id)
}

// ---------------------------------------------------------------- settings

function theme() {
  return THEMES[S().theme] || THEMES.midnight
}

function publicSettings() {
  return {
    ...S(),
    themes: THEMES,
    colors: theme(),
    engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])),
    apps: SIDEBAR_APPS,
    version: app.getVersion(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome }
  }
}

function applySettings() {
  const c = theme()
  if (win) win.setBackgroundColor(c.bg)
  for (const t of tabs) t.view.setBackgroundColor(c.bg)
  rpc.configure({ enabled: S().rpc, appId: S().rpcAppId, showTitles: S().rpcShowTitles })
  pushTabs()
  sendUI('settings', publicSettings())
  broadcastPages('settings', publicSettings())
  adblock.setEnabled(S().adblock)
}

// ---------------------------------------------------------------- ipc from the chrome

function fromUI(e) {
  return ui && e.sender === ui.webContents
}

function fromInternal(e) {
  try { return new URL(e.senderFrame.url).protocol === 'flow:' } catch { return false }
}

function setupIpc() {
  const onUI = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (fromUI(e)) fn(...a) })
  const handleUI = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fromUI(e) ? fn(...a) : null)

  onUI('tab:new', (url, isPrivate) => createTab(url || NEWTAB, { isPrivate: !!isPrivate }))
  onUI('tab:close', id => closeTab(id))
  onUI('tab:select', id => selectTab(id))
  onUI('tab:move', (id, to) => moveTab(id, to))
  onUI('tab:menu', id => tabMenu(id))
  onUI('tab:mute', id => { const t = tab(id); if (t) { t.view.webContents.setAudioMuted(!t.view.webContents.isAudioMuted()); pushTabs() } })
  onUI('nav:go', input => navigate(input))
  onUI('nav:back', goBack)
  onUI('nav:forward', goForward)
  onUI('nav:reload', () => { const t = active(); if (t) t.view.webContents.reload() })
  onUI('nav:stop', () => { const t = active(); if (t) t.view.webContents.stop() })
  onUI('nav:home', () => navigate(NEWTAB))
  onUI('bookmark:toggle', toggleBookmark)
  onUI('zoom', step => zoom(step))
  onUI('menu:main', (x, y) => mainMenu(x, y))
  onUI('menu:apps', (x, y) => appsMenu(x, y))
  onUI('open', name => openInternal(name))
  onUI('panel', appId => togglePanel(appId))
  onUI('panel:width', () => cyclePanelWidth())
  onUI('vpn:menu', (x, y) => vpnMenu(x, y))
  onUI('vpn:get', () => sendUI('vpn', vpnState))
  onUI('spotify', action => spotify(action))
  onUI('win:min', () => win.minimize())
  onUI('win:max', () => win.isMaximized() ? win.unmaximize() : win.maximize())
  onUI('win:close', () => win.close())
  onUI('layout', l => { layout = { ...layout, ...l }; relayout() })
  onUI('overlay', open => { overlayOpen = !!open; restack() })
  onUI('find', (text, forward, findNext) => {
    const t = active()
    if (!t) return
    if (!text) return t.view.webContents.stopFindInPage('clearSelection')
    t.view.webContents.findInPage(text, { forward: forward !== false, findNext: !!findNext })
  })
  onUI('find:stop', () => { const t = active(); if (t) { t.view.webContents.stopFindInPage('clearSelection'); t.view.webContents.focus() } })
  onUI('focus-page', () => { const t = active(); if (t) t.view.webContents.focus() })
  handleUI('suggest', text => suggest(text))
  handleUI('url-info', input => toUrl(input))

  // ---- from flow:// pages (new tab, settings, history...)
  const onPage = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fromInternal(e) ? fn(e, ...a) : null)

  onPage('page:settings', () => publicSettings())
  onPage('page:set', (_, patch) => {
    const allowed = Object.keys(store.DEFAULT_SETTINGS)
    for (const [k, v] of Object.entries(patch || {})) if (allowed.includes(k) && k !== 'window') S()[k] = v
    store.settings.save()
    applySettings()
    return publicSettings()
  })
  onPage('page:reset-settings', () => {
    const keepWindow = S().window
    store.settings.data = { ...structuredClone(store.DEFAULT_SETTINGS), window: keepWindow }
    store.settings.save()
    applySettings()
    return publicSettings()
  })
  onPage('page:history', (_, query = '', limit = 300) => {
    const q = query.toLowerCase()
    return store.history.data.filter(h => !q || h.url.toLowerCase().includes(q) || (h.title || '').toLowerCase().includes(q)).slice(0, limit)
  })
  onPage('page:history-remove', (_, url) => {
    store.history.data = store.history.data.filter(h => h.url !== url)
    store.history.save()
  })
  onPage('page:bookmarks', () => store.bookmarks.data)
  onPage('page:bookmark-remove', (_, url) => {
    store.bookmarks.data = store.bookmarks.data.filter(b => b.url !== url)
    store.bookmarks.save()
    pushTabs()
  })
  onPage('page:bookmark-edit', (_, url, title) => {
    const b = store.bookmarks.data.find(x => x.url === url)
    if (b) { b.title = title; store.bookmarks.save() }
  })
  onPage('page:downloads', () => downloadList())
  onPage('page:download', (_, id, action) => {
    const d = downloads.find(x => x.id === id)
    if (!d) return
    if (action === 'open') shell.openPath(d.path)
    if (action === 'show') shell.showItemInFolder(d.path)
    if (action === 'cancel' && d.item) d.item.cancel()
    if (action === 'pause' && d.item) d.item.pause()
    if (action === 'resume' && d.item && d.item.canResume()) d.item.resume()
    if (action === 'remove') { downloads.splice(downloads.indexOf(d), 1); pushDownloads() }
  })
  onPage('page:downloads-clear', () => {
    for (let i = downloads.length - 1; i >= 0; i--) if (downloads[i].state !== 'progressing') downloads.splice(i, 1)
    pushDownloads()
  })
  onPage('page:clear-data', async (_, what) => {
    const ses = session.defaultSession
    if (what.includes('history')) { store.history.data = []; store.history.save() }
    if (what.includes('cache')) await ses.clearCache()
    if (what.includes('cookies')) await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] })
    if (what.includes('permissions')) { store.permissions.data = {}; store.permissions.save() }
    return true
  })
  onPage('page:wallpaper', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Pick a wallpaper', properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    })
    if (canceled || !filePaths[0]) return null
    const dest = path.join(app.getPath('userData'), 'wallpaper' + path.extname(filePaths[0]).toLowerCase())
    fs.copyFileSync(filePaths[0], dest)
    S().wallpaper = 'custom'
    S().wallpaperFile = dest
    store.settings.save()
    applySettings()
    return publicSettings()
  })
  onPage('page:open', (e, url, newTab) => {
    if (newTab) createTab(url)
    else {
      const t = tabs.find(x => x.view.webContents === e.sender)
      if (t) t.view.webContents.loadURL(toUrl(url))
    }
  })
  onPage('page:search', (e, text) => {
    const t = tabs.find(x => x.view.webContents === e.sender)
    if (t) t.view.webContents.loadURL(toUrl(text))
  })
  onPage('page:suggest', (_, text) => suggest(text))
  onPage('search:web', (_, q, params) => search.web(q, params).catch(e => ({ status: -1, error: String(e) })))
  onPage('search:instant', (_, q) => search.instant(q))
  onPage('search:images', (_, q, next) => search.images(q, next).catch(() => ({ results: [], next: null })))
  onPage('search:news', (_, q) => search.news(q).catch(() => []))
  onPage('search:wiki', (_, title) => search.wiki(title))
  onPage('page:blocked-total', () => adblock.total())
  onPage('page:default-browser', () => {
    app.setAsDefaultProtocolClient('http')
    app.setAsDefaultProtocolClient('https')
    shell.openExternal('ms-settings:defaultapps')
  })
}

// ---------------------------------------------------------------- start

app.on('second-instance', (_, argv) => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
  const url = argv.slice(1).find(a => /^https?:\/\//.test(a))
  if (url) createTab(url)
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  // fetch / update the widevine CDM before any page loads (first run needs internet). don't hang if offline
  if (components) {
    try { await Promise.race([components.whenReady(), new Promise(r => setTimeout(r, 20000))]) }
    catch (e) { console.log('widevine not ready:', e && e.message) }
  }
  setInterval(pollSpotify, 1500)
  vpn.init([session.defaultSession, session.fromPartition('flow-private')], vpnChanged)
  servePages()

  const sessions = [session.defaultSession, session.fromPartition('flow-private'), session.fromPartition('persist:flow-panels')]
  for (const ses of sessions) {
    ses.setUserAgent(CHROME_UA)
    // the headers have to agree with the user agent, chromium's client hints would give it away
    ses.webRequest.onBeforeSendHeaders({ urls: GOOGLE_LOGIN_HOSTS.map(h => `https://${h}/*`) }, (details, done) => {
      const headers = details.requestHeaders
      headers['User-Agent'] = FIREFOX_UA
      for (const k of Object.keys(headers)) if (k.toLowerCase().startsWith('sec-ch-ua')) delete headers[k]
      done({ requestHeaders: headers })
    })
    setupDownloads(ses)
    setupPermissions(ses)
  }
  protocolForPrivate()

  adblock.init(sessions, (wcId) => {
    const t = tabs.find(x => !x.view.webContents.isDestroyed() && x.view.webContents.id === wcId)
    if (t) { t.blocked++; pushTabs() }
  }, S().adblock)

  setupIpc()
  createWindow()
  if (S().vpn) vpn.start(S().vpnCountry || '')
  rpc.configure({ enabled: S().rpc, appId: S().rpcAppId, showTitles: S().rpcShowTitles })

  const startUrl = process.argv.slice(1).find(a => /^https?:\/\//.test(a))
  const saved = store.session.data
  if (S().startup === 'restore' && saved.tabs && saved.tabs.length) {
    saved.tabs.forEach((u, i) => createTab(u, { background: i !== saved.active }))
    const want = tabs[Math.min(saved.active, tabs.length - 1)]
    if (want) selectTab(want.id)
  } else {
    createTab()
  }
  if (startUrl) createTab(startUrl)
})

// private tabs need flow:// too (new tab page)
function protocolForPrivate() {
  for (const p of ['flow-private', 'persist:flow-panels']) {
    const ses = session.fromPartition(p)
    ses.protocol.handle('flow', req => {
      const u = new URL(req.url)
      let file = u.pathname === '/' ? path.join(PAGES, u.host + '.html') : path.join(PAGES, path.normalize(u.pathname).replace(/^([/\\])+/, ''))
      if (u.host === 'wallpaper') file = S().wallpaperFile || ''
      if (!fs.existsSync(file)) return new Response('', { status: 404 })
      return net.fetch(pathToFileURL(file).toString())
    })
  }
}

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => vpn.kill())
app.on('before-quit', () => {
  saveSession(true)
  store.history.save(true)
  store.bookmarks.save(true)
  store.settings.save(true)
})
