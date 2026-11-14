// 表情包 stickers.mjs
//
// 她怎么用：回复里写 [表情:表情名]，网桥把它换成图片链接
//
// 两套库存：
//   old       —— 284 个老表情包（文件名做名字）
//   nekowhale —— 322 个 nekowhale 表情（有中文名，更像她）
//
// 规矩：
//   · 找不到那个名字，就当没写，别报错打断
//   · 一次回复最多 2 个表情，多了像刷屏

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dir, 'data')
const PUB = join(__dir, 'public', 'stickers')
mkdirSync(PUB, { recursive: true })

let list = { old: [], nekowhale: [] }
try {
  list = JSON.parse(readFileSync(join(DATA, 'sticker-list.json'), 'utf8'))
} catch (e) {
  console.error('[表情] 清单读取失败', e.message)
}

// nekowhale 的 322 个里，本地只有 28 个（按 hash 存）
const NK_DIR = 'C:\\Users\\Administrator\\.dsh\\nekowhale-stickers\\byhash'

// 名字 → 可用文件
function findNeko(name) {
  const key = String(name || '').trim()
  if (!key) return null
  const items = list.nekowhale || []
  // 先精确，再模糊
  let hit = items.find(i => i.name === key)
  if (!hit) hit = items.find(i => (i.name || '').includes(key))
  if (!hit) hit = items.find(i => key.includes(i.name || '###'))
  if (!hit) return null

  // 本地有就返回本地路径
  const localPng = join(PUB, 'nk', (hit.hash || '') + '.gif')
  if (existsSync(localPng)) return { url: '/stickers/nk/' + hit.hash + '.gif', name: hit.name }
  // 只在这个目录找得到才算数
  for (const ext of ['.gif', '.png', '.jpg']) {
    const p = join(PUB, 'nk', (hit.hash || '') + ext)
    if (existsSync(p)) return { url: '/stickers/nk/' + hit.hash + ext, name: hit.name }
  }
  // 本地没有这张 —— 换成 284 个里能用的（远程服务器连不上）
  return null
}

function findOld(name) {
  const key = String(name || '').trim()
  if (!key) return null
  const olds = list.old || []
  const hit = olds.find(f => f === key) || olds.find(f => f.includes(key))
  if (!hit) return null
  return { url: '/stickers/' + hit, name: hit }
}

export function findSticker(name) {
  return findNeko(name) || findOld(name)
}

// 返回给她看的一份名字清单（用来写进人格，别太多）
export function stickerNamesHint(limit = 120) {
  // 只给本地真有的那几张，名字得是能用的
  const have = []
  for (const it of (list.nekowhale || [])) {
    if (!it.name) continue
    for (const ext of ['.gif', '.png', '.jpg']) {
      if (existsSync(join(PUB, 'nk', (it.hash || '') + ext))) { have.push(it.name); break }
    }
  }
  return have.slice(0, limit)
}

// 把 [表情:xxx] 换成 markdown 图片
export function renderStickers(text) {
  if (!text) return text
  let count = 0
  return String(text).replace(/\[表情[:：]\s*([^\]]{1,24})\]/g, (m, name) => {
    if (count >= 2) return ''   // 多了就删掉
    const s = findSticker(name)
    if (!s) return ''           // 找不到就当没写
    count++
    return `\n![${s.name}](${s.url})\n`
  }).replace(/\n{3,}/g, '\n\n').trim()
}

export function stickerCount() {
  return { old: (list.old || []).length, nekowhale: (list.nekowhale || []).length }
}


/** 给 App 用的完整表情清单（带可直接加载的地址） */
export function stickerGallery(limit = 400) {
  const out = []
  // 她专属的先来（有名字，更好玩）
  for (const it of (list.nekowhale || [])) {
    if (!it.name || !it.hash) continue
    let ext = null
    for (const e of ['.gif', '.png', '.jpg']) {
      if (existsSync(join(PUB, 'nk', it.hash + e))) { ext = e; break }
    }
    if (!ext) continue
    out.push({ name: it.name, url: '/stickers/nk/' + it.hash + ext, kind: 'her' })
    if (out.length >= limit) return out
  }
  // 旧表情包
  for (const f of (list.old || [])) {
    out.push({ name: f.replace(/\.[^.]+$/, ''), url: '/stickers/' + f, kind: 'old' })
    if (out.length >= limit) return out
  }
  return out
}
