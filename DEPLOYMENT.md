# 播客智能阅读助手上线手册

本文档对应当前代码版本 `0.23.3`。目标是把 AI 代理部署到 Vercel，再以 Hidden 方式发布到 Microsoft Edge Add-ons，先验证真实用户体验与 AI 成本。

## 1. 发布结构

```text
Bilibili 页面
  └─ Edge/Chrome 扩展（不包含模型密钥）
       └─ Vercel HTTPS Functions
            ├─ 匿名安装会话
            ├─ CORS 来源限制
            ├─ 请求频率与用量保护
            └─ 智谱 GLM API
```

模型、备用模型、限额和密钥都通过服务端环境变量配置。代理支持智谱和 DeepSeek；切换模型时无需重新发布扩展。

## 2. Vercel Functions

根目录的 `vercel.json` 将公开接口重写到 `api/` 下的函数：

- `GET /health`
- `POST /v1/register`
- `POST /v1/chat/completions`
- `POST /v1/web-search`

`proxy/server.mjs` 同时作为函数的共享处理器和本地开发服务器，扩展端接口契约不变。

### 2.1 首次部署

1. 登录 Vercel，选择 **Add New → Project**。
2. 导入 GitHub 仓库 `zhoujie97/broadcast-agent-extension`。
3. Framework Preset 选择 **Other**，Root Directory 保持仓库根目录。
4. 在 Environment Variables 中录入：
   - `DEEPSEEK_API_KEY`：DeepSeek 正式密钥（使用 DeepSeek 对话模型时必填）。
   - `ZHIPU_API_KEY`：智谱正式密钥（使用智谱对话模型或保留智谱联网搜索时必填）。
   - `SESSION_SIGNING_SECRET`：至少 24 字符的随机字符串。
   - `ALLOWED_EXTENSION_ORIGINS`：例如 `chrome-extension://babomghgdgifmepkmndbepfidadbhffo`。多个 Origin 用英文逗号分隔。
   - `AI_PROVIDER`：推荐 `deepseek`
   - `AI_MODEL`：推荐 `deepseek-v4-flash`
   - `AI_FALLBACK_MODEL`：可留空。
   - `WEB_SEARCH_PROVIDER`：当前填写 `zhipu`；DeepSeek 官方对话 API 不提供本项目所需的独立网页搜索接口。
5. 点击 Deploy。部署成功后访问 `https://你的项目.vercel.app/health`，应返回 `{"ok":true,...}`。

不要把任何 API Key 提交到 Git、扩展代码、聊天、截图或日志中。

### 2.2 建议环境变量

```text
REQUEST_TIMEOUT_MS=105000
SESSION_TTL_SECONDS=604800
RATE_LIMIT_PER_MINUTE=8
DAILY_INSTALLATION_UNITS=80
GLOBAL_DAILY_UNITS=5000
MAX_BODY_BYTES=1048576
```

Vercel Functions 可能横向扩容或重启，当前进程内限流只作为第一层保护，不能视为跨实例的严格全局额度。正式公开发布前，务必同时在智谱控制台配置预算或消费上限；用户量增长后再接入持久化限流存储。

### 2.3 环境变量更新

在 Vercel 项目的 **Settings → Environment Variables** 修改变量后，需要重新部署才能让新部署读取新值。只修改 `AI_MODEL` 或 `AI_FALLBACK_MODEL` 不需要更新扩展。

## 3. 隐私与支持页面

- 隐私政策：`https://podcast-field-notes-cn.bright-frog-5143.chatgpt.site/privacy`
- 支持页面：`https://podcast-field-notes-cn.bright-frog-5143.chatgpt.site/support`

提交商店前，把支持页里的临时说明替换为真实支持邮箱或公开 Issue 地址。

## 4. 生成生产 ZIP

```bash
API_BASE_URL=https://你的项目.vercel.app \
RELEASE_VERSION=1.0.0 \
npm run package:extension
```

产物：

```text
dist/broadcast-agent-extension.zip
```

构建脚本会写入 HTTPS 代理地址和域名权限、移除开发说明，并检查 Manifest、图标、本地地址与疑似密钥。不要提交使用示例域名生成的 ZIP。

## 5. Edge Hidden 发布

1. 登录 Microsoft Partner Center 并加入 Microsoft Edge Program。
2. 创建扩展，上传生产 ZIP。
3. Availability 选择 **Hidden**。
4. 获得正式扩展 ID 后，把 `chrome-extension://正式扩展ID` 加入 Vercel 的 `ALLOWED_EXTENSION_ORIGINS` 并重新部署。
5. 填写商店资料、隐私政策 URL、支持 URL、权限说明和审核备注。
6. 上传能展示悬浮面板、字幕读取与时间戳跳转的截图。
7. 审核通过后，用商店安装包完成端到端验收。

## 6. 上线验收

- 使用人工字幕、AI 字幕和多 P 视频各验证一个。
- 未授权时不发送字幕；授权后内容地图、高光切片、内容重构和延伸探索可用。
- 时间戳跳转、视频内提问、知识笔记和清除数据可用。
- 代理的 401、403、429、超时错误都能显示为可理解提示。
- 服务日志不包含字幕正文、问题正文、回答正文或密钥。
- 暂停 AI 服务后，字幕阅读和手工笔记仍可使用。

## 7. 模型切换与回滚

在服务端修改：

```text
AI_PROVIDER=deepseek
AI_MODEL=新模型名
AI_FALLBACK_MODEL=备用模型名
```

然后重新部署。DeepSeek 推荐使用 `deepseek-v4-flash`，高质量备用模型可使用 `deepseek-v4-pro`。先用内容地图、结构化输出和普通问答分别验证；失败时恢复旧模型并重新部署即可。扩展端 `/v1/chat/completions` 与 `/v1/web-search` 契约保持不变。

## 8. 日常运维

- 监控函数请求量、429、上游错误率、延迟和智谱费用。
- 异常时先在智谱侧停用或限制密钥，再排查来源。
- 定期轮换 `DEEPSEEK_API_KEY` 和仍在使用的 `ZHIPU_API_KEY`。
- 轮换 `SESSION_SIGNING_SECRET` 会使已有匿名会话失效并自动重新注册。
- 扩展升级时递增版本号并重新生成 ZIP。
