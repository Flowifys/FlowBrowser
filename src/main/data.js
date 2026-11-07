// search engines and the apps you can pin to the sidebar

const ENGINES = {
  flow: { name: 'Flow Search', search: 'flow://search/?q=%s', suggest: 'https://duckduckgo.com/ac/?q=%s&type=list' },
  duckduckgo: { name: 'DuckDuckGo', search: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?q=%s&type=list' },
  brave: { name: 'Brave Search', search: 'https://search.brave.com/search?q=%s', suggest: 'https://search.brave.com/api/suggest?q=%s' },
  startpage: { name: 'Startpage', search: 'https://www.startpage.com/do/search?q=%s', suggest: null },
  google: { name: 'Google', search: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  bing: { name: 'Bing', search: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' }
}

const SIDEBAR_APPS = {
  discord: { name: 'Discord', url: 'https://discord.com/app', host: 'discord.com' },
  spotify: { name: 'Spotify', url: 'https://open.spotify.com', host: 'open.spotify.com' },
  whatsapp: { name: 'WhatsApp', url: 'https://web.whatsapp.com', host: 'web.whatsapp.com' },
  telegram: { name: 'Telegram', url: 'https://web.telegram.org/a/', host: 'web.telegram.org' },
  ytmusic: { name: 'YouTube Music', url: 'https://music.youtube.com', host: 'music.youtube.com' },
  twitch: { name: 'Twitch', url: 'https://www.twitch.tv', host: 'www.twitch.tv' },
  instagram: { name: 'Instagram', url: 'https://www.instagram.com/direct/inbox/', host: 'www.instagram.com' },
  messenger: { name: 'Messenger', url: 'https://www.messenger.com', host: 'www.messenger.com' },
  x: { name: 'X', url: 'https://x.com', host: 'x.com' },
  tiktok: { name: 'TikTok', url: 'https://www.tiktok.com', host: 'www.tiktok.com' },
  claude: { name: 'Claude', url: 'https://claude.ai', host: 'claude.ai' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com', host: 'chatgpt.com' }
}

// browser colour themes. all dark, they change the base tones, the accent is picked separately
const THEMES = {
  midnight: { name: 'Midnight', bg: '#08080c', bar: '#0f1016', raise: '#161821', raise2: '#1d1f2a', line: '#22242e' },
  graphite: { name: 'Graphite', bg: '#101113', bar: '#17181b', raise: '#1e1f23', raise2: '#26282d', line: '#2d2f35' },
  abyss: { name: 'Abyss', bg: '#050912', bar: '#0a111f', raise: '#101a2b', raise2: '#162236', line: '#1d2a40' },
  plum: { name: 'Plum', bg: '#0c0711', bar: '#130c1a', raise: '#1b1225', raise2: '#231930', line: '#2c2039' },
  forest: { name: 'Forest', bg: '#060b09', bar: '#0c1411', raise: '#121e19', raise2: '#182821', line: '#1f3229' },
  ember: { name: 'Ember', bg: '#0e0806', bar: '#170e0b', raise: '#201410', raise2: '#2a1b15', line: '#33221b' },
  oled: { name: 'OLED Black', bg: '#000000', bar: '#060607', raise: '#0d0d10', raise2: '#141418', line: '#1c1c21' }
}

module.exports = { ENGINES, SIDEBAR_APPS, THEMES }
