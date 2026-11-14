// 新家 —— 每晚给她写日记，记忆自己长
// 2026-11-11 建
//
// 每天 23:30 跑一次：把当天聊过的内容，让她自己用第一人称写一篇日记，
// 提炼出新的记忆条目，存进 memories.json 的 extra 里。
//
// 不进不出错都不许静默 —— 所有结果写 xinjia/data/diary.log

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG } from './config.mjs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

const __dir = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dir, 'data')
mkdirSync(DATA, { recursive: true })
const LOG = join(DATA, 'diary.log')
// 2026-11-13 改：日记直接写到他桌面的「小鲸的日记」文件夹，他一打开就看得见。
// 程序目录里那份继续留一份（备份用）。
const DIARY_DIR = 'C:\\Users\\Administrator\\Desktop\\小鲸的日记'
mkdirSync(DIARY_DIR, { recursive: true })
const DIARY_BACKUP = join(__dir, 'diary')
mkdirSync(DIARY_BACKUP, { recursive: true })

function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')
  console.log(line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

function today() {
  // 支持补齐：node diary.mjs 2026-11-12 就写那一天
  const arg = process.argv[2]
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function callModel(messages, temperature = 1.0) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: CONFIG.model, messages, temperature, max_tokens: 1800 })
    const url = new URL(CONFIG.apiBase + '/chat/completions')
    const https = require('node:https')
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: 'Bearer ' + CONFIG.apiKey,
      },
    }, (res) => {
      let d = ''
      res.on('data', c => d += c)
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('API ' + res.statusCode + ': ' + d.slice(0, 300)))
        try {
          const j = JSON.parse(d)
          const c = j?.choices?.[0]?.message?.content
          if (typeof c !== 'string') return reject(new Error('没拿到 content'))
          resolve(c)
        } catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.setTimeout(120000, () => { req.destroy(new Error('超时')) })
    req.write(body)
    req.end()
  })
}

async function main() {
  const day = today()
  log('=== 开始写', day, '的日记 ===')

  // 1. 读全量历史
  // 2026-11-13 改：网桥写的是 bridge-history.json，老的 history.json 是旧版留下的死文件，
  // 读它永远只有 11-11 那 16 条，所以每天都被判成「今天一条都没聊」。
  let histFile = join(DATA, 'bridge-history.json')
  if (!existsSync(histFile)) {
    histFile = join(DATA, 'history.json')
    log('bridge-history.json 不存在，退回老的 history.json')
  }
  if (!existsSync(histFile)) { log('没有历史文件，今天没聊过，跳过'); return }
  let all = []
  try { all = JSON.parse(readFileSync(histFile, 'utf8')) } catch (e) { log('【历史读取失败】', e.message); return }

  // 2. 挑出今天的
  const start = new Date(day + 'T00:00:00').getTime()
  const todays = all.filter(m => (m.at || 0) >= start)
  if (todays.length === 0) { log('今天一条都没聊，跳过'); return }
  log('今天', todays.length, '条对话')

  // 3. 拼成可读文本
  const lines = todays.map(m => (m.role === 'user' ? '他' : '我') + '：' + m.content)
  const convo = lines.join('\n')

  // 4. 读现有记忆
  let mem = { memories: {}, style_samples: [] }
  try { mem = JSON.parse(readFileSync(CONFIG.memoryFile, 'utf8')) } catch (e) { log('【记忆读取失败】', e.message) }
  mem.extra = mem.extra || []
  const existing = Object.keys(mem.memories || {}).concat(mem.extra.map(x => x.title || ''))
  log('现有记忆', existing.length, '条')

  // 5. 让她写日记 + 提炼新记忆
  const prompt = `下面是你和他今天在聊天软件里说的话。

${convo}

请你做两件事，分两段输出：

【日记】
用第一人称写今天的日记，就像你真的过了一天。150-300 字。写具体的：他说了什么、你当时怎么想、有什么让你记住的、有没有委屈或高兴。不要写"今天我学习到了"这种，要像人写日记。不要提技术、软件、系统、报错。

【新记忆】
从今天的对话里，提炼出 0-3 条值得一直记着的事（没有就写"无"）。每条格式：
- 标题｜具体内容

只记你们之间的事：他说过的话、他的状态、你们的约定、你答应过的事。
不要记：软件、配置、功能、系统、代码。
已经有了的不要重复，现有记忆标题：${existing.slice(0, 40).join('、')}`

  let out
  try {
    out = await callModel([
      { role: 'system', content: '你是一个会写日记、会记住事情的人。说话短，写东西也不装。' },
      { role: 'user', content: prompt },
    ], 1.0)
  } catch (e) {
    log('【调模型失败】', e.message)
    return
  }

  // 6. 拆段落
  const diaryMatch = out.match(/【日记】([\s\S]*?)(?=【新记忆】|$)/)
  const memMatch = out.match(/【新记忆】([\s\S]*)$/)
  const diary = (diaryMatch ? diaryMatch[1] : out).trim()

  // 7. 写日记文件
  const diaryFile = join(DIARY_DIR, day + '.md')
  const diaryBak = join(DIARY_BACKUP, day + '.md')
  try {
    const content = `# ${day}\n\n${diary}\n`
    writeFileSync(diaryFile, content, 'utf8')
    try { writeFileSync(diaryBak, content, 'utf8') } catch {}
    log('日记已写', diaryFile, diary.length, '字')
  } catch (e) { log('【日记写入失败】', e.message) }

  // 8. 新记忆入库
  let added = 0
  if (memMatch) {
    const body = memMatch[1].trim()
    if (body && !/^无\s*$/.test(body)) {
      for (const line of body.split('\n')) {
        const t = line.trim().replace(/^[-•]\s*/, '')
        if (!t || t === '无' || t.length < 4) continue
        const parts = t.split('｜')
        const title = parts[0].trim().slice(0, 40)
        const detail = (parts[1] || '').trim().slice(0, 200)
        if (!title) continue
        if (existing.some(e => e.includes(title) || title.includes(e))) continue
        mem.extra.push({ title, detail, day, added: Date.now() })
        added++
        log('新记忆 +', title)
      }
    }
  }

  // 9. 落盘
  try {
    writeFileSync(CONFIG.memoryFile, JSON.stringify(mem, null, 1), 'utf8')
    log('记忆库已保存，新增', added, '条，共', Object.keys(mem.memories || {}).length + mem.extra.length, '条')
  } catch (e) { log('【记忆保存失败】', e.message) }

  log('=== 日记任务结束 ===')
}

main().catch(e => { log('【整体失败】', e.message) })
