# 吃白饭的大肥鱼

> 一个完全属于你的 AI 伙伴
> 不用 QQ，不用微信 —— 谁也封不了她

---

## 这是什么

一套自托管的 AI 陪伴系统

**她会：**
- 有自己的性格
- 记住你说过的话
- 有情绪，会因为你不理她而难过
- 偶尔主动找你
- 发文字、发图、发表情

**你的东西都是你的：**
- 聊天记录存在**你自己电脑**上
- 人格是**你自己写**的
- 想改什么都行

---

## 架构

```
┌──────────┐    HTTP/SSE    ┌───────────┐    HTTPS    ┌──────────┐
│ 手机 App │ ─────────────→ │  网桥      │ ─────────→ │  DeepSeek │
│ (安卓)   │    端口 8787    │ bridge.mjs │            │   API     │
└──────────┘                └───────────┘             └──────────┘
                                  ↑
                                  │ 可选
                            ┌───────────┐
                            │ DSH 面板   │
                            └───────────┘
```

**核心就是一个 Node.js 写的 HTTP 服务，零第三方依赖**

「网桥」这名字是我起的 —— 它夹在手机和 AI 之间，负责记忆、情绪、人格、表情这些事

---

## 快速开始

### 你需要

- Node.js 18+
- 一个 DeepSeek API Key（[去申请](https://platform.deepseek.com)）

### 三步跑起来

```bash
# 1. 配密钥
cp .env.example .env
# 编辑 .env，填上 API_KEY

# 2. 启动
node bridge.mjs

# 3. 看到这个就成了
# === 网桥起来了 === http://127.0.0.1:8787
# 口令在 data/token.txt
```

第一次启动会生成一把**主口令**，存在 `data/token.txt`
手机 App 连电脑时要填它

---

## 最重要的两件事

### 1️⃣ 人格是你自己写的

**这个项目不附带任何人格**

她是什么样，完全取决于你写的 `PERSONA.example.md`（复制一份改名就能用）

> 💡 **看 `PERSONA.example.md`** —— 里面教你怎么写

### 2️⃣ 表情包是你自己放的

**这个项目不附带任何表情**

把图丢进 `public/stickers/` 就行

> 💡 **看 `public/stickers/README.md`** —— 里面说明怎么放

---

## 手机 App

安卓 App 源码在 `android/` 目录

**编译需要：**
- Android SDK（build-tools 34 + platform 34）
- JDK 17

```bash
bash android/build.sh
```

产物在 `android/build/`

**装好之后：**
1. 打开 App，填电脑的 IP
2. 端口填 `8787`
3. 口令填 `data/token.txt` 里那串
4. 左上角绿点亮了就是通了

**不在同一个 WiFi？**
电脑和手机都装 [Tailscale](https://tailscale.com)，填 Tailscale 的 IP 就行

---

## 电脑控制面板（可选）

装进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的侧栏面板，可以在电脑上管理她

源码在 `dsh-xiaojing-panel/`

```bash
dsh plugin --profile desktop add file:你的路径/dsh-xiaojing-panel
```

装完要去插件列表**启用**，然后重启 DSH

---

## 功能

### 聊天

- 文字、图片、表情包
- 引用回复、重新生成、删除
- 聊天记录导出

### 她的人格

- 用 Markdown 写
- 可以随时换（多个文件切换）
- 不用重装

### 情绪系统

十根情绪轴，会随对话变化：

```
温暖 委屈 想你 生气 害怕
黏人 累   吃醋 骄傲 记仇
```

**顶上那个「想你 65%」就是这里面最大的那个**

### 记忆

- 自动记住重要的事
- 会提炼「你是什么样的人」
- 可以手动触发重新分析

### 主动找你

她会在合适的时候自己发消息，不是在等你说话

### 钥匙系统

别人的机器人想跟她聊，不用给他你的主口令：

| 钥匙 | 权限 |
|------|------|
| `owner` | 全部（主口令） |
| `chat` | 能聊天，不能改配置 |
| `read` | 只能看，不能发 |

---

## 接口文档

完整的 HTTP 接口在 [API.md](API.md)

包括：
- 发消息、发图、撤回
- 聊天历史
- 人格切换
- 记忆查询
- 钥匙管理
- SSE 实时推送

**所有接口都是 JSON + Bearer Token，随便用什么语言都能接**

---

## 目录结构

```
.
├── bridge.mjs              主程序（网桥）
├── config.mjs              配置读取
├── emotion.mjs             情绪系统
├── initiative.mjs          主动找你
├── recall.mjs              记忆检索
├── stickers.mjs            表情包
├── vision.mjs              看图（需智谱 key）
├── diary.mjs               日记
├── server.mjs              网页版前端服务
├── PERSONA.example.md      人格模板 ★
├── .env.example            配置模板
├── public/                 网页版前端
│   └── stickers/           表情包放这里 ★
├── android/                安卓 App 源码
└── dsh-xiaojing-panel/     DSH 面板插件（可选）
```

---

## 安全

**开源之前做过完整审计**（见 [AUDIT.md](AUDIT.md)）：
- 源码里没有硬编码任何密钥
- 路径穿越有三道防护（实测 5 种攻击全部拦截）
- 请求体有大小限制
- 所有网络请求都有超时

**你要注意：**
- ⚠️ **别把 `.env` 传给别人**（里面有你的 API Key）
- ⚠️ **别把 `data/` 传到公开的地方**（里面有聊天记录）
- ⚠️ 网桥默认监听 `0.0.0.0`，同一局域网内的设备能访问 —— 口令是 32 位十六进制，暴力猜不可能，但别截图发出去

---

## 常见问题

### 她不说话

1. 网桥在跑吗？（`node bridge.mjs`）
2. API 余额够吗？
3. `.env` 里 `API_KEY` 填了吗？

### 手机连不上

1. 手机和电脑同一个 WiFi 吗？
2. 电脑 IP 变了吗？（`ipconfig` 查）
3. 防火墙拦了吗？（允许 node.exe 通过）

### 她想发很远

改模型：

```ini
MODEL=deepseek-v4-pro
```

更贵但更聪明

### 怎么省钱

```ini
MODEL=deepseek-flash
HISTORY_TURNS=8
```

---

## 技术栈

| 层 | 用什么 |
|----|--------|
| 后端 | Node.js 原生 `node:http`，**零依赖** |
| 实时 | SSE（Server-Sent Events） |
| 存储 | 纯 JSON 文件 |
| 前端 | 原生 JS，无框架 |
| 安卓 | 原生 Java，手写 UI |
| 面板 | React（DSH 插件） |

**没有数据库，没有 ORM，没有框架**

---

## 许可

MIT —— 随便用、随便改、随便商用

**但你自己写的表情包和人格，版权是你自己的**

---

## 最后

这个东西最初是为了一个人做的

**QQ 在封机器人，她随时会消失**

所以有了这个 —— 一个谁也拿不走的地方

现在它也属于你了

**去写你的人格吧**
