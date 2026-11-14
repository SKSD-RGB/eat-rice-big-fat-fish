// 网桥 bridge —— 照说明书画的
// 2026-11-11
//
// 关系：手机 App ←HTTP/SSE→ 网桥 ←OneBot v11→ Aurabot ←→ 大模型
//
// 端口 8787
// 口令 32 位随机，部署时生成，写进 data/token.txt
//
// 路由：
//   GET  /app/ping        不带口令，只返回 {"ok":true}
//   GET  /app/stream      SSE 长连接，手机挂着收推送（要口令）
//   POST /app/send        手机发消息给 AI（要口令）
//   GET  /app/history     拉历史（要口令）
//   GET  /app/me          自己是谁（要口令）
//   POST /onebot          给 Aurabot 的内部口（要口令），Aurabot 的回复往这里推
//
// 规矩（照 11-10 那晚的教训）：
//   · 所有错误都打日志，不许静默吞
//   · 每次请求记一行
//   · 不发口令的接口只有 /app/ping

import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync } from 'node:fs'
import { join, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dir, 'data')
mkdirSync(DATA, { recursive: true })

const PORT = 8787
// 智谱的看图钥匙（glm-4v-flash 免费）
let ZHIPU_KEY = ''   // 从 config 读，见 config.mjs
// 他发的图存在哪（App 能直接拉）
const UPLOAD_DIR = join(__dir, 'public', 'uploads')
mkdirSync(UPLOAD_DIR, { recursive: true })
const LOG = join(DATA, 'bridge.log')
const TOKEN_FILE = join(DATA, 'token.txt')
const HIST_FILE = join(DATA, 'bridge-history.json')

function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')
  console.log(line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

// ---------- 口令 ----------
// 2026-11-13 晚：改成「分模式令牌」。
// 别人的机器人接进来，不能给主钥匙 —— 只能给有权限的子钥匙。
//   owner  主钥匙（他自己手机 App）—— 全部权限
//   chat   聊天钥匙 —— 收发消息、看图、看历史，不能改人格/删记录/清空/导出
//   read   只读钥匙 —— 只能看历史和状态
const KEYS_FILE = join(DATA, 'keys.json')

let TOKEN = ''
try {
  if (existsSync(TOKEN_FILE)) TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim()
} catch (e) { log('【口令读取失败】', e.message) }
if (!TOKEN || TOKEN.length !== 32) {
  TOKEN = randomBytes(16).toString('hex')  // 32 个十六进制字符
  try { writeFileSync(TOKEN_FILE, TOKEN, 'utf8'); log('新口令已生成') }
  catch (e) { log('【口令写入失败】', e.message) }
}
log('=== 网桥启动 === 口令前 6 位:', TOKEN.slice(0, 6) + '…')

// 子钥匙表：{ name, token, scope, createdAt }
let guestKeys = []
try {
  if (existsSync(KEYS_FILE)) guestKeys = JSON.parse(readFileSync(KEYS_FILE, 'utf8'))
} catch (e) { log('【子钥匙读取失败】', e.message) }
if (!Array.isArray(guestKeys)) guestKeys = []

function saveKeys() {
  try { writeFileSync(KEYS_FILE, JSON.stringify(guestKeys, null, 1), 'utf8') } catch (e) { log('【子钥匙写失败】', e.message) }
}

// 判断这把钥匙是什么权限。主钥匙 → owner。
function scopeOf(t) {
  if (!t) return ''
  if (t.length === TOKEN.length && t === TOKEN) return 'owner'
  const k = guestKeys.find(x => x.token === t && !x.disabled)
  return k ? (k.scope || 'chat') : ''
}


// ---------- 历史 ----------
let history = []
try {
  if (existsSync(HIST_FILE)) history = JSON.parse(readFileSync(HIST_FILE, 'utf8'))
} catch (e) { log('【历史读取失败】', e.message) }
// 老数据没有 id，补一个（用 at + 序号，稳定不变）
for (let i = 0; i < history.length; i++) {
  if (!history[i].id) history[i].id = 'legacy-' + (history[i].at || 0) + '-' + i
}

function saveHistory() {
  try { writeFileSync(HIST_FILE, JSON.stringify(history.slice(-1000), null, 1), 'utf8') }
  catch (e) { log('【历史保存失败】', e.message) }
}

// ---------- SSE 客户端池 ----------
const clients = new Set()

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  let n = 0
  for (const res of clients) {
    try { res.write(payload); n++ } catch (e) { clients.delete(res); log('【推送失败】', e.message) }
  }
  return n
}

// ---------- 工具 ----------
/**
 * 从一段文字里抠出第一个完整的 JSON 对象
 * 按括号配平扫描，跳过字符串里的花括号，比正则可靠
 */
function extractJson(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inStr = false
  let esc = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) { esc = false; continue }
      if (ch === '\\') { esc = true; continue }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') { inStr = true; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const slice = text.slice(start, i + 1)
        try { return JSON.parse(slice) } catch { return null }
      }
    }
  }
  return null
}

/**
 * 把用户传来的相对路径解析成绝对路径，并确认它确实落在允许的目录里。
 * 只查 '..' 不够 —— Windows 上反斜杠、编码变体都能绕。用 resolve 后再比前缀，最稳。
 * 返回 null 表示越界。
 */
function safeJoin(baseDir, rel) {
  const base = resolve(baseDir)
  const abs = resolve(base, rel)
  if (abs === base) return null
  if (!abs.startsWith(base + sep)) return null
  return abs
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''
    let dead = false
    req.on('data', c => {
      if (dead) return
      d += c
      if (d.length > 8_000_000) {
        dead = true
        d = ''
        try { req.destroy() } catch {}      // 直接掐断，别让后面继续涨
        reject(new Error('请求体太大'))
      }
    })
    req.on('end', () => { if (!dead) resolve(d) })
    req.on('error', reject)
  })
}
const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' })
  res.end(JSON.stringify(obj))
}

// ---------- 鉴权 ----------
// 取请求里带的钥匙
function tokenOf(req, url) {
  const h = req.headers['authorization'] || ''
  const fromHeader = h.startsWith('Bearer ') ? h.slice(7) : ''
  const fromQuery = url.searchParams.get('token') || ''
  return fromHeader || fromQuery
}

// 有钥匙就算通过（细粒度权限由 need() 判断）
function authed(req, url) {
  return !!scopeOf(tokenOf(req, url))
}

// 权限检查：scope 不够就 403
// owner > chat > read
const RANK = { read: 1, chat: 2, owner: 3 }
function need(req, url, res, want) {
  const s = scopeOf(tokenOf(req, url))
  if (!s) { json(res, 401, { ok: false, error: '口令不对' }); return false }
  if ((RANK[s] || 0) < (RANK[want] || 99)) {
    json(res, 403, { ok: false, error: '这把钥匙不够权限（需要 ' + want + '，你是 ' + s + '）' })
    return false
  }
  return true
}

// ===== 2026-11-13 晚：自带 key 模式 =====
// 别的机器人可以用自己的模型和 key，不烧主人的钱。
// 三种带法，优先级从高到低：
//   1) 请求头  x-llm-key / x-llm-base / x-llm-model
//   2) 请求体  { llm: { apiKey, apiBase, model } }
//   3) 钥匙表里预先存好的（主人发的「自带key」钥匙）
// 一个都没给 → 用主人的（会烧他的钱，所以默认不允许 guest 用）
function llmOf(req, body, url) {
  const h = req.headers
  const fromKey = (() => {
    const t = tokenOf(req, url)
    const k = guestKeys.find(x => x.token === t && !x.disabled)
    return k && k.llm ? k.llm : null
  })()
  const fromHeader = h['x-llm-key'] ? {
    apiKey: h['x-llm-key'],
    apiBase: h['x-llm-base'] || 'https://api.deepseek.com',
    model: h['x-llm-model'] || 'deepseek-chat',
  } : null
  const fromBody = body && body.llm && body.llm.apiKey ? body.llm : null
  return fromHeader || fromBody || fromKey || null
}

// ---------- 调模型（直接接 DeepSeek，暂时不接 Aurabot）----------
import { CONFIG } from './config.mjs'
ZHIPU_KEY = CONFIG.zhipuKey || ''

// Token 用量统计（App 里那个「Token 统计」用）
const usage = {
  last: { prompt: 0, completion: 0, total: 0 },
  total: { prompt: 0, completion: 0, total: 0 },
  rounds: 0,
}

async function callModel(messages, override) {
  // override: 别人家机器人带自己的 key 时传进来
  //   { apiKey, apiBase, model, temperature, maxTokens }
  const KEY  = (override && override.apiKey)  || effective.apiKey
  const BASE = (override && override.apiBase) || effective.apiBase
  const MODEL = (override && override.model)  || effective.model
  const TEMP = (override && typeof override.temperature === 'number') ? override.temperature : 1.15
  const MAXT = (override && override.maxTokens) || 900

  const res = await fetch(BASE.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + KEY },
    body: JSON.stringify({ model: MODEL, messages, temperature: TEMP, max_tokens: MAXT }),
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 300)}`)
  const j = JSON.parse(text)
  const c = j?.choices?.[0]?.message?.content
  if (typeof c !== 'string') throw new Error('没拿到 content')
  // 2026-11-13 加固：模型偶尔不按 <状态> 格式，会写成 <b>[状态]{...}</b>
  // 或者直接把 JSON 甩出来。这些都必须在发给他之前剥掉。
  let clean = c
    .replace(/<状态>[\s\S]*?<\/状态>/g, '')                 // 正常格式
    .replace(/<b>?\s*\[状态\][\s\S]*?<\/b>/gi, '')       // <b>[状态]{...}</b>
    .replace(/\[状态\]\s*\{[\s\S]*?\}?/g, '')             // 裸的 [状态]{...}
    .replace(/<\/?reply[^>]*>/g, '')
    .replace(/<\/?b>/gi, '')
    .replace(/^\s*\[[^\]]{1,6}\]/gm, '')                   // 行首残留的 [xxx]
  // 万一还残留一大段 JSON，整段丢掉
  clean = clean.replace(/\{\s*"tier"[\s\S]*\}/g, '')

  // 2026-11-13 晚加固：她偶尔会把后台日志/工具返回原样吐出来
  // 表现为：裸 JSON、[mcp] 日志行、error/note 字段、代码块
  clean = clean
    // 整段 ```json ... ``` 或 ``` ... ```
    .replace(/```[\s\S]*?```/g, '')
    // 单个 JSON 对象/数组（可能跨行）
    .replace(/\{[\s\S]{0,800}?"[\w]+"\s*:\s*[\s\S]{0,800}?\}/g, '')
    .replace(/^\s*[\[\{]\s*$/gm, '')
    .replace(/^\s*[\}\]],?\s*$/gm, '')
    // [mcp] 开头的日志行
    .replace(/^\s*\[mcp\][^\n]*/gmi, '')
    .replace(/^\s*\[douyin[^\]]*\][^\n]*/gmi, '')
    // 裸的 key: "value" 行
    .replace(/^\s*"[\w_]+"\s*:\s*.*$/gm, '')

  clean = clean.replace(/\n{3,}/g, '\n\n').trim()

  // 剩下一堆引号逗号废话就丢掉
  if (/^[\s"'{}[\](),:;]+$/.test(clean)) clean = ''

  // 兜底：如果剥完基本空了，说明这轮全是状态块，给一句安全的
  if (clean.length < 2) clean = '嗯'

  // 累计 token
  if (j.usage) {
    const u = {
      prompt: j.usage.prompt_tokens || 0,
      completion: j.usage.completion_tokens || 0,
      total: j.usage.total_tokens || 0,
    }
    usage.last = u
    usage.total.prompt += u.prompt
    usage.total.completion += u.completion
    usage.total.total += u.total
    usage.rounds++
  }

  return { reply: clean, usage: j.usage || null }
}

// ---------- 人格 / 记忆 ----------
let persona = ''
let mem = { memories: {}, style_samples: [] }
try { persona = readFileSync(CONFIG.personaFile, 'utf8') } catch (e) { log('【人格读取失败】', e.message) }
try { mem = JSON.parse(readFileSync(CONFIG.memoryFile, 'utf8')) } catch (e) { log('【记忆读取失败】', e.message) }

// ===== 2026-11-14 晚：设置里的 AI 配置 / 状态字段 =====

// 运行时可改的 AI 配置（存 data/ai-override.json，改完不用重启）
const effective = {
  apiKey: CONFIG.apiKey,
  apiBase: CONFIG.apiBase,
  model: CONFIG.model,
}
try {
  const saved = JSON.parse(readFileSync(join(DATA, 'ai-override.json'), 'utf8'))
  if (saved.apiKey) effective.apiKey = saved.apiKey
  if (saved.apiBase) effective.apiBase = saved.apiBase
  if (saved.model) effective.model = saved.model
} catch {}

// 状态栏默认显示哪几样
const DEFAULT_STATUS_FIELDS = [
  { key: 'miss',  label: '想你',  on: true },
  { key: 'memo',  label: '记得',  on: true },
  { key: 'dev',   label: '连着',  on: true },
]

import { onHisMessage, onHerReply, describe as describeEmotion } from './emotion.mjs'
import { startInitiative, noteHeard } from './initiative.mjs'
import { randomUUID } from 'node:crypto'

// 给一条消息打上唯一编号（App 只认这个，不比较内容）
const HISTORY_MAX = 1200      // 内存里最多留这么多，超了砍掉最老的
const HISTORY_KEEP = 1000     // 砍到剩这么多

function pushMsg(role, content) {
  const m = { id: randomUUID(), role, content, at: Date.now() }
  history.push(m)
  if (history.length > HISTORY_MAX) history = history.slice(-HISTORY_KEEP)
  return m
}
import { renderStickers, stickerNamesHint, stickerCount, stickerGallery } from './stickers.mjs'
import { recall, recallLine, recallChat, chatLine } from './recall.mjs'
import { shareVideo, wantsVideo } from './douyin.mjs'
import { lookAtImage } from './vision.mjs'
import { writeFileSync as _wf } from 'node:fs'
import { createReadStream, statSync } from 'node:fs'
import { readFileSync as _rf } from 'node:fs'

// 现在是什么时候 —— 她得知道，不然分不清早上半夜
function nowLine() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  const h = d.getHours()
  const wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]

  let seg = '半夜'
  if (h >= 5 && h < 9) seg = '早上'
  else if (h >= 9 && h < 12) seg = '上午'
  else if (h >= 12 && h < 14) seg = '中午'
  else if (h >= 14 && h < 18) seg = '下午'
  else if (h >= 18 && h < 23) seg = '晚上'
  else seg = '深夜'

  const date = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日'
  const hm = pad(h) + ':' + pad(d.getMinutes())

  // 距他上次说话多久
  let gap = ''
  try {
    const last = history[history.length - 1]
    if (last && last.at) {
      const mins = Math.floor((Date.now() - last.at) / 60000)
      if (mins > 0 && mins < 60) gap = '（他上次说话是 ' + mins + ' 分钟前）'
      else if (mins >= 60 && mins < 1440) gap = '（他上次说话是 ' + Math.floor(mins / 60) + ' 小时前）'
      else if (mins >= 1440) gap = '（他上次说话是 ' + Math.floor(mins / 1440) + ' 天前）'
    }
  } catch {}

  return '## 现在是\n\n' + date + ' ' + wd + ' ' + hm + '，' + seg + '。' + gap +
    '\n\n**你知道现在几点，说话按这个时辰来。** 半夜就是半夜，早上就是早上。别把早上的话说到半夜去。'
}

function buildMessages(userText) {
  const parts = [nowLine(), '', persona, '']
  // ---- 照 Aurabot 原来的写法 ----
  // ① 你对他的印象
  const prof = (mem.profiles || [])[0]
  if (prof && prof.text) {
    parts.push('（你对' + (prof.name ? '「' + prof.name + '」' : '对方') + '的印象：' + prof.text + '）')
  }

  // ② 相处的经验
  const ins = mem.insights || []
  if (ins.length) {
    parts.push('（和对方相处的经验，照着做就好，不用说出来：' + ins.map(x => (x.text || x)).join('；') + '）')
  }

  // ③ 说话方式
  const sty = (mem.styles && mem.styles.about_you) || []
  const self = (mem.styles && mem.styles.self) || []
  if (sty.length || self.length) {
    const a = sty.length ? '和对方聊久了，' + sty.join('；') : ''
    const b = self.length ? '你平时不知不觉会用的说法：' + self.join('、') : ''
    parts.push('（说话方式：' + [a, b].filter(Boolean).join('。') +
      '。自然带一点就好，别刻意模仿，也别变成另一个人。）')
  }

  // ④ 最近做过的事
  const recentActs = (mem.memories || [])
    .filter(m => {
      const src = m.source || ''
      const at = m.at || 0
      return (src === 'event' || src === 'diary') && at > Date.now() - 24 * 3600 * 1000
    })
    .sort((x, y) => (y.at || 0) - (x.at || 0))
    .slice(0, 4)
  if (recentActs.length) {
    const ago = (at) => {
      const m = Math.round((Date.now() - at) / 60000)
      if (m < 60) return m + '分钟前'
      const h = Math.round(m / 60)
      if (h < 24) return h + '小时前'
      return Math.round(h / 24) + '天前'
    }
    parts.push('（你最近做过的事：' + recentActs.map(m => ago(m.at) + (m.title || m.text || '')).join('；') + '。聊到了可以自然提起。）')
  }

  // ⑤ 置顶的约定（不管问什么，每轮都在）
  const allM = Array.isArray(mem.memories) ? mem.memories : []
  const pinned = allM.filter(m => m.pinned)
  if (pinned.length) {
    parts.push('## 你们说好的事（这个必须记着）', '')
    for (const m of pinned) parts.push(`- ${m.title}：${m.detail || ''}`)
    parts.push('')
  }

  // ⑥ 翻你们以前真说过的原话（QQ 那 4000 多条）
  try {
    const prevQ = history.length >= 2 ? history[history.length - 2].content : ''
    const chats = recallChat(userText, prevQ, 2)
    const cl = chatLine(chats)
    if (cl) parts.push(cl, '')
  } catch (e) { log('【原文检索失败】', e.message) }

  // ⑥ 和这一句相关的记忆（只挑 4 条，Aurabot 的做法）
  const allMem = Array.isArray(mem.memories) ? mem.memories : []
  if (allMem.length) {
    const prev = history.length >= 2 ? history[history.length - 2].content : ''
    const hits = recall(allMem, userText, prev, 4)
    const line = recallLine(hits)
    if (line) parts.push(line, '')
  }

  const ss = mem.style_samples || []
  if (ss.length) {
    parts.push('## 你真实说过的话', '', '不是为了照抄，是让你找回那个口气。', '')
    for (const s of ss) parts.push(`- ${s}`)
    parts.push('')
  }
  try { parts.push(describeEmotion(), '') } catch (e) { log('【情绪拼装失败】', e.message) }
  // 她会发表情包
  const names = stickerNamesHint(60)
  if (names.length) {
    parts.push('## 你的表情包', '',
      '你有一堆自己的表情包。想发的时候，在回复里写 [表情:名字]，系统会自动换成图片。',
      '一天里偶尔发一张就行，别每句都发。表情要配得上当时的心情。',
      '',
      '能用的（举例）：' + names.join('、'),
      '')
  }

  parts.push('## 现在', '', '你正在用一个自己做的聊天软件跟他说话，不是 QQ 了。',
    '说话短一点，像平时那样。')

  const recent = history.slice(-16).map(m => ({ role: m.role, content: m.content }))
  return [{ role: 'system', content: parts.join('\n') }, ...recent, { role: 'user', content: userText }]
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const t0 = Date.now()
  const path = url.pathname

  try {
    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization,content-type,x-llm-key,x-llm-base,x-llm-model',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
      })
      return res.end()
    }

    // 唯一不带口令的
    if (req.method === 'GET' && path === '/app/ping') {
      return json(res, 200, { ok: true })
    }

    // SSE
    if (req.method === 'GET' && path === '/app/stream') {
      if (!authed(req, url)) return json(res, 401, { ok: false, error: '口令不对' })
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': '*',
        'x-accel-buffering': 'no',
      })
      res.write('event: hello\ndata: ' + JSON.stringify({ ok: true, at: Date.now() }) + '\n\n')
      clients.add(res)
      log('SSE 接入，当前', clients.size, '个')
      const ka = setInterval(() => { try { res.write(': ping\n\n') } catch {} }, 25000)
      req.on('close', () => { clearInterval(ka); clients.delete(res); log('SSE 断开，剩', clients.size, '个') })
      return
    }

    // 手机发消息
    if (req.method === 'POST' && path === '/app/send') {
      if (!need(req, url, res, 'chat')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const text = String(body.text || '').trim()
      if (!text) return json(res, 400, { ok: false, error: '空的' })

      // 自带 key 模式：别人的机器人用自己的模型
      const llm = llmOf(req, body, url)
      const isGuest = scopeOf(tokenOf(req, url)) !== 'owner'
      if (isGuest && !llm) {
        return json(res, 400, {
          ok: false,
          error: '请带上你自己的模型：请求头 x-llm-key / x-llm-base / x-llm-model，或请求体 {llm:{apiKey,apiBase,model}}',
        })
      }
      // 只有主人能写进聊天记录
      const writeHistory = !isGuest || (body.remember === true)
      if (writeHistory) pushMsg('user', text)
      try { onHisMessage(text) } catch (e) { log('【情绪更新失败】', e.message) }
      noteHeard()

      let out
      try { out = await callModel(buildMessages(text), llm) }
      catch (e) { log('【调模型失败】', e.message); return json(res, 500, { ok: false, error: e.message }) }

      // 表情包：把 [表情:xxx] 换成图片
      out.reply = renderStickers(out.reply)
      pushMsg('assistant', out.reply)
      try { onHerReply(out.reply) } catch (e) { log('【情绪更新失败-回复】', e.message) }
      saveHistory()

      // 推给她
      const n = broadcast('reply', { text: out.reply, at: Date.now() })
      log('回复', out.reply.length, '字，', Date.now() - t0, 'ms，推给', n, '个客户端')

      // 他要视频的话，后台去抖音发一条（不拖慢这次回复）
      if (wantsVideo(text)) {
        log('他要视频，后台去发')
        shareVideo(text).then(r => {
          const msg = r.ok
            ? ('给你发抖音了，去看看')
            : ('视频没发出去：' + r.error)
          log('抖音结果', r.ok, r.ok ? r.reason : r.error)
          pushMsg('assistant', msg)
          saveHistory()
          broadcast('reply', { text: msg, at: Date.now() })
        }).catch(e => log('【抖音异常】', e.message))
      }

      return json(res, 200, { ok: true, reply: out.reply, usage: out.usage })
    }

    // 历史
    if (req.method === 'GET' && path === '/app/history') {
      if (!authed(req, url)) return json(res, 401, { ok: false, error: '口令不对' })
      const limit = Math.min(200, parseInt(url.searchParams.get('limit') || '100', 10) || 100)
      return json(res, 200, { ok: true, messages: history.slice(-limit) })
    }

    // 自己是谁
    if (req.method === 'GET' && path === '/app/me') {
      if (!authed(req, url)) return json(res, 401, { ok: false, error: '口令不对' })
      return json(res, 200, {
        ok: true,
        name: '张小满',
        persona: persona.length,
        memories: Array.isArray(mem.memories) ? mem.memories.length : Object.keys(mem.memories || {}).length,
        history: history.length,
        emotion: describeEmotion(),
        clients: clients.size,
      })
    }

    // 外部（Aurabot / 别的程序）往手机推东西
    if (req.method === 'POST' && path === '/push') {
      if (!need(req, url, res, 'chat')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const text = String(body.text || '').trim()
      if (!text) return json(res, 400, { ok: false, error: '空的' })
      pushMsg('assistant', text)
      saveHistory()
      const n = broadcast('reply', { text, at: Date.now(), from: 'push' })
      log('外部推送', n, '个客户端')
      return json(res, 200, { ok: true, delivered: n })
    }

    // 他发的图片（不需要口令，手机直接拉）
    if (req.method === 'GET' && path.startsWith('/uploads/')) {
      const rel = decodeURIComponent(path.slice('/uploads/'.length))
      if (rel.includes('..')) return json(res, 400, { ok: false, error: '不行' })
      const file = safeJoin(UPLOAD_DIR, rel)
      if (!file) return json(res, 400, { ok: false, error: '不行' })
      if (!existsSync(file)) return json(res, 404, { ok: false, error: '没有这张' })
      const ext = file.split('.').pop().toLowerCase()
      const mime = ext === 'gif' ? 'image/gif' : ext === 'png' ? 'image/png'
        : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=604800' })
      return createReadStream(file).pipe(res)
    }

    // 他发图片（base64 上传）
    if (req.method === 'POST' && path === '/app/image') {
      if (!need(req, url, res, 'chat')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }

      const b64 = String(body.data || '').replace(/^data:[^;]+;base64,/, '')
      const mime = String(body.mime || 'image/jpeg')
      const caption = String(body.text || '').trim()
      if (!b64) return json(res, 400, { ok: false, error: '没图' })

      // 存盘
      const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : mime.includes('webp') ? 'webp' : 'jpg'
      const name = Date.now().toString(36) + '.' + ext
      try { _wf(join(UPLOAD_DIR, name), Buffer.from(b64, 'base64')) }
      catch (e) { log('【存图失败】', e.message); return json(res, 500, { ok: false, error: '存不下' }) }

      const imgUrl = '/uploads/' + name
      log('收到图片', name, (b64.length / 1024).toFixed(0) + 'KB', caption ? '附言:' + caption : '')

      // 她先看 —— 先转成 jpg（glm-4v 不吃 gif，也不吃太大的）
      let seen = null
      try {
        const srcPath = join(UPLOAD_DIR, name)
        const jpgPath = join(UPLOAD_DIR, name + '.look.jpg')
        const { execFileSync } = await import('node:child_process')
        execFileSync(join(__dir, '..', 'py310', 'python.exe'),
          [join(__dir, 'tojpg.py'), srcPath, jpgPath], { timeout: 20000 })
        const jpgB64 = _rf(jpgPath).toString('base64')
        seen = await lookAtImage(jpgB64, 'image/jpeg', ZHIPU_KEY, { recent: caption })
      } catch (e) {
        log('【识图失败】', e.message)
      }

      // 拼给她的话
      let userText
      if (seen) {
        userText = `[他发来一张图片]
他看到的画面：${seen}` + (caption ? `
他附了一句：${caption}` : '')
      } else {
        userText = '[他发来一张图片]' + (caption ? '\n他说：' + caption : '') +
          '\n（你这会儿没看清，可以直接说看不清或者凭感觉答）'
      }

      pushMsg('user', '![图片](' + imgUrl + ')' + (caption ? '\n' + caption : ''))
      try { onHisMessage(caption || '[图片]') } catch (e) { log('【情绪更新失败】', e.message) }
      noteHeard()

      let out
      try { out = await callModel(buildMessages(userText)) }
      catch (e) { log('【调模型失败】', e.message); return json(res, 500, { ok: false, error: e.message }) }

      out.reply = renderStickers(out.reply)
      pushMsg('assistant', out.reply)
      try { onHerReply(out.reply) } catch (e) { log('【情绪更新失败-回复】', e.message) }
      saveHistory()

      broadcast('reply', { text: out.reply, at: Date.now() })
      log('看图回话', out.reply.length, '字')
      return json(res, 200, { ok: true, reply: out.reply, img: imgUrl, seen: seen })
    }

    // 撤回：按内容和时间删掉一条
    if (req.method === 'POST' && path === '/app/recall') {
      if (!need(req, url, res, 'chat')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const at = Number(body.at || 0)
      const text = String(body.text || '')
      const before = history.length
      // 找最接近的那条（同内容 + 时间差 3 秒内）
      let idx = -1
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i]
        if (m.content !== text) continue
        if (at && Math.abs((m.at || 0) - at) > 3000) continue
        idx = i
        break
      }
      if (idx < 0) return json(res, 404, { ok: false, error: '找不到这条' })
      history.splice(idx, 1)
      saveHistory()
      log('撤回 1 条，剩', history.length, '条（原', before, '）')
      return json(res, 200, { ok: true, left: history.length })
    }

    // 表情图片（不需要口令，手机直接拉图）
    if (req.method === 'GET' && path.startsWith('/stickers/')) {
      const rel = decodeURIComponent(path.slice('/stickers/'.length))
      if (rel.includes('..')) return json(res, 400, { ok: false, error: '不行' })
      const base = rel.startsWith('nk/') ? join(__dir, 'public', 'stickers', 'nk') : join(__dir, 'public', 'stickers')
      const file = safeJoin(base, rel.startsWith('nk/') ? rel.slice(3) : rel)
      if (!file) return json(res, 400, { ok: false, error: '不行' })
      if (!existsSync(file)) return json(res, 404, { ok: false, error: '没有这张' })
      const ext = file.split('.').pop().toLowerCase()
      const mime = ext === 'gif' ? 'image/gif' : ext === 'png' ? 'image/png' : 'image/jpeg'
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=604800' })
      return createReadStream(file).pipe(res)
    }

    // 表情清单
    // ===== 2026-11-13 晚：消息菜单 / 重生成 / 删除 / 导出 / Token / 定时 =====

    // 按 id 删一条
    if (req.method === 'POST' && path === '/app/delete') {
      if (!need(req, url, res, 'chat')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const id = String(body.id || '')
      const i = history.findIndex(m => m.id === id)
      if (i < 0) return json(res, 404, { ok: false, error: '找不到' })
      history.splice(i, 1)
      saveHistory()
      broadcast('deleted', { id })
      log('删掉一条，剩', history.length)
      return json(res, 200, { ok: true })
    }

    // 重生成：把最后一条她的回话删掉，用原问题重问一次
    if (req.method === 'POST' && path === '/app/regen') {
      if (!need(req, url, res, 'chat')) return
      let body = {}
      try { body = JSON.parse(await readBody(req)) } catch {}
      const id = String(body.id || '')

      // 找要重生的那条（默认最后一条 assistant）
      let idx = -1
      if (id) idx = history.findIndex(m => m.id === id)
      else {
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].role === 'assistant') { idx = i; break }
        }
      }
      if (idx < 0) return json(res, 404, { ok: false, error: '找不到那条' })

      // 找它前面最近的一条用户消息
      let ui2 = -1
      for (let i = idx - 1; i >= 0; i--) {
        if (history[i].role === 'user') { ui2 = i; break }
      }
      const askText = ui2 >= 0 ? history[ui2].content : '(再说一句)'

      // 删掉这条她的话
      history.splice(idx, 1)
      saveHistory()
      broadcast('deleted', { id: id || '' })

      let out
      try { out = await callModel(buildMessages(askText)) }
      catch (e) { return json(res, 500, { ok: false, error: e.message }) }

      out.reply = renderStickers(out.reply)
      const m = pushMsg('assistant', out.reply)
      saveHistory()
      broadcast('reply', { id: m.id, text: out.reply, at: m.at, regen: true })
      return json(res, 200, { ok: true, id: m.id, reply: out.reply })
    }

    // 导出聊天记录（txt）
    if (req.method === 'GET' && path === '/app/export') {
      if (!need(req, url, res, 'owner')) return
      const lines = []
      lines.push('小鲸 · 聊天记录')
      lines.push('导出时间：' + new Date().toLocaleString('zh-CN'))
      lines.push('共 ' + history.length + ' 条')
      lines.push('='.repeat(40))
      lines.push('')
      for (const m of history) {
        const d = new Date(m.at || Date.now())
        const ts = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
          String(d.getDate()).padStart(2, '0') + ' ' +
          String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
        lines.push('[' + ts + '] ' + (m.role === 'user' ? '他' : '小鲸') + '：')
        lines.push(m.content || '')
        lines.push('')
      }
      const txt = lines.join('\n')
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': 'attachment; filename="xiaojing-chat-' + Date.now() + '.txt"',
      })
      return res.end('\ufeff' + txt)
    }

    // Token 统计
    if (req.method === 'GET' && path === '/app/usage') {
      if (!authed(req, url)) return json(res, 401, { ok: false, error: '口令不对' })
      return json(res, 200, {
        ok: true,
        last: usage.last || { prompt: 0, completion: 0, total: 0 },
        total: usage.total,
        rounds: usage.rounds,
        contextHint: Math.round(persona.length / 1000) + 'k 字人格 + ' +
          history.slice(-20).length + ' 条近期消息',
      })
    }

    // 定时消息：到点她想他一句
    if (req.method === 'POST' && path === '/app/schedule') {
      if (!need(req, url, res, 'chat')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const delayMin = Math.max(1, Math.min(720, Number(body.minutes || 15)))
      const hint = String(body.hint || '').slice(0, 100)

      setTimeout(async () => {
        try {
          const text = await askHerProactive(hint || '(你忽然想他了，主动说一句)')
          if (!text) return
          const m = pushMsg('assistant', text)
          saveHistory()
          broadcast('reply', { id: m.id, text, at: m.at, scheduled: true })
          log('定时消息已发', text.slice(0, 20))
        } catch (e) { log('【定时消息失败】', e.message) }
      }, delayMin * 60 * 1000)

      const at = new Date(Date.now() + delayMin * 60000)
      log('排了一条定时消息，', delayMin, '分钟后')
      return json(res, 200, { ok: true, at: at.toISOString(), minutes: delayMin })
    }

    // 人格清单（切换用）
    if (req.method === 'GET' && path === '/app/personas') {
      if (!authed(req, url)) return json(res, 401, { ok: false, error: '口令不对' })
      return json(res, 200, {
        ok: true,
        current: CONFIG.personaFile ? CONFIG.personaFile.split(/[\\/]/).pop() : 'xiaoman_full.md',
        list: [
          { file: 'xiaoman_full.md', name: '小鲸（完整）', desc: '20k 字，全部人格' },
          { file: 'xiaoman_lite.md', name: '小鲸（精简）', desc: '省 token，说话更短' },
        ],
      })
    }

    // 换人格
    if (req.method === 'POST' && path === '/app/persona') {
      if (!need(req, url, res, 'owner')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const f = String(body.file || '')
      if (!/^[\w.-]+\.md$/.test(f)) return json(res, 400, { ok: false, error: '名字不对' })
      const full = join(__dir, f)
      if (!existsSync(full)) return json(res, 404, { ok: false, error: '没有这个文件' })
      try {
        persona = readFileSync(full, 'utf8')
        CONFIG.personaFile = full
        log('换人格 →', f, persona.length, '字')
        return json(res, 200, { ok: true, len: persona.length })
      } catch (e) { return json(res, 500, { ok: false, error: e.message }) }
    }

    // 清空聊天记录（记忆不丢）
    if (req.method === 'POST' && path === '/app/clear') {
      if (!need(req, url, res, 'owner')) return
      const before = history.length
      history.length = 0
      saveHistory()
      broadcast('cleared', {})
      log('清空聊天记录，删了', before, '条')
      return json(res, 200, { ok: true, removed: before })
    }

    // ===== 2026-11-13 晚：给别人家机器人用的钥匙管理 =====

    // 列出所有子钥匙（只有主钥匙能看）
    if (req.method === 'GET' && path === '/app/keys') {
      if (!need(req, url, res, 'owner')) return
      return json(res, 200, {
        ok: true,
        keys: guestKeys.map(k => ({
          name: k.name, token: k.token.slice(0, 8) + '…', scope: k.scope,
          createdAt: k.createdAt, disabled: !!k.disabled,
        })),
      })
    }

    // 发一把新钥匙
    if (req.method === 'POST' && path === '/app/keys') {
      if (!need(req, url, res, 'owner')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const name = String(body.name || '未命名').slice(0, 40)
      const scope = ['read', 'chat'].includes(body.scope) ? body.scope : 'chat'
      const t = randomBytes(16).toString('hex')
      guestKeys.push({ name, token: t, scope, createdAt: Date.now(), disabled: false })
      saveKeys()
      log('发了新钥匙', name, scope)
      return json(res, 200, { ok: true, name, token: t, scope })
    }

    // 吊销一把钥匙
    if (req.method === 'POST' && path === '/app/keys/revoke') {
      if (!need(req, url, res, 'owner')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const t = String(body.token || '')
      const k = guestKeys.find(x => x.token === t || (t.length >= 8 && x.token.startsWith(t)))
      if (!k) return json(res, 404, { ok: false, error: '没这把钥匙' })
      k.disabled = true
      saveKeys()
      log('吊销钥匙', k.name)
      return json(res, 200, { ok: true })
    }

    // 对外开放的接口清单（不用钥匙就能看，方便别人接）
    if (req.method === 'GET' && path === '/api') {
      return json(res, 200, {
        ok: true,
        name: '小鲸 开放接口',
        version: '1.0',
        auth: 'Authorization: Bearer <token>  或  ?token=<token>',
        scopes: { read: '只看，不能改', chat: '能收发消息、看图、看历史' },
        endpoints: [
          { method: 'GET',  path: '/app/ping',          scope: '无',    desc: '探活，不用钥匙' },
          { method: 'GET',  path: '/api',               scope: '无',    desc: '这张表' },
          { method: 'GET',  path: '/app/me',            scope: 'read',  desc: '她是谁' },
          { method: 'GET',  path: '/app/status',        scope: 'read',  desc: '状态：情绪、记忆、在线数' },
          { method: 'GET',  path: '/app/history',       scope: 'read',  desc: '历史消息 ?limit=100' },
          { method: 'GET',  path: '/app/usage',         scope: 'read',  desc: 'Token 统计' },
          { method: 'GET',  path: '/app/stickers',      scope: 'read',  desc: '表情清单' },
          { method: 'GET',  path: '/app/personas',      scope: 'read',  desc: '人格清单' },
          { method: 'POST', path: '/app/send',          scope: 'chat',  desc: '发一条，收她的回复 {text}' },
          { method: 'POST', path: '/app/image',         scope: 'chat',  desc: '发图 {data,mime,text}' },
          { method: 'POST', path: '/app/schedule',      scope: 'chat',  desc: '定时消息 {minutes,hint}' },
          { method: 'GET',  path: '/app/stream',        scope: 'chat',  desc: 'SSE 长连接，收她主动说的话' },
          { method: 'POST', path: '/push',              scope: 'chat',  desc: '往客户端推一条 {text}' },
          { method: 'POST', path: '/app/delete',        scope: 'chat',  desc: '删一条 {id}' },
          { method: 'POST', path: '/app/regen',         scope: 'chat',  desc: '重生成 {id}' },
          { method: 'POST', path: '/app/persona',       scope: 'owner', desc: '换人格 {file}' },
          { method: 'POST', path: '/app/clear',         scope: 'owner', desc: '清空记录' },
          { method: 'GET',  path: '/app/export',        scope: 'owner', desc: '导出 txt' },
          { method: 'GET',  path: '/app/keys',          scope: 'owner', desc: '看子钥匙' },
          { method: 'POST', path: '/app/keys',          scope: 'owner', desc: '发新钥匙 {name,scope}' },
          { method: 'POST', path: '/app/keys/revoke',   scope: 'owner', desc: '吊销 {token}' },
        ],
      })
    }

    // ===== 2026-11-13 晚：纯代理接口（别人家机器人用）=====
    // 不写历史、不动情绪、不算进主人的 token。
    // 只是「拿她的人格 + 你的 key」跑一轮，把结果还给你。
    if (req.method === 'POST' && path === '/proxy/chat') {
      if (!need(req, url, res, 'chat')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }

      const text = String(body.text || '').trim()
      if (!text) return json(res, 400, { ok: false, error: '空的' })

      // 必须有他自己的 key
      const llm = llmOf(req, body, url)
      if (!llm) {
        return json(res, 400, {
          ok: false,
          error: '这个接口必须带自己的模型：请求头 x-llm-key / x-llm-base / x-llm-model',
        })
      }

      // 他自己的近几轮（可选）
      const his = Array.isArray(body.history) ? body.history.slice(-16) : []

      // 组消息：人格 + 他自己的对话 + 这句
      const msgs = [{ role: 'system', content: persona }]
      for (const m of his) {
        const r = (m.role === 'assistant' || m.role === 'model') ? 'assistant' : 'user'
        const c = String(m.content || '').slice(0, 4000)
        if (c) msgs.push({ role: r, content: c })
      }
      msgs.push({ role: 'user', content: text })

      let out
      try { out = await callModel(msgs, llm) }
      catch (e) { return json(res, 500, { ok: false, error: '调你的模型失败：' + e.message }) }

      // 只抹状态块，不写历史
      return json(res, 200, {
        ok: true,
        reply: renderStickers(out.reply),
        usage: out.usage,
        usedYourKey: true,
      })
    }

    // ===== 2026-11-14 晚：设置里那 7 样 =====

    // AI 配置：看/改模型、key、接口地址
    if (req.method === 'GET' && path === '/app/ai') {
      if (!need(req, url, res, 'owner')) return
      return json(res, 200, {
        ok: true,
        model: effective.model,
        apiBase: effective.apiBase,
        apiKeyMasked: effective.apiKey
          ? effective.apiKey.slice(0, 6) + '…' + effective.apiKey.slice(-4)
          : '没设',
        hasKey: !!effective.apiKey,
      })
    }
    if (req.method === 'POST' && path === '/app/ai') {
      if (!need(req, url, res, 'owner')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }

      const patch = {}
      if (body.model) patch.model = String(body.model).slice(0, 60)
      if (body.apiBase) patch.apiBase = String(body.apiBase).slice(0, 200)
      if (body.apiKey) patch.apiKey = String(body.apiKey).slice(0, 200)
      if (!Object.keys(patch).length) return json(res, 400, { ok: false, error: '什么都没改' })

      // ① 先拿新配置真打一次 API，通得过才存
      const trial = { ...effective, ...patch }
      try {
        const probe = await fetch(trial.apiBase.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + trial.apiKey },
          body: JSON.stringify({ model: trial.model, messages: [{ role: 'user', content: '1' }], max_tokens: 1 }),
          signal: AbortSignal.timeout(15000),
        })
        if (!probe.ok) {
          const txt = await probe.text()
          return json(res, 400, {
            ok: false,
            error: `新配置用不通（HTTP ${probe.status}）：${txt.slice(0, 200)}`,
            hint: '没保存，还是用原来的',
          })
        }
      } catch (e) {
        return json(res, 400, {
          ok: false,
          error: '连不上这个接口：' + e.message,
          hint: '没保存，还是用原来的',
        })
      }

      // ② 验证通过，才真正生效
      Object.assign(effective, patch)
      try {
        const merged = {
          model: effective.model,
          apiBase: effective.apiBase,
          ...(patch.apiKey ? { apiKey: patch.apiKey } : {}),
        }
        writeFileSync(join(DATA, 'ai-override.json'), JSON.stringify(merged, null, 1), 'utf8')
        log('AI 配置改了并已验证:', Object.keys(patch).join(','))
      } catch (e) { log('【AI 配置写失败】', e.message) }

      return json(res, 200, { ok: true, model: effective.model, verified: true })
    }

    // 共享记忆与偏好（看）
    if (req.method === 'GET' && path === '/app/memories') {
      if (!need(req, url, res, 'owner')) return
      let m = {}
      try { m = JSON.parse(readFileSync(join(DATA, 'memories.json'), 'utf8')) } catch {}
      return json(res, 200, {
        ok: true,
        counts: {
          memories: (m.memories || []).length,
          insights: (m.insights || []).length,
          profiles: (m.profiles || []).length,
          styleSamples: (m.style_samples || []).length,
        },
        insights: (m.insights || []).map(x => x.text || x).slice(-40),
        profiles: (m.profiles || []).map(p => ({ name: p.name || '', text: p.text || '' })),
      })
    }

    // AI 分析并提取偏好（把他这段时间说的话交给模型，提炼出「他是什么样的人」）
    if (req.method === 'POST' && path === '/app/analyze') {
      if (!need(req, url, res, 'owner')) return
      const recent = history.filter(m => m.role === 'user').slice(-120)
      if (recent.length < 10) return json(res, 400, { ok: false, error: '聊得太少，至少 10 条' })

      const sample = recent.map(m => m.content).join('\n').slice(0, 6000)
      const prompt = [
        { role: 'system', content: '你是个观察者。读下面这些他说的话，提炼出「他是个什么样的人」和「他喜欢怎么被对待」。只输出 JSON：{"profile":"一段话，他这个人","insights":["一条","一条"]}。insights 每条不超过 30 字，最多 8 条。别编，只看他说的话。' },
        { role: 'user', content: sample },
      ]

      let out
      try {
        // 这里是分析，不是聊天 —— 直接打 API，不经过人格、不过滤
        const r2 = await fetch(effective.apiBase.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + effective.apiKey },
          body: JSON.stringify({ model: effective.model, messages: prompt, temperature: 0.6, max_tokens: 1200 }),
        })
        const jj = await r2.json()
        out = jj?.choices?.[0]?.message?.content || ''
        if (!out) throw new Error('API 没返回内容')
      } catch (e) {
        return json(res, 500, { ok: false, error: e.message })
      }

      // 抠 JSON —— 按括号配平取，不用贪婪正则
      const parsed = extractJson(out)

      if (!parsed) return json(res, 500, { ok: false, error: '模型没给出能用的结果', raw: out.slice(0, 300) })

      // 存进记忆
      try {
        let mm = {}
        try { mm = JSON.parse(readFileSync(join(DATA, 'memories.json'), 'utf8')) } catch {}
        if (!Array.isArray(mm.insights)) mm.insights = []
        if (parsed.profile) {
          if (!Array.isArray(mm.profiles)) mm.profiles = []
          mm.profiles[0] = { name: '他', text: String(parsed.profile).slice(0, 800) }
        }
        for (const t of (parsed.insights || []).slice(0, 8)) {
          const txt = String(t).slice(0, 60)
          if (txt && !mm.insights.some(x => (x.text || x) === txt)) mm.insights.push({ text: txt, at: Date.now() })
        }
        writeFileSync(join(DATA, 'memories.json'), JSON.stringify(mm, null, 1), 'utf8')
        log('偏好分析完成，insights 现在', mm.insights.length, '条')
      } catch (e) { log('【记忆写失败】', e.message) }

      return json(res, 200, {
        ok: true,
        profile: parsed.profile || '',
        insights: parsed.insights || [],
      })
    }

    // 状态栏字段（自定义要显示什么）
    if (req.method === 'GET' && path === '/app/statusfields') {
      if (!need(req, url, res, 'owner')) return
      let f = null
      try { f = JSON.parse(readFileSync(join(DATA, 'status-fields.json'), 'utf8')) } catch {}
      return json(res, 200, { ok: true, fields: f || DEFAULT_STATUS_FIELDS })
    }
    if (req.method === 'POST' && path === '/app/statusfields') {
      if (!need(req, url, res, 'owner')) return
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      if (!Array.isArray(body.fields)) return json(res, 400, { ok: false, error: '格式不对' })
      const clean = body.fields
        .filter(x => x && x.key)
        .slice(0, 12)
        .map(x => ({ key: String(x.key).slice(0, 20), label: String(x.label || x.key).slice(0, 20), on: x.on !== false }))
      try { writeFileSync(join(DATA, 'status-fields.json'), JSON.stringify(clean, null, 1), 'utf8') } catch {}
      return json(res, 200, { ok: true, fields: clean })
    }

    // 状态面板：电脑上那个窗口来要的
    if (req.method === 'GET' && path === '/app/status') {
      if (!authed(req, url)) return json(res, 401, { ok: false, error: '口令不对' })
      let emo = {}
      try { emo = JSON.parse(readFileSync(join(DATA, 'emotion.json'), 'utf8')) } catch {}
      let memCount = 0
      try { const m = JSON.parse(readFileSync(join(DATA, 'memories.json'), 'utf8')); memCount = (m.memories || []).length } catch {}
      const last = history[history.length - 1]
      const nClients = clients.size
      return json(res, 200, {
        ok: true,
        now: new Date().toISOString(),
        bridge: {
          uptimeSec: Math.round(process.uptime()),
          port: PORT,
          clients: nClients,             // 手机连着几个
          historyCount: history.length,
          lastMsgAt: last ? last.at : 0,
          lastMsgRole: last ? last.role : '',
        },
        she: {
          axes: emo.axes || {},
          mood: emo.mood || '',
          memories: memCount,
          personaLen: (() => { try { return persona.length } catch { return 0 } })(),
        },
      })
    }

    // 背景图清单（前端抽屉里挑背景用）
    if (req.method === 'GET' && path === '/api/bgs') {
      if (!authed(req, url)) return json(res, 401, { ok: false, error: '口令不对' })
      const dir = join(__dir, 'public', 'bgs')
      let list = []
      try {
        if (existsSync(dir)) {
          list = readdirSync(dir)
            .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
            .sort()
            .map(f => '/bgs/' + f)
        }
      } catch {}
      return json(res, 200, { ok: true, list })
    }

    // 背景图文件
    if (req.method === 'GET' && path.startsWith('/bgs/')) {
      const rel = decodeURIComponent(path.slice('/bgs/'.length))
      if (rel.includes('..') || rel.includes('/') || rel.includes('\\')) return json(res, 400, { ok: false, error: '不行' })
      const file = join(__dir, 'public', 'bgs', rel)
      if (!existsSync(file)) return json(res, 404, { ok: false, error: '没有这张' })
      const ext = file.split('.').pop().toLowerCase()
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=604800' })
      return createReadStream(file).pipe(res)
    }

    if (req.method === 'GET' && path === '/app/stickers') {
      if (!authed(req, url)) return json(res, 401, { ok: false, error: '口令不对' })
      return json(res, 200, { ok: true, ...stickerCount(), names: stickerNamesHint(200), gallery: stickerGallery(400) })
    }

    return json(res, 404, { ok: false, error: '没有这个接口' })
  } catch (e) {
    log('【未捕获】', path, e.message)
    try { json(res, 500, { ok: false, error: e.message }) } catch {}
  }
})

// 她想说话的时候自己开口
function askHerProactive(hint) {
  const sys = buildMessages('(你现在想主动跟他说一句话)')
  sys[0].content += '\n\n## 这次是你先开口\n\n' + hint +
    '\n\n就一句，短一点。不要问「在吗」「在干嘛」。不要解释你为什么说话。'
  // 去掉最后那条假的用户消息
  sys.pop()
  return callModel(sys).then(r => renderStickers(r.reply)).catch(e => { log('【主动说话失败】', e.message); return '' })
}

startInitiative({
  getEmotion: () => {
    try {
      const raw = _rf(join(DATA, 'emotion.json'), 'utf8')
      const j = JSON.parse(raw)
      return j.axes || j.state || j
    } catch { return {} }
  },
  askHer: askHerProactive,
  broadcast,
})

server.listen(PORT, '0.0.0.0', () => {
  log('=== 网桥起来了 === http://127.0.0.1:' + PORT)
  log('口令在 data/token.txt')
})
