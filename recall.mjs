// 记忆召回 recall.mjs
// 照 Aurabot 的做法：不是把全部记忆塞进去，而是按这一句话去检索
//
// 为什么：191 条全塞 = 2.8 万 token，等于什么都没重点。
//        Aurabot 只挑当轮相关的 4 条、300 字以内。
//
// 打分方式：
//   完全相同的词    3 分
//   两字以上的交集   按长度给分
//   同一个人/事     加分

function tokenize(s) {
  // 中文按两字滑窗切，英文按空格
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
    if (!tt.has(q)) continue
    s += q.length >= 2 ? 1 : 0.3
  }
  return s
}

/**
 * 从全部记忆里挑出和这句话最相关的几条
 * @param {Array<{title:string,detail:string,at?:number,importance?:number}>} all
 * @param {string} query 他这一句
 * @param {string} prev  上一句（短句时补上）
 * @param {number} limit 最多几条
 */
export function recall(all, query, prev, limit = 4) {
  const q = String(query || '').trim()
  if (!q || !all || !all.length) return []

  const qTokens = tokenize(q)
  // 「嗯嗯」「然后呢」这种太短的，把上一句也带上
  const extraTokens = q.length < 12 && prev ? tokenize(prev) : new Set()

  const scored = []
  for (const m of all) {
    const text = (m.title || '') + ' ' + (m.detail || '')
    let s = score(qTokens, text)
    if (extraTokens.size) s = Math.max(s, score(extraTokens, text) * 0.6)
    if (s <= 0) continue
    // 重要度轻微加权（0.4~0.95 → 乘 0.85~1.05）
    const imp = typeof m.importance === 'number' ? m.importance : 0.75
    s *= 0.85 + imp * 0.2
    scored.push({ m, s })
  }

  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limit).map(x => x.m)
}

/** 把记住的事写成一句话（Aurabot 的写法） */
export function recallLine(list) {
  if (!list || !list.length) return ''
  const body = list.map(m => (m.title || '') + (m.detail ? '——' + m.detail : '')).join('；')
  const cut = body.length > 300 ? body.slice(0, 300) + '…' : body
  return '（你记得这些事，聊到相关的就自然用上，别把老事当新事说，也别说「根据记忆」：' + cut + '）'
}


// ---------- 原始对话（QQ 那 4000 多条）----------
// 她要找的是「我们真正说过的话」，不是提炼过的结论
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __d = dirname(fileURLToPath(import.meta.url))
let chatBlocks = null
function loadBlocks() {
  if (chatBlocks) return chatBlocks
  try {
    chatBlocks = JSON.parse(readFileSync(join(__d, 'data', 'chatblocks.json'), 'utf8'))
  } catch { chatBlocks = [] }
  return chatBlocks
}

/** 从他的这句话里，去那 4000 多条原始记录里翻出最像的那几段 */
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
    if (s < 2) continue          // 太弱的不要，宁可不说
    scored.push({ b, s })
  }
  scored.sort((a, b) => b.s - a.s)
  return scored.slice(0, limit).map(x => x.b)
}

/** 把翻到的原文写成一句话（带日期） */
export function chatLine(blocks) {
  if (!blocks || !blocks.length) return ''
  const body = blocks.map(b => `【${b.day}】\n` + b.text).join('\n\n')
  const cut = body.length > 500 ? body.slice(0, 500) + '…' : body
  return '（这是你们以前真说过的原话，翻到了就照着这个口气和内容说，别说「根据记录」：\n' + cut + '）'
}
