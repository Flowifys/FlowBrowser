// tiny json file storage. everything lives in the user data folder.
const fs = require('fs')
const path = require('path')
const { app } = require('electron')

class Store {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), name + '.json')
    this.defaults = defaults
    this.data = structuredClone(defaults)
    let saved = null
    try {
      saved = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (Array.isArray(defaults)) this.data = Array.isArray(saved) ? saved : this.data
      else this.data = { ...this.data, ...saved }
    } catch {}
    this.timer = null
    // settings from the first version: move them over to the new default look
    if (name === 'settings' && saved && !saved.settingsVersion) {
      this.data.accent = defaults.accent
      this.data.settingsVersion = 2
    }
  }

  // writes are batched so typing in settings doesn't hammer the disk
  save(now = false) {
    clearTimeout(this.timer)
    const write = () => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data))
        fs.renameSync(this.file + '.tmp', this.file)
      } catch (e) {
        console.error('could not save', this.file, e)
      }
    }
    if (now) write()
    else this.timer = setTimeout(write, 400)
  }
}

const DEFAULT_SETTINGS = {
  settingsVersion: 2,
  accent: '#7c5cff',
  theme: 'midnight',
  searchEngine: 'flow',
  adblock: true,
  startup: 'restore',            // restore | newtab
  suggestions: true,
  wallpaper: 'flow',             // flow | aurora | none | custom
  wallpaperFile: null,
  wallpaperDim: 35,
  wallpaperBlur: 0,
  showClock: true,
  smoothScroll: true,
  rpc: false,
  vpn: false,                    // Flow VPN (tor) on at startup
  vpnCountry: '',
  rpcAppId: '',
  rpcShowTitles: true,
  sidebarApps: ['discord', 'spotify', 'whatsapp', 'telegram', 'ytmusic', 'twitch'],
  speedDial: [
    { title: 'YouTube', url: 'https://www.youtube.com' },
    { title: 'Discord', url: 'https://discord.com/app' },
    { title: 'GitHub', url: 'https://github.com' },
    { title: 'Reddit', url: 'https://www.reddit.com' },
    { title: 'Twitch', url: 'https://www.twitch.tv' },
    { title: 'Netflix', url: 'https://www.netflix.com' },
    { title: 'Roblox', url: 'https://www.roblox.com' },
    { title: 'Wikipedia', url: 'https://en.wikipedia.org' }
  ],
  window: { width: 1360, height: 860, maximized: false }
}

module.exports = {
  settings: new Store('settings', DEFAULT_SETTINGS),
  history: new Store('history', []),
  bookmarks: new Store('bookmarks', []),
  session: new Store('session', { tabs: [], active: 0 }),
  permissions: new Store('permissions', {}),
  DEFAULT_SETTINGS
}
