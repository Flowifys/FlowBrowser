// bridge for the browser chrome (tabs, toolbar, sidebar)
const { contextBridge, ipcRenderer } = require('electron')

const listen = ch => cb => {
  const fn = (_, ...a) => cb(...a)
  ipcRenderer.on(ch, fn)
  return () => ipcRenderer.removeListener(ch, fn)
}

contextBridge.exposeInMainWorld('flow', {
  send: (ch, ...a) => ipcRenderer.send(ch, ...a),
  suggest: text => ipcRenderer.invoke('suggest', text),
  onTabs: listen('tabs'),
  onSettings: listen('settings'),
  onDownloads: listen('downloads'),
  onFocusAddress: listen('focus-address'),
  onFindOpen: listen('find-open'),
  onFindResult: listen('find-result'),
  onFullscreen: listen('fullscreen'),
  onWindowState: listen('window-state'),
  onPanel: listen('panel'),
  onNowPlaying: listen('nowplaying'),
  onVpn: listen('vpn'),
  onFrames: listen('frames')
})
