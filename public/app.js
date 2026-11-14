// 小鲸 —— 前端 v2 (2026-11-13)
const $ = id => document.getElementById(id)
const $stream = $('stream')
const $input = $('input')
const $send = $('send')
const $bg = $('bg')
const $statusbar = $('statusbar')
const $toast = $('toast')
const $drawer = $('drawer')
const $mask = $('mask')
const $dbody = $('dbody')

const TOKEN_KEY = 'xj_token'
const SKIN_KEY = 'xj_skin'
const BG_KEY = 'xj_bg'
const NAME_KEY = 'xj_name'
const AVATAR_KEY = 'xj_avatar'

let token = localStorage.getItem(TOKEN_KEY) || ''
let busy = false
let lastDay = ''
let statusOpen = false
let es = null

function pad(n){ return String(n).padStart(2, '0') }
function dayKey(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) }
function timeText(d){
  const today = dayKey(new Date())
  const k = dayKey(d)
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes())
  if (k === today) return hm
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm
}

function toast(msg, ms = 1800){
  $toast.textContent = msg
  $toast.classList.add('on')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => $toast.classList.remove('on'), ms)
}

function authHeaders(extra){
  return Object.assign({ 'content-type': 'application/json' }, extra || {})
}
function api(url){
  const u = new URL(url, location.origin)
  if (token) u.searchParams.set('token', token)
  return fetch(u.toString(), { headers: authHeaders() })
}
function apiPost(url, body){
  const u = new URL(url, location.origin)
  if (token) u.searchParams.set('token', token)
  return fetch(u.toString(), { method: 'POST', headers: authHeaders(), body: JSON.stringify(body || {}) })
}

/* ==================== 顶栏 ==================== */
function applyName(name){
  if (name) $('name').textContent = name
}
function applyAvatar(src){
  const img = $('avatarImg'), emo = $('avatarEmoji')
  if (src){
    img.src = src; img.hidden = false; emo.hidden = true
  } else {
    img.hidden = true; emo.hidden = false
  }
}
function setName(n){
  localStorage.setItem(NAME_KEY, n)
  applyName(n)
}
function setAvatar(src){
  if (src) localStorage.setItem(AVATAR_KEY, src)
  else localStorage.removeItem(AVATAR_KEY)
  applyAvatar(src)
}
function setOnline(on){
  $('dot').classList.toggle('off', !on)
  $('sub').textContent = on ? '在线' : '连接断了'
}

/* ==================== 皮肤 ==================== */
const SKINS = {
  mint:   { name: '薄荷',   a: '#7fd4a0', b: '#5ec98a', t: '#0b2a18' },
  peach:  { name: '蜜桃',   a: '#ffb3ba', b: '#ff9aa8', t: '#4a1420' },
  sky:    { name: '晴空',   a: '#8ec9f0', b: '#66aee8', t: '#0d2a42' },
  grape:  { name: '葡萄',   a: '#c3b0f0', b: '#a891e8', t: '#26194a' },
  cream:  { name: '奶油',   a: '#ffe6a8', b: '#f7d585', t: '#453411' },
  paper:  { name: '纸白',   a: '#e9e9e9', b: '#d8d8d8', t: '#1b1f24' },
}
function applySkin(k){
  const s = SKINS[k] || SKINS.mint
  const r = document.documentElement.style
  r.setProperty('--mine', s.a)
  r.setProperty('--mine2', s.b)
  r.setProperty('--mineText', s.t)
  localStorage.setItem(SKIN_KEY, k)
  document.querySelectorAll('.skin').forEach(el => el.classList.toggle('on', el.dataset.k === k))
}
function applyBg(src){
  $bg.style.backgroundImage = src ? `url("${src}")` : 'none'
  if (src) localStorage.setItem(BG_KEY, src)
  else localStorage.removeItem(BG_KEY)
  document.querySelectorAll('.bgitem').forEach(el => el.classList.toggle('on', (el.dataset.src || '') === (src || '')))
}

/* ==================== 消息渲染 ==================== */
function scrollDown(smooth = true){
  $stream.scrollTo({ top: $stream.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}
function addTime(d){
  const k = dayKey(d)
  if (k === lastDay) return
  lastDay = k
  const el = document.createElement('div')
  el.className = 'time'
  el.textContent = timeText(d)
  $stream.appendChild(el)
}
function herAvatarSrc(){
  return localStorage.getItem(AVATAR_KEY) || ''
}

function addRow(role, text, at){
  const t = new Date(at || Date.now())
  addTime(t)
  const row = document.createElement('div')
  row.className = 'row ' + (role === 'user' ? 'mine' : 'theirs')

  const av = document.createElement('div')
  av.className = 'av'
  const src = role === 'user' ? '' : herAvatarSrc()
  if (src){
    const im = document.createElement('img')
    im.src = src
    av.appendChild(im)
  } else {
    av.textContent = role === 'user' ? '🧑' : '🐋'
  }

  const b = document.createElement('div')
  b.className = 'bubble'

  // 图片消息：![alt](url) 或 <img>
  const imgMatch = /^!\[[^\]]*\]\(([^)]+)\)$/.exec(text.trim())
  if (imgMatch){
    const im = document.createElement('img')
    im.src = imgMatch[1]
    im.style.cssText = 'max-width:100%;border-radius:10px;display:block;cursor:pointer'
    im.onclick = () => window.open(imgMatch[1], '_blank')
    b.appendChild(im)
  } else {
    b.textContent = text
  }

  row.appendChild(av)
  row.appendChild(b)
  $stream.appendChild(row)
  scrollDown()
}

function showTyping(on){
  const old = $('typingRow')
  if (!on){ if (old) old.remove(); return }
  if (old) return
  const row = document.createElement('div')
  row.className = 'row theirs'
  row.id = 'typingRow'

  const av = document.createElement('div')
  av.className = 'av'
  const src = herAvatarSrc()
  if (src){
    const im = document.createElement('img'); im.src = src; av.appendChild(im)
  } else av.textContent = '🐋'

  const b = document.createElement('div')
  b.className = 'bubble typing'
  b.innerHTML = '<i></i><i></i><i></i>'
  row.appendChild(av); row.appendChild(b)
  $stream.appendChild(row)
  scrollDown()
}

function showError(msg){
  const el = document.createElement('div')
  el.className = 'err'
  el.textContent = msg
  $stream.appendChild(el)
  scrollDown()
}

/* ==================== 状态栏 ==================== */
const AXIS_CN = {
  joy: '开心', trust: '信任', fear: '怕', surprise: '意外',
  sadness: '低落', disgust: '腻', anger: '气', anticipation: '期待',
  intimacy: '亲近', missing: '想你', arousal: '心动',
}
function renderStatus(s){
  if (!s || !s.ok) return
  const chips = []
  const she = s.she || {}
  const axes = she.axes || {}

  if (she.mood) chips.push({ k: '心情', v: she.mood, warm: /想|黏|亲|心动|害羞/.test(she.mood) })

  // 挑三个最突出的维度
  const tops = Object.entries(axes)
    .filter(([k, v]) => typeof v === 'number' && v > 0.35)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  for (const [k, v] of tops){
    chips.push({ k: AXIS_CN[k] || k, v: Math.round(v * 100) + '%' })
  }

  const b = s.bridge || {}
  if (b.clients) chips.push({ k: '连着', v: b.clients + ' 台' })
  if (she.memories) chips.push({ k: '记得', v: she.memories + ' 条' })

  $statusbar.innerHTML = ''
  for (const c of chips){
    const el = document.createElement('div')
    el.className = 'chip' + (c.warm ? ' warm' : '')
    el.innerHTML = `<span class="k">${c.k}</span><span class="v">${c.v}</span>`
    $statusbar.appendChild(el)
  }
}

async function pollStatus(){
  try {
    const r = await api('/app/status')
    if (r.status === 401){ setOnline(false); return }
    const j = await r.json()
    setOnline(true)
    renderStatus(j)
  } catch { setOnline(false) }
}

function toggleStatus(){
  statusOpen = !statusOpen
  $statusbar.classList.toggle('hidden', !statusOpen)
  if (statusOpen) pollStatus()
}

/* ==================== 发送 ==================== */
async function send(){
  const text = $input.value.trim()
  if (!text || busy) return
  busy = true
  $send.disabled = true
  $input.value = ''
  $input.style.height = 'auto'

  addRow('user', text)

  const beat = 320 + Math.min(1100, text.length * 38)
  showTyping(true)
  await new Promise(r => setTimeout(r, beat))

  try {
    const res = await apiPost('/app/send', { text })
    showTyping(false)
    if (res.status === 401){ showError('口令不对，点右上角设置'); return }
    const j = await res.json()
    if (!j.ok){ showError('她说不出话：' + (j.error || '未知')); return }

    const parts = String(j.reply).split('\n').map(s => s.trim()).filter(Boolean)
    for (let i = 0; i < parts.length; i++){
      if (i > 0) await new Promise(r => setTimeout(r, 240))
      addRow('assistant', parts[i])
    }
    if (statusOpen) pollStatus()
  } catch (e) {
    showTyping(false)
    showError('连不上：' + e.message)
    setOnline(false)
  } finally {
    busy = false
    $send.disabled = false
    $input.focus()
  }
}

/* ==================== SSE ==================== */
function connectSSE(){
  if (es) { try { es.close() } catch {} }
  const u = new URL('/app/stream', location.origin)
  if (token) u.searchParams.set('token', token)
  try {
    es = new EventSource(u.toString())
    es.addEventListener('hello', () => setOnline(true))
    es.addEventListener('reply', ev => {
      try {
        const d = JSON.parse(ev.data)
        if (d && d.text){
          // 自己刚发的不重复渲染（send 里已经 render 了）
          if (d.from === 'push' || !busy) addRow('assistant', d.text, d.at)
        }
      } catch {}
    })
    es.onerror = () => setOnline(false)
    es.onopen = () => setOnline(true)
  } catch {}
}

/* ==================== 抽屉 ==================== */
function openDrawer(){
  $drawer.classList.add('on')
  $mask.classList.add('on')
}
function closeDrawer(){
  $drawer.classList.remove('on')
  $mask.classList.remove('on')
}

function section(title, items){
  const d = document.createElement('div')
  d.className = 'dsec'
  if (title){
    const h = document.createElement('h4')
    h.textContent = title
    d.appendChild(h)
  }
  return d
}

function item(ico, label, val, onClick, danger){
  const b = document.createElement('button')
  b.className = 'ditem' + (danger ? ' danger' : '')
  b.innerHTML = `<span class="ico">${ico}</span><span class="lbl">${label}</span>` +
    (val ? `<span class="val">${val}</span>` : '')
  b.onclick = onClick
  return b
}

function buildDrawer(){
  $dbody.innerHTML = ''

  /* --- 身份 --- */
  const s1 = section('她是谁')
  s1.appendChild(item('✏️', '改名字', $('name').textContent, () => {
    const n = prompt('她叫什么？', $('name').textContent)
    if (n && n.trim()){ setName(n.trim()); buildDrawer(); toast('改好了') }
  }))
  s1.appendChild(item('🖼️', '换头像', '', () => pickAvatar()))
  $dbody.appendChild(s1)

  /* --- 气泡皮肤 --- */
  const s2 = section('气泡')
  const skins = document.createElement('div')
  skins.className = 'skins'
  const cur = localStorage.getItem(SKIN_KEY) || 'mint'
  for (const [k, v] of Object.entries(SKINS)){
    const b = document.createElement('button')
    b.className = 'skin' + (k === cur ? ' on' : '')
    b.dataset.k = k
    b.innerHTML = `<span class="dot" style="background:linear-gradient(135deg,${v.a},${v.b})"></span>` +
      `<span class="nm">${v.name}</span>`
    b.onclick = () => { applySkin(k); toast('换成' + v.name) }
    skins.appendChild(b)
  }
  s2.appendChild(skins)
  $dbody.appendChild(s2)

  /* --- 背景 --- */
  const s3 = section('背景')
  const bgs = document.createElement('div')
  bgs.className = 'bgs'
  const curBg = localStorage.getItem(BG_KEY) || ''

  const none = document.createElement('div')
  none.className = 'bgitem none' + (curBg ? '' : ' on')
  none.dataset.src = ''
  none.textContent = '无'
  none.onclick = () => { applyBg(''); toast('背景关掉了') }
  bgs.appendChild(none)

  // 从服务器拿背景图
  api('/api/bgs').then(r => r.json()).then(j => {
    if (!j || !j.ok || !j.list) return
    for (const src of j.list.slice(0, 8)){
      const el = document.createElement('div')
      el.className = 'bgitem' + (curBg === src ? ' on' : '')
      el.dataset.src = src
      el.style.backgroundImage = `url("${src}")`
      el.onclick = () => { applyBg(src); toast('背景换好了') }
      bgs.appendChild(el)
    }
  }).catch(() => {})

  s3.appendChild(bgs)
  $dbody.appendChild(s3)

  /* --- 连接 --- */
  const s4 = section('连接')
  s4.appendChild(item('🔑', '口令', token ? token.slice(0, 6) + '…' : '没设', () => {
    const t = prompt('把口令贴进来（32位）', token)
    if (t !== null){
      token = t.trim()
      localStorage.setItem(TOKEN_KEY, token)
      toast('口令存好了')
      connectSSE(); pollStatus()
    }
  }))
  s4.appendChild(item('🔄', '重连一次', '', () => {
    connectSSE(); pollStatus(); toast('正在重连…')
  }))
  $dbody.appendChild(s4)

  /* --- 聊天 --- */
  const s5 = section('聊天')
  s5.appendChild(item('🧹', '清屏（记忆不丢）', '', () => {
    $stream.innerHTML = ''
    lastDay = ''
    loadHistory()
    closeDrawer()
    toast('屏幕清干净了')
  }))
  $dbody.appendChild(s5)
}

/* 选头像 */
function pickAvatar(){
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = 'image/*'
  inp.onchange = () => {
    const f = inp.files && inp.files[0]
    if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      setAvatar(rd.result)
      buildDrawer()
      toast('头像换好了')
    }
    rd.readAsDataURL(f)
  }
  inp.click()
}

/* ==================== 事件 ==================== */
$send.addEventListener('click', send)

$input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 900){
    e.preventDefault()
    send()
  }
})

$input.addEventListener('input', () => {
  $input.style.height = 'auto'
  $input.style.height = Math.min(140, $input.scrollHeight) + 'px'
})

$('btnMenu').addEventListener('click', () => { buildDrawer(); openDrawer() })
$('btnClose').addEventListener('click', closeDrawer)
$mask.addEventListener('click', closeDrawer)
$('btnStatus').addEventListener('click', toggleStatus)

/* ==================== 启动 ==================== */
async function loadHistory(){
  try {
    const r = await api('/app/history?limit=120')
    if (r.status === 401){ setOnline(false); return }
    const j = await r.json()
    if (!j.ok) return
    $stream.innerHTML = ''
    lastDay = ''
    for (const m of j.messages){
      if (m.role === 'user' || m.role === 'assistant') addRow(m.role, m.content, m.at)
    }
    scrollDown(false)
  } catch {}
}

function boot(){
  // 恢复个性化
  const nm = localStorage.getItem(NAME_KEY)
  if (nm) applyName(nm)
  const av = localStorage.getItem(AVATAR_KEY)
  if (av) applyAvatar(av)
  applySkin(localStorage.getItem(SKIN_KEY) || 'mint')
  const bg = localStorage.getItem(BG_KEY)
  if (bg) applyBg(bg)

  loadHistory()
  connectSSE()
  pollStatus()
  setInterval(pollStatus, 30000)
  $input.focus()
}

boot()
