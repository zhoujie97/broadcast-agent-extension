# 播客智能阅读助手

一款面向 Bilibili 访谈、播客和长视频的 Edge 浏览器扩展。它可以读取视频字幕并生成智能稿本、内容地图、高光切片、人物资料、知识笔记和深度文章。

![](效果图/智能稿本.png)
当前扩展版本：`v1.0.16`

- [v1.0.16 版本说明](docs/v1.0.16-release-notes.md)
- [v1.0.15 版本说明](docs/v1.0.15-release-notes.md)
- [扩展完整使用说明](extension/README.md)
- [Vercel 部署说明](DEPLOYMENT.md)

## 主要功能

- 智能稿本：读取 Bilibili 中文字幕，合并成带时间戳的智能稿本；点击时间戳跳转视频，并随播放进度高亮当前内容；选中文字既可以结合前后文理解。
<div align="center">

<img src="效果图/智能稿本1.png" width="40%">
<img src="效果图/智能稿本-ai理解.png" width="49%">

</div>

- 内容地图：生成人物资料、采访主题地图、人物生命轨迹、思想金句；人物资料优先检索百度百科，并结合视频上下文校验身份；支持人工修正字幕中的错误姓名，例如 `叶利静 → 易立竞`；支持自然语言纠错，由 AI 核实后更新人物和内容信息

<div align="center">

<img src="效果图/内容地图1.png" width="30%">
<img src="效果图/内容地图2.png" width="30%">
<img src="效果图/内容地图3.png" width="30%">
<img src="效果图/内容地图4.png" width="30%">
<img src="效果图/内容地图-人物轨迹.png" width="30%">
<img src="效果图/内容地图-思想碎片.png" width="30%">

</div>

- 高光切片：生成8 至 10 个高光切片为每个高光片段便于长视频播客在短视频上的传播，推荐 3 首适配该片段的歌曲bgm，并提供抖音搜索入口
<div align="center">

<img src="效果图/高光切片1.png" width="30%">
<img src="效果图/高光切片2.png" width="30%">
<img src="效果图/高光切片3.png" width="30%">

</div>


- 内容重构：被采访者可分别选择生成人物特写或第一人称自述、深度文章，可以选择1000字、2000字、3000字。
- 支持视频AI问答、知识笔记
- 延伸探索会为每位嘉宾分别推荐资料

<div align="center">

<img src="效果图/内容重构1.png" width="50%">
<img src="效果图/延伸探索.png" width="41%">
<img src="效果图/知识笔记1.png" >
<img src="效果图/知识笔记-ai提问.png">

</div>


- AI Key 只保存在服务端，扩展使用 Vercel HTTPS 代理

## 普通用户安装

如果你拿到的是发布压缩包：

1. 解压 `broadcast-agent-extension.zip`。
2. 打开 `edge://extensions`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择解压后的扩展文件夹。
6. 打开并刷新 Bilibili 视频页面，然后点击扩展图标。

普通用户不需要下载整个源码仓库，也不需要填写 DeepSeek API Key。

## 从源码构建

要求 Node.js 18 或更高版本。

```bash
npm install

API_BASE_URL=https://broadcast-agent-extension.vercel.app \
RELEASE_VERSION=1.0.16 \
npm run package:extension
```

构建结果：

```text
dist/extension/
dist/broadcast-agent-extension.zip
```

开发环境也可以直接在浏览器扩展管理页加载仓库中的 `extension/`，但需要同时运行本地代理。具体配置见[扩展完整使用说明](extension/README.md)。

## AI 服务配置

扩展端不包含密钥。生产环境通过 Vercel 代理调用：

| 能力 | 服务 |
| --- | --- |
| 内容地图、切片、问答、重构、纠错 | DeepSeek |
| 百度百科人物检索、延伸探索 | DeepSeek Web Search |
| API Key、来源校验和限流 | Vercel Functions |

Vercel 至少需要配置：

```text
AI_MODEL=deepseek-v4-flash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
SESSION_SIGNING_SECRET=至少 24 字符的随机字符串
ALLOWED_EXTENSION_ORIGINS=chrome-extension://你的正式扩展ID
```

修改 Vercel 环境变量后需要重新部署。侧载测试可临时将 `ALLOWED_EXTENSION_ORIGINS` 设置为 `chrome-extension://*`；正式发布后应改为商店分配的固定扩展 ID。完整流程见 [DEPLOYMENT.md](DEPLOYMENT.md)。

## 本地验证

```bash
npm test
npm run check
```

## 隐私与安全

- 不读取、保存或上传 Bilibili `SESSDATA`
- 只有用户主动使用 AI 功能时，相关字幕和问题才会发送到代理
- API Key 不写入扩展源码或安装包
- 笔记、稿本修正和生成结果保存在浏览器本地，并按视频隔离

## 已知限制

- 视频没有可用中文字幕时，无法生成智能稿本
- AI 字幕可能识别错字，需要使用稿本人名修正功能
- 抖音歌曲只提供搜索跳转，不提供内嵌试听
- 公开大规模使用前，建议为 Vercel 代理接入持久化限流并设置模型消费上限

## 反馈问题

请在 [GitHub Issues](https://github.com/zhoujie97/broadcast-agent-extension/issues) 提交问题，并尽量附上：

- 浏览器与扩展版本
- 视频链接或 BV 号
- 操作步骤和错误提示
- 已隐藏密钥及个人信息的截图
