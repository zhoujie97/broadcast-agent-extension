# 播客智能阅读助手上线手册

本文档对应当前代码版本 `0.22.0`，目标是先以 Hidden 方式发布到 Microsoft Edge Add-ons，验证真实用户使用与 AI 成本，再决定是否公开及同步 Chrome Web Store。

## 1. 发布结构

```text
Bilibili 页面
  └─ Edge/Chrome 扩展（不包含任何模型密钥）
       └─ HTTPS AI 代理（Render）
            ├─ 匿名安装会话
            ├─ CORS 来源限制
            ├─ 分钟/单安装/全局日限额
            └─ 智谱 GLM API
```

模型名称、备用模型、限额和密钥都配置在服务端环境变量中。以后换模型不需要修改扩展；只有在更换 API 提供商或协议时才需要更新代理代码。

## 2. 已完成的上线准备

- Manifest V3 扩展、16/32/48/128 PNG 图标。
- AI 密钥只保留在服务端；生产构建会扫描疑似密钥。
- 首次使用 AI 前明确授权，可撤回并清除本地数据。
- HTTPS 代理支持健康检查、匿名签名会话、来源限制、请求超时和三级限额。
- `render.yaml` 可在 Render 创建 Web Service。
- 隐私页、支持页、商店文案、审核说明和生产 ZIP 构建脚本。

## 3. 首次部署（需要账号操作）

### 3.1 GitHub

1. 新建私有仓库，例如 `broadcast-agent`。
2. 将本目录提交并推送到仓库。不要提交 `.env` 或任何 API Key。
3. 建议保护默认分支，后续通过分支与 Pull Request 发布。

### 3.2 Render AI 代理

1. 在 Render 选择 **New → Blueprint**，连接上述 GitHub 仓库。
2. Render 会读取根目录的 `render.yaml` 创建 `broadcast-agent-api`。
3. 在 Render 的 Environment 中录入：
   - `ZHIPU_API_KEY`：智谱正式密钥。
   - `ALLOWED_EXTENSION_ORIGINS`：第一次可先填本机侧载扩展的 Origin，例如 `chrome-extension://扩展ID`。提交商店后再增加正式扩展 ID，多个 Origin 用英文逗号分隔。
   - `SESSION_SIGNING_SECRET`：Blueprint 会自动生成，不要复制进代码库。
4. 部署完成后打开 `https://你的服务.onrender.com/health`，应返回 `{"ok":true,...}`。
5. 记录 HTTPS 根地址，后续示例记为 `https://YOUR-SERVICE.onrender.com`。

Render Web Service 必须监听 `0.0.0.0` 与平台提供的 `PORT`，当前代码及 Blueprint 已处理。Render 会为 `onrender.com` 地址提供 HTTPS。

### 3.3 隐私与支持页面（已部署）

公开 HTTPS 站点已经部署：

- `https://podcast-field-notes-cn.bright-frog-5143.chatgpt.site/privacy`
- `https://podcast-field-notes-cn.bright-frog-5143.chatgpt.site/support`

正式提交前，把支持页里的“公开测试开始时将补充……”替换成真实支持邮箱或 Issue 地址并发布新版本。

### 3.4 生成生产 ZIP

```bash
API_BASE_URL=https://YOUR-SERVICE.onrender.com \
RELEASE_VERSION=1.0.0 \
npm run package:extension
```

产物为：

```text
dist/broadcast-agent-extension.zip
```

构建脚本会：

1. 将扩展复制到干净目录；
2. 把本地代理替换为 HTTPS 生产地址；
3. 写入正式版本号和生产域名权限；
4. 删除开发说明；
5. 检查 Manifest、图标、本地地址与疑似密钥；
6. 生成 ZIP。

不要把使用示例域名生成的 ZIP 提交商店。

## 4. Edge 小范围发布

1. 使用 Microsoft Account 登录 Partner Center，并加入 Microsoft Edge Program。
2. 创建新扩展并上传生产 ZIP。
3. Availability 选择 **Hidden**，先通过链接邀请测试用户。
4. 包验证完成、Partner Center 显示扩展 ID 后，先把 `chrome-extension://正式扩展ID` 加到 Render 的 `ALLOWED_EXTENSION_ORIGINS`，再提交审核，确保审核员能够调用 AI。
5. 填写中文商店信息、隐私政策 URL、支持 URL、权限说明和审核备注。
6. 上传至少一张能看清悬浮面板与时间戳跳转的截图。
7. 发布审核。官方说明认证最长可能需要 7 个工作日。
8. 审核通过后，用正式商店安装包完成一次端到端验收。

Edge 开发者注册与发布：

- https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/create-dev-account
- https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension

## 5. 上线验收

至少使用 3 个不同 Bilibili 视频验证：

- 有人工字幕、AI 字幕、多 P 视频各一个。
- 未授权时，任何 AI 功能都不会发送字幕。
- 授权后能生成内容地图、高光切片、内容重构和延伸探索。
- 时间戳跳转、视频内提问、知识笔记和清除数据均可用。
- 全屏与非全屏下悬浮按钮不遮挡主要控件。
- 服务端 401、403、429、上游超时都显示可理解错误。
- 代理日志不出现字幕正文、问题正文、回答正文或密钥。
- 从 Render 暂时关闭 AI 后，字幕阅读和手工笔记仍可使用。

## 6. 模型切换与回滚

仅切换智谱兼容模型时，在 Render 修改：

```text
AI_MODEL=新模型名
AI_FALLBACK_MODEL=备用模型名（可留空）
```

保存后 Render 会重启服务，扩展不需要重新审核。先在非高峰期用 3 类任务验证 JSON 结构输出，再逐步放量。如果失败，把 `AI_MODEL` 改回原值即可回滚。

更换到不同 API 供应商时，应在代理中新增 Provider 适配器，保持扩展端 `/v1/chat/completions` 和 `/v1/web-search` 契约不变。这样仍可避免发布新扩展。

## 7. 日常运维

- 每日查看请求量、429 比例、上游错误率、P95 延迟和估算费用。
- 先调低 `DAILY_INSTALLATION_UNITS` 或 `GLOBAL_DAILY_UNITS` 止损，再排查异常。
- 定期轮换 `ZHIPU_API_KEY`；轮换只在 Render 完成。
- 若怀疑 `SESSION_SIGNING_SECRET` 泄露，轮换后所有匿名会话会自动失效并重新注册。
- 扩展升级时递增版本号，重新生成 ZIP；Edge 会向已安装用户自动分发通过审核的更新。

## 8. 当前需要用户提供/完成的事项

1. GitHub 仓库归属与是否设为私有。
2. Render 登录及 GitHub 授权。
3. 在 Render 控制台输入智谱 API Key（不要通过聊天发送）。
4. 正式支持邮箱或公开 Issue 地址。
5. Microsoft Partner Center 登录、开发者身份与最终发布确认。
