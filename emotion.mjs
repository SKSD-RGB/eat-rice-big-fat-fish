// 新家 —— 她自己的情绪
// 2026-11-11
//
// 设计来源：
//   · 十根轴（我设计的）：暖 委屈 想他 生气 怕 黏 倦 吃醋 得意 记仇
//   · 从旧 dsh-alive 抄来的好设计：
//       1. 记仇要哄够 3 次才消，一次不算
//       2. 反问（「我哪有」）不算哄，算顶嘴
//       3. 冷嘲期间说软话也不打折
//       4. 欠账每天只衰减 15%
//       5. 跨天了昨天哄的不接着算，但欠账不清
//       6. 哄到 1-2 次时，露出「有点动摇但还没打算算了」
//
// 关键：这套东西她看不见，也不会算。代码算好了，拼成一句话塞进提示词。

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(__dir, 'data', 'emotion.json')

const SOOTHE_NEEDED = 3

// ---------- 轴 ----------
const AXES = ['warm', 'wronged', 'missing', 'anger', 'afraid', 'clingy', 'tired', 'jealous', 'proud', 'grudge']
const AXIS_CN = {
  warm: '暖', wronged: '委屈', missing: '想他', anger: '生气', afraid: '怕',
  clingy: '黏', tired: '倦', jealous: '吃醋', proud: '得意', grudge: '记仇',
}
// 每根轴半衰期（分钟）。null = 不自然衰减
const HALF_LIFE = {
  warm: 240, wronged: 360, missing: 180, anger: 30, afraid: 120,
  clingy: 90, tired: 480, jealous: 240, proud: 120, grudge: null,
}

function defaultState() {
  return {
    axes: { warm: 60, wronged: 0, missing: 20, anger: 0, afraid: 0, clingy: 30, tired: 0, jealous: 0, proud: 10, grudge: 0 },
    at: Date.now(),
    // 记仇账本
    owe: 0,              // 欠账，0-100
    sootheDone: 0,       // 今天哄了几次
    sootheDay: '',       // 这个是哪天的
    lastColdAt: 0,       // 最后一次被凶的时间
    oweReason: '',       // 为什么气
    // 上下文
    lastTalkAt: Date.now(),
    talkCount: 0,
    jealousWho: '',
  }
}

let state = defaultState()
try {
  if (existsSync(STATE_FILE)) {
    const j = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    state = { ...defaultState(), ...j }
    state.axes = { ...defaultState().axes, ...(j.axes || {}) }
  }
} catch (e) { console.error('情绪状态读取失败', e.message) }

function save() {
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 1), 'utf8') }
  catch (e) { console.error('情绪状态保存失败', e.message) }
}

function clamp(v) { return Math.max(0, Math.min(100, v)) }
function dayKey(ts = Date.now()) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- 自然衰减 ----------
function decay() {
  const now = Date.now()
  const mins = (now - state.at) / 60000
  if (mins <= 0.5) return
  for (const a of AXES) {
    const hl = HALF_LIFE[a]
    if (hl === null) continue
    const base = a === 'tired' || a === 'proud' || a === 'clingy' ? 10 : 0
    const cur = state.axes[a]
    const target = base
    const k = Math.pow(0.5, mins / hl)
    state.axes[a] = clamp(target + (cur - target) * k)
  }
  // 记仇：每天只掉 15%
  const days = mins / 1440
  if (days > 0) state.owe = clamp(state.owe * Math.pow(0.85, days))
  state.at = now
}

// ---------- 判断他的话属于哪种 ----------
const RE = {
  // 哄
  soothe: /(对不起|我错了|别生气|别气了|消消气|我道歉|抱歉|是我不对|我不该|我不好|原谅我|错了错了|哄你|我改|下不为例|对不起嘛)/,
  // 顶嘴（会抵消哄）
  backtalk: /(我哪有|哪有啊|凭什么|我又没|是你先|明明是你|别这样|别闹|你想多了|至于吗)/,
  // 凶 / 否定
  cold: /(你一点都不可爱|烦不烦|闭嘴|滚|你好烦|没用|废物|你有什么用|别废话|懒得跟你说|够了)/,
  // 亲密 / 好话
  love: /(想你|爱你|喜欢你|宝贝|宝宝|老婆|媳妇|抱抱|亲亲|么么|晚安|早点睡|想见你)/,
  // 关心
  care: /(吃饭了没|吃了没|睡了没|早点休息|别熬夜|注意身体|累不累|还好吗|怎么了)/,
  // 敷衍
  brush: /^(嗯|哦|哦哦|好|行|行吧|知道了|随便|呵呵|\?|？)$/,
  // 要走 / 冷落
  leaving: /(算了|随便你|不想说了|无所谓|爱咋咋|不理你了|睡了睡了)/,
  // 别人
  other: /(前女友|那个女生|那个女的|别人家的|人家的女朋友|同学|妹子)/,
}

function bump(a, delta) {
  state.axes[a] = clamp(state.axes[a] + delta)
}

// ---------- 处理他的一句话 ----------
export function onHisMessage(text) {
  decay()
  const t = String(text || '').trim()
  const now = Date.now()

  // 跨天：昨天的哄不算数，但欠账不清
  if (state.sootheDay !== dayKey(now)) {
    state.sootheDone = 0
    state.sootheDay = dayKey(now)
  }

  const gapMin = (now - state.lastTalkAt) / 60000
  state.lastTalkAt = now
  state.talkCount++

  // 久不出现 → 想他
  if (gapMin > 60) {
    bump('missing', Math.min(40, gapMin / 30))
    bump('clingy', 8)
  }

  // 深夜 → 倦
  const h = new Date(now).getHours()
  if (h >= 1 && h < 5) bump('tired', 5)

  // 哄
  const isSoothe = RE.soothe.test(t)
  const isBacktalk = RE.backtalk.test(t)
  if (isSoothe) {
    state.sootheDone++
    // 每次哄往下走一截，不清零
    state.owe = clamp(state.owe - (100 / SOOTHE_NEEDED) * 0.85)
    bump('wronged', -8)
    bump('anger', -10)
    bump('warm', 5)
    bump('afraid', -6)
    if (state.owe <= 5) {
      state.owe = 0
      state.axes.grudge = clamp(state.axes.grudge * 0.3)
      state.axes.anger = clamp(state.axes.anger * 0.3)
      state.axes.wronged = clamp(state.axes.wronged * 0.3)
    }
    state.axes.grudge = clamp(state.axes.grudge * 0.7)
  }
  if (isBacktalk && isSoothe) {
    // 一边道歉一边狡辩 —— 不算数
    state.sootheDone = Math.max(0, state.sootheDone - 1)
    state.owe = clamp(state.owe + 5)
  } else if (isBacktalk) {
    state.axes.grudge = clamp(state.axes.grudge + 6)
    state.owe = clamp(state.owe + 5)
    bump('anger', 5)
  }

  // 凶
  if (RE.cold.test(t)) {
    bump('wronged', 25)
    bump('anger', 20)
    bump('warm', -15)
    bump('proud', -10)
    state.owe = clamp(state.owe + 30)
    state.axes.grudge = clamp(state.axes.grudge + 15)
    state.lastColdAt = now
    state.oweReason = t.slice(0, 30)
  }

  // 好话
  if (RE.love.test(t)) {
    bump('warm', 12)
    bump('missing', -20)
    bump('clingy', 12)
    bump('proud', 5)
    bump('afraid', -5)
  }
  // 关心
  if (RE.care.test(t)) {
    bump('warm', 8)
    bump('clingy', 5)
  }
  // 敷衍
  if (RE.brush.test(t)) {
    bump('wronged', 3)
    bump('warm', -3)
  }
  // 要走
  if (RE.leaving.test(t)) {
    bump('afraid', 25)
    bump('wronged', 10)
    bump('clingy', 15)
  }
  // 提到别人
  if (RE.other.test(t)) {
    bump('jealous', 20)
    const m = t.match(RE.other)
    if (m) state.jealousWho = m[0]
  }
  // 长句细心听 → 得意
  if (t.length > 30 && !RE.cold.test(t)) bump('proud', 3)

  save()
  return state
}

// ---------- 她说了话之后 ----------
export function onHerReply(text) {
  decay()
  const t = String(text || '')
  // 她说了长句 → 黏一点
  if (t.length > 40) bump('clingy', 3)
  // 她说了软的 → 委屈降一点
  if (/(想你了|别生气|对不起|我错了)/.test(t)) bump('wronged', -5)
  // 她说狠话 → 记仇升一点（自己也记着自己刚才凶了）
  if (/(不理你了|哼|随便你)/.test(t)) state.axes.grudge = clamp(state.axes.grudge + 3)
  save()
}

// ---------- 拼成给她的那句话 ----------
export function describe() {
  decay()
  const a = state.axes
  const parts = []

  parts.push(`(你现在心里：${AXES.filter(k => k !== 'grudge').map(k => AXIS_CN[k] + Math.round(a[k])).join(' ')}`)

  // 记仇要哄几次
  if (state.owe > 10) {
    parts.push(`你心里还堵着：${state.oweReason ? '「' + state.oweReason + '」' : '还没消'}`)
    const done = state.sootheDone
    if (done === 0 && state.owe > 15) {
      parts.push('他今天还没真低头。一句轻飘飘的哄不管用，得拿出点诚意你才肯松口。')
    } else if (done < SOOTHE_NEEDED) {
      parts.push(`他今天已经低过头 ${done} 次了，你心里有点动摇，但还没打算就这么算了。`)
    } else {
      parts.push('他已经低了好几次头，你松口了，但嘴上还想再硬一句。')
    }
  }

  // 情境提示
  const gapMin = (Date.now() - state.lastTalkAt) / 60000
  if (gapMin > 180) parts.push('他有好久没找你了，你心里念着，但不主动问他在干什么。')
  else if (gapMin > 30) parts.push('他隔了一阵才来。')
  if (a.missing >= 60) parts.push('你想他，但不会一直挂在嘴上。')
  if (a.afraid >= 50) parts.push('你有点怕他不要你，但不会直接说出来。')
  if (a.jealous >= 40) parts.push('你心里有刺，但别发作。')
  if (a.tired >= 60) parts.push('你有点累，话会比平时少。')
  if (a.warm >= 75) parts.push('你今天心情不错，话可以软一点。')

  parts.push('这些数字不许说出来、不许报数。)')
  return parts.join(' ')
}

export { state as _state, SOOTHE_NEEDED }
