// ad + tracker blocking with ghostery's engine. the filter lists get cached so startup stays quick.
const path = require('path')
const fs = require('fs/promises')
const { app, net } = require('electron')

let blocker = null
let sessions = []
let enabled = false
let blockedTotal = 0
let onBlocked = () => {}

async function init(list, callback, on) {
  sessions = list
  onBlocked = callback
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron')
    const cache = path.join(app.getPath('userData'), 'adblock-engine.bin')
    blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(url => net.fetch(url), {
      path: cache,
      read: fs.readFile,
      write: fs.writeFile
    })
    blocker.on('request-blocked', req => {
      blockedTotal++
      if (req.tabId) onBlocked(req.tabId)
    })
    setEnabled(on)
  } catch (e) {
    console.error('adblock failed to start', e)
  }
}

function setEnabled(on) {
  if (!blocker || on === enabled) return
  enabled = on
  for (const ses of sessions) {
    try {
      if (on) blocker.enableBlockingInSession(ses)
      else blocker.disableBlockingInSession(ses)
    } catch {}
  }
}

module.exports = { init, setEnabled, total: () => blockedTotal }
