// Flow Search results page
const params = new URLSearchParams(location.search)
let query = params.get('q') || ''
let vertical = params.get('v') || 'web'
let nextParams = null
let imageNext = null
let started = 0

$('#q').value = query
$('#clear').innerHTML = icon('close')
$('#go').innerHTML = icon('search')
document.title = query ? `${query} - Flow Search` : 'Flow Search'

$('#form').onsubmit = e => {
  e.preventDefault()
  const v = $('#q').value.trim()
  if (v) location.href = `flow://search/?q=${encodeURIComponent(v)}${vertical !== 'web' ? '&v=' + vertical : ''}`
}
$('#clear').onclick = () => { $('#q').value = ''; $('#q').focus() }

$$('#verticals button').forEach(b => {
  b.classList.toggle('on', b.dataset.v === vertical)
  b.onclick = () => { location.href = `flow://search/?q=${encodeURIComponent(query)}${b.dataset.v !== 'web' ? '&v=' + b.dataset.v : ''}` }
})

// ---------------------------------------------------------------- web results

// duckduckgo wraps every link in a redirect, pull the real address back out
function realUrl(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com')
    return u.searchParams.get('uddg') || u.href
  } catch {
    return href
  }
}

function parse(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out = []
  for (const el of doc.querySelectorAll('.result')) {
    if (el.classList.contains('result--ad') || el.querySelector('.badge--ad')) continue
    const a = el.querySelector('a.result__a')
    if (!a) continue
    const url = realUrl(a.getAttribute('href'))
    if (/duckduckgo\.com\/y\.js/.test(url)) continue
    const snip = el.querySelector('.result__snippet')
    out.push({ title: a.textContent.trim(), url, snippet: snip ? snip.innerHTML : '' })
  }
  // the "next page" form carries everything needed for page 2
  let next = null
  for (const form of doc.querySelectorAll('.nav-link form')) {
    const btn = form.querySelector('input[type=submit]')
    if (btn && /next/i.test(btn.value)) {
      next = {}
      form.querySelectorAll('input[name]').forEach(i => { next[i.name] = i.value })
    }
  }
  const blocked = !!doc.querySelector('.anomaly-modal__title, #challenge-form')
  return { results: out, next, blocked }
}

// only keep <b> from snippets, everything else becomes text
function cleanSnippet(html) {
  // parsed in an inert document so nothing in it can run
  const tmp = new DOMParser().parseFromString(html, 'text/html').body
  let out = ''
  tmp.childNodes.forEach(n => {
    if (n.nodeType === 3) out += esc(n.textContent)
    else if (n.nodeName === 'B') out += '<b>' + esc(n.textContent) + '</b>'
    else out += esc(n.textContent)
  })
  return out
}

function crumbs(url) {
  try {
    const u = new URL(url)
    const parts = u.pathname.split('/').filter(Boolean).slice(0, 3).map(decodeURIComponent)
    return [u.hostname.replace(/^www\./, ''), ...parts].join(' › ')
  } catch {
    return url
  }
}

function siteName(url) {
  const h = host(url)
  const base = h.split('.').slice(-2, -1)[0] || h
  return base.charAt(0).toUpperCase() + base.slice(1)
}

function renderResults(list) {
  const box = $('#results')
  const frag = document.createDocumentFragment()
  list.forEach((r, i) => {
    const el = document.createElement('div')
    el.className = 'r'
    el.style.animationDelay = (i * 25) + 'ms'
    el.innerHTML = `
      <div class="site"><img src="${favicon(r.url)}"><div><div class="n">${esc(siteName(r.url))}</div><div class="u">${esc(crumbs(r.url))}</div></div></div>
      <h3><a href="${esc(r.url)}">${esc(r.title)}</a></h3>
      <p>${cleanSnippet(r.snippet)}</p>`
    el.querySelector('img').onerror = function () { this.style.visibility = 'hidden' }
    frag.appendChild(el)
  })
  box.appendChild(frag)
}

async function loadWeb(more) {
  const box = $('#results')
  if (!more) {
    started = performance.now()
    box.innerHTML = '<div class="skel"></div>'.repeat(5)
    calc()
    instant()
  } else {
    box.querySelector('.more')?.remove()
  }
  const res = await window.flow.web(query, more ? nextParams : null)
  if (!more) box.innerHTML = ''
  if (!res || res.status !== 200 || !res.html) return failed(box)
  const { results, next, blocked } = parse(res.html)
  if (blocked) return failed(box, true)
  if (!more) {
    const meta = document.createElement('p')
    meta.className = 'meta'
    meta.textContent = results.length ? `Results in ${((performance.now() - started) / 1000).toFixed(2)}s` : ''
    box.appendChild(meta)
    if (window.pendingAnswer) box.prepend(window.pendingAnswer)
  }
  if (!results.length && !more) {
    box.insertAdjacentHTML('beforeend', `<div class="status">Nothing found for <b>${esc(query)}</b>. Try different words.</div>`)
    return
  }
  renderResults(results)
  nextParams = next
  if (next) {
    const m = document.createElement('div')
    m.className = 'more'
    m.innerHTML = '<button class="btn">More results</button>'
    m.querySelector('button').onclick = () => { m.innerHTML = '<div class="skel" style="width:100%"></div>'; loadWeb(true) }
    box.appendChild(m)
  }
}

function failed(box, rateLimited) {
  box.innerHTML = `<div class="status">${rateLimited
    ? 'The results server wants to make sure you are human right now.'
    : 'Could not load results. Check your connection.'}
    <br><br><a class="btn primary" href="https://duckduckgo.com/?q=${encodeURIComponent(query)}">Open this search on DuckDuckGo</a></div>`
  if (window.pendingAnswer) box.prepend(window.pendingAnswer)
}

// ---------------------------------------------------------------- answers + knowledge panel

// small safe calculator: numbers, + - * / ^ % ( ) and a few functions. no eval
function calc() {
  const src = query.replace(/\s+/g, '').replace(/x/gi, '*').replace(/÷/g, '/').replace(/=$/, '')
  if (!/^[\d.+\-*/^%()a-z]+$/i.test(src) || !/\d/.test(src) || !/[+\-*/^%(]/.test(src.slice(1))) return
  let i = 0
  const peek = () => src[i]
  const num = () => {
    const m = src.slice(i).match(/^(\d+\.?\d*|\.\d+)/)
    if (m) { i += m[0].length; return parseFloat(m[0]) }
    const f = src.slice(i).match(/^(sqrt|sin|cos|tan|log|ln|abs|pi|e)/i)
    if (f) {
      i += f[0].length
      const name = f[0].toLowerCase()
      if (name === 'pi') return Math.PI
      if (name === 'e') return Math.E
      const v = factor()
      return { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs }[name](v)
    }
    throw 0
  }
  const factor = () => {
    if (peek() === '-') { i++; return -factor() }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v }
    return num()
  }
  const power = () => { let v = factor(); while (peek() === '^') { i++; v = Math.pow(v, factor()) } if (peek() === '%') { i++; v /= 100 } return v }
  const term = () => { let v = power(); while (peek() === '*' || peek() === '/') { const op = src[i++]; const r = power(); v = op === '*' ? v * r : v / r } return v }
  const expr = () => { let v = term(); while (peek() === '+' || peek() === '-') { const op = src[i++]; const r = term(); v = op === '+' ? v + r : v - r } return v }
  try {
    const v = expr()
    if (i !== src.length || !isFinite(v)) return
    const nice = Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(6) : +v.toPrecision(12)
    showAnswer(query.replace(/=$/, '') + ' =', nice.toLocaleString ? nice.toLocaleString(undefined, { maximumFractionDigits: 10 }) : nice, 'Calculator')
  } catch {}
}

function showAnswer(k, v, s) {
  const el = document.createElement('div')
  el.className = 'answer'
  el.innerHTML = `<div class="k">${esc(k)}</div><div class="v">${esc(v)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}`
  const box = $('#results')
  if (box.querySelector('.skel')) window.pendingAnswer = el
  else box.prepend(el)
}

async function instant() {
  const d = await window.flow.instant(query)
  const side = $('#side')
  side.innerHTML = ''
  if (!d) return

  if (d.Answer && typeof d.Answer === 'string') showAnswer(query, d.Answer, d.AnswerType ? d.AnswerType.replace(/_/g, ' ') : '')

  let panel = null
  if (d.AbstractText) {
    panel = { title: d.Heading, extract: d.AbstractText, url: d.AbstractURL, source: d.AbstractSource, image: d.Image ? (d.Image.startsWith('http') ? d.Image : 'https://duckduckgo.com' + d.Image) : null }
  } else if (query.split(' ').length <= 5) {
    const w = await window.flow.wiki(query)
    if (w) panel = { title: w.title, description: w.description, extract: w.extract, url: w.url, source: 'Wikipedia', image: w.image }
  }
  if (panel) {
    const facts = (d.Infobox && d.Infobox.content || []).filter(x => typeof x.value === 'string' && x.label).slice(0, 7)
    side.innerHTML = `<div class="panel card">
      ${panel.image ? `<img class="hero" src="${esc(panel.image)}">` : ''}
      <h2>${esc(panel.title)}</h2>
      ${panel.description ? `<div class="d">${esc(panel.description)}</div>` : '<div class="d"></div>'}
      <p>${esc(panel.extract.length > 520 ? panel.extract.slice(0, 520).replace(/\s\S*$/, '') + '...' : panel.extract)}</p>
      ${facts.length ? `<table>${facts.map(f => `<tr><td>${esc(f.label)}</td><td>${esc(f.value)}</td></tr>`).join('')}</table>` : ''}
      ${panel.url ? `<a class="src" href="${esc(panel.url)}">Read more on ${esc(panel.source || host(panel.url))}</a>` : ''}
    </div>`
    const img = side.querySelector('.hero')
    if (img) img.onerror = () => img.remove()
  }

  const related = (d.RelatedTopics || []).filter(t => t.Text && t.FirstURL).slice(0, 8)
  if (related.length) {
    const r = document.createElement('div')
    r.className = 'related'
    r.innerHTML = '<h4>Related</h4><div class="chips">' + related.map(t => {
      const name = t.Text.split(' - ')[0].slice(0, 40)
      return `<a href="flow://search/?q=${encodeURIComponent(name)}">${esc(name)}</a>`
    }).join('') + '</div>'
    ;(panel ? side.firstChild : side).appendChild(r)
  }
}

// ---------------------------------------------------------------- images

async function loadImages(more) {
  const box = $('#results')
  box.classList.add('images')
  $('#side').remove()
  if (!more) box.innerHTML = '<div class="skel"></div>'.repeat(3)
  const { results, next } = await window.flow.images(query, more ? imageNext : null)
  if (!more) box.innerHTML = '<div class="igrid"></div>'
  box.querySelector('.more')?.remove()
  const grid = box.querySelector('.igrid')
  grid.querySelector('.fill')?.remove()
  if (!results.length && !more) { box.innerHTML = '<div class="status">No images found.</div>'; return }
  results.forEach((r, i) => {
    const d = document.createElement('div')
    d.className = 'im'
    d.style.width = Math.round(190 * (r.w / r.h || 1.4)) + 'px'
    d.style.animationDelay = (i % 30) * 15 + 'ms'
    d.innerHTML = `<img src="${esc(r.thumb)}" loading="lazy"><div class="cap">${esc(r.title)}</div>`
    d.querySelector('img').onerror = () => d.remove()
    d.onclick = () => view(r)
    grid.appendChild(d)
  })
  grid.insertAdjacentHTML('beforeend', '<div class="fill"></div>')
  imageNext = next
  if (next) {
    const m = document.createElement('div')
    m.className = 'more'
    m.innerHTML = '<button class="btn">More images</button>'
    m.querySelector('button').onclick = () => loadImages(true)
    box.appendChild(m)
  }
}

function view(r) {
  $('#vimg').src = r.thumb
  const full = new Image()
  full.onload = () => { $('#vimg').src = r.image }
  full.src = r.image
  $('#vtitle').textContent = r.title
  $('#vsrc').textContent = `${host(r.url)}  /  ${r.w} x ${r.h}`
  $('#vvisit').href = r.url
  $('#vopen').href = r.image
  $('#viewer').classList.remove('hidden')
}
$('#vclose').onclick = () => $('#viewer').classList.add('hidden')
$('#viewer').onclick = e => { if (e.target.id === 'viewer') $('#viewer').classList.add('hidden') }
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#viewer').classList.add('hidden') })

// ---------------------------------------------------------------- news

async function loadNews() {
  const box = $('#results')
  box.innerHTML = '<div class="skel"></div>'.repeat(4)
  const list = await window.flow.news(query)
  box.innerHTML = list.length ? '' : '<div class="status">No news for this right now.</div>'
  list.forEach((n, i) => {
    const a = document.createElement('a')
    a.className = 'news'
    a.href = n.url
    a.style.animationDelay = i * 30 + 'ms'
    a.innerHTML = `${n.image ? `<img src="${esc(n.image)}">` : ''}<div><div class="src">${esc(n.source || host(n.url))}  /  ${n.date ? ago(n.date * 1000) : ''}</div><h3>${esc(n.title)}</h3><p>${esc(n.excerpt || '')}</p></div>`
    const img = a.querySelector('img')
    if (img) img.onerror = () => img.remove()
    box.appendChild(a)
  })
  instant()
}

// ---------------------------------------------------------------- start

boot(() => {
  if (!query) { $('#results').innerHTML = '<div class="status">Type something to search.</div>'; $('#q').focus(); return }
  if (vertical === 'images') loadImages()
  else if (vertical === 'news') loadNews()
  else loadWeb()
})
