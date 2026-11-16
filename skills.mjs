// 技能 skills.mjs
// 照 dsh-memory-evolve 的技能设计：把重复的操作存成「技能」，下次直接调。
//
// 一个技能就是一个 markdown 文件：
//   data/memory/skills/<名字>.md
//
// 格式：
//   ---
//   name: 技能名（kebab-case）
//   description: 什么时候用这个技能
//   created: 2026-11-16
//   used: 3
//   ---
//
//   # 正文
//   （步骤、命令、坑、验证方式）

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __d = dirname(fileURLToPath(import.meta.url))
const DIR = process.env.MEMORY_DIR || join(__d, 'data', 'memory')
const SKILL_DIR = join(DIR, 'skills')

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,48}$/

function ensure() { try { mkdirSync(SKILL_DIR, { recursive: true }) } catch { } }

function fileOf(name) { return join(SKILL_DIR, name + '.md') }

function parse(text) {
  const m = String(text || '').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return { meta: {}, body: String(text || '') }
  const meta = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i < 0) continue
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: m[2] }
}

function format(meta, body) {
  const lines = ['---']
  for (const k of ['name', 'description', 'created', 'used']) {
    if (meta[k] !== undefined) lines.push(k + ': ' + meta[k])
  }
  lines.push('---', '')
  return lines.join('\n') + String(body || '').trim() + '\n'
}

/** 建一个技能 */
export function createSkill(name, description, body) {
  if (!NAME_RE.test(String(name || ''))) {
    return { ok: false, error: '技能名要用小写字母、数字、短横线，2-49 个字' }
  }
  if (existsSync(fileOf(name))) {
    return { ok: false, error: '已经有这个技能了，要改请用 patch' }
  }
  if (!description || !String(description).trim()) {
    return { ok: false, error: 'description 不能为空' }
  }
  ensure()
  const today = new Date().toISOString().slice(0, 10)
  try {
    writeFileSync(fileOf(name), format({ name, description, created: today, used: 0 }, body), 'utf8')
    return { ok: true, name }
  } catch (e) { return { ok: false, error: e.message } }
}

/** 改一个技能 */
export function patchSkill(name, description, body) {
  if (!existsSync(fileOf(name))) return { ok: false, error: '没有这个技能' }
  const old = parse(readFileSync(fileOf(name), 'utf8'))
  const meta = Object.assign({}, old.meta, {
    name,
    description: description || old.meta.description,
  })
  try {
    writeFileSync(fileOf(name), format(meta, body), 'utf8')
    return { ok: true, name }
  } catch (e) { return { ok: false, error: e.message } }
}

/** 读一个技能 */
export function readSkill(name) {
  if (!existsSync(fileOf(name))) return null
  try {
    const { meta, body } = parse(readFileSync(fileOf(name), 'utf8'))
    return { name, description: meta.description || '', body }
  } catch { return null }
}

/** 列全部技能 */
export function listSkills() {
  ensure()
  let files = []
  try { files = readdirSync(SKILL_DIR).filter(f => f.endsWith('.md')) } catch { return [] }
  const out = []
  for (const f of files) {
    const name = f.replace(/\.md$/, '')
    const s = readSkill(name)
    if (s) out.push({ name, description: s.description })
  }
  return out
}

/** 用了一次，计数 +1（提示词里可以据此提「常用技能」） */
export function touchSkill(name) {
  if (!existsSync(fileOf(name))) return false
  try {
    const { meta, body } = parse(readFileSync(fileOf(name), 'utf8'))
    meta.used = String(parseInt(meta.used || '0', 10) + 1)
    writeFileSync(fileOf(name), format(meta, body), 'utf8')
    return true
  } catch { return false }
}

export function removeSkill(name) {
  if (!existsSync(fileOf(name))) return { ok: false, error: '没有这个技能' }
  try { unlinkSync(fileOf(name)); return { ok: true } }
  catch (e) { return { ok: false, error: e.message } }
}

/** 给提示词用的简短清单 */
export function skillsHint(limit = 30) {
  const list = listSkills().slice(0, limit)
  if (!list.length) return ''
  return list.map(s => '- ' + s.name + '：' + s.description).join('\n')
}
