// 待办 dtodo.mjs
// 照 dsh-memory-evolve 的四轨待办设计：
//   life    生活
//   work    工作
//   project 项目（跟当前工作目录走）
//   daily   每日（按日期）
//
// 四象限：q1 重要紧急 / q2 重要不紧急 / q3 紧急不重要 / q4 不重要不紧急
// 存 JSON，文件在 data/memory/todo.json

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'

const __d = dirname(fileURLToPath(import.meta.url))
const DIR = process.env.MEMORY_DIR || join(__d, 'data', 'memory')
const FILE = join(DIR, 'todo.json')

const TRACKS = ['life', 'work', 'project', 'daily']

function load() {
  try {
    const d = JSON.parse(readFileSync(FILE, 'utf8'))
    if (d && Array.isArray(d.items)) return d
  } catch { }
  return { items: [] }
}

function save(d) {
  try {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(d, null, 1), 'utf8')
    return true
  } catch { return false }
}

function newId() {
  return randomBytes(4).toString('hex')
}

function today() {
  const x = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate())
}

/** 加一条待办 */
export function addTodo({ content, target = 'work', due = '', cat = '', quadrant = '', important, urgent }) {
  if (!content || !String(content).trim()) return { ok: false, error: '内容不能为空' }
  const t = TRACKS.includes(target) ? target : 'work'
  const d = load()

  // 四象限：显式给的优先，否则按 important/urgent 推
  let q = quadrant
  if (!q) {
    const imp = important === true
    const urg = urgent === true
    q = imp && urg ? 'q1' : imp ? 'q2' : urg ? 'q3' : 'q4'
  }

  const item = {
    id: newId(),
    content: String(content).trim(),
    target: t,
    status: 'pending',
    quadrant: q,
    cat: cat || '',
    // daily 轨的截止就是今天
    due: t === 'daily' ? (due || today()) : (due || ''),
    created: new Date().toISOString(),
  }
  d.items.push(item)
  if (!save(d)) return { ok: false, error: '写文件失败' }
  return { ok: true, item }
}

/** 列出待办 */
export function listTodos({ target, status, date, all, past, expired } = {}) {
  const d = load()
  let items = d.items.slice()

  if (target && TRACKS.includes(target)) items = items.filter(i => i.target === target)
  if (status) items = items.filter(i => i.status === status)
  if (date) items = items.filter(i => i.due === date)

  const td = today()

  // 默认只看未完成的
  if (!all && !status) items = items.filter(i => i.status !== 'done')

  // 过往（daily 轨的昨天及更早）
  if (!past) {
    items = items.filter(i => !(i.target === 'daily' && i.due && i.due < td) || i.status === 'done')
  }
  if (past && !expired) {
    items = items.filter(i => !(i.status !== 'done' && i.due && i.due < td))
  }

  // 排序：逾期/今日到期优先，再看象限
  const qOrder = { q1: 0, q2: 1, q3: 2, q4: 3 }
  items.sort((a, b) => {
    const ad = a.due || '9999', bd = b.due || '9999'
    if (ad !== bd) return ad < bd ? -1 : 1
    return (qOrder[a.quadrant] ?? 3) - (qOrder[b.quadrant] ?? 3)
  })

  return items.slice(0, all ? 9999 : 8)
}

function findById(id) {
  const d = load()
  const i = d.items.findIndex(x => x.id === id)
  if (i < 0) return { d, i: -1, item: null }
  return { d, i, item: d.items[i] }
}

export function doneTodo(id) {
  const { d, i, item } = findById(id)
  if (!item) return { ok: false, error: '没有这一条' }
  d.items[i].status = 'done'
  d.items[i].doneAt = new Date().toISOString()
  save(d)
  return { ok: true, item: d.items[i] }
}

export function updateTodo(id, patch = {}) {
  const { d, i, item } = findById(id)
  if (!item) return { ok: false, error: '没有这一条' }
  for (const k of ['content', 'due', 'cat', 'quadrant', 'status']) {
    if (patch[k] !== undefined) d.items[i][k] = patch[k]
  }
  save(d)
  return { ok: true, item: d.items[i] }
}

export function removeTodo(id) {
  const { d, i, item } = findById(id)
  if (!item) return { ok: false, error: '没有这一条' }
  d.items.splice(i, 1)
  save(d)
  return { ok: true }
}

/** 到期的（今天及逾期），给回复末尾提醒用 */
export function dueTodos() {
  const d = load()
  const td = today()
  return d.items.filter(i => i.status !== 'done' && i.due && i.due <= td)
}
