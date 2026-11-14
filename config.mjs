// 新家 —— 配置
// 密钥都放在 .env 里（不入仓库）

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))

// 读 .env（不依赖 dotenv）
const env = {}
const envFile = join(__dir, '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i < 0) continue
    env[s.slice(0, i).trim()] = s.slice(i + 1).trim()
  }
}
const pick = (k, d) => (process.env[k] || env[k] || d)

export const CONFIG = {
  port: Number(pick('PORT', 8787)),

  // DeepSeek
  apiKey: pick('API_KEY', ''),
  apiBase: pick('API_BASE', 'https://api.deepseek.com'),
  model: pick('MODEL', 'deepseek-chat'),

  // 她 —— 完整人格
  personaFile: join(__dir, pick('PERSONA', 'xiaoman_full.md')),

  // 她的记忆
  memoryFile: join(__dir, 'data', 'memories.json'),

  // 带多少条近期对话给她
  historyTurns: Number(pick('HISTORY_TURNS', 16)),

  // 看图用的（智谱，可选）
  zhipuKey: pick('ZHIPU_KEY', ''),
}
