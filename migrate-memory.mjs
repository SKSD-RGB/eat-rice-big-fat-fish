// 迁移脚本：把旧的 memories.json 搬进新的五轨结构
// 用法：node migrate-memory.mjs [--dry]
//
// 分流规则：
//   pinned=1 或 importance >= 0.9   → key.md（永远带）
//   extra 里带 day 的（关于他的事）   → user.md
//   importance >= 0.7               → memory.md
//   importance < 0.7                → memory.md（权重标低）
//   运维/技术类旧记忆                → 跳过（不迁，留着不碍事）
//   insights                        → user.md（当洞察）
//   style_samples                   → user.md（当说话风格）

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __d = dirname(fileURLToPath(import.meta.url))
const DRY = process.argv.includes('--dry')

const MEM_DIR = join(__d, 'data', 'memory')
const DAILY_DIR = join(MEM_DIR, 'daily')

// ---------- 运维垃圾判断 ----------
// 这些词命中 >= 2 个，就当技术记录跳过
const TECH_WORDS = [
  '端口', 'plugins', 'plugin', 'npm', 'pnpm', 'json', 'token', 'API Key', 'api key',
  'bridge.mjs', 'config', '构建', '打包', '编译', 'apk', 'ADB', 'adb', 'git ',
  'commit', 'push', 'patch', 'yaml', 'yml', 'curl', 'node ', '进程', 'PID',
  '防火墙', '自启动', 'schtasks', '注册表', '环境变量', '安装包', '版本号',
]

function isTech(title, body) {
  const s = String(title || '') + ' ' + String(body || '')
  let n = 0
  for (const w of TECH_WORDS) if (s.includes(w)) n++
  return n >= 2
}

// ---------- 条目格式 ----------
function fmt(title, body, w, tags, at) {
  return '## ' + String(title || '').replace(/\n/g, ' ').trim() + '\n' +
    '§ ' + at + ' | ' + w.toFixed(2) + ' | ' + tags.join(',') + '\n' +
    String(body || '').trim() + '\n---\n'
}

function readJSON(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

// ---------- 主流程 ----------
const src = join(__d, 'data', 'memories.json')
const d = readJSON(src)
if (!d) { console.error('读不到 memories.json'); process.exit(1) }

const AT = '2026-11-11 23:00'   // 旧数据统一盖这个时间（文件最后修改时间附近）

const keyE = [], userE = [], memE = []
let skipped = 0

// ① memories
for (const m of (d.memories || [])) {
  const t = m.title || ''
  const b = m.detail || ''
  const imp = typeof m.importance === 'number' ? m.importance : 0.7
  const pinned = m.pinned === 1 || m.pinned === true

  if (isTech(t, b)) { skipped++; continue }

  const tags = ['他']
  if (pinned || imp >= 0.9) keyE.push(fmt(t, b, Math.min(1, imp), tags, AT))
  else memE.push(fmt(t, b, imp, tags, AT))
}

// ② extra（带 day，都是关于他的近况）
for (const m of (d.extra || [])) {
  const t = m.title || ''
  const b = m.detail || ''
  if (isTech(t, b)) { skipped++; continue }
  const at = m.day ? (m.day + ' 20:00') : AT
  userE.push(fmt(t, b, 0.8, ['他', '近况'], at))
}

// ③ insights（洞察）
for (const m of (d.insights || [])) {
  const t = typeof m === 'string' ? m : (m.title || '')
  const b = typeof m === 'string' ? '' : (m.detail || '')
  if (!t) continue
  if (isTech(t, b)) { skipped++; continue }
  userE.push(fmt(t, b, 0.75, ['洞察'], AT))
}

// ④ style_samples（她说话的样子）
for (const s of (d.style_samples || [])) {
  const t = String(s || '').slice(0, 20)
  if (!t) continue
  userE.push(fmt('她这么说话：' + t, String(s), 0.6, ['说话风格'], AT))
}

// ---------- 写文件 ----------
function head(name) { return '# ' + name + '\n\n' }

if (DRY) {
  console.log('【试运行，不写文件】')
  console.log('  key       :', keyE.length, '条')
  console.log('  user      :', userE.length, '条')
  console.log('  memory    :', memE.length, '条')
  console.log('  跳过(技术) :', skipped, '条')
  console.log('  合计       :', keyE.length + userE.length + memE.length, '条')
  process.exit(0)
}

mkdirSync(DAILY_DIR, { recursive: true })

writeFileSync(join(MEM_DIR, 'key.md'), head('关键记忆') + keyE.join(''), 'utf8')
writeFileSync(join(MEM_DIR, 'user.md'), head('用户档案') + userE.join(''), 'utf8')
writeFileSync(join(MEM_DIR, 'memory.md'), head('长期记忆') + memE.join(''), 'utf8')
writeFileSync(join(MEM_DIR, 'project.md'), head('项目日志') + '', 'utf8')

// 原文对话搬过去
const cbSrc = join(__d, 'data', 'chatblocks.json')
if (existsSync(cbSrc)) {
  try {
    const raw = readFileSync(cbSrc, 'utf8')
    writeFileSync(join(MEM_DIR, 'chatblocks.json'), raw, 'utf8')
    console.log('  chatblocks.json 已复制')
  } catch (e) { console.log('  chatblocks 复制失败:', e.message) }
}

console.log('迁移完成：')
console.log('  key.md      ', keyE.length, '条')
console.log('  user.md     ', userE.length, '条')
console.log('  memory.md   ', memE.length, '条')
console.log('  project.md  ', 0, '条（新建）')
console.log('  跳过(技术)   ', skipped, '条')
console.log('  输出目录    ', MEM_DIR)
