// only flow:// pages (new tab, settings, history...) get this api. normal websites see nothing.
const { contextBridge, ipcRenderer } = require('electron')

// on google's sign in pages the request headers say firefox, so the page's own javascript has to agree:
// hide the chromium only bits and fill in the firefox ones
if (['accounts.google.com', 'accounts.youtube.com', 'accounts.google.co.uk'].includes(location.hostname)) {
  try {
    contextBridge.executeInMainWorld({
      func: () => {
        const def = (obj, key, value) => { try { Object.defineProperty(obj, key, { get: () => value, configurable: true }) } catch {} }
        try { delete Navigator.prototype.userAgentData } catch {}
        def(Navigator.prototype, 'userAgentData', undefined)
        def(Navigator.prototype, 'vendor', '')
        def(Navigator.prototype, 'productSub', '20100101')
        def(Navigator.prototype, 'platform', 'Win32')
        def(Navigator.prototype, 'oscpu', 'Windows NT 10.0; Win64; x64')
        def(Navigator.prototype, 'buildID', '20181001000000')
        def(Navigator.prototype, 'appVersion', '5.0 (Windows)')
        try { delete window.chrome } catch {}
        def(window, 'chrome', undefined)
      }
    })
  } catch {}
}

if (location.protocol === 'flow:') {
  const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a)
  const listen = ch => cb => ipcRenderer.on(ch, (_, d) => cb(d))

  contextBridge.exposeInMainWorld('flow', {
    settings: () => call('page:settings'),
    set: patch => call('page:set', patch),
    resetSettings: () => call('page:reset-settings'),
    history: (q, limit) => call('page:history', q, limit),
    removeHistory: url => call('page:history-remove', url),
    bookmarks: () => call('page:bookmarks'),
    removeBookmark: url => call('page:bookmark-remove', url),
    renameBookmark: (url, title) => call('page:bookmark-edit', url, title),
    downloads: () => call('page:downloads'),
    download: (id, action) => call('page:download', id, action),
    clearDownloads: () => call('page:downloads-clear'),
    clearData: what => call('page:clear-data', what),
    pickWallpaper: () => call('page:wallpaper'),
    open: (url, newTab) => call('page:open', url, newTab),
    search: text => call('page:search', text),
    suggest: text => call('page:suggest', text),
    blockedTotal: () => call('page:blocked-total'),
    makeDefault: () => call('page:default-browser'),
    web: (q, params) => call('search:web', q, params),
    instant: q => call('search:instant', q),
    images: (q, next) => call('search:images', q, next),
    news: q => call('search:news', q),
    wiki: title => call('search:wiki', title),
    onSettings: listen('settings'),
    onDownloads: listen('downloads'),
    onBookmarks: listen('bookmarks-changed')
  })
}
