let items = []

function draw() {
  const q = $('#filter').value.toLowerCase()
  const list = items.filter(d => !q || d.name.toLowerCase().includes(q) || d.url.toLowerCase().includes(q))
  const box = $('#list')
  box.innerHTML = ''
  if (!list.length) {
    box.innerHTML = `<div class="empty">${icon('download')}${items.length ? 'No matches' : 'Files you download show up here'}</div>`
    return
  }
  for (const d of list) {
    const row = document.createElement('div')
    row.className = 'row card'
    row.style.marginBottom = '8px'
    const pct = d.total ? Math.round(d.received / d.total * 100) : 0
    let sub
    if (d.state === 'progressing') sub = `${bytes(d.received)} of ${d.total ? bytes(d.total) : '?'}  /  ${pct}%`
    else if (d.state === 'paused') sub = `Paused  /  ${bytes(d.received)} of ${bytes(d.total)}`
    else if (d.state === 'completed') sub = `${bytes(d.total || d.received)}  /  ${host(d.url)}`
    else if (d.state === 'cancelled') sub = 'Cancelled'
    else sub = 'Failed'
    const done = d.state === 'completed'
    row.innerHTML = `<div class="main"><div class="title" style="${done ? '' : 'color:var(--dim)'}">${esc(d.name)}</div><div class="sub">${esc(sub)}</div>
      ${d.state === 'progressing' || d.state === 'paused' ? `<div style="height:4px;border-radius:4px;background:var(--raise-2);margin-top:8px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent);box-shadow:0 0 10px var(--accent-glow)"></div></div>` : ''}</div>
      <div class="acts" style="opacity:1"></div>`
    const acts = row.querySelector('.acts')
    const add = (ic, title, action) => {
      const b = document.createElement('button')
      b.className = 'iconbtn'
      b.title = title
      b.innerHTML = icon(ic)
      b.onclick = () => window.flow.download(d.id, action)
      acts.appendChild(b)
    }
    if (done) { add('open', 'Open', 'open'); add('folder', 'Show in folder', 'show') }
    if (d.state === 'progressing') { add('pause', 'Pause', 'pause'); add('close', 'Cancel', 'cancel') }
    if (d.state === 'paused') { add('play', 'Resume', 'resume'); add('close', 'Cancel', 'cancel') }
    if (d.state !== 'progressing' && d.state !== 'paused') add('trash', 'Remove from list', 'remove')
    box.appendChild(row)
  }
}

$('#action').innerHTML = icon('trash') + 'Clear list'
$('#action').onclick = () => window.flow.clearDownloads()
$('#filter').oninput = draw
boot(async () => {
  items = await window.flow.downloads()
  draw()
  window.flow.onDownloads(list => { items = list; draw() })
})
