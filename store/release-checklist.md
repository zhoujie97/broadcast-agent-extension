# 发布检查清单

- [ ] 源码与 ZIP 中没有 API Key、Cookie、个人邮箱或本机绝对路径。
- [ ] `/health` 返回 200，模型名正确。
- [ ] Render `ALLOWED_EXTENSION_ORIGINS` 包含测试/正式扩展 Origin。
- [ ] 隐私页与支持页可匿名通过 HTTPS 访问。
- [ ] 隐私页包含真实支持联系方式。
- [ ] 使用真实生产 URL 重新运行 `npm run package:extension`。
- [ ] `npm run check` 与 `npm run validate:release` 通过。
- [ ] 在全新 Edge Profile 中侧载 `dist/extension` 完成首装测试。
- [ ] 未授权 AI 时代理不收到字幕请求。
- [ ] 授权、撤回、清除当前视频缓存、清除全部数据均通过。
- [ ] 三个不同视频完成字幕、跳转、问答与笔记测试。
- [ ] 商店名称、说明、截图与扩展实际行为一致。
- [ ] 选择 Hidden 可见性进行首轮发布。
- [ ] 审核通过后，用商店安装版本再做一次端到端验收。
