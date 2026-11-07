// backend for Flow Search (flow://search). results come from duckduckgo's no-js pages and apis,
// the page itself turns them into flow's own results layout.
const { net } = require('electron')

const UA = () => require('electron').app.userAgentFallback

async function get(url, opts = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 8000)
  try {
    const res = await net.fetch(url, {
      method: opts.method || 'GET',
      body: opts.body,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA(), 'Accept-Language': 'en-US,en;q=0.9', ...(opts.headers || {}) }
    })
    return { status: res.status, text: await res.text() }
  } finally {
    clearTimeout(timer)
  }
}

// web results: the page parses this html (it has a dom, main doesn't)
async function web(q, params) {
  const body = new URLSearchParams(params && Object.keys(params).length ? params : { q, kl: 'us-en' })
  const r = await get('https://html.duckduckgo.com/html/', {
    method: 'POST',
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://html.duckduckgo.com/' }
  })
  return { status: r.status, html: r.text }
}

async function instant(q) {
  try {
    const r = await get(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`, { timeout: 5000 })
    return JSON.parse(r.text)
  } catch {
    return null
  }
}

const vqdCache = new Map()
async function vqd(q) {
  if (vqdCache.has(q)) return vqdCache.get(q)
  const r = await get(`https://duckduckgo.com/?q=${encodeURIComponent(q)}&iax=images&ia=images`)
  const m = r.text.match(/vqd=["']?([\d-]+)["'&]/) || r.text.match(/vqd=([\d-]+)/)
  if (!m) throw new Error('no token')
  vqdCache.set(q, m[1])
  if (vqdCache.size > 50) vqdCache.delete(vqdCache.keys().next().value)
  return m[1]
}

async function images(q, next) {
  const token = await vqd(q)
  const url = next ? `https://duckduckgo.com/${next}&vqd=${token}` :
    `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(q)}&vqd=${token}&f=,,,,,&p=1`
  const r = await get(url, { headers: { Referer: 'https://duckduckgo.com/', Accept: 'application/json' } })
  const data = JSON.parse(r.text)
  return { results: (data.results || []).map(x => ({ image: x.image, thumb: x.thumbnail, title: x.title, url: x.url, w: x.width, h: x.height, source: x.source })), next: data.next || null }
}

async function news(q) {
  const token = await vqd(q)
  const r = await get(`https://duckduckgo.com/news.js?l=us-en&o=json&noamp=1&q=${encodeURIComponent(q)}&vqd=${token}&p=1`, {
    headers: { Referer: 'https://duckduckgo.com/', Accept: 'application/json' }
  })
  const data = JSON.parse(r.text)
  return (data.results || []).map(x => ({ title: x.title, url: x.url, excerpt: x.excerpt, image: x.image, source: x.source, date: x.date }))
}

async function wiki(title) {
  try {
    const r = await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { timeout: 5000 })
    const d = JSON.parse(r.text)
    if (d.type === 'disambiguation' || !d.extract) return null
    return { title: d.title, extract: d.extract, image: d.thumbnail && d.thumbnail.source, url: d.content_urls && d.content_urls.desktop.page, description: d.description }
  } catch {
    return null
  }
}

module.exports = { web, instant, images, news, wiki }
