// 小鲸控制台 · 宿主半边
//
// 作用：给网页半边提供 /xiaojing/api/* 接口。
// 它自己不做业务，只做两件事：
//   1. 记住小鲸网桥的地址和口令（存在插件自己的配置里）
//   2. 把面板发来的请求转发到网桥的 8787 端口
//
// 网页半边（client/client.js）只管画界面，不直接碰网桥——跨域 + 口令都不该出现在浏览器里。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
import { join } from 'node:path'

export const name = 'xiaojing-panel'
export const inject = ['webServer']

const PREFIX = '/xiaojing/api'

// ---------- 配置存取 ----------
// 存在 DSH 的数据目录里，卸载插件不丢；用户改了端口也记得住。
function cfgFile(ctx) {
  const base = ctx?.baseDir || ctx?.dataDir || process.cwd()
  const dir = join(base, 'xiaojing-panel')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'config.json')
}

function loadCfg(ctx) {
  const def = { host: '127.0.0.1', port: 8787, token: '' }
  try {
    const raw = readFileSync(cfgFile(ctx), 'utf8')
    const j = JSON.parse(raw)
    return { ...def, ...j }
  } catch {
    return def
  }
}

function saveCfg(ctx, next) {
  try {
    writeFileSync(cfgFile(ctx), JSON.stringify(next, null, 2), 'utf8')
  } catch (e) {
    // 写不下就算了，内存里照样能用
  }
  return next
}

// ---------- 转发到网桥 ----------
async function bridgeFetch(cfg, path, init) {
  const base = `http://${cfg.host}:${cfg.port}`
  const url = base + path
  const headers = { ...(init?.headers || {}) }
  if (cfg.token) headers.authorization = 'Bearer ' + cfg.token

  try {
    const r = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(init?.timeout || 30000),
    })
    const text = await r.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = { ok: false, error: '网桥返回的不是 JSON', raw: text.slice(0, 500) }
    }
    return { status: r.status, body }
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? '网桥没响应（超时）' : e.message
    return {
      status: 502,
      body: {
        ok: false,
        error: '连不上小鲸网桥：' + msg,
        hint: `确认电脑上那个网桥在跑，地址 ${cfg.host}:${cfg.port}`,
      },
    }
  }
}

// ---------- 请求工具 ----------
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''
    let dead = false
    req.on('data', (c) => {
      if (dead) return
      d += c
      if (d.length > 4_000_000) {
        dead = true
        try {
          req.destroy()
        } catch {}
        resolve('')
      }
    })
    req.on('end', () => {
      if (!dead) resolve(d)
    })
    req.on('error', () => resolve(''))
  })
}

function send(res, code, obj) {
  try {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  } catch {}
}

// ---------- 主入口 ----------
export function apply(ctx) {
  // 调试标记：证明宿主被加载了
  try { require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'xj-host-loaded.txt'), new Date().toISOString()) } catch {}
  let cfg = loadCfg(ctx)

  // 面板要的接口清单
  // DSH 的 exact 路由不区分请求方法，同一路径只能注册一次 —— 所以这里按 path 聚合，
  // 一条路径挂一个 handler，内部再按 GET / POST 分流。
  const table = new Map() // path -> { GET: fn, POST: fn }

  const route = (method, path, handler) => {
    if (!table.has(path)) table.set(path, {})
    table.get(path)[method] = handler
  }

  const flushRoutes = () => {
    for (const [path, handlers] of table) {
      const full = PREFIX + path
      ctx.effect(
        () =>
          ctx.webServer.register({
            kind: 'exact',
            path: full,
            handler: async (req, res) => {
              try {
                const m = (req.method || 'GET').toUpperCase()
                const fn = handlers[m] || handlers.GET
                if (!fn) return send(res, 405, { ok: false, error: '这个路径不支持 ' + m })
                await fn(req, res)
              } catch (e) {
                send(res, 500, { ok: false, error: e.message })
              }
            },
          }),
        `xiaojing-panel: 路由 ${path}`,
      )
    }
  }

  // ① 连接状态 + 当前配置（口令打码）
  route('GET', '/conn', async (req, res) => {
    const r = await bridgeFetch(cfg, '/app/ping', { timeout: 5000 })
    send(res, 200, {
      ok: true,
      config: {
        host: cfg.host,
        port: cfg.port,
        hasToken: !!cfg.token,
        tokenMasked: cfg.token ? cfg.token.slice(0, 6) + '…' + cfg.token.slice(-4) : '没设',
      },
      online: r.status === 200 && r.body?.ok === true,
      ping: r.body,
    })
  })

  // ② 保存连接配置
  route('POST', '/conn', async (req, res) => {
    const raw = await readBody(req)
    let body = {}
    try {
      body = JSON.parse(raw)
    } catch {
      return send(res, 400, { ok: false, error: '不是合法 JSON' })
    }
    if (body.host) cfg.host = String(body.host).slice(0, 100)
    if (body.port) cfg.port = Number(body.port) || 8787
    if (typeof body.token === 'string' && body.token.trim()) cfg.token = body.token.trim()
    if (body.clearToken) cfg.token = ''
    cfg = saveCfg(ctx, cfg)

    // 存完立刻探一次，让用户当场知道通没通
    const r = await bridgeFetch(cfg, '/app/ping', { timeout: 5000 })
    send(res, 200, {
      ok: true,
      online: r.status === 200 && r.body?.ok === true,
      message: r.status === 200 ? '连上了' : r.body?.error || '没连上',
    })
  })

  // ③ 概览：状态 + 用量 + 记忆数 + 模型
  route('GET', '/overview', async (req, res) => {
    const [st, us, mem, ai] = await Promise.all([
      bridgeFetch(cfg, '/app/status'),
      bridgeFetch(cfg, '/app/usage'),
      bridgeFetch(cfg, '/app/memories'),
      bridgeFetch(cfg, '/app/ai'),
    ])
    send(res, 200, {
      ok: true,
      status: st.body,
      usage: us.body,
      memories: mem.body,
      ai: ai.body,
    })
  })

  // ④ 聊天记录
  route('GET', '/history', async (req, res) => {
    const u = new URL(req.url, 'http://x')
    const limit = Math.min(200, Number(u.searchParams.get('limit')) || 60)
    const r = await bridgeFetch(cfg, `/app/history?limit=${limit}`)
    send(res, r.status, r.body)
  })

  // ⑤ 发一条消息（面板里直接跟她说话）
  route('POST', '/send', async (req, res) => {
    const raw = await readBody(req)
    let body = {}
    try {
      body = JSON.parse(raw)
    } catch {}
    if (!body.text) return send(res, 400, { ok: false, error: '没说写什么' })
    const r = await bridgeFetch(cfg, '/app/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: String(body.text).slice(0, 4000) }),
      timeout: 120000,
    })
    send(res, r.status, r.body)
  })

  // ⑥ 模型配置
  route('GET', '/ai', async (req, res) => {
    const r = await bridgeFetch(cfg, '/app/ai')
    send(res, r.status, r.body)
  })
  route('POST', '/ai', async (req, res) => {
    const raw = await readBody(req)
    const r = await bridgeFetch(cfg, '/app/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
      timeout: 40000,
    })
    send(res, r.status, r.body)
  })

  // ⑦ 记忆与偏好
  route('GET', '/memories', async (req, res) => {
    const r = await bridgeFetch(cfg, '/app/memories')
    send(res, r.status, r.body)
  })
  route('POST', '/analyze', async (req, res) => {
    const r = await bridgeFetch(cfg, '/app/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      timeout: 120000,
    })
    send(res, r.status, r.body)
  })

  // ⑧ 状态栏字段
  route('GET', '/statusfields', async (req, res) => {
    const r = await bridgeFetch(cfg, '/app/statusfields')
    send(res, r.status, r.body)
  })
  route('POST', '/statusfields', async (req, res) => {
    const raw = await readBody(req)
    const r = await bridgeFetch(cfg, '/app/statusfields', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    })
    send(res, r.status, r.body)
  })

  // ⑨ 钥匙管理
  route('GET', '/keys', async (req, res) => {
    const r = await bridgeFetch(cfg, '/app/keys')
    send(res, r.status, r.body)
  })
  route('POST', '/keys', async (req, res) => {
    const raw = await readBody(req)
    const r = await bridgeFetch(cfg, '/app/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    })
    send(res, r.status, r.body)
  })
  route('POST', '/keys/revoke', async (req, res) => {
    const raw = await readBody(req)
    const r = await bridgeFetch(cfg, '/app/keys/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    })
    send(res, r.status, r.body)
  })

  // ⑩ 人格切换
  route('GET', '/personas', async (req, res) => {
    const r = await bridgeFetch(cfg, '/app/personas')
    send(res, r.status, r.body)
  })
  route('POST', '/persona', async (req, res) => {
    const raw = await readBody(req)
    const r = await bridgeFetch(cfg, '/app/persona', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    })
    send(res, r.status, r.body)
  })

  // 所有 route 声明完了，一次性注册（每个 path 只注册一次）
  flushRoutes()
}
