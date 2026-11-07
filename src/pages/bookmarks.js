let items = []

async function load() {
  items = await window.flow.bookmarks()
  draw()
}

function draw() {
  const q = $('#filter').value.toLowerCase()
  const list = items.filter(b => !q || b.url.toLowerCase().includes(q) || (b.title || '').toLowerCase().includes(q))
  const box = $('#list')
  box.innerHTML = ''
  if (!list.length) {
    box.innerHTML = `<div class="empty">${icon('star')}${items.length ? 'No matches' : 'Press Ctrl+D or the star in the address bar to bookmark a page'}</div>`
    return
  }
  for (const b of list) {
    const row = document.createElement('a')
    row.className = 'row'
    row.href = b.url
    row.innerHTML = `<img class="fav" src="${favicon(b.url)}">
      <div class="main"><div class="title">${esc(b.title || b.url)}</div><div class="sub">${esc(b.url)}</div></div>
      <div class="time">${ago(b.time)}</div>
      <div class="acts"><button class="iconbtn rn" title="Rename">${icon('edit')}</button><button class="iconbtn rm" title="Delete">${icon('trash')}</button></div>`
    row.querySelector('img').onerror = function () { this.style.visibility = 'hidden' }
    row.querySelector('.rn').onclick = e => {
      e.preventDefault()
      // electron has no prompt(), so rename right in the row
      const t = row.querySelector('.title')
      const input = document.createElement('input')
      input.className = 'field'
      input.style.cssText = 'height:30px;width:100%'
      input.value = b.title || ''
      t.replaceWith(input)
      input.focus()
      input.select()
      input.onclick = ev => ev.preventDefault()
      const save = async () => {
        b.title = input.value.trim() || b.title
        await window.flow.renameBookmark(b.url, b.title)
        draw()
      }
      input.onkeydown = ev => { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') draw() }
      input.onblur = save
    }
    row.querySelector('.rm').onclick = async e => {
      e.preventDefault()
      await window.flow.removeBookmark(b.url)
      items = items.filter(x => x.url !== b.url)
      draw()
    }
    box.appendChild(row)
  }
}

$('#action').classList.add('hidden')
$('#filter').oninput = draw
window.flow && window.flow.onBookmarks(load)
boot(load)
