# Bilibili 字幕提取调研与验证

验证日期：2026-07-16  
样例视频：`BV1xBTp6cE9L`

## 结论

MVP 可以优先读取 Bilibili 的 CC/AI 字幕，不必先做 ASR。但必须把字幕来源分成两类：

1. **可下载字幕轨**：播放器接口返回字幕清单与 `subtitle_url`，可以直接得到带 `from`、`to`、`content` 的 JSON。
2. **烧录字幕**：字幕已经合成进视频画面，但播放器接口没有字幕轨。这类字幕无法从网页元数据直接提取，只能降级到音频 ASR，OCR 仅适合作为校对补充。

本次样例验证结果属于第二种或“登录后才可能提供 AI 字幕”的情况：公开元数据可以取得视频标识，但游客态播放器接口返回 `need_login_subtitle: true`，字幕数组为空。因此插件不能把“用户肉眼看到字幕”当作“存在 CC 字幕”的判断条件。

## 实际验证结果

### 1. 获取视频元数据

请求：

```text
GET https://api.bilibili.com/x/web-interface/view?bvid=BV1xBTp6cE9L
```

关键响应：

```json
{
  "code": 0,
  "data": {
    "aid": 116854131525640,
    "bvid": "BV1xBTp6cE9L",
    "cid": 39677463982,
    "duration": 14145,
    "pages": [
      {
        "cid": 39677463982,
        "page": 1,
        "duration": 14145
      }
    ],
    "subtitle": {
      "list": []
    }
  }
}
```

结论：BV 号到 `aid/cid` 的转换可在游客态完成；多 P 视频应根据当前 `p` 参数从 `pages` 中选择对应 `cid`。

### 2. 获取播放器字幕清单

请求：

```text
GET https://api.bilibili.com/x/player/v2?bvid=BV1xBTp6cE9L&cid=39677463982
```

游客态关键响应：

```json
{
  "code": 0,
  "data": {
    "login_mid": 0,
    "need_login_subtitle": true,
    "subtitle": {
      "subtitles": []
    }
  }
}
```

`/x/player/wbi/v2` 的游客态结果相同，因此仅替换接口路径不能绕过登录要求。

## 推荐提取链路

```text
当前页面 URL
  -> 解析 bvid 与 p
  -> /x/web-interface/view 获取 pages/cid
  -> /x/player/v2 获取 subtitle.subtitles
  -> 选择中文或用户指定语言
  -> 请求 subtitle_url
  -> 标准化为 [{ from, to, content }]
  -> 合并成适合阅读的 15~40 秒段落
```

典型字幕文件结构：

```json
{
  "body": [
    {
      "from": 12.4,
      "to": 15.8,
      "location": 2,
      "content": "字幕文本"
    }
  ]
}
```

字段和接口均不是面向第三方开发者的稳定公开契约，需要把 Bilibili 逻辑封装在独立 adapter 中，并准备监控与降级。

## 浏览器扩展实现建议

### 页面上下文负责登录态请求

优先在 Bilibili 页面主世界执行只读请求：

```js
const result = await chrome.scripting.executeScript({
  target: { tabId },
  world: "MAIN",
  func: async ({ bvid, cid }) => {
    const url = new URL("https://api.bilibili.com/x/player/v2");
    url.searchParams.set("bvid", bvid);
    url.searchParams.set("cid", String(cid));

    const response = await fetch(url, { credentials: "include" });
    return response.json();
  },
  args: [{ bvid, cid }]
});
```

原因：页面主世界请求可以复用用户现有 Bilibili 登录态，同时避免读取、复制或保存 Cookie。插件只接收播放器接口的结构化结果。

### 权限保持最小化

建议 Manifest V3 权限：

```json
{
  "permissions": ["activeTab", "scripting", "storage", "sidePanel"],
  "host_permissions": [
    "https://www.bilibili.com/*",
    "https://api.bilibili.com/*",
    "https://*.hdslb.com/*"
  ]
}
```

不建议第一版申请 `cookies` 权限，也不要把 `SESSDATA` 发送到自己的后端。

### 时间戳跳转

Content Script 接收侧栏消息后控制当前播放器：

```js
const video = document.querySelector("video");
if (!video) throw new Error("VIDEO_NOT_FOUND");

video.currentTime = targetSeconds;
await video.play();
```

页面可能重新挂载 `<video>`，所以每次跳转都应重新查询，不长期缓存 DOM 引用。通过 `timeupdate` 事件把当前播放时间同步回侧栏，并用二分查找定位当前字幕段。

## 必须覆盖的产品状态

| 状态 | 判断 | 插件反馈 | 后续动作 |
|---|---|---|---|
| 字幕就绪 | `subtitles.length > 0` | 展示逐字稿 | 拉取字幕文件 |
| 需要登录 | `need_login_subtitle === true` 且未登录 | 提示登录后重试 | 不索取账号或 Cookie |
| 没有字幕轨 | 已登录且数组仍为空 | 说明可能是烧录字幕 | 提供 ASR 入口 |
| 多语言 | 多条字幕轨 | 默认中文，允许切换 | 保存本视频偏好 |
| 多 P | `pages.length > 1` | 跟随当前 P | 切 P 后重新提取 |
| 风控/接口变化 | 非 0 code、结构缺失或 412 | 可理解的失败提示 | 退避重试，不循环请求 |

## MVP 范围建议

第一版支持：

- Bilibili 单 P 与多 P 视频
- 已登录用户的 CC/AI 字幕读取
- 时间戳纵向逐字稿
- 点击时间戳跳转并播放
- 当前段落高亮与自动跟随
- 基于“当前段 + 前后各 2~3 段”的 AI 解释
- 无字幕轨时给出明确降级提示

第一版暂不支持：

- 自动下载整段视频
- 画面 OCR 全量转录
- 绕过登录或付费限制
- 将 Bilibili Cookie 上传到后端

## 下一轮工程验证

需要在已登录 Bilibili 的 Chrome/Edge 中侧载最小扩展，验证以下三点：

1. 主世界 `fetch(..., { credentials: "include" })` 是否能稳定返回字幕轨。
2. 返回的 `subtitle_url` 是否可由扩展直接读取，及其 CORS/Referer 要求。
3. Bilibili 播放器切 P、全屏和软导航后，`video.currentTime` 与侧栏同步是否稳定。

