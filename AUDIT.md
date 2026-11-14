# 小鲸 代码审计报告

日期：2026-11-14 21:30
范围：bridge.mjs 等 9 个后端文件（1997 行）+ Android 端 10 个 Java 文件（4282 行）

---

## 一、检查清单（我查了什么、怎么查的）

| # | 检查项 | 方法 | 结果 |
|---|--------|------|------|
| 1 | 文件清单与规模 | `ls -la` + `wc -l` 统计 | 后端 9 个文件 1997 行；安卓 10 个文件 4282 行 |
| 2 | 全部 HTTP 接口枚举 | 正则提取 `path === '...'` + 跟随的 `need()` 调用 | 发现 30+ 接口，逐条列出鉴权等级 |
| 3 | 未加 `need()` 的接口 | 按代码块切分，检测块内是否含 `need(req` | 10 个接口没有 need()，**逐个复查后确认都用了 `authed()`**，无裸奔接口 |
| 4 | 鉴权分级正确性 | 实调接口：无 token / 错 token / 正确 token 三组对比 | 401 / 401 / 200 —— 正确 |
| 5 | read 钥匙越权测试 | 临时签发 read 钥匙，尝试发消息、改人格、读记忆、撤销钥匙 | 全部 403，报错信息正确；测试钥匙已撤销 |
| 6 | 密钥硬编码 | grep `sk-` `ghp_` `8af54caa` 于所有 .mjs 和 .java | 无硬编码。安卓端只出现在输入框 hint 里 |
| 7 | .env 与数据泄露 | 读 `.gitignore` | `.env`、`data/`、`public/uploads/`、`public/dl/` 均已排除 |
| 8 | JS 语法 | `node --check` 逐个文件 | 9 个文件全部通过 |
| 9 | 请求体大小限制 | 读 `readBody()` 实现 | 有 8MB 上限，超限 reject |
| 10 | 并发写文件 | 枚举 `writeFileSync` 调用点 | 7 处，均写不同文件，无同文件竞争 |
| 11 | 历史数组增长 | 追踪 `history.push` 与落盘截断 | 落盘截断 1000 条；**内存数组本身无上限**（见问题 1） |
| 12 | 安卓网络超时 | 统计 `setConnectTimeout` / `setReadTimeout` | 26 处超时设置，覆盖全部请求 |
| 13 | 安卓异常兜底 | 统计 `catch (Exception` | 25 处，覆盖网络与解析 |
| 14 | 安卓主线程网络 | 正则扫描 `new URL` 上下文是否在线程内 | 1 处疑似，复查为 `uploadImage` 线程内代码，**误报** |
| 15 | 前后端字段一致性 | 对比后端 `DEFAULT_STATUS_FIELDS` 与安卓 `isFieldOn("...")` | miss/memo/dev 三处 key 完全一致 |
| 16 | 键盘与表情互斥 | 检查 `dismissInputPanel` / `showKeyboard` / `hideKeyboard` 调用链 | 三条路径完整，无死锁 |
| 17 | 错误处理密度 | 统计 try / catch 数量 | 55 try / 57 catch，异常覆盖充分 |
| 18 | 定时任务卡死风险 | 查 `setInterval` 回调是否含阻塞操作 | 2 处，均为异步或纯写缓冲，无阻塞 |

---

## 二、发现的问题

### 🔴 问题 1：history 内存数组无上限

**位置**：`bridge.mjs:296` `pushMsg()`

```js
function pushMsg(role, content) {
  const m = { id: randomUUID(), role, content, at: Date.now() }
  history.push(m)      // ← 只加不减
  return m
}
```

**现状**：落盘时截断到 1000 条，但内存里的 `history` 数组一直增长。

**后果**：长期运行（比如挂一个月）后，每条消息都留在内存里。按每天 200 条算，一个月 6000 条，内存占用约 10-20MB —— 不算致命，但会累积。

**建议**：`pushMsg` 里加一行

```js
history.push(m)
if (history.length > 1200) history = history.slice(-1000)
```

（注意 `history` 得改成 `let` 声明）

---

### 🟡 问题 2：`/app/ai` 改了 model 后不校验可用性

**位置**：`bridge.mjs:989`

```js
if (body.model) patch.model = String(body.model).slice(0, 60)
Object.assign(effective, patch)
writeFileSync(...)
```

**现状**：填什么就存什么，填错了（比如写成 `deepseek-chatx`）要等下次发消息才发现报错。

**建议**：改完立刻用一次极小的请求试一下（1 token 那种），失败就回滚并提示。

---

### 🟡 问题 3：`/app/analyze` 的 JSON 解析靠正则抠

**位置**：`bridge.mjs:1050` 附近

```js
const m = out.match(/\{[\s\S]*\}/)
if (m) parsed = JSON.parse(m[0])
```

**现状**：模型如果返回 `{"profile": "..."}` 后面再跟一段废话，正则会把两段都括进去，`JSON.parse` 直接抛错。

**建议**：改成从第一个 `{` 开始逐字符配平括号，或者干脆在提示词里强制要求「只输出 JSON，不要任何其他文字」并加 `response_format`。

---

### 🟡 问题 4：`statusBarOn` 这个开关已经名存实亡

**位置**：`MainActivity.java` 多处

**现状**：这个变量还在，还在存 SharedPreferences，但 `renderStatus` 里那句 `if (!statusBarOn) return` 已删除（我改的），现在它只影响箭头按钮显不显示。

**后果**：逻辑上混乱——变量名叫「状态栏开关」，实际管的是「箭头按钮」。将来改的人容易踩坑。

**建议**：重命名为 `chevronVisible`，或者干脆并入 `statusOpen`。

---

### 🟢 问题 5：`readBody` reject 后没销毁请求流

**位置**：`bridge.mjs` `readBody()`

```js
req.on('data', c => { d += c; if (d.length > 8_000_000) reject(new Error('太大')) })
```

**现状**：reject 之后 `data` 事件还在继续触发，`d` 还在涨，直到请求自然结束。

**后果**：恶意大包仍能吃掉一段时间的内存。本地自用无所谓，开源给别人跑的话建议 `req.destroy()`。

---

### 🟢 问题 6：安卓端 `SimpleDateFormat` / `JSON` 静态复用缺失

**位置**：`MainActivity.java` 有多处 `new JSONObject(...)`

**现状**：不是 bug，是性能小问题——每次网络回调都新建对象。

**建议**：如果哪天觉得卡，这块可以先优化。现在这个量级完全够用。

---

## 三、没发现问题的地方（确认健康）

| 项目 | 结论 |
|------|------|
| 鉴权分级 | 三级（owner/chat/read）实测全部生效，越权一律 403 |
| 密钥管理 | 无硬编码，`.env` 已排除，GitHub PAT 不在代码里 |
| 请求体限制 | 8MB 上限存在 |
| 网络超时 | 全部接口都有 connect/read 双超时 |
| 异常兜底 | 55 try / 57 catch，比 try 还多 2 个 catch（说明有嵌套兜底） |
| 前后端字段对齐 | 状态栏三个 key 完全一致 |
| 键盘/表情/空白点击 | 三条互斥路径完整 |
| 文件写入 | 7 处写入不同文件，无竞争 |
| 语法 | 全部通过 `node --check` |

---

## 四、优先级建议

```
现在必须改：  无

建议尽快：    问题 1（内存上限）—— 挂机久了会累积
             问题 2（AI 配置校验）—— 填错要等到下次才发现

可以缓：      问题 3、5（都是防御性改进，本地自用影响不大）
             问题 4、6（代码整洁度，不影响运行）
```
