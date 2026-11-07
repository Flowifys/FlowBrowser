// new tab page: clock, search, pinned sites, wallpaper + theme picker
const SWATCHES = ['#7c5cff', '#22d3ee', '#ff2e55', '#ff6b2c', '#ffc22e', '#4be38a', '#3f8cff', '#ff4fd8', '#e9eaf0']

let pins = []
let editIndex = -1

function tick() {
  const d = new Date()
  $('#time').textContent = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '')
  const part = d.getHours() < 5 ? 'Up late' : d.getHours() < 12 ? 'Good morning' : d.getHours() < 18 ? 'Good afternoon' : 'Good evening'
  $('#date').textContent = `${part}  ·  ${d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`
}

function applyLook(s) {
  document.body.className = 'wall-' + (s.wallpaper || 'flow')
  if (s.wallpaper === 'custom') {
    $('#photo').style.backgroundImage = `url(flow://wallpaper/?v=${encodeURIComponent(s.wallpaperFile || '')})`
    $('#photo').style.filter = `blur(${s.wallpaperBlur || 0}px)`
    $('#shade').style.opacity = (s.wallpaperDim ?? 35) / 100
  }
  if (s.wallpaper === 'aurora') startAurora()
  $('#photoopts').classList.toggle('hidden', s.wallpaper !== 'custom')
  $('#dim').value = s.wallpaperDim ?? 35
  $('#blur').value = s.wallpaperBlur || 0
  $('#clock').classList.toggle('hidden', s.showClock === false)
  $('#showclock').checked = s.showClock !== false
  $$('.walls button').forEach(b => b.classList.toggle('on', b.dataset.wall === s.wallpaper))
  $('#upload').textContent = s.wallpaper === 'custom' ? 'Change picture' : 'Upload picture'
  $$('.sw').forEach(b => b.classList.toggle('on', b.dataset.c === s.accent))
  $('#themes').innerHTML = Object.entries(s.themes || {}).map(([k, t]) =>
    `<div class="th${k === s.theme ? ' on' : ''}" data-t="${k}" style="background:linear-gradient(135deg, ${t.raise2}, ${t.bg})">${esc(t.name)}</div>`).join('')
  $$('.th').forEach(el => el.onclick = () => window.flow.set({ theme: el.dataset.t }))
  const engine = (s.engines || {})[s.searchEngine] || 'Flow Search'
  $('#engine').innerHTML = icon('search') + esc(engine)
  $('#q').placeholder = 'Search with ' + engine
}

// ---------------------------------------------------------------- pins

function drawPins() {
  const box = $('#pins')
  box.innerHTML = ''
  pins.forEach((p, i) => {
    const a = document.createElement('a')
    a.className = 'pin'
    a.href = p.url
    a.innerHTML = `<span class="ic"><img src="${favicon(p.url)}"></span><span>${esc(p.title)}</span><button class="ed" title="Edit">${icon('edit')}</button>`
    a.querySelector('img').onerror = function () { this.parentNode.innerHTML = `<b>${esc((p.title || '?')[0].toUpperCase())}</b>` }
    a.querySelector('.ed').onclick = e => { e.preventDefault(); e.stopPropagation(); openModal(i) }
    a.oncontextmenu = e => { e.preventDefault(); openModal(i) }
    box.appendChild(a)
  })
  if (pins.length < 30) {
    const add = document.createElement('div')
    add.className = 'pin add'
    add.innerHTML = icon('plus') + '<span>Pin a site</span>'
    add.onclick = () => openModal(-1)
    box.appendChild(add)
  }
}

function openModal(i) {
  editIndex = i
  const p = pins[i] || { title: '', url: '' }
  $('#modaltitle').textContent = i < 0 ? 'Pin a site' : 'Edit pin'
  $('#pname').value = p.title
  $('#purl').value = p.url
  $('#premove').classList.toggle('hidden', i < 0)
  $('#modal').classList.remove('hidden')
  setTimeout(() => (i < 0 ? $('#purl') : $('#pname')).focus(), 30)
}

const closeModal = () => $('#modal').classList.add('hidden')

$('#pinform').onsubmit = e => {
  e.preventDefault()
  let url = $('#purl').value.trim()
  if (!url) return
  if (!/^\w+:\/\//.test(url)) url = 'https://' + url
  const title = $('#pname').value.trim() || host(url).split('.')[0].replace(/^\w/, c => c.toUpperCase())
  if (editIndex < 0) pins.push({ title, url })
  else pins[editIndex] = { title, url }
  window.flow.set({ speedDial: pins })
  drawPins()
  closeModal()
}
$('#pcancel').onclick = closeModal
$('#premove').onclick = () => { pins.splice(editIndex, 1); window.flow.set({ speedDial: pins }); drawPins(); closeModal() }
$('#modal').onclick = e => { if (e.target === $('#modal')) closeModal() }

// ---------------------------------------------------------------- search + suggestions

const q = $('#q')
let sugs = []
let sel = -1
let req = 0

$('#searchform .go').innerHTML = icon('arrow')
$('#searchform').onsubmit = e => {
  e.preventDefault()
  const v = sel >= 0 && sugs[sel] ? (sugs[sel].url || sugs[sel].text) : q.value
  if (v.trim()) window.flow.search(v)
}

q.oninput = async () => {
  const id = ++req
  if (!q.value.trim()) return hideSugs()
  const list = await window.flow.suggest(q.value)
  if (id !== req) return
  sugs = list.slice(0, 8)
  sel = -1
  drawSugs()
}

q.onkeydown = e => {
  if (!sugs.length) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + sugs.length + 1) % (sugs.length + 1)
    if (sel === sugs.length) sel = -1
    drawSugs()
  }
  if (e.key === 'Escape') hideSugs()
}
q.onblur = () => setTimeout(hideSugs, 120)

function drawSugs() {
  const box = $('#sugs')
  if (!sugs.length) return hideSugs()
  box.classList.remove('hidden')
  $('#searchform').classList.add('open')
  box.innerHTML = ''
  sugs.forEach((s, i) => {
    const r = document.createElement('div')
    r.className = 's' + (i === sel ? ' sel' : '')
    r.innerHTML = s.type === 'search'
      ? icon('search') + `<span>${esc(s.text)}</span>`
      : icon(s.type === 'bookmark' ? 'star' : 'history') + `<span>${esc(s.title || s.url)}</span><span class="u">${esc(host(s.url))}</span>`
    r.onmousedown = e => { e.preventDefault(); window.flow.search(s.url || s.text) }
    box.appendChild(r)
  })
}

function hideSugs() {
  sugs = []
  sel = -1
  $('#sugs').classList.add('hidden')
  $('#searchform').classList.remove('open')
}

// ---------------------------------------------------------------- customize drawer

$('#custom').onclick = () => $('#drawer').classList.toggle('hidden')
document.addEventListener('mousedown', e => {
  if (!e.target.closest('#drawer') && !e.target.closest('#custom')) $('#drawer').classList.add('hidden')
})
$$('.walls button').forEach(b => b.onclick = async () => {
  if (b.dataset.wall === 'custom') {
    const s = await window.flow.pickWallpaper()
    if (s) applyLook(s)
  } else window.flow.set({ wallpaper: b.dataset.wall })
})
$('#dim').oninput = e => { $('#shade').style.opacity = e.target.value / 100 }
$('#dim').onchange = e => window.flow.set({ wallpaperDim: Number(e.target.value) })
$('#blur').oninput = e => { $('#photo').style.filter = `blur(${e.target.value}px)` }
$('#blur').onchange = e => window.flow.set({ wallpaperBlur: Number(e.target.value) })
$('#swatches').innerHTML = SWATCHES.map(c => `<div class="sw" data-c="${c}" style="background:${c}"></div>`).join('')
$$('.sw').forEach(s => s.onclick = () => window.flow.set({ accent: s.dataset.c }))
$('#showclock').onchange = e => window.flow.set({ showClock: e.target.checked })
$('#opensettings').onclick = () => window.flow.open('flow://settings/')

// ---------------------------------------------------------------- aurora wallpaper

let auroraOn = false
function startAurora() {
  if (auroraOn) return
  auroraOn = true
  const c = $('#aurora')
  const g = c.getContext('2d')
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const draw = t => {
    if (!document.body.classList.contains('wall-aurora')) { auroraOn = false; return }
    const w = c.width = innerWidth, h = c.height = innerHeight
    g.clearRect(0, 0, w, h)
    for (const [color, alpha, off] of [[css('--accent'), .5, 0], [css('--accent-2'), .35, 2], [css('--accent'), .2, 4]]) {
      g.beginPath()
      for (let x = 0; x <= w; x += 8) {
        const y = h * .45 + Math.sin(x / 260 + t / 2400 + off) * 90 + Math.sin(x / 120 + t / 1500 + off * 2) * 30
        x ? g.lineTo(x, y) : g.moveTo(x, y)
      }
      g.lineTo(w, h); g.lineTo(0, h); g.closePath()
      const grad = g.createLinearGradient(0, h * .3, 0, h)
      grad.addColorStop(0, color)
      grad.addColorStop(1, 'transparent')
      g.globalAlpha = alpha
      g.filter = 'blur(40px)'
      g.fillStyle = grad
      g.fill()
    }
    g.filter = 'none'
    g.globalAlpha = 1
    requestAnimationFrame(draw)
  }
  requestAnimationFrame(draw)
}

// ---------------------------------------------------------------- start

boot(async s => {
  pins = s.speedDial || []
  applyLook(s)
  drawPins()
  const n = await window.flow.blockedTotal()
  $('#stat').innerHTML = s.adblock ? icon('shield') + `${n.toLocaleString()} ads and trackers blocked this session` : ''
})
window.onSettingsChanged = s => { pins = s.speedDial || pins; applyLook(s); drawPins() }
tick()
setInterval(tick, 1000)
