const SWATCHES = ['#7c5cff', '#22d3ee', '#ff2e55', '#ff6b2c', '#ffc22e', '#4be38a', '#3f8cff', '#ff4fd8', '#e9eaf0']

function toast(text) {
  const t = $('#toast')
  t.textContent = text
  t.classList.add('show')
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => t.classList.remove('show'), 1800)
}

function fill(s) {
  $('#swatches').innerHTML = SWATCHES.map(c => `<div class="sw${c === s.accent ? ' on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('') +
    `<input type="color" class="custom-color" id="customcolor" value="${s.accent}" title="Custom colour">`
  $$('.sw').forEach(el => el.onclick = () => set({ accent: el.dataset.c }))
  $('#customcolor').onchange = e => set({ accent: e.target.value })

  $('#themes').innerHTML = Object.entries(s.themes).map(([k, t]) =>
    `<div class="th${k === s.theme ? ' on' : ''}" data-t="${k}" style="background:linear-gradient(135deg, ${t.raise2}, ${t.bg})"><i></i>${esc(t.name)}</div>`).join('')
  $$('.th').forEach(el => el.onclick = () => set({ theme: el.dataset.t }))
  $('#photoset').classList.toggle('hidden', s.wallpaper !== 'custom')
  $('#dim').value = s.wallpaperDim ?? 35
  $('#blur').value = s.wallpaperBlur || 0
  $('#rpcid').value = s.rpcAppId || ''

  $$('#walls button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === s.wallpaper)
    b.onclick = async () => {
      if (b.dataset.v === 'custom') { const r = await window.flow.pickWallpaper(); if (r) fill(r) }
      else set({ wallpaper: b.dataset.v })
    }
  })
  $$('#start button').forEach(b => { b.classList.toggle('on', b.dataset.v === s.startup); b.onclick = () => set({ startup: b.dataset.v }) })

  $$('[data-key]').forEach(i => {
    i.checked = s[i.dataset.key] !== false
    i.onchange = () => set({ [i.dataset.key]: i.checked })
  })

  $('#engine').innerHTML = Object.entries(s.engines).map(([k, v]) => `<option value="${k}"${k === s.searchEngine ? ' selected' : ''}>${esc(v)}</option>`).join('')
  $('#engine').onchange = e => set({ searchEngine: e.target.value })

  $('#applist').innerHTML = Object.entries(s.apps).map(([id, a]) =>
    `<label class="app${s.sidebarApps.includes(id) ? ' on' : ''}" data-id="${id}"><input type="checkbox"${s.sidebarApps.includes(id) ? ' checked' : ''}><img src="https://icons.duckduckgo.com/ip3/${a.host}.ico">${esc(a.name)}</label>`).join('')
  $$('.app').forEach(el => el.querySelector('input').onchange = e => {
    const list = SETTINGS.sidebarApps.filter(x => x !== el.dataset.id)
    if (e.target.checked) list.push(el.dataset.id)
    set({ sidebarApps: list })
  })

  $('#ver').textContent = `Version ${s.version}  /  Chromium ${s.versions.chrome}  /  Electron ${s.versions.electron}`
}

async function set(patch) {
  SETTINGS = await window.flow.set(patch)
  fill(SETTINGS)
  toast('Saved')
}

$('#dim').onchange = e => set({ wallpaperDim: Number(e.target.value) })
$('#blur').onchange = e => set({ wallpaperBlur: Number(e.target.value) })
$('#changepic').onclick = async () => { const r = await window.flow.pickWallpaper(); if (r) { SETTINGS = r; fill(r) } }
$('#rpcsave').onclick = () => {
  const id = $('#rpcid').value.trim()
  if (id && !/^\d{15,25}$/.test(id)) return toast('That doesn\'t look like an Application ID')
  set({ rpcAppId: id, rpc: id ? true : SETTINGS.rpc })
}
$('#rpcportal').onclick = () => window.flow.open('https://discord.com/developers/applications', true)

$('#clearbtn').onclick = async () => {
  const what = $$('.clear input:checked').map(i => i.value)
  if (!what.length) return
  await window.flow.clearData(what)
  toast('Cleared')
}
$('#default').onclick = () => window.flow.makeDefault()
$('#reset').onclick = async () => {
  if (!confirm('Reset every setting?')) return
  SETTINGS = await window.flow.resetSettings()
  fill(SETTINGS)
  toast('Settings reset')
}

// highlight the section you're looking at in the side nav
const links = $$('.side a')
const spy = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id))
}, { rootMargin: '-30% 0px -60% 0px' })
$$('section').forEach(s => spy.observe(s))

boot(async s => {
  fill(s)
  const n = await window.flow.blockedTotal()
  $('#blockedline').textContent = `Built in blocker, ${n.toLocaleString()} blocked since Flow started`
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView()
})
window.onSettingsChanged = fill
