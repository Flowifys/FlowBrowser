let items = []

async function load() {
  items = await window.flow.history($('#filter').value, 600)
  draw()
}

function draw() {
  const box = $('#list')
  box.innerHTML = ''
  if (!items.length) {
    box.innerHTML = `<div class="empty">${icon('history')}Nothing here yet</div>`
    return
  }
  let lastDay = ''
  for (const h of items) {
    const day = dayLabel(h.time)
    if (day !== lastDay) {
      box.insertAdjacentHTML('beforeend', `<div class="group-label">${esc(day)}</div>`)
      lastDay = day
    }
    const row = document.createElement('a')
    row.className = 'row'
    row.href = h.url
    row.innerHTML = `<div class="time">${new Date(h.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
      <img class="fav" src="${favicon(h.url)}">
      <div class="main"><div class="title">${esc(h.title || h.url)}</div><div class="sub">${esc(host(h.url))}</div></div>
      <div class="acts"><button class="iconbtn" title="Remove">${icon('close')}</button></div>`
    row.querySelector('img').onerror = function () { this.style.visibility = 'hidden' }
    row.querySelector('button').onclick = async e => {
      e.preventDefault()
      await window.flow.removeHistory(h.url)
      items = items.filter(x => x.url !== h.url)
      draw()
    }
    box.appendChild(row)
  }
}

$('#action').innerHTML = icon('trash') + 'Clear history'
$('#action').onclick = async () => {
  if (!confirm('Clear all of your history?')) return
  await window.flow.clearData(['history'])
  load()
}
$('#filter').oninput = () => { clearTimeout(load.t); load.t = setTimeout(load, 150) }
boot(load)
