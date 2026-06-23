# 微信公众号 + Vercel 部署指南

将高考志愿数据查询部署为微信公众号后台，用户在微信聊天框输入「广东物理600分」即可查询位次、排名信息和冲稳保建议。

## 架构概览

```
用户微信 → 公众号消息 → 微信服务器 → Vercel (api/wechat) → 查询本地SQLite/PostgreSQL → 回复文本 → 用户微信
```

- **接收消息**：微信将用户消息通过 POST XML 转发到 Vercel
- **查询分析**：NLP 解析省份/分数/选科 → 查询一分一段数据库
- **回复结果**：5 秒内返回格式化文本（位次、趋势、批次对比、冲稳保）

## 前置条件

1. [微信公众号](https://mp.weixin.qq.com/)（需已认证或未认证个人订阅号均可）
2. [Vercel 账号](https://vercel.com)（免费版即可）
3. [GitHub 账号](https://github.com)
4. [Vercel PostgreSQL](https://vercel.com/docs/storage/vercel-postgres)（可选，推荐生产用）

## 第一步：部署到 Vercel

### 方式 A：一键部署（推荐）

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/gaokao-helper&env=DEEPSEEK_API_KEY,DEEPSEEK_MODEL,WECHAT_TOKEN,WECHAT_APP_ID,WECHAT_APP_SECRET&envDescription=必填环境变量)

### 方式 B：手动部署

```bash
# 1. 推送到 GitHub
cd /d/CC/高考志愿SKills/next-app
git init
git add .
git commit -m "init: gaokao helper with wechat support"
git remote add origin https://github.com/YOUR_USERNAME/gaokao-helper.git
git push -u origin main

# 2. 在 Vercel 导入该仓库
#    https://vercel.com/new
```

### 环境变量配置

在 Vercel 项目 **Settings → Environment Variables** 中添加：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `WECHAT_TOKEN` | ✅ | 微信公众号后台自定义的 Token |
| `WECHAT_APP_ID` | ✅ | 公众号 AppID |
| `WECHAT_APP_SECRET` | ✅ | 公众号 AppSecret |
| `WECHAT_ENCODING_AES_KEY` | ❌ | 43 位密钥（安全模式必填） |
| `DEEPSEEK_API_KEY` | ❌ | DeepSeek API Key（AI 分析用） |
| `DEEPSEEK_MODEL` | ❌ | 模型名，默认 deepseek-chat |
| `POSTGRES_URL` | ❌ | Vercel PostgreSQL 连接串（推荐生产用） |

> **注意**：不设置 `POSTGRES_URL` 也没关系，系统会自动使用本地 JSON 数据文件。
> 但数据文件较大（~500MB），建议生产环境使用 PostgreSQL。

### 设置 Vercel PostgreSQL（推荐）

```bash
# 1. 在 Vercel 项目 Storage 中创建 Postgres 数据库
# 2. 复制 POSTGRES_URL 到环境变量
# 3. 运行数据迁移：
cd /d/CC/高考志愿SKills/next-app
npx vercel env pull .env.vercel  # 拉取 Vercel 环境变量
node scripts/migrate_to_postgres.mjs
```

## 第二步：微信公众号后台配置

### 获取配置信息

1. 登录 [微信公众号后台](https://mp.weixin.qq.com)
2. 进入 **设置与开发 → 基本配置**
3. 获取 **AppID** 和 **AppSecret**
4. 在 **服务器配置** 中点击「修改配置」

### 填写服务器配置

| 配置项 | 值 |
|--------|-----|
| URL | `https://your-project.vercel.app/api/wechat` |
| Token | 自定义字符串（与 `WECHAT_TOKEN` 保持一致） |
| EncodingAESKey | 随机生成或留空（推荐「安全模式」） |
| 消息加解密方式 | 明文模式 或 安全模式 |

### 服务器验证

点击「提交」后，微信会发送 GET 请求验证服务器。如果配置正确，会出现「配置成功」提示。

> **验证失败？**
> - 确保你已在 Vercel 设置了 `WECHAT_TOKEN`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`
> - 如果使用安全模式，`WECHAT_ENCODING_AES_KEY` 也必须设置
> - 检查 Vercel 部署日志：`https://vercel.com/.../deployments`

### 配置服务器后

配置成功后，在 **设置与开发 → 基本配置** 中点击「启用」，服务器配置即生效。

## 第三步：验证配置

访问以下地址检查配置状态：

```
https://your-project.vercel.app/api/wechat/status
```

返回 JSON：
```json
{
  "ok": true,
  "checks": [
    { "name": "WECHAT_TOKEN", "ok": true },
    { "name": "WECHAT_APP_ID", "ok": true },
    { "name": "WECHAT_APP_SECRET", "ok": true }
  ],
  "tokenTest": { "ok": true, "note": "获取成功（xxx...）" }
}
```

## 第四步：本地开发调试

### 安装依赖

```bash
cd /d/CC/高考志愿SKills/next-app
npm install
```

### 配置本地环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local`，填入微信公众号配置。

### 启动开发服务器

```bash
npm run dev
```

### 使用 ngrok 暴露本地服务

微信服务器必须访问 HTTPS 地址，使用 ngrok 将本地服务暴露到公网：

```bash
npx ngrok http 3000
```

将 ngrok 生成的 URL + `/api/wechat` 填写到微信公众号后台的服务器 URL 中。

## 功能说明

### 支持的消息类型

| 消息类型 | 支持情况 |
|----------|----------|
| 文本消息 | ✅ 核心功能 |
| 语音消息 | ✅ 自动识别并查询 |
| 图片消息 | ❌ 提示用户发送文字 |
| 事件（关注） | ✅ 发送欢迎语 |
| 事件（菜单） | ✅ 可扩展 |

### 查询示例

用户发送 → 系统回复：

| 输入 | 回复内容 |
|------|----------|
| 「广东物理600分」 | 位次、同分人数、近年趋势、批次对比、冲稳保 |
| 「四川理科550分」 | 同上 |
| 「北京620分想学计算机」 | 位次 + 该专业录取数据（如有） |
| 「查中大 广东物理600分」 | 位次 + 中山大学录取概率 |
| 「帮助」 | 使用说明 |
| 「详细」 | 如何获取更详细分析 |

### 数据来源

- **一分一段表**：各省教育考试院官方发布的历史数据（2023-2025年）
- **录取数据**：各高校在各省的录取最低分/位次
- **批次线**：各省本科/专科批次线

## 限制说明

### 微信限制

1. **5 秒超时**：被动回复必须在 5 秒内返回。本系统在该限制内返回核心数据。
2. **回复长度**：文本回复上限约 2048 字符。超长内容会被截断。
3. **每日额度**：未认证订阅号有发消息限制，但用户主动发消息触发的回复不占用额度。

### 数据限制

1. **数据年份**：最新数据到 2025 年（实际最新年份视数据采集情况）
2. **覆盖面**：约 15 个主要省份有完整数据（广东、四川、河南、山东、江苏、浙江等）
3. **录取数据**：院校级录取数据较全，专业级数据有限

## 扩展建议

### 1. 使用 Vercel KV 缓存 access_token

避免每次冷启动重新获取 access_token：

```bash
vercel kv create
```

然后在 `lib/wechat/access-token.js` 中使用 KV 存储。

### 2. 使用 PostgreSQL 替代 JSON 文件

JSON 文件 ~500MB，Vercel 无法直接部署。建议：
1. 创建 Vercel Postgres 数据库
2. 运行 `node scripts/migrate_to_postgres.mjs` 迁移数据
3. 设置 `POSTGRES_URL` 环境变量

### 3. 对接 DeepSeek AI 分析

设置 `DEEPSEEK_API_KEY` 后，Web 版 (`/api/chat`) 会使用 AI 生成更详细的分析报告。微信版暂未集成 AI（受 5 秒超时限制），如需 AI 分析：
- 先用被动回复返回「正在分析...」
- 通过客服消息 API 异步推送 AI 分析结果

## 项目结构（新增文件）

```
next-app/
├── lib/
│   ├── gaokao-query.js          ← 新增：共享查询逻辑
│   └── wechat/
│       ├── config.js            ← 新增：微信配置
│       ├── crypto.js            ← 新增：签名/加解密
│       ├── xml.js               ← 新增：XML 解析/构建
│       ├── handler.js           ← 新增：消息处理 + 高考查询
│       └── access-token.js      ← 新增：Token 管理
├── app/api/
│   ├── chat/route.js            ← 已修改：使用共享模块
│   └── wechat/
│       ├── route.js             ← 新增：微信入口
│       └── status/route.js      ← 新增：状态检查
├── WECHAT_DEPLOY.md             ← 本文
└── .env.example                 ← 已更新
```

## 故障排除

### 配置成功但收不到回复

1. 检查 Vercel 函数日志
2. 测试 `/api/wechat/status` 是否正常
3. 确认已在公众号后台「启用」服务器配置
4. 检查 `WECHAT_TOKEN` 是否与后台配置完全一致

### 数据查询无结果

1. 本地开发时确认 `data/` 目录下有 JSON 数据文件
2. 生产环境确认已配置 `POSTGRES_URL` 且有数据
3. 通过 `/api/provinces` 检查可用省份
4. 通过 `/api/score-rank?province=广东&year=2025&classify=物理&score=600` 测试

### Vercel 部署失败

1. 检查环境变量是否已在 Vercel 配置
2. 确认 `next.config.mjs` 中的 `output: 'standalone'` 不影响 WeChat 路由
3. 查看 Vercel 构建日志
