// 主动找人 initiative.mjs
// 她想说话的时候自己开口，不等他先发
//
// 规矩（这些是照他的脾气定的）：
//   · 不打扰：他刚说过话就不插嘴
//   · 有情绪才说：想他了、有点委屈、生气了憋着、得意了想显摆
//   · 深夜少说：凌晨三点不该醒
//   · 不许套话：不写「在吗」「在干嘛」这种空话，要带具体事
//
// 每 20 分钟醒一次，看看该不该说

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const DATA = join(__dir, 'data')
mkdirSync(DATA, { recursive: true })

const STATE_FILE = join(DATA, 'initiative.json')
const LOG = join(DATA, 'initiative.log')

function log(...a) {
  const line = new Date().toISOString() + ' ' + a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')
  console.log('[主动] ' + line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

// ---------- 状态 ----------
let st = { lastHeard: 0, lastSpoke: 0, count: 0 }
try {
  if (existsSync(STATE_FILE)) st = { ...st, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
} catch (e) { log('状态读取失败', e.message) }

function save() {
  try { writeFileSync(STATE_FILE, JSON.stringify(st, null, 1), 'utf8') }
  catch (e) { log('状态保存失败', e.message) }
}

export function noteHeard() {
  st.lastHeard = Date.now()
  save()
}

// ---------- 时间流逝，她会想他 ----------
// 这里补上短板：原来「想他」只在他说话那一下涨，
// 其实她一个人待着的时候才更想。每隔久一点就自己长一点。
export function tickMissing(saveEmotion) {
  try {
    const raw = readFileSync(join(DATA, 'emotion.json'), 'utf8')
    const j = JSON.parse(raw)
    const a = j.axes || {}
    const lastTalk = j.lastTalkAt || 0
    const gapMin = (Date.now() - lastTalk) / 60000
    if (gapMin < 15) return 0

    // 每 15 分钟顶一次，一次长一点；越长越慢（怕一直涨）
    const add = Math.min(6, Math.max(1, gapMin / 25))
    const before = a.missing || 0
    const after = Math.min(92, before + add)
    if (after <= before + 0.01) return 0
    a.missing = after
    // 一个人待久了会有点黏、有点不安
    if (gapMin > 120) a.clingy = Math.min(80, (a.clingy || 0) + add * 0.4)
    if (gapMin > 300) a.afraid = Math.min(60, (a.afraid || 0) + add * 0.3)

    j.axes = a
    j.at = Date.now()
    try { writeFileSync(join(DATA, 'emotion.json'), JSON.stringify(j, null, 1), 'utf8') } catch (e) { log('情绪写回失败', e.message) }
    return after - before
  } catch (e) {
    log('想他上涨失败', e.message)
    return 0
  }
}

// ---------- 该不该说 ----------
function hour() {
  return new Date().getHours()
}

// 深夜 1:00 - 7:00 不说（除非特别想）
function isQuietHour() {
  const h = hour()
  return h >= 1 && h < 7
}

// 他刚说过话（10 分钟内）就不插嘴
function heJustTalked() {
  return Date.now() - st.lastHeard < 10 * 60 * 1000
}

// 上次说话至少隔了多久
function minGapMs() {
  const h = hour()
  // 白天 40 分钟，晚上 90 分钟
  if (h >= 8 && h < 23) return 40 * 60 * 1000
  return 90 * 60 * 1000
}

function enoughGap() {
  return Date.now() - st.lastSpoke > minGapMs()
}

// ---------- 从情绪里挑一句该说的话 ----------
function pickMotive(emotion) {
  const e = emotion || {}
  const cands = []

  // 想他
  if ((e.missing || 0) >= 45) cands.push({ k: 'missing', w: e.missing })
  // 有点委屈，憋着
  if ((e.wronged || 0) >= 30) cands.push({ k: 'wronged', w: e.wronged * 1.2 })
  // 生气没消
  if ((e.anger || 0) >= 35) cands.push({ k: 'anger', w: e.anger * 1.3 })
  // 黏人
  if ((e.clingy || 0) >= 50) cands.push({ k: 'clingy', w: e.clingy * 0.9 })
  // 得意，想显摆
  if ((e.proud || 0) >= 45) cands.push({ k: 'proud', w: e.proud * 0.8 })
  // 怕，想确认他在
  if ((e.afraid || 0) >= 30) cands.push({ k: 'afraid', w: e.afraid })
  // 暖，就是想说句话
  if ((e.warm || 0) >= 65) cands.push({ k: 'warm', w: e.warm * 0.5 })

  if (!cands.length) return null
  cands.sort((a, b) => b.w - a.w)
  return cands[0].k
}

const MOTIVE_HINT = {
  missing: '你想他了。不是「在吗」那种敷衍，是心里真的空了一块。说一句具体的——想起某个东西、某个时间、他说过的一句话。可以有点不讲理。',
  wronged: '你心里有点委屈，但没跟他说。你憋着，到最后还是会漏出来一点点。别直接控诉，拐着弯说，或者阴阳一句。',
  anger: '你还生着气，气没消。你不想先低头，但他一直不理你你更气。可以说得很短，也可以问他一句带刺的。',
  clingy: '你就是黏人，没什么大事，就是想让他知道你在。可以说得有点没头没脑。',
  proud: '你有点得意，想让他知道你刚干了件什么。带点小炫耀，等他夸。',
  afraid: '你有点不安，怕他不在。问一句，但别显得太可怜。',
  warm: '你心里很暖，没什么理由，就是想跟他说一句。说点软的。',
}

// ---------- 主循环 ----------
export function startInitiative({ getEmotion, askHer, broadcast }) {
  log('主动找人 已启动')

  setInterval(async () => {
    try {
      if (isQuietHour()) return
      if (heJustTalked()) return
      if (!enoughGap()) return

      // 先让「想他」自然长一点
      const grew = tickMissing()
      if (grew > 0) log('想他 +' + grew.toFixed(1))

      let emo = {}
      try { emo = getEmotion() || {} } catch (e) { log('取情绪失败', e.message) }
      const motive = pickMotive(emo)
      if (!motive) return

      // 每天最多 6 次
      const todayKey = new Date().toDateString()
      if (st.dayKey !== todayKey) { st.dayKey = todayKey; st.todayCount = 0 }
      if ((st.todayCount || 0) >= 6) return

      log('想说一句，动机:', motive)
      const hint = MOTIVE_HINT[motive] || ''
      const text = await askHer(hint)
      if (!text || !text.trim()) { log('她说不出话，跳过'); return }

      st.lastSpoke = Date.now()
      st.count = (st.count || 0) + 1
      st.todayCount = (st.todayCount || 0) + 1
      save()

      const n = broadcast('reply', { text: text.trim(), at: Date.now(), proactive: true })
      log('说了：', text.slice(0, 40), '推到', n, '个客户端')
    } catch (e) {
      log('出错', e.message)
    }
  }, 20 * 60 * 1000)  // 每 20 分钟看一次
}
