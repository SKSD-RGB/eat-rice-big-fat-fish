// 小鲸控制台 · 网页半边
//
// 在 DSH 侧栏「自动化任务」下面加一个「小鲸」入口，点开是整页面板。
// 只读写宿主半边的 /xiaojing/api/* 接口，不直接连网桥。
// 颜色全部走 DSH 的主题变量（--dsw-alias-*），深浅色自动跟随。

window.__ModuleLoader__.load({
  id: 'dsh-xiaojing-panel',
  factory: (require) => {
    const React = require('react')
    const { useState, useEffect, useCallback } = React
    const h = React.createElement
    const inject = ['slots']
    const PANEL_ID = 'xiaojing'
    const API = '/xiaojing/api'

    // ---------------- 接口封装 ----------------
    const get = (p) =>
      fetch(API + p, { cache: 'no-store' })
        .then((r) => r.json())
        .catch((e) => ({ ok: false, error: '连不上插件：' + e.message }))
    const post = (p, body) =>
      fetch(API + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
        .then((r) => r.json())
        .catch((e) => ({ ok: false, error: '连不上插件：' + e.message }))

    const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString())

    // ---------------- 样式 ----------------
    const CSS = `
.xj-root{
  --xj-sea:#3d7fd6; --xj-foam:rgba(61,127,214,.10);
  --xj-text:var(--dsw-alias-label-primary,#1f2328);
  --xj-sub:var(--dsw-alias-label-secondary,#57606a);
  --xj-dim:var(--dsw-alias-label-tertiary,#8b949e);
  --xj-bg:var(--dsw-alias-bg-base,#fff);
  --xj-card:var(--dsw-alias-bg-layer-1,#fff);
  --xj-card2:var(--dsw-alias-bg-layer-2,#f6f8fa);
  --xj-line:var(--dsw-alias-border-l1,rgba(0,0,0,.08));
  --xj-ok:var(--dsw-alias-state-success-primary,#1a7f37);
  --xj-err:var(--dsw-alias-state-error-primary,#cf222e);
  height:100%;overflow:auto;background:var(--xj-bg);color:var(--xj-text);
  font-size:13px;line-height:1.6;
  padding:var(--dsh-frame-top-clearance,24px) 0 40px;box-sizing:border-box;
  font-family:var(--dsh-font-family-ui,inherit);
}
.xj-wrap{max-width:820px;margin:0 auto;padding:0 24px}
.xj-head{display:flex;align-items:center;gap:12px;margin-bottom:6px}
.xj-title{font-size:19px;font-weight:600;margin:0}
.xj-dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.xj-sub{color:var(--xj-sub);font-size:12.5px;margin:0 0 18px}
.xj-tabs{display:flex;gap:4px;border-bottom:1px solid var(--xj-line);margin-bottom:18px;flex-wrap:wrap}
.xj-tab{padding:8px 13px;border:0;background:none;color:var(--xj-sub);cursor:pointer;font-size:13px;
  border-bottom:2px solid transparent;margin-bottom:-1px;border-radius:6px 6px 0 0;font-family:inherit}
.xj-tab:hover{background:var(--xj-foam)}
.xj-tab.on{color:var(--xj-sea);border-bottom-color:var(--xj-sea);font-weight:600}
.xj-card{background:var(--xj-card);border:1px solid var(--xj-line);border-radius:10px;padding:14px 16px;margin-bottom:12px}
.xj-card h4{margin:0 0 10px;font-size:13.5px;font-weight:600}
.xj-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0}
.xj-row+.xj-row{border-top:1px solid var(--xj-line)}
.xj-k{color:var(--xj-sub);font-size:12.5px}
.xj-v{font-size:13px;text-align:right;word-break:break-all}
.xj-in{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid var(--xj-line);
  border-radius:7px;background:var(--xj-bg);color:var(--xj-text);font-size:13px;font-family:inherit;outline:none}
.xj-in:focus{border-color:var(--xj-sea)}
.xj-btn{padding:7px 14px;border:1px solid var(--xj-line);border-radius:7px;background:var(--xj-card2);
  color:var(--xj-text);cursor:pointer;font-size:12.5px;font-family:inherit}
.xj-btn:hover{background:var(--xj-foam)}
.xj-btn.pri{background:var(--xj-sea);border-color:var(--xj-sea);color:#fff}
.xj-btn.pri:hover{opacity:.9}
.xj-btn:disabled{opacity:.5;cursor:default}
.xj-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.xj-msg{border-radius:8px;padding:8px 12px;margin-bottom:6px;font-size:13px;max-width:88%;white-space:pre-wrap;word-break:break-word}
.xj-msg.me{margin-left:auto;background:var(--xj-sea);color:#fff}
.xj-msg.her{background:var(--xj-card2);color:var(--xj-text)}
.xj-meta{font-size:11px;color:var(--xj-dim);margin:2px 0 8px}
.xj-list{margin:0;padding-left:18px}
.xj-list li{margin:4px 0}
.xj-tip{color:var(--xj-dim);font-size:12px}
.xj-err{color:var(--xj-err);font-size:12.5px}
.xj-ok{color:var(--xj-ok);font-size:12.5px}
`

    function injectCss() {
      if (document.getElementById('xj-css')) return
      const s = document.createElement('style')
      s.id = 'xj-css'
      s.textContent = CSS
      document.head.appendChild(s)
    }

    // ---------------- 侧栏图标 ----------------
    function WhaleIcon() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M4 14c0-3.3 2.7-6 6-6h5l2.2-2.6a.6.6 0 0 1 1 .4V8c1.6.6 2.8 2.2 2.8 4 0 .6-.1 1.1-.3 1.6l1.5 1.4-1.8.5c-.9 1.7-2.7 2.9-4.9 2.9H8a4 4 0 0 1-4-4V14Z',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinejoin: 'round',
        }),
        h('circle', { cx: 8.6, cy: 12.6, r: 0.9, fill: 'currentColor' }),
      )
    }

    // ---------------- 面板 ----------------
    function XiaojingPage() {
      const [tab, setTab] = useState('overview')
      const [conn, setConn] = useState(null)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')

      useEffect(() => {
        injectCss()
      }, [])

      const refreshConn = useCallback(() => {
        get('/conn').then(setConn)
      }, [])

      useEffect(() => {
        refreshConn()
        const t = setInterval(refreshConn, 8000)
        return () => clearInterval(t)
      }, [refreshConn])

      const online = conn?.online
      const cfg = conn?.config || {}

      const tabs = [
        ['overview', '概览'],
        ['conn', '连接'],
        ['model', '模型'],
        ['memory', '记忆'],
        ['keys', '钥匙'],
        ['chat', '聊天'],
      ]

      function TabOverview() {
        const [d, setD] = useState(null)
        useEffect(() => {
          if (tab !== 'overview') return
          get('/overview').then(setD)
        }, [tab])
        if (!d) return h('p', { className: 'xj-tip' }, '读取中…')
        const st = d.status || {}
        const she = st.she || {}
        const br = st.bridge || {}
        const us = d.usage || {}
        const mem = d.memories || {}
        const ai = d.ai || {}
        const tot = us.total || {}
        const last = us.last || {}
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '她现在'),
            Row('心情', she.mood || '—'),
            Row('想你', Math.round(she.axes?.missing || 0) + '%'),
            Row('记得', fmtNum(she.memories) + ' 条'),
            Row('人格长度', fmtNum(she.personaLen) + ' 字'),
          ),
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '网桥'),
            Row('地址', (cfg.host || '') + ':' + (cfg.port || '')),
            Row('已运行', br.uptimeSec ? Math.floor(br.uptimeSec / 60) + ' 分钟' : '—'),
            Row('连着的设备', (br.clients || 0) + ' 台'),
            Row('历史消息', fmtNum(br.historyCount) + ' 条'),
          ),
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '用量'),
            Row('这一轮', fmtNum(last.total) + ' token'),
            Row('累计', fmtNum(tot.total) + ' token'),
            Row('轮数', fmtNum(us.rounds)),
            Row('模型', ai.model || '—'),
          ),
        )
      }

      function TabConn() {
        const [host, setHost] = useState('')
        const [port, setPort] = useState('')
        const [token, setToken] = useState('')
        const [saving, setSaving] = useState(false)

        useEffect(() => {
          if (tab !== 'conn') return
          get('/conn').then((c) => {
            setHost(c.config?.host || '127.0.0.1')
            setPort(String(c.config?.port || 8787))
          })
        }, [tab])

        async function save() {
          setSaving(true)
          const r = await post('/conn', { host, port: Number(port), token: token || undefined })
          setSaving(false)
          setToken('')
          setNote(r.ok && r.online ? '✅ ' + r.message : '⚠️ ' + (r.message || r.error || '失败'))
          refreshConn()
        }

        return h(
          'div',
          null,
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '小鲸网桥地址'),
            h('p', { className: 'xj-tip' }, '网桥是电脑上那个跑在 8787 端口的程序。手机 App 和这个面板都连它。'),
            h('div', { className: 'xj-grid2', style: { marginTop: 10 } },
              h('div', null,
                h('div', { className: 'xj-k', style: { marginBottom: 4 } }, '地址'),
                h('input', { className: 'xj-in', value: host, onChange: (e) => setHost(e.target.value), placeholder: '127.0.0.1' }),
              ),
              h('div', null,
                h('div', { className: 'xj-k', style: { marginBottom: 4 } }, '端口'),
                h('input', { className: 'xj-in', value: port, onChange: (e) => setPort(e.target.value), placeholder: '8787' }),
              ),
            ),
            h('div', { style: { marginTop: 10 } },
              h('div', { className: 'xj-k', style: { marginBottom: 4 } }, '口令（当前：' + (cfg.tokenMasked || '没设') + '）'),
              h('input', { className: 'xj-in', value: token, onChange: (e) => setToken(e.target.value), placeholder: '留空 = 不改' }),
            ),
            h('div', { style: { marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' } },
              h('button', { className: 'xj-btn pri', onClick: save, disabled: saving }, saving ? '测试中…' : '保存并测试'),
              note ? h('span', { className: note.startsWith('✅') ? 'xj-ok' : 'xj-err' }, note) : null,
            ),
          ),
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '当前状态'),
            Row('连接', online ? '✅ 通着' : '❌ 连不上'),
            Row('口令', cfg.hasToken ? '已设置' : '没设'),
          ),
        )
      }

      function TabModel() {
        const [ai, setAi] = useState(null)
        const [model, setModel] = useState('')
        const [key, setKey] = useState('')
        const [msg, setMsg] = useState('')
        const [busy, setBusy] = useState(false)

        useEffect(() => {
          if (tab !== 'model') return
          get('/ai').then((r) => {
            setAi(r)
            setModel(r.model || '')
          })
        }, [tab])

        useEffect(() => {
          if (!msg) return
          const t = setTimeout(() => setMsg(''), 6000)
          return () => clearTimeout(t)
        }, [msg])

        async function save() {
          setBusy(true)
          const body = {}
          if (model) body.model = model
          if (key) body.apiKey = key
          const r = await post('/ai', body)
          setBusy(false)
          setKey('')
          if (r.ok) {
            setMsg('✅ 换好了，模型：' + r.model)
            get('/ai').then(setAi)
          } else {
            setMsg('⚠️ ' + (r.error || '失败') + (r.hint ? '（' + r.hint + '）' : ''))
          }
        }

        return h(
          'div',
          null,
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '模型'),
            h('p', { className: 'xj-tip' }, '改完会先拿新配置真打一次 API，通得过才存 —— 填错当场拒绝，不会把原来的弄坏。'),
            h('div', { style: { marginTop: 10 } },
              h('div', { className: 'xj-k', style: { marginBottom: 4 } }, '模型名'),
              h('input', { className: 'xj-in', value: model, onChange: (e) => setModel(e.target.value), placeholder: 'deepseek-flash' }),
            ),
            h('div', { style: { marginTop: 10 } },
              h('div', { className: 'xj-k', style: { marginBottom: 4 } }, '接口地址'),
              h('div', { className: 'xj-v', style: { textAlign: 'left' } }, ai?.apiBase || '—'),
            ),
            h('div', { style: { marginTop: 10 } },
              h('div', { className: 'xj-k', style: { marginBottom: 4 } }, '密钥（当前：' + (ai?.apiKeyMasked || '没设') + '）'),
              h('input', { className: 'xj-in', value: key, onChange: (e) => setKey(e.target.value), placeholder: '留空 = 不改' }),
            ),
            h('div', { style: { marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' } },
              h('button', { className: 'xj-btn pri', onClick: save, disabled: busy }, busy ? '验证中…' : '保存并验证'),
              msg ? h('span', { className: msg.startsWith('✅') ? 'xj-ok' : 'xj-err' }, msg) : null,
            ),
          ),
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '可选模型'),
            h('p', { className: 'xj-list xj-tip' },
              h('div', null, '· deepseek-flash —— 便宜快，日常聊天推荐'),
              h('div', null, '· deepseek-v4-pro —— 贵一些，回复质量更好'),
            ),
          ),
        )
      }

      function TabMemory() {
        const [m, setM] = useState(null)
        const [busy, setBusy] = useState(false)
        const [msg, setMsg] = useState('')

        const load = () => get('/memories').then(setM)
        useEffect(() => {
          if (tab !== 'memory') return
          load()
        }, [tab])

        async function analyze() {
          setBusy(true)
          setMsg('正在分析…要十几秒')
          const r = await post('/analyze', {})
          setBusy(false)
          setMsg(r.ok ? '✅ 分析完了' : '⚠️ ' + (r.error || '失败'))
          load()
        }

        const c = m?.counts || {}
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '她记得的'),
            Row('记忆', fmtNum(c.memories) + ' 条'),
            Row('偏好', fmtNum(c.insights) + ' 条'),
            Row('说话样本', fmtNum(c.styleSamples) + ' 条'),
            h('div', { style: { marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' } },
              h('button', { className: 'xj-btn pri', onClick: analyze, disabled: busy }, 'AI 分析并提取偏好'),
              msg ? h('span', { className: msg.startsWith('✅') ? 'xj-ok' : 'xj-tip' }, msg) : null,
            ),
          ),
          m?.profiles?.[0]?.text
            ? h('div', { className: 'xj-card' },
                h('h4', null, '他这个人'),
                h('p', { style: { margin: 0, whiteSpace: 'pre-wrap' } }, m.profiles[0].text),
              )
            : null,
          (m?.insights || []).length
            ? h('div', { className: 'xj-card' },
                h('h4', null, '偏好'),
                h('ul', { className: 'xj-list' },
                  ...(m.insights || []).slice(-20).map((t, i) => h('li', { key: i }, typeof t === 'string' ? t : t.text || '')),
                ),
              )
            : null,
        )
      }

      function TabKeys() {
        const [d, setD] = useState(null)
        const [msg, setMsg] = useState('')
        const load = () => get('/keys').then(setD)
        useEffect(() => {
          if (tab !== 'keys') return
          load()
        }, [tab])

        async function issue(scope) {
          const r = await post('/keys', { name: scope === 'chat' ? '聊天机器人' : '只读机器人', scope })
          if (r.ok) {
            setMsg('✅ 新钥匙：' + r.token + '（只显示这一次，记下来）')
            load()
          } else {
            setMsg('⚠️ ' + (r.error || '失败'))
          }
        }

        const arr = d?.keys || []
        return h(
          'div',
          null,
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '发给别人用的钥匙'),
            h('p', { className: 'xj-tip' }, '别人家的机器人拿这把钥匙就能跟你的小鲸说话，不用你的主口令。'),
            h('div', { style: { display: 'flex', gap: 8, marginTop: 10 } },
              h('button', { className: 'xj-btn pri', onClick: () => issue('chat') }, '发一把 chat 钥匙'),
              h('button', { className: 'xj-btn', onClick: () => issue('read') }, '发一把 read 钥匙'),
            ),
            msg ? h('p', { className: 'xj-ok', style: { marginTop: 10, wordBreak: 'break-all' } }, msg) : null,
          ),
          h(
            'div',
            { className: 'xj-card' },
            h('h4', null, '已发出的（' + arr.length + ' 把）'),
            arr.length === 0
              ? h('p', { className: 'xj-tip' }, '还没发过。')
              : h('div', null,
                  ...arr.map((k, i) =>
                    h('div', { className: 'xj-row', key: i },
                      h('div', null,
                        h('div', null, k.name || '(无名)'),
                        h('div', { className: 'xj-tip' }, k.token + ' · ' + (k.scope || 'chat') + (k.disabled ? ' · 已停用' : '')),
                      ),
                    ),
                  ),
                ),
          ),
        )
      }

      function TabChat() {
        const [msgs, setMsgs] = useState([])
        const [text, setText] = useState('')
        const [sending, setSending] = useState(false)

        const load = () =>
          get('/history?limit=60').then((r) => {
            if (r.ok && Array.isArray(r.messages)) setMsgs(r.messages)
          })

        useEffect(() => {
          if (tab !== 'chat') return
          load()
          const t = setInterval(load, 4000)
          return () => clearInterval(t)
        }, [tab])

        async function send() {
          const t = text.trim()
          if (!t || sending) return
          setSending(true)
          setText('')
          const r = await post('/send', { text: t })
          setSending(false)
          if (!r.ok) setNote(r.error || '发送失败')
          load()
        }

        return h(
          'div',
          null,
          h(
            'div',
            { className: 'xj-card', style: { maxHeight: 460, overflow: 'auto' } },
            msgs.length === 0
              ? h('p', { className: 'xj-tip' }, '还没有消息。')
              : h('div', null,
                  ...msgs.map((m, i) =>
                    h('div', { key: m.id || i },
                      h('div', { className: 'xj-meta' }, new Date(m.at || Date.now()).toLocaleString()),
                      h('div', { className: 'xj-msg ' + (m.role === 'user' ? 'me' : 'her') }, m.content || ''),
                    ),
                  ),
                ),
          ),
          h(
            'div',
            { className: 'xj-card' },
            h('div', { style: { display: 'flex', gap: 8 } },
              h('input', {
                className: 'xj-in',
                value: text,
                placeholder: '在电脑上直接跟她说句话…',
                onChange: (e) => setText(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') send()
                },
              }),
              h('button', { className: 'xj-btn pri', onClick: send, disabled: sending }, sending ? '发送中' : '发送'),
            ),
            note ? h('p', { className: 'xj-err', style: { marginTop: 8 } }, note) : null,
          ),
        )
      }

      const body = {
        overview: TabOverview,
        conn: TabConn,
        model: TabModel,
        memory: TabMemory,
        keys: TabKeys,
        chat: TabChat,
      }[tab]
      const Body = body

      return h(
        'div',
        { className: 'xj-root' },
        h(
          'div',
          { className: 'xj-wrap' },
          h(
            'div',
            { className: 'xj-head' },
            h('h1', { className: 'xj-title' }, '小鲸'),
            h('span', {
              className: 'xj-dot',
              style: { background: online ? 'var(--xj-ok)' : 'var(--xj-err)' },
            }),
            h('span', { className: 'xj-tip' }, online ? '网桥通着' : '网桥连不上'),
          ),
          h('p', { className: 'xj-sub' }, '在这儿看她的状态、改模型、翻记忆、发钥匙。改完手机上立刻生效。'),
          h(
            'div',
            { className: 'xj-tabs' },
            ...tabs.map(([id, label]) =>
              h(
                'button',
                {
                  key: id,
                  className: 'xj-tab' + (tab === id ? ' on' : ''),
                  onClick: () => setTab(id),
                },
                label,
              ),
            ),
          ),
          online || tab === 'conn'
            ? h(Body)
            : h(
                'div',
                { className: 'xj-card' },
                h('h4', null, '先连上网桥'),
                h('p', { className: 'xj-tip' }, '这个面板要连电脑上那个跑在 8787 端口的小鲸网桥。去「连接」页填地址。'),
                h('button', { className: 'xj-btn pri', onClick: () => setTab('conn') }, '去连接'),
              ),
        ),
      )
    }

    function Row(k, v) {
      return h(
        'div',
        { className: 'xj-row' },
        h('span', { className: 'xj-k' }, k),
        h('span', { className: 'xj-v' }, v),
      )
    }

    // ---------------- 注册 ----------------
    return {
      inject,
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, XiaojingPage))
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 25, label: () => '小鲸' },
            WhaleIcon,
          ),
        )
      },
    }
  },
})
