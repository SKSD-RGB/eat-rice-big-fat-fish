// 识图 vision.mjs
// 他发图过来，她得真的看懂，不是瞎夸
//
// 用智谱 glm-4v-flash（免费）
// 规矩（照 10-26 他说的）：识图/表情要直接回应，不要垫话
//   ✗「我看到图片了，这是一只猫」
//   ✓「这猫怎么看着这么欠揍」

import { appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const LOG = join(__dir, 'data', 'vision.log')

const ZHIPU_API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const MODEL = 'glm-4v-flash'

function log(...a) {
  const line = new Date().toISOString() + ' [识图] ' +
    a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')
  console.log(line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

// 图片 → 一句话描述（给她看的「眼睛」）
export async function lookAtImage(base64, mimeType, apiKey, { herMood = '', recent = '' } = {}) {
  if (!apiKey) {
    log('没有 ZHIPU_API_KEY，看不见')
    return null
  }
  const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`

  const prompt = [
    '你在帮我描述一张图片，等下要交给一个女孩子看。',
    '她的性格：说话短、不太客气、会损人、也有软的时候。',
    herMood ? `她现在心情：${herMood}` : '',
    recent ? `刚才他们在聊：${recent}` : '',
    '',
    '请用 2-3 句话，说清楚这张图里有什么。要具体，',
    '包括：画面里最显眼的东西、气氛、有没有文字、',
    '有没有让人觉得好笑/奇怪/可爱的细节。',
    '不要写「这张图片中」「可以看到」这种，直接说东西本身。',
  ].filter(Boolean).join('\n')

  try {
    const res = await fetch(ZHIPU_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: prompt },
          ],
        }],
        temperature: 0.6,
      }),
    })
    const text = await res.text()
    if (!res.ok) {
      log('接口失败', res.status, text.slice(0, 200))
      return null
    }
    const j = JSON.parse(text)
    const c = j?.choices?.[0]?.message?.content
    if (typeof c !== 'string') {
      log('没拿到内容')
      return null
    }
    log('看见了：', c.slice(0, 60))
    return c.trim()
  } catch (e) {
    log('出错', e.message)
    return null
  }
}
