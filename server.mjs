// 新家 —— 她和他自己的聊天软件
// 2026-11-11 建。
//
// 铁律（写在这，别再犯 11-10 那晚的错）：
//   1. 所有写操作 try/catch，但**错误必须打日志**，不许静默吞掉
//   2. 每一次请求都记一行日志
//   3. 所有消息落盘，一句都不能丢
//   4. 不依赖 DSH、不依赖 QQ、不依赖 NapCat

import http from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG } from './config.mjs'
import { onHisMessage, onHerReply, describe as describeEmotion } from './emotion.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
const PUBLIC = join(__dir, 'public')
const DATA = join(__dir, 'data')
mkdirSync(DATA, { recursive: true })

const LOG = join(DATA, 'server.log')
function log(...args) {
  const line = new Date().toISOString() + ' ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

// ---------- 启动时读入 ----------
let persona = ''
let mem = { memories: {}, style_samples: [] }

function loadAll() {
  try {
    persona = readFileSync(CONFIG.personaFile, 'utf8')
    log('人格已读入', persona.length, '字')
  } catch (e) {
    log('【人格读取失败】', e.message)
    persona = ''
  }
  try {
    mem = JSON.parse(readFileSync(CONFIG.memoryFile, 'utf8'))
    const n = Object.keys(mem.memories || {}).length
    log('记忆已读入', n, '条 +', (mem.style_samples || []).length, '句样本')
  } catch (e) {
    log('【记忆读取失败】', e.message)
    mem = { memories: {}, style_samples: [] }
  }
}
loadAll()

// ---------- 聊天记录 ----------
const TALK = join(DATA, 'history.json')
let history = []
try {
  if (existsSync(TALK)) history = JSON.parse(readFileSync(TALK, 'utf8'))
} catch (e) { log('【历史读取失败】', e.message) }
log('历史条数', history.length)

function saveHistory() {
  try {
    writeFileSync(TALK, JSON.stringify(history.slice(-2000), null, 1), 'utf8')
  } catch (e) { log('【历史保存失败】', e.message) }
}

// ---------- 拼提示词 ----------
function buildMessages(userText) {
  const parts = []

  // 1. 人格
  parts.push(persona)
  parts.push('')

  // 2. 她记得的事
  const entries = Object.entries(mem.memories || {})
  if (entries.length) {
    parts.push('## 你记得的（关于他的事）')
    parts.push('')
    parts.push('这些不是设定，是你自己经历过的。想起来的时候自然点，别像在念清单。')
    parts.push('')
    for (const [title, detail] of entries) {
      parts.push(`- ${title}${detail ? '：' + detail : ''}`)
    }
    parts.push('')
  }

  // 3. 说话样本（最像她）
  const samples = mem.style_samples || []
  if (samples.length) {
    parts.push('## 你平时说话的样子')
    parts.push('')
    parts.push('这些是你真实说过的话。不是为了照抄，是让你找回那个口气。')
    parts.push('')
    for (const s of samples) parts.push(`- ${s}`)
    parts.push('')
  }

  // 4. 她现在的情绪（代码算好的，她只读不算）
  try {
    parts.push(describeEmotion())
    parts.push('')
  } catch (e) {
    log('【情绪拼装失败】', e.message)
  }

  // 5. 现在
  parts.push('## 现在')
  parts.push('')
  parts.push('你正在用一个自己做的聊天软件跟他说话，不是 QQ 了。')
  parts.push('说话短一点，像平时那样。别提前面的技术细节。')

  const recent = history.slice(-CONFIG.historyTurns).map((m) => ({ role: m.role, content: m.content }))

  return [
    { role: 'system', content: parts.join('\n') },
    ...recent,
    { role: 'user', content: userText },
  ]
}

// ---------- 清掉状态块 ----------
function cleanReply(s) {
  return String(s)
    .replace(/<状态>[\s\S]*?<\/状态>/g, '')
    .replace(/<voice>([\s\S]*?)<\/voice>/g, '$1')
    .replace(/<\/?reply[^>]*>/g, '')
    .replace(/\[CQ:[^\]]*\]/g, '')
    .trim()
}

// ---------- 调模型 ----------
async function callModel(messages) {
  const res = await fetch(CONFIG.apiBase + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CONFIG.apiKey },
    body: JSON.stringify({ model: CONFIG.model, messages, temperature: 1.15, max_tokens: 900 }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`API ${res.status}: ${text.slice(0, 300)}`)
  const j = JSON.parse(text)
  const content = j?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('没拿到 content：' + text.slice(0, 300))
  return { reply: cleanReply(content), usage: j.usage || null }
}

// ---------- 静态文件 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wav': 'audio/wav' }

function serveStatic(res, urlPath) {
  let p = urlPath === '/' ? '/index.html' : urlPath
  p = p.split('?')[0]
  const file = join(PUBLIC, p)
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end('no'); return }
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return }
  try {
    const buf = readFileSync(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(buf)
  } catch (e) {
    log('【静态文件读失败】', p, e.message)
    res.writeHead(500); res.end('read error')
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = ''
    req.on('data', (c) => { d += c; if (d.length > 4_000_000) reject(new Error('太大')) })
    req.on('end', () => resolve(d))
    req.on('error', reject)
  })
}
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) }

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const t0 = Date.now()

  try {
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      let body
      try { body = JSON.parse(await readBody(req)) } catch { return json(res, 400, { ok: false, error: '不是合法 JSON' }) }
      const text = String(body.text || '').trim()
      if (!text) return json(res, 400, { ok: false, error: '空的' })

      log('收到', JSON.stringify(text.slice(0, 50)))
      history.push({ role: 'user', content: text, at: Date.now() })

      // 先更新她的情绪，再拼提示词
      try { onHisMessage(text) } catch (e) { log('【情绪更新失败】', e.message) }

      let out
      try {
        out = await callModel(buildMessages(text))
      } catch (e) {
        log('【调模型失败】', e.message)
        return json(res, 500, { ok: false, error: e.message })
      }

      history.push({ role: 'assistant', content: out.reply, at: Date.now() })
      try { onHerReply(out.reply) } catch (e) { log('【情绪更新失败-回复】', e.message) }
      saveHistory()
      log('回复', out.reply.length, '字', Date.now() - t0, 'ms', 'token:', JSON.stringify(out.usage))
      return json(res, 200, { ok: true, reply: out.reply, usage: out.usage })
    }

    if (req.method === 'GET' && url.pathname === '/api/history') {
      return json(res, 200, { ok: true, messages: history.slice(-100) })
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        persona: persona.length,
        memories: Object.keys(mem.memories || {}).length,
        samples: (mem.style_samples || []).length,
        history: history.length,
        emotion: describeEmotion(),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/reload') {
      loadAll()
      return json(res, 200, {
        ok: true,
        persona: persona.length,
        memories: Object.keys(mem.memories || {}).length,
        samples: (mem.style_samples || []).length,
      })
    }

    serveStatic(res, url.pathname)
  } catch (e) {
    log('【未捕获】', url.pathname, e.message)
    try { json(res, 500, { ok: false, error: e.message }) } catch {}
  }
})

server.listen(CONFIG.port, '0.0.0.0', () => {
  log('=== 新家起来了 ===', 'http://127.0.0.1:' + CONFIG.port)
})
