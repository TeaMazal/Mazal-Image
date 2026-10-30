import fs from 'node:fs'
import path from 'node:path'

const base = path.resolve(process.argv[2])
const destination = path.resolve(process.argv[3])
const lock = JSON.parse(fs.readFileSync(path.join(base, 'package-lock.json'), 'utf8'))
fs.mkdirSync(destination, { recursive: true })
const report = []
function licenseFiles(folder, depth = 0) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const source = path.join(folder, entry.name)
    if (entry.isFile() && /^(license|licence|copying|notice|copyright)/i.test(entry.name)) return [source]
    if (entry.isDirectory() && depth < 4 && !['node_modules', '.git', '.cache'].includes(entry.name)) return licenseFiles(source, depth + 1)
    return []
  })
}
for (const [relative, item] of Object.entries(lock.packages)) {
  if (!relative || item.dev) continue
  const folder = path.join(base, relative)
  if (!fs.existsSync(path.join(folder, 'package.json'))) continue
  const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'))
  const files = []
  for (const source of licenseFiles(folder)) {
    const target = path.join(pkg.name.replaceAll('/', '_') + '-' + pkg.version, path.relative(folder, source))
    fs.mkdirSync(path.dirname(path.join(destination, target)), { recursive: true })
    fs.copyFileSync(source, path.join(destination, target))
    files.push(target.replaceAll('\\', '/'))
  }
  if (!files.length) {
    const fallback = path.join(base, 'third-party-licenses', 'npm', pkg.name.replace(/^@/, '').replaceAll('/', '__') + '.txt')
    if (fs.existsSync(fallback)) {
      const target = path.join(pkg.name.replaceAll('/', '_') + '-' + pkg.version, 'LICENSE-upstream.txt')
      fs.mkdirSync(path.dirname(path.join(destination, target)), { recursive: true })
      fs.copyFileSync(fallback, path.join(destination, target))
      files.push(target.replaceAll('\\', '/'))
    }
  }
  if (!files.length) {
    const existing = path.join(destination, pkg.name.replaceAll('/', '_') + '-' + pkg.version)
    if (fs.existsSync(existing)) {
      files.push(...licenseFiles(existing).map((file) => path.relative(destination, file).replaceAll('\\', '/')))
    }
  }
  report.push({ name: pkg.name, version: pkg.version, license: pkg.license || item.license || '', files })
}
fs.writeFileSync(path.join(destination, 'index.json'), JSON.stringify(report, null, 2) + '\n')
console.log('Collected npm dependency license records:', report.length)
