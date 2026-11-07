const p = new URLSearchParams(location.search)
const url = p.get('url') || ''
const code = Number(p.get('code'))
const messages = {
  '-105': ['That site doesn\'t seem to exist', 'Check the address for typos. The server name couldn\'t be found.'],
  '-106': ['You\'re offline', 'Check your internet connection and try again.'],
  '-102': ['Connection refused', 'The site isn\'t accepting connections right now.'],
  '-118': ['That took too long', 'The site took too long to respond.'],
  '-7': ['That took too long', 'The site took too long to respond.'],
  '-200': ['This connection isn\'t private', 'The site\'s security certificate has a problem, so Flow stopped here to keep you safe.'],
  '-201': ['This connection isn\'t private', 'The site\'s certificate has expired or the clock on your computer is wrong.'],
  '-202': ['This connection isn\'t private', 'The site\'s certificate isn\'t trusted.'],
  '-21': ['Network changed', 'Your connection changed while loading. Try again.']
}
const [title, msg] = messages[code] || ['Can\'t reach this page', 'Something went wrong while loading it.']
document.title = title
$('#title').textContent = title
$('#msg').textContent = msg
$('#url').textContent = url
$('#code').textContent = p.get('desc') || ''
$('#retry').onclick = () => { location.href = url }
$('#search').onclick = () => window.flow && window.flow.search(url.replace(/^https?:\/\//, '').replace(/\/$/, ''))
boot()
