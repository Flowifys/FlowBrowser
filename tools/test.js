// loads the real browser, waits, then screenshots every view so the layout can be checked
const { app, webContents } = require('electron')
const fs = require('fs')
const path = require('path')
process.env.TEST_SHOT_DIR = process.env.TEST_SHOT_DIR || '/tmp/flowshots'
fs.mkdirSync(process.env.TEST_SHOT_DIR, { recursive: true })
app.setPath('userData', '/tmp/flow-userdata')
require('../src/main/main.js')
const steps = JSON.parse(process.env.STEPS || '[]')
app.whenReady().then(() => setTimeout(async () => {
  for (const s of steps) {
    const all = webContents.getAllWebContents()
    const ui = all.find(w => w.getURL().includes('ui/index.html'))
    if (s.js) await ui.executeJavaScript(s.js).catch(e => console.log('js err', e.message))
    if (s.tabjs) {
      const tab = all.filter(w => w.getURL().startsWith(s.tabUrl || 'flow://')).pop()
      if (tab) await tab.executeJavaScript(s.tabjs).catch(e => console.log('tab js err', e.message))
    }
    if (s.wait) await new Promise(r => setTimeout(r, s.wait))
  }
  let i = 0
  for (const wc of webContents.getAllWebContents()) {
    try {
      const img = await wc.capturePage()
      const name = `${i++}_${wc.getURL().replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`
      fs.writeFileSync(path.join(process.env.TEST_SHOT_DIR, name), img.toPNG())
      console.log('shot', name, img.getSize())
    } catch (e) { console.log('fail', wc.getURL(), e.message) }
  }
  app.quit()
}, Number(process.env.WAIT || 4000)))
process.on('uncaughtException', e => console.log('UNCAUGHT', e))
