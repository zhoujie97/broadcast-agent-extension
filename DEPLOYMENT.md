# v1.0.24 发布与旧服务下线

新版插件直接使用用户自己的 DeepSeek Key，无需部署后端、Vercel 或本地代理。

## 构建

```bash
npm test
npm run check
npm run package:extension
```

安装包：`dist/broadcast-agent-extension.zip`。开发时直接加载 `extension/`，或加载 `dist/extension/` 验收发布包。模型为 `deepseek-v4-flash`，聊天和搜索均直连 `https://api.deepseek.com`。

## 旧版服务必须下线

本地改动不会自动改变已经上线的 Vercel 部署。`api/` 与 `proxy/server.mjs` 仅保留退役响应：所有旧接口返回 HTTP 410，不读取任何环境变量密钥，不发出上游请求。它们不参与新版插件运行。

如曾部署旧代理，应在旧项目发布退役版本或停用其部署，并撤销旧开发者 DeepSeek Key。仅删除 Vercel 环境变量不足以保证历史部署失效；旧部署可能仍含当时的密钥。保留仍用于商店的隐私政策与支持页面地址。不要在新版插件中填写开发者 Key。

## 验收

- 无 Key：点击生成只引导配置，网络面板无 AI 请求。
- 个人 Key：可测试、保存、会话使用或主动记住、删除；测试会产生少量调用费用。
- 聊天与搜索只请求 DeepSeek，不访问 localhost、Vercel、注册或健康检查接口。
- 错误 Key、余额不足、限流等错误可见，不切换开发者 Key。
- 非 AI 字幕、笔记与视频跳转继续可用。
