// 记忆模块 memory.mjs
// 照 dsh-memory-evolve 的分层设计，重写成大肥鱼自己能用的版本。
//
// 五条轨（跟 DSH 那套一致）：
//   key.md        关键记忆——永远带上（他说死的事、不能忘的事）
//   user.md       用户档案——他是谁、在意什么、怎么说话
//   memory.md     长期记忆——发生过的事、记住的细节
//   project.md    项目日志——这次改了什么、踩了什么坑
//   daily/日期.md  每日日志——今天聊了什么、做了什么
//
// 条目格式（§ 分隔，方便解析和人工看）：
//   ## 标题
//   § 2026-11-16 18:20 | 权重 0.9 | 标签: 他/技术
//   正文
//   ---
//
// 跟旧的 recall.mjs 的区别：
//   旧：把 192 条全塞进 JSON，每轮按关键词捞 4 条
//   新：分成五轨，keyword 检索 + 权重淘汰（艾宾浩斯衰减），
//       key 轨全带，其余按相关性捞

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __d = dirname(fileURLToPath(import.meta.url))

// ---------- 路径 ----------
const MEM_DIR = process.env.MEMORY_DIR || join(__d, 'data', 'memory')
const TRACKS = {
  key: join(MEM_DIR, 'key.md'),
  user: join(MEM_DIR, 'user.md'),
  memory: join(MEM_DIR, 'memory.md'),
  project: join(MEM_DIR, 'project.md'),
}
const DAILY_DIR = join(MEM_DIR, 'daily')

function ensureDirs() {
  try { mkdirSync(DAILY_DIR, { recursive: true }) } catch { }
}

function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function nowStamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return today() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
}

// ---------- 条目解析 ----------
// 一条长这样：
//   ## 标题
//   § 2026-11-16 18:20 | 0.9 | 他,技术
//   正文
//   ---

const ENTRY_RE = /^##\s+(.+?)\n§\s*([^|\n]*)\|\s*([\d.]+)\s*\|\s*([^\n]*)\n([\s\S]*?)\n---/gm

export function parseEntries(text) {
  const out = []
  let m
  ENTRY_RE.lastIndex = 0
  while ((m = ENTRY_RE.exec(String(text || ''))) !== null) {
    out.push({
      title: m[1].trim(),
      at: (m[2] || '').trim(),
      w: parseFloat(m[3]) || 0.7,
      tags: (m[4] || '').split(',').map(s => s.trim()).filter(Boolean),
      body: (m[5] || '').trim(),
    })
  }
  return out
}

export function formatEntry(e) {
  const tags = (e.tags || []).join(',')
  return '## ' + String(e.title || '').replace(/\n/g, ' ') + '\n' +
    '§ ' + (e.at || nowStamp()) + ' | ' + (Number(e.w) || 0.7).toFixed(2) + ' | ' + tags + '\n' +
    String(e.body || '').trim() + '\n---\n'
}

// ---------- 读写一整条轨 ----------
function readTrack(track) {
  const p = TRACKS[track]
  if (!p || !existsSync(p)) return []
  try { return parseEntries(readFileSync(p, 'utf8')) } catch { return [] }
}

function writeTrack(track, entries) {
  const p = TRACKS[track]
  if (!p) return false
  ensureDirs()
  try {
    const head = '# ' + trackName(track) + '\n\n'
    writeFileSync(p, head + entries.map(formatEntry).join(''), 'utf8')
    return true
  } catch { return false }
}

function trackName(track) {
  return ({ key: '关键记忆', user: '用户档案', memory: '长期记忆', project: '项目日志' })[track] || track
}

// ---------- 每日日志 ----------
function dailyFile(day) {
  return join(DAILY_DIR, (day || today()) + '.md')
}

export function readDaily(day) {
  const p = dailyFile(day)
  if (!existsSync(p)) return []
  try { return parseEntries(readFileSync(p, 'utf8')) } catch { return [] }
}

export function appendDaily(title, body, w = 0.6, tags = []) {
  ensureDirs()
  const p = dailyFile()
  const e = { title, body, w, tags, at: nowStamp() }
  try {
    const old = existsSync(p) ? readFileSync(p, 'utf8') : '# 每日日志 ' + today() + '\n\n'
    writeFileSync(p, old + (old.endsWith('\n') ? '' : '\n') + formatEntry(e), 'utf8')
    return true
  } catch { return false }
}

// ---------- 新增一条 ----------
export function addMemory(track, title, body, w = 0.7, tags = []) {
  if (track === 'daily') return appendDaily(title, body, w, tags)
  const list = readTrack(track)
  list.push({ title, body, w, tags, at: nowStamp() })
  return writeTrack(track, list)
}

export function listTrack(track) {
  if (track === 'daily') return readDaily()
  if (track === 'all') {
    return {
      key: readTrack('key'), user: readTrack('user'),
      memory: readTrack('memory'), project: readTrack('project'),
    }
  }
  return readTrack(track)
}

// ---------- 检索打分 ----------
function tokenize(s) {
  const out = new Set()
  const str = String(s || '').toLowerCase()
  for (const w of str.split(/[\s，。、？！,.?!：:；;“”"'（）()【】\[\]]+/)) {
    if (!w) continue
    if (/^[a-z0-9]+$/.test(w)) { if (w.length >= 2) out.add(w); continue }
    if (w.length === 1) { out.add(w); continue }
    for (let i = 0; i + 2 <= w.length; i++) out.add(w.slice(i, i + 2))
  }
  return out
}

function score(queryTokens, text) {
  const tt = tokenize(text)
  let s = 0
  for (const q of queryTokens) {
    if (tt.has(q)) s += q.length >= 2 ? 1 : 0.3
  }
  return s
}

// 艾宾浩斯式衰减：越久没提到的，权重慢慢往下掉
function decayWeight(e) {
  const base = typeof e.w === 'number' ? e.w : 0.7
  const atStr = e.at || ''
  const t = Date.parse(atStr.replace(' ', 'T') + ':00+08:00')
  if (!Number.isFinite(t)) return base
  const days = Math.max(0, (Date.now() - t) / 86400000)
  // 半衰期 30 天；权重不低于 30%
  const factor = Math.pow(0.5, days / 30)
  return base * (0.3 + 0.7 * factor)
}

/**
 * 捞跟这句话相关的记忆
 * 返回 { key: [...], picked: [...], line: '...' }
 */
export function recall(query, prev, limit = 6) {
  const q = String(query || '').trim()
  const keys = readTrack('key')   // key 轨永远全带

  if (!q) {
    return { key: keys, picked: [], line: buildLine(keys, []) }
  }

  const qTokens = tokenize(q)
  const exTokens = q.length < 12 && prev ? tokenize(prev) : new Set()

  const pool = [
    ...readTrack('user').map(e => ({ e, from: 'user' })),
    ...readTrack('memory').map(e => ({ e, from: 'memory' })),
    ...readTrack('project').map(e => ({ e, from: 'project' })),
    ...readDaily().map(e => ({ e, from: 'today' })),
  ]

  const scored = []
  for (const { e, from } of pool) {
    const text = (e.title || '') + ' ' + (e.body || '')
    let s = score(qTokens, text)
    if (exTokens.size) s = Math.max(s, score(exTokens, text) * 0.6)
    if (s <= 0) continue
    s *= decayWeight(e)           // 权重 + 衰减
    if (from === 'user') s *= 1.15 // 关于他的事优先
    scored.push({ e, s, from })
  }
  scored.sort((a, b) => b.s - a.s)
  const picked = scored.slice(0, limit).map(x => x.e)

  return { key: keys, picked, line: buildLine(keys, picked) }
}

/** 把捞到的东西拼成给模型看的一段话 */
function buildLine(keys, picked) {
  const parts = []
  if (keys.length) {
    parts.push('（这些是你一直记着、不能忘的：' +
      keys.map(e => e.title + (e.body ? '——' + e.body : '')).join('；') + '）')
  }
  if (picked.length) {
    const body = picked.map(e => e.title + (e.body ? '——' + e.body : '')).join('；')
    const cut = body.length > 400 ? body.slice(0, 400) + '…' : body
    parts.push('（你记得这些事，聊到相关的就自然用上，别把老事当新事说，也别说「根据记忆」：' + cut + '）')
  }
  return parts.join('\n')
}

// ---------- 原始对话（沿用旧逻辑，数据另存）----------
let chatBlocks = null
function loadBlocks() {
  if (chatBlocks) return chatBlocks
  for (const p of [join(__d, 'data', 'chatblocks.json'), join(__d, 'data', 'memory', 'chatblocks.json')]) {
    try { chatBlocks = JSON.parse(readFileSync(p, 'utf8')); return chatBlocks } catch { }
  }
  chatBlocks = []
  return chatBlocks
}

export function recallChat(query, prev, limit = 2) {
  const q = String(query || '').trim()
  if (!q) return []
  const blocks = loadBlocks()
  if (!blocks.length) return []

  const qTokens = tokenize(q)
  const exTokens = q.length < 12 && prev ? tokenize(prev) : new Set()

  const scored = []
  for (const b of blocks) {
    let s = score(qTokens, b.text)
    if (exTokens.size) s = Math.max(s, score(exTokens, b.text) * 0.6)
    if (s < 2) continue
    scored.push({ b, s })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limit).map(x => x.b)
}

export function chatLine(blocks) {
  if (!blocks || !blocks.length) return ''
  const body = blocks.map(b => '【' + b.day + '】\n' + b.text).join('\n\n')
  const cut = body.length > 500 ? body.slice(0, 500) + '…' : body
  return '（这是你们以前真说过的原话，翻到了就照着这个口气和内容说，别说「根据记录」：\n' + cut + '）'
}

// ---------- 统计 ----------
export function stats() {
  const s = {
    key: readTrack('key').length,
    user: readTrack('user').length,
    memory: readTrack('memory').length,
    project: readTrack('project').length,
    daily: readDaily().length,
    chatblocks: loadBlocks().length,
  }
  s.total = s.key + s.user + s.memory + s.project
  return s
}
