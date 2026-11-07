// puts the icon and name into the exe (electron-builder wants wine for this, resedit is plain js)
const fs = require('fs')
const ResEdit = require('resedit')
const exePath = process.argv[2]
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
const res = ResEdit.NtExecutableResource.from(exe)
const ico = ResEdit.Data.IconFile.from(fs.readFileSync(__dirname + '/../build/icon.ico'))
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)
const id = groups.length ? groups[0].id : 1
const lang = groups.length ? groups[0].lang : 1033
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map(i => i.data))
const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0]
const v = require('../package.json').version.split('.').map(Number)
vi.setFileVersion(v[0], v[1], v[2], 0, 1033)
vi.setProductVersion(v[0], v[1], v[2], 0, 1033)
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
  FileDescription: 'Flow Browser', ProductName: 'Flow Browser', CompanyName: 'flowifys',
  InternalName: 'FlowBrowser', OriginalFilename: 'FlowBrowser.exe', LegalCopyright: 'flowifys'
})
vi.outputToResourceEntries(res.entries)
res.outputResource(exe)
fs.writeFileSync(exePath, Buffer.from(exe.generate()))
console.log('stamped', exePath)
