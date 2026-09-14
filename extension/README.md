# 播客智能阅读助手 v1.0.24

安装插件后无需部署服务器。在 Edge 扩展管理中加载此目录，打开 Bilibili 普通 BV 视频页后点击插件图标。

- AI 功能：在“AI 能力”填写自己的 DeepSeek API Key，并授权发送必要字幕。聊天与联网搜索均直接访问 DeepSeek，按用户账户计费；不提供开发者免费额度。
- 默认 Key 仅当前浏览器会话有效，勾选“在此设备记住”才持久保存。可随时删除 Key。
- 测试 Key 会发起一次简短请求并产生少量费用。

开发与构建：在根目录执行 `npm test`、`npm run check`、`npm run package:extension`。无需 API_BASE_URL、Vercel 或本地代理。更换模型需修改后台配置并重新发布。

遇到 AI 错误请检查 Key、DeepSeek 账户余额与网络连接；不会自动切换到其他账户。详细隐私说明见 privacy.html。
