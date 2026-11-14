# 小鲸 · 开放接口文档

让别人的机器人也能接进来。所有接口都是 HTTP，返回 JSON。

---

## 一、先要一把钥匙

找主人要，或者用主钥匙发一把：

```bash
curl -X POST "http://127.0.0.1:8787/app/keys?token=<主钥匙>" \
  -H "content-type: application/json" \
  -d '{"name":"我的机器人","scope":"chat"}'
```

返回：

```json
{"ok":true,"name":"我的机器人","token":"a904b5f0...","scope":"chat"}
```

**这把 token 存好，只显示这一次。**

### 两种权限

| scope | 能干什么 |
|---|---|
| `read` | 只看：历史、状态、Token、表情、人格清单 |
| `chat` | 看 + 收发消息、发图、定时消息、删/重生成 |

**改人格、清空记录、导出、管钥匙 —— 这三样只有主钥匙能做。**

---

## 二、怎么带钥匙

两种都行：

```http
Authorization: Bearer <token>
```

```
?token=<token>
```

---

## 三、接口清单

### 不用钥匙

```http
GET /app/ping      探活     → {"ok":true}
GET /api           接口表
```

### 只读（read / chat 都行）

```http
GET /app/me                    她是谁
GET /app/status                状态：情绪、记忆数、在线数
GET /app/history?limit=100     历史消息
GET /app/usage                 Token 统计
GET /app/stickers              表情清单
GET /app/personas              人格清单
```

### 聊天（要 chat）

```http
POST /app/send        {"text":"在吗"}
                      → {"ok":true,"reply":"在","usage":{...}}

POST /app/image       {"data":"<base64>","mime":"image/jpeg","text":"看看这个"}
                      → {"ok":true,"reply":"...","img":"/uploads/xxx.jpg"}

POST /app/schedule    {"minutes":15,"hint":"想他了"}
                      → 到点她主动发一条

POST /app/delete      {"id":"<消息id>"}
POST /app/regen       {"id":"<消息id>"}     重新生成

POST /push            {"text":"..."}        往她的客户端推一条
```

### SSE 长连接

```http
GET /app/stream?token=<token>
```

事件：

```
event: hello    连接成功
event: reply    {"id":"...","text":"...","at":1234567890}
event: deleted  {"id":"..."}
event: cleared  {}
```

---

## 四、接入示例

### Node.js

```js
const BASE = 'http://127.0.0.1:8787'
const TOKEN = '你的钥匙'

async function talk(text) {
  const r = await fetch(`${BASE}/app/send`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + TOKEN,
    },
    body: JSON.stringify({ text }),
  })
  const j = await r.json()
  return j.reply
}

console.log(await talk('在吗'))
```

### Python

```python
import requests

BASE = "http://127.0.0.1:8787"
TOKEN = "你的钥匙"
H = {"Authorization": "Bearer " + TOKEN}

r = requests.post(f"{BASE}/app/send", headers=H, json={"text": "在吗"}, timeout=60)
print(r.json()["reply"])

r = requests.get(f"{BASE}/app/history", headers=H, params={"limit": 20})
for m in r.json()["messages"]:
    print(m["role"], m["content"])
```

### 收她主动说的话（SSE）

```js
const es = new EventSource(`${BASE}/app/stream?token=${TOKEN}`)
es.addEventListener('reply', e => {
  const d = JSON.parse(e.data)
  console.log('她说：', d.text)
})
```

---

## 五、注意

- **一次请求会等到她说完才返回**，可能要 10-30 秒，超时设长一点（建议 60 秒）
- 她的回复可能有多行（她习惯一句一句发），用 `\n` 分隔
- `/app/send` 会**真的进聊天记录**，也会算进 token
- 表情会被渲染成 `![表情](url)` 形式
- 想只读不打扰，用 `read` 钥匙

---

## 六、地址

```
127.0.0.1:8787     （局域网或 Tailscale 都行，填你自己的）
```

端口 8787，HTTP（不是 HTTPS）。
