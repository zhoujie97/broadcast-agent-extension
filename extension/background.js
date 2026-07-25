const SUPPORTED_VIDEO_URL = /^https:\/\/www\.bilibili\.com\/video\/BV[a-zA-Z0-9]+/;
const AI_CONFIG = Object.freeze({
  // Production builds should replace this with the deployed HTTPS proxy URL.
  // The proxy keeps provider API keys on the server; never put a key here.
  proxyUrl: "http://127.0.0.1:8787/v1/chat/completions",
  defaultMaxTokens: 4096
});
const PROXY_INSTALLATION_KEY = "proxyInstallationId";
const PROXY_SESSION_KEY = "proxyAnonymousSession";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.remove("aiConfig").catch(() => {});
  chrome.storage.local.remove("aiPreferences").catch(() => {});
  Promise.all([
    caches.delete("webllm/model"),
    caches.delete("webllm/config"),
    caches.delete("webllm/wasm")
  ]).catch(() => {});
  removeLegacyTranscriptAiCaches().catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !SUPPORTED_VIDEO_URL.test(tab.url || "")) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_FLOATING_PANEL" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_FLOATING_PANEL" });
  }
});

async function removeLegacyTranscriptAiCaches() {
  const [localValues, sessionValues] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.session.get(null)
  ]);
  const localKeys = Object.keys(localValues)
    .filter((key) =>
      key.startsWith("polishedTranscript:") ||
      key.startsWith("clipRadar:") ||
      key.startsWith("clipFavorites:") ||
      key.startsWith("contentValueRadarV3:") ||
      key.startsWith("contentMap:") ||
      key.startsWith("contentMapV2:") ||
      key.startsWith("contentMapV3:")
    );
  const sessionKeys = Object.keys(sessionValues)
    .filter((key) => key.startsWith("speakerLabels:"));
  await Promise.all([
    localKeys.length ? chrome.storage.local.remove(localKeys) : Promise.resolve(),
    sessionKeys.length ? chrome.storage.session.remove(sessionKeys) : Promise.resolve()
  ]);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LOAD_TRANSCRIPT") {
    loadTranscriptForActiveTab()
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "SEEK_ACTIVE_VIDEO") {
    seekActiveVideo(message.seconds)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "GET_PLAYBACK_STATE") {
    getPlaybackState()
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "SAVE_PAGE_NOTE") {
    savePageNote(message.payload, sender.tab)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "GET_ACTIVE_PAGE") {
    getActiveBilibiliTab()
      .then((tab) =>
        sendResponse({
          ok: true,
          page: {
            tabId: tab.id,
            title: tab.title || "",
            url: tab.url || ""
          }
        })
      )
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "GET_AI_STATUS") {
    getAiServiceStatus()
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "EXPLAIN_SEGMENT") {
    explainSegment(message.payload, message.force === true)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "GENERATE_OVERVIEW") {
    generateOverview(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "GENERATE_CLIP_CANDIDATES") {
    generateClipCandidates(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "GENERATE_REMIX") {
    generateRemix(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "ASK_PODCAST") {
    askPodcast(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "ASK_PAGE_CONTEXT") {
    askPageContext(message.payload, sender.tab)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "GENERATE_FOLLOWUP") {
    generateFollowup(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  return false;
});

async function loadTranscriptForActiveTab() {
  const tab = await getActiveBilibiliTab();
  const pageInfo = parseVideoPage(tab.url);
  const result = await fetchBilibiliTranscript(pageInfo, tab.title);

  await chrome.storage.session.set({
    lastTranscript: {
      tabId: tab.id,
      video: result.video,
      track: result.track,
      segments: result.segments,
      loadedAt: Date.now()
    }
  });

  return {
    ...result,
    page: {
      tabId: tab.id,
      title: tab.title || result.video.title,
      url: tab.url
    }
  };
}

async function getAiServiceStatus() {
  const healthUrl = new URL("/health", AI_CONFIG.proxyUrl).href;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json();
    return {
      ok: response.ok && payload?.ok === true,
      available: response.ok && payload?.ok === true,
      model: payload?.model || "云端模型"
    };
  } catch (error) {
    return {
      ok: true,
      available: false,
      model: "云端模型",
      message: `无法连接 AI API 代理：${error.message || "Failed to fetch"}`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getVideoCacheKey(video) {
  return `${video?.bvid || "unknown"}:${video?.cid || "unknown"}`;
}

async function explainSegment(payload = {}, force = false) {
  const segment = payload.segment;
  if (!segment) {
    throw createError("SEGMENT_NOT_FOUND", "没有找到需要解释的段落。");
  }

  const videoKey = getVideoCacheKey(payload.video);
  const cacheKey =
    `segmentInsight:v3:${videoKey}:${segment.id}:` +
    simpleTextHash(segment.text);
  if (!force) {
    const cached = await chrome.storage.session.get(cacheKey);
    if (cached[cacheKey]) {
      return { ok: true, cached: true, insight: cached[cacheKey] };
    }
  }

  const result = await callAiJson({
    schemaName: "selection_insight",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        explanation: { type: "string" }
      },
      required: ["explanation"]
    },
    instructions:
      "你是谨慎而自然的中文访谈陪读助手。结合完整段落和前后文，解释用户选中文字在这里真正表达的意思、它回应了什么，以及必要的不确定性。只输出一段连贯自然的话，不列点、不分标题、不使用‘总结、隐含含义、上下文’等模板词。不要补充原声文稿之外的事实，不把推测写成事实，控制在120至260字。",
    input: JSON.stringify({
      videoTitle: payload.video?.title || "",
      fullSegmentText: payload.fullSegmentText || segment.text,
      contextSegments: Array.isArray(payload.contextSegments)
        ? payload.contextSegments.map(toAiSegment)
        : [],
      targetSegment: toAiSegment(segment)
    }),
    temperature: 0.3
  });

  await chrome.storage.session.set({ [cacheKey]: result });
  return { ok: true, cached: false, insight: result };
}

function simpleTextHash(text) {
  let hash = 2166136261;
  for (const character of String(text || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function generateOverview(payload = {}) {
  const segments = requireTranscriptSegments(payload.segments);
  const transcript = prepareTranscriptForAi(segments, 140000);
  const videoTitle = payload.video?.title || "";
  const webResults = await searchWeb(
    `${videoTitle.slice(0, 46)} ${payload.video?.publisher || ""} 嘉宾 简介`,
    12
  ).catch(() => []);
  const result = await callAiJson({
    schemaName: "content_map",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        oneLiner: { type: "string" },
        summary: { type: "string" },
        interviewers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              bio: { type: "string" },
              knownFor: { type: "string" },
              sourceLinks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" }
                  },
                  required: ["title", "url"]
                }
              }
            },
            required: ["name", "role", "bio", "knownFor", "sourceLinks"]
          }
        },
        interviewees: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              bio: { type: "string" },
              knownFor: { type: "string" },
              sourceLinks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" }
                  },
                  required: ["title", "url"]
                }
              }
            },
            required: ["name", "role", "bio", "knownFor", "sourceLinks"]
          }
        },
        chapters: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              from: { type: "number" },
              to: { type: "number" },
              insight: { type: "string" },
              content: { type: "string" }
            },
            required: ["title", "from", "to", "insight", "content"]
          }
        },
        lifeTrajectories: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              personName: { type: "string" },
              overview: { type: "string" },
              events: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    period: { type: "string" },
                    title: { type: "string" },
                    description: { type: "string" },
                    turningPoint: { type: "boolean" },
                    mentionedAt: { type: "number" }
                  },
                  required: [
                    "period", "title", "description", "turningPoint", "mentionedAt"
                  ]
                }
              }
            },
            required: ["personName", "overview", "events"]
          }
        },
        thoughtFragments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              statement: { type: "string" },
              lens: { type: "string" }
            },
            required: ["statement", "lens"]
          }
        }
      },
      required: [
        "oneLiner", "summary", "interviewers", "interviewees",
        "chapters", "lifeTrajectories", "thoughtFragments"
      ]
    },
    instructions:
      "你是资深播客编辑与人物叙事研究者。请把完整访谈重组为内容地图，并严格区分三种信息结构。第一，chapters 是节目时间线：按 from 递增，边界只能取自原声文稿已有时间戳，建议6至12章；每章 title 是8至18字的主题题目，insight 是35至70字的一句话提炼，必须说清该章最重要的判断或矛盾，不能只是内容预告；content 是120至240字的主要内容，用一段完整自然的中文说明论证过程、经验和结论，不分点、不编号、不使用项目符号。第二，lifeTrajectories 是被采访者的人生时间线，不按节目顺序，而按童年、求学、入行、转型、低谷、突破、当下等生命阶段或有可靠证据的年份排序；每位主要被采访者在信息充分时给出4至8个事件，overview 用一句话概括其人生轨迹，turningPoint 只标记真正改变后续方向的节点。事件若在访谈中明确出现，mentionedAt 使用对应原声文稿时间戳；仅由搜索材料支持时填-1。不得编造年份、经历或因果关系，年份不确定时使用‘职业早期’‘转型阶段’等阶段词；period 绝不能返回单独的‘年’‘月’‘日’‘时期’或‘阶段’，资料不足时 events 返回空数组。第三，thoughtFragments 是从具体人物和事件中抽离出的5至8条思想碎片：每条 statement 必须是脱离上下文仍成立、具有解释力的完整观点或陈述，35至80字，尽量包含条件、张力、因果或方法，不得以任何人名、‘他、她、我、他们、嘉宾、主持人’等人物或代词作主语，不得写成‘某某认为’‘某某提到’，也不能只是漂亮但空泛的鸡汤；优先使用‘真正的…’‘当…时…’‘一种选择的代价是…’等能够独立传播的观点结构。lens 用2至6字标记观察角度，如成长、选择、创作、职业、关系、方法论或社会观察。oneLiner 用一句话说明本期最值得看的原因；summary 用150至300字概括主线。必须区分采访者与被采访者：interviewers 只列提问或主持采访的人，interviewees 只列主要回答问题的人。视频标题和 publisher 中的人名采用原字，严禁写成同音字；当字幕与标题冲突时以标题为准。人物简介可以参考搜索结果但不得猜测；sourceLinks 的 URL 必须逐字使用搜索候选中的 URL。不要输出 Markdown 星号。",
    input: JSON.stringify({
      videoTitle,
      publisher: payload.video?.publisher || "",
      transcript,
      webResults
    }),
    temperature: 0.2,
    maxTokens: 6000,
    validateResult: contentMapValidationIssues
  });
  const allowedUrls = new Set(webResults.map((item) => item.url));
  canonicalizePeopleFromVideo(result, payload.video);
  sanitizeUnsupportedContentMapYears(result, [
    videoTitle,
    payload.video?.description || "",
    ...transcript.map((segment) => segment.text || ""),
    ...webResults.flatMap((item) => [item.title || "", item.content || ""])
  ].join(" "));
  normalizeContentMapResult(result, transcript);
  const normalizedIssues = contentMapValidationIssues(result);
  if (normalizedIssues.length) {
    throw createError(
      "AI_CONTENT_MAP_INCOMPLETE",
      `AI 返回的内容地图不完整：${normalizedIssues.join("；")}。请稍后重试。`
    );
  }
  result.interviewers = filterPersonSourceLinks(result.interviewers, allowedUrls)
    .map((person) => validateHighRiskFacts(person, webResults));
  result.interviewees = filterPersonSourceLinks(result.interviewees, allowedUrls)
    .map((person) => validateHighRiskFacts(person, webResults));
  const enriched = await enrichPeople(result, payload.video).catch(() => null);
  if (enriched) {
    result.interviewers = enriched.interviewers;
    result.interviewees = enriched.interviewees;
  }
  return { ok: true, overview: result };
}

async function generateClipCandidates(payload = {}) {
  const segments = requireTranscriptSegments(payload.segments);
  const transcript = prepareTranscriptForHighlights(segments);
  const result = await callAiJson({
    schemaName: "clip_candidates",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        intro: { type: "string" },
        clips: {
          type: "array",
          minItems: 8,
          maxItems: 10,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: { type: "number" },
              to: { type: "number" },
              type: { type: "string" },
              title: { type: "string" },
              quote: { type: "string" },
              scores: {
                type: "object",
                additionalProperties: false,
                properties: {
                  emotionalIntensity: { type: "number" },
                  depthOfThought: { type: "number" },
                  storyTension: { type: "number" },
                  practicalInspiration: { type: "number" },
                  spreadPotential: { type: "number" }
                },
                required: ["emotionalIntensity", "depthOfThought", "storyTension", "practicalInspiration", "spreadPotential"]
              },
              valuePortrait: { type: "string" },
              whyRecommended: { type: "string" },
              signals: { type: "array", items: { type: "string" } },
              scenarios: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: { type: "string" },
                    fit: { type: "string" },
                    title: { type: "string" },
                    advice: { type: "string" }
                  },
                  required: ["type", "fit", "title", "advice"]
                }
              },
              hook: { type: "string" },
              topics: { type: "array", items: { type: "string" } },
              bgmSuggestion: { type: "string" }
            },
            required: [
              "from", "to", "type", "title", "quote", "scores", "valuePortrait",
              "whyRecommended", "signals", "scenarios",
              "hook", "topics", "bgmSuggestion"
            ]
          }
        }
      },
      required: ["intro", "clips"]
    },
    instructions:
      "你是长内容价值分析师，不是单纯的短视频剪辑助手。请从完整原声文稿中识别8至10个彼此不重复、最值得观看、理解或二次利用的关键内容节点。type 必须且只能是情绪共鸣、认知突破、金句传播、故事高潮、争议观点之一。每个区间应包含必要背景、观点展开和自然收尾，通常30至180秒；from 和 to 必须取自逐字稿已有时间边界。五项 scores 均为0至100：emotionalIntensity评估情绪浓度，depthOfThought评估思考深度，storyTension评估故事冲突、转折与叙事张力，practicalInspiration评估能否转化为行动或方法启发，spreadPotential评估传播与讨论潜力。valuePortrait 用一句自然中文概括该片段的内容人格，例如‘这是一个高情绪、高故事、高共鸣的转折片段，更适合需要心理支持与人生经验的观众’，不要复述分数。whyRecommended 用一段话说明推荐逻辑；signals 从观点转折、个人经历、情绪变化、普适价值、具体案例、冲突张力、表达凝练等信号中选择2至5项。scenarios 只保留短视频传播、深度文章两种场景，分别对应抖音式短视频与小红书式文章，fit只能为高、中、低，并分别给出推荐标题和简短适配建议。hook、topics、bgmSuggestion 仅服务于短视频场景，BGM只写情绪、节奏和进入时机，不推荐具体歌曲。quote 必须是文稿原句。不得为了制造爆点夸大、歪曲或拼接人物原意。intro 应概括本期内容价值分布，而不是宣传口号。",
    input: JSON.stringify({
      videoTitle: payload.video?.title || "",
      duration: Number(payload.video?.duration) || null,
      transcript
    }),
    temperature: 0.3,
    maxTokens: 8000,
    validateResult: clipCandidateValidationIssues
  });

  const normalized = normalizeClipCandidates(result, segments);
  if (normalized.clips.length < 5) {
    throw createError(
      "AI_CLIP_RESULT_INCOMPLETE",
      "AI 返回的有效高光区间不足 5 个，结果未保存。请稍后重试。"
    );
  }
  return {
    ok: true,
    clips: normalized
  };
}

function normalizeClipCandidates(result, segments) {
  const firstFrom = Number(segments[0]?.from) || 0;
  const lastTo = Number(segments[segments.length - 1]?.to) || firstFrom;
  const boundaries = segments.flatMap((segment) => [
    Number(segment.from) || 0,
    Number(segment.to) || 0
  ]);
  const nearestBoundary = (value) => boundaries.reduce((best, boundary) =>
    Math.abs(boundary - value) < Math.abs(best - value) ? boundary : best,
  boundaries[0] || 0);
  const seen = new Set();
  const clips = [];

  for (const [index, raw] of (Array.isArray(result?.clips) ? result.clips : []).entries()) {
    const requestedFrom = Math.min(lastTo, Math.max(firstFrom, Number(raw.from) || firstFrom));
    const requestedTo = Math.min(lastTo, Math.max(requestedFrom, Number(raw.to) || requestedFrom));
    const from = nearestBoundary(requestedFrom);
    const to = nearestBoundary(requestedTo);
    if (!(to > from + 3)) continue;
    const rangeKey = `${Math.round(from)}:${Math.round(to)}`;
    if (seen.has(rangeKey)) continue;
    seen.add(rangeKey);
    const sourceText = segments
      .filter((segment) => Number(segment.to) > from && Number(segment.from) < to)
      .map((segment) => String(segment.text || "").trim())
      .filter(Boolean)
      .join("");
    const requestedQuote = String(raw.quote || "").trim();
    const compactSource = sourceText.replace(/[\s，。！？、；：“”‘’（）()《》…—-]/gu, "");
    const compactQuote = requestedQuote.replace(/[\s，。！？、；：“”‘’（）()《》…—-]/gu, "");
    const verifiedQuote = compactQuote.length >= 4 && compactSource.includes(compactQuote)
      ? requestedQuote
      : `${sourceText.slice(0, 76)}${sourceText.length > 76 ? "…" : ""}`;
    const scoreKeys = [
      "emotionalIntensity", "depthOfThought", "storyTension",
      "practicalInspiration", "spreadPotential"
    ];
    const legacyScoreKeys = {
      emotionalIntensity: "emotionalImpact",
      depthOfThought: "cognitiveValue",
      storyTension: "completeness",
      practicalInspiration: "independence",
      spreadPotential: "spreadPotential"
    };
    const scores = Object.fromEntries(scoreKeys.map((key) => [
      key,
      Math.round(Math.min(100, Math.max(
        0,
        Number(raw.scores?.[key] ?? raw.scores?.[legacyScoreKeys[key]]) || 0
      )))
    ]));
    const valueScore = Math.round(
      scores.emotionalIntensity * 0.17 +
      scores.depthOfThought * 0.23 +
      scores.storyTension * 0.19 +
      scores.practicalInspiration * 0.18 +
      scores.spreadPotential * 0.23
    );
    const allowedTypes = ["情绪共鸣", "认知突破", "金句传播", "故事高潮", "争议观点"];
    const type = allowedTypes.includes(raw.type) ? raw.type : "认知突破";
    const scenarioTypes = ["短视频传播", "深度文章"];
    const scenariosByType = new Map(
      (Array.isArray(raw.scenarios) ? raw.scenarios : [])
        .filter((scenario) => scenarioTypes.includes(scenario?.type))
        .map((scenario) => [scenario.type, scenario])
    );
    clips.push({
      id: `clip-${Math.round(from)}-${Math.round(to)}-${index}`,
      from,
      to,
      type,
      valueScore,
      scores,
      valuePortrait: String(raw.valuePortrait || "这是一段兼具思考与传播价值的访谈内容，适合进一步观看和再利用。").trim(),
      title: String(raw.title || "未命名片段").trim(),
      quote: verifiedQuote,
      whyRecommended: String(raw.whyRecommended || "该片段包含可复用的核心观点。 ").trim(),
      signals: (Array.isArray(raw.signals) ? raw.signals : [])
        .map((signal) => String(signal || "").trim()).filter(Boolean).slice(0, 5),
      scenarios: scenarioTypes.map((scenarioType) => {
        const scenario = scenariosByType.get(scenarioType) || {};
        return {
          type: scenarioType,
          fit: ["高", "中", "低"].includes(scenario.fit) ? scenario.fit : "中",
          title: String(scenario.title || raw.title || "未命名内容").trim(),
          advice: String(scenario.advice || "可根据目标受众补充背景后使用。").trim()
        };
      }),
      hook: String(raw.hook || "").trim(),
      topics: (Array.isArray(raw.topics) ? raw.topics : [])
        .map((topic) => String(topic || "").replace(/^#+/u, "").trim())
        .filter(Boolean).slice(0, 6),
      bgmSuggestion: String(raw.bgmSuggestion || "根据内容情绪选择，人物说话时降低音量。").trim()
    });
  }
  clips.sort((a, b) => b.valueScore - a.valueScore || a.from - b.from);
  return {
    version: 3,
    intro: String(result?.intro || "AI 已按传播、认知与二次创作价值整理关键内容节点。"),
    clips: clips.slice(0, 10)
  };
}

function clipCandidateValidationIssues(result) {
  const issues = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return ["结果不是对象"];
  }
  if (String(result.intro || "").trim().length < 12) {
    issues.push("缺少内容价值总览");
  }
  const clips = Array.isArray(result.clips) ? result.clips : [];
  const validClips = clips.filter((clip) =>
    Number.isFinite(Number(clip?.from)) &&
    Number.isFinite(Number(clip?.to)) &&
    Number(clip.to) > Number(clip.from) + 3 &&
    String(clip?.title || "").trim().length >= 4 &&
    String(clip?.whyRecommended || "").trim().length >= 12
  );
  if (validClips.length < 6) {
    issues.push(`有效高光区间不足 6 个（当前 ${validClips.length} 个）`);
  }
  return issues;
}

function canonicalizePeopleFromVideo(overview, video = {}) {
  const title = String(video.title || "");
  const publisher = String(video.publisher || "").trim();
  const titleHints = extractPeopleHintsFromTitle(title);
  const guestHint = titleHints.interviewee ||
    title.match(/(?:听|访谈|对话)([\p{Script=Han}]{2,4})(?:讲|聊|谈|：|:|\s)/u)?.[1];
  const interviewerHint = titleHints.interviewer;
  if (guestHint && (!Array.isArray(overview.interviewees) || overview.interviewees.length === 0)) {
    overview.interviewees = [emptyPersonProfile(guestHint, "被采访者")];
  }
  if (guestHint && Array.isArray(overview.interviewees) && overview.interviewees.length === 1) {
    overview.interviewees[0].name = guestHint;
  }
  if (
    interviewerHint &&
    (!Array.isArray(overview.interviewers) || overview.interviewers.length === 0)
  ) {
    overview.interviewers = [emptyPersonProfile(interviewerHint, "采访者")];
  }
  if (
    interviewerHint &&
    Array.isArray(overview.interviewers) &&
    overview.interviewers.length === 1
  ) {
    overview.interviewers[0].name = interviewerHint;
  }
  if (
    /^[\p{Script=Han}]{2,4}$/u.test(publisher) &&
    (!Array.isArray(overview.interviewers) || overview.interviewers.length === 0)
  ) {
    overview.interviewers = [emptyPersonProfile(publisher, "采访者")];
  }
  if (
    /^[\p{Script=Han}]{2,4}$/u.test(publisher) &&
    Array.isArray(overview.interviewers) &&
    overview.interviewers.length === 1
  ) {
    overview.interviewers[0].name = publisher;
  }
}

function extractPeopleHintsFromTitle(title) {
  const normalized = String(title || "")
    .replace(/[《》【】]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const directedSpeech = normalized.match(
    /([\p{Script=Han}]{2,4})(?:给|向|对)([\p{Script=Han}]{2,4})(?:说|讲|聊|谈|问)/u
  );
  if (directedSpeech) {
    return {
      interviewee: directedSpeech[1],
      interviewer: directedSpeech[2]
    };
  }
  const hostDialogue = normalized.match(
    /([\p{Script=Han}]{2,4})(?:专访|访谈|对话)([\p{Script=Han}]{2,4})/u
  );
  if (hostDialogue) {
    return {
      interviewer: hostDialogue[1],
      interviewee: hostDialogue[2]
    };
  }
  return { interviewer: "", interviewee: "" };
}

function emptyPersonProfile(name, role) {
  return {
    name,
    role,
    bio: "",
    knownFor: "",
    sourceLinks: []
  };
}

async function enrichPeople(overview, video = {}) {
  const interviewers = Array.isArray(overview.interviewers)
    ? overview.interviewers
    : [];
  const interviewees = Array.isArray(overview.interviewees)
    ? overview.interviewees
    : [];
  const people = [...interviewers, ...interviewees]
    .filter((person) => person?.name)
    .slice(0, 6);
  if (!people.length) return null;

  const knowledgeProfiles = await Promise.all(
    people.map((person) => fetchPublicKnowledgeProfile(person.name).catch(() => null))
  );
  const knowledgeByName = new Map(
    knowledgeProfiles.filter(Boolean).map((profile) => [profile.name, profile])
  );

  const videoContext = String(video.title || "").slice(0, 54);
  const evidenceGroups = await Promise.all(people.map(async (person) => {
    const queries = [
      `"${person.name}" 人物 专访 简介 代表作品`,
      videoContext
        ? `"${person.name}" ${videoContext}`
        : `"${person.name}" 内容创作者 职业经历`
    ];
    const batches = await Promise.all(
      queries.map((query) => searchWeb(query, 8).catch(() => []))
    );
    return {
      name: person.name,
      results: rankPersonEvidence(deduplicateSearchResults(batches.flat(), 12))
    };
  }));
  const candidates = deduplicateSearchResults(
    evidenceGroups.flatMap((group) => group.results),
    40
  );
  if (!candidates.length) {
    return {
      interviewers: applyKnowledgeProfiles(interviewers, knowledgeByName),
      interviewees: applyKnowledgeProfiles(interviewees, knowledgeByName)
    };
  }
  let result;
  try {
    result = await callAiJson({
    schemaName: "interview_people",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        interviewers: { type: "array", items: personProfileSchema() },
        interviewees: { type: "array", items: personProfileSchema() }
      },
      required: ["interviewers", "interviewees"]
    },
    instructions:
      "你是严格的事实核查编辑。保留输入中已经识别的采访者和被采访者身份，不要互换角色。只写搜索候选明确支持的稳定事实，优先采用本人、政府、机构官网和权威媒体等一手或权威来源。人物简介仅包含职业身份、长期经历与代表性作品；禁止写近期节目阵容、热搜或未经可靠来源支持的娱乐履历。奖项、职务、纪录、数字和时间必须有直接证据；来源冲突且无法消除时删除该事实，绝不凭模型记忆补全。sourceLinks 只能原样复制实际用于核实内容的候选 URL。不要输出 Markdown 星号。宁可少写也不要猜测，但已有可靠候选时必须提炼出一段简洁简介，不能只返回“暂无资料”。",
    input: JSON.stringify({
      currentDate: new Date().toISOString().slice(0, 10),
      interviewers,
      interviewees,
      evidenceGroups
    }),
    temperature: 0,
    maxTokens: 5000
    });
  } catch {
    return {
      interviewers: applyKnowledgeProfiles(interviewers.map((person) =>
        validateHighRiskFacts(
          buildSearchFallbackProfile(person, evidenceGroups),
          candidates
        )
      ), knowledgeByName),
      interviewees: applyKnowledgeProfiles(interviewees.map((person) =>
        validateHighRiskFacts(
          buildSearchFallbackProfile(person, evidenceGroups),
          candidates
        )
      ), knowledgeByName)
    };
  }
  const allowedUrls = new Set(candidates.map((item) => item.url));
  const verifiedInterviewers = preserveIdentifiedPeople(
    interviewers,
    filterPersonSourceLinks(result.interviewers, allowedUrls),
    candidates,
    evidenceGroups
  );
  const verifiedInterviewees = preserveIdentifiedPeople(
    interviewees,
    filterPersonSourceLinks(result.interviewees, allowedUrls),
    candidates,
    evidenceGroups
  );
  return {
    interviewers: applyKnowledgeProfiles(verifiedInterviewers, knowledgeByName),
    interviewees: applyKnowledgeProfiles(verifiedInterviewees, knowledgeByName)
  };
}

function applyKnowledgeProfiles(people, knowledgeByName) {
  return people.map((person) => {
    const knowledge = knowledgeByName.get(person.name);
    if (!knowledge) return person;
    const missing = (value) =>
      !String(value || "").trim() || /^(?:暂无|未检索到|公共知识库暂无)/u.test(value);
    const genericRole = /^(?:采访者|被采访者|人物资料)$/u.test(String(person.role || "").trim());
    const links = deduplicateSourceLinks([
      ...(Array.isArray(person.sourceLinks) ? person.sourceLinks : []),
      ...(Array.isArray(knowledge.sourceLinks) ? knowledge.sourceLinks : [])
    ]);
    return {
      ...person,
      role: genericRole || missing(person.role) ? knowledge.role : person.role,
      bio: missing(person.bio) ? knowledge.bio : person.bio,
      knownFor: missing(person.knownFor) ? knowledge.knownFor : person.knownFor,
      sourceLinks: links
    };
  });
}

function deduplicateSourceLinks(links) {
  const seen = new Set();
  return links.filter((link) => {
    if (!link?.url || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function rankPersonEvidence(results) {
  const authorityScore = (value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (/\.(?:gov|edu)\.cn$/u.test(host) || host.endsWith(".gov.cn")) return 6;
      if (/(?:thepaper\.cn|people\.com\.cn|xinhuanet\.com|jiemian\.com|cctv\.com)$/u.test(host)) return 5;
      if (/(?:china\.com\.cn|chinanews\.com|gmw\.cn|youth\.cn)$/u.test(host)) return 4;
      if (/(?:sina\.com\.cn|sina\.cn|qq\.com|163\.com)$/u.test(host)) return 3;
      return 1;
    } catch {
      return 0;
    }
  };
  return [...results].sort((a, b) => authorityScore(b.url) - authorityScore(a.url));
}

async function fetchPublicKnowledgeProfile(name) {
  const searchUrl = new URL("https://www.wikidata.org/w/api.php");
  searchUrl.search = new URLSearchParams({
    action: "wbsearchentities",
    search: name,
    language: "zh",
    uselang: "zh",
    type: "item",
    limit: "5",
    format: "json",
    origin: "*"
  });
  const searchPayload = await fetch(searchUrl).then((response) => {
    if (!response.ok) throw new Error(`Wikidata search HTTP ${response.status}`);
    return response.json();
  });
  const normalizedName = String(name || "").replace(/\s+/gu, "");
  const match = (Array.isArray(searchPayload.search) ? searchPayload.search : [])
    .find((item) => String(item.label || "").replace(/\s+/gu, "") === normalizedName);
  if (!match?.id) return null;

  const entityUrl = new URL("https://www.wikidata.org/w/api.php");
  entityUrl.search = new URLSearchParams({
    action: "wbgetentities",
    ids: match.id,
    props: "descriptions|sitelinks",
    languages: "zh|zh-hans",
    sitefilter: "zhwiki",
    format: "json",
    origin: "*"
  });
  const entityPayload = await fetch(entityUrl).then((response) => response.json());
  const entity = entityPayload.entities?.[match.id];
  const description = entity?.descriptions?.zh?.value ||
    entity?.descriptions?.["zh-hans"]?.value || match.description || "";
  const wikiTitle = entity?.sitelinks?.zhwiki?.title || "";
  let extract = "";
  if (wikiTitle) {
    const extractUrl = new URL("https://zh.wikipedia.org/w/api.php");
    extractUrl.search = new URLSearchParams({
      action: "query",
      prop: "extracts",
      exintro: "1",
      explaintext: "1",
      redirects: "1",
      titles: wikiTitle,
      format: "json",
      origin: "*"
    });
    const extractPayload = await fetch(extractUrl).then((response) => response.json());
    const page = Object.values(extractPayload.query?.pages || {})[0];
    extract = String(page?.extract || "").replace(/\s+/gu, " ").trim();
  }
  const bio = extract.split(/(?<=[。！？])/u).slice(0, 2).join("").slice(0, 320) ||
    description || "公共知识库暂无详细介绍。";
  const sourceLinks = [
    { title: `Wikidata：${name}`, url: `https://www.wikidata.org/wiki/${match.id}` }
  ];
  if (wikiTitle) {
    sourceLinks.push({
      title: `维基百科：${wikiTitle}`,
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(wikiTitle.replace(/ /gu, "_"))}`
    });
  }
  return {
    name,
    role: description || "人物资料",
    bio,
    knownFor: "",
    sourceLinks
  };
}

function sanitizeUnsupportedContentMapYears(overview, evidenceText) {
  const fields = ["oneLiner", "summary"];
  for (const field of fields) {
    overview[field] = stripUnsupportedYears(overview[field], evidenceText);
  }
  for (const chapter of Array.isArray(overview.chapters) ? overview.chapters : []) {
    chapter.title = stripUnsupportedYears(chapter.title, evidenceText);
    chapter.insight = stripUnsupportedYears(chapter.insight, evidenceText);
    chapter.content = stripUnsupportedYears(chapter.content, evidenceText);
    chapter.summary = stripUnsupportedYears(chapter.summary, evidenceText);
    chapter.keyPoints = (Array.isArray(chapter.keyPoints) ? chapter.keyPoints : [])
      .map((point) => stripUnsupportedYears(point, evidenceText));
  }
  overview.thoughtFragments = (Array.isArray(overview.thoughtFragments)
    ? overview.thoughtFragments
    : []).map((fragment) => ({
    ...fragment,
    statement: stripUnsupportedYears(fragment?.statement, evidenceText)
  }));
  for (const trajectory of Array.isArray(overview.lifeTrajectories)
    ? overview.lifeTrajectories
    : []) {
    trajectory.overview = stripUnsupportedYears(trajectory.overview, evidenceText);
    trajectory.events = (Array.isArray(trajectory.events) ? trajectory.events : [])
      .map((event) => ({
        ...event,
        period: normalizeLifePeriod(
          stripUnsupportedYears(event?.period, evidenceText)
        ),
        title: stripUnsupportedYears(event?.title, evidenceText),
        description: stripUnsupportedYears(event?.description, evidenceText)
      }));
  }
}

function contentMapValidationIssues(overview) {
  if (!overview || typeof overview !== "object" || Array.isArray(overview)) {
    return ["结果不是对象"];
  }
  const issues = [];
  if (String(overview.oneLiner || "").trim().length < 12) {
    issues.push("缺少本期一句话总览");
  }
  if (String(overview.summary || "").trim().length < 80) {
    issues.push("主线概括不足 80 字");
  }
  const chapters = Array.isArray(overview.chapters) ? overview.chapters : [];
  const validChapters = chapters.filter((chapter) =>
    Number.isFinite(Number(chapter?.from)) &&
    Number.isFinite(Number(chapter?.to)) &&
    Number(chapter.to) > Number(chapter.from) &&
    String(chapter?.title || "").trim().length >= 4 &&
    String(chapter?.content || "").trim().length >= 50
  );
  if (validChapters.length < 4) {
    issues.push(`有效主题章节不足 4 个（当前 ${validChapters.length} 个）`);
  }
  const fragments = Array.isArray(overview.thoughtFragments)
    ? overview.thoughtFragments
    : [];
  const peopleNames = [
    ...(Array.isArray(overview.interviewers) ? overview.interviewers : []),
    ...(Array.isArray(overview.interviewees) ? overview.interviewees : [])
  ].map((person) => String(person?.name || "").trim()).filter(Boolean);
  const personLedPattern =
    /^(?:他|她|我|我们|他们|她们|嘉宾|主持人|采访者|被采访者)(?:在|的|认为|提到|表示|觉得|通过|选择|经历|说|谈到)?/u;
  const validFragments = fragments.filter((fragment) =>
    String(fragment?.statement || "").replace(/\s+/gu, "").length >= 18 &&
    !personLedPattern.test(String(fragment?.statement || "").trim()) &&
    !peopleNames.some((name) =>
      String(fragment?.statement || "").trim().startsWith(name)
    )
  );
  if (validFragments.length < 3) {
    issues.push(`有效思想碎片不足 3 条（当前 ${validFragments.length} 条）`);
  }
  return issues;
}

function normalizeContentMapResult(overview, transcript) {
  const existingTimes = transcript
    .map((segment) => Number(segment?.from))
    .filter((time) => Number.isFinite(time) && time >= 0)
    .sort((a, b) => a - b);
  overview.chapters = (Array.isArray(overview.chapters) ? overview.chapters : [])
    .filter((chapter) => chapter?.title && chapter?.content)
    .sort((a, b) => Number(a.from) - Number(b.from))
    .map((chapter) => ({
      ...chapter,
      insight: String(chapter.insight || chapter.summary || "")
        .replace(/\s+/gu, " ")
        .trim()
    }));
  const peopleNames = [
    ...(Array.isArray(overview.interviewers) ? overview.interviewers : []),
    ...(Array.isArray(overview.interviewees) ? overview.interviewees : [])
  ].map((person) => String(person?.name || "").trim()).filter(Boolean);
  const personLedPattern = /^(?:他|她|我|我们|他们|她们|嘉宾|主持人|采访者|被采访者)(?:在|的|认为|提到|表示|觉得|通过|选择|经历|说|谈到)?/u;
  const seenStatements = new Set();
  overview.thoughtFragments = (Array.isArray(overview.thoughtFragments)
    ? overview.thoughtFragments
    : []).map((fragment) => ({
    statement: String(fragment?.statement || "").replace(/\s+/gu, " ").trim(),
    lens: String(fragment?.lens || "独立观点").trim()
  })).filter((fragment) => {
    if (fragment.statement.length < 18 || personLedPattern.test(fragment.statement)) return false;
    if (peopleNames.some((name) => fragment.statement.startsWith(name))) return false;
    const dedupeKey = fragment.statement.replace(/[，。！？；：\s]/gu, "");
    if (seenStatements.has(dedupeKey)) return false;
    seenStatements.add(dedupeKey);
    return true;
  }).slice(0, 8);
  const intervieweeNames = (Array.isArray(overview.interviewees)
    ? overview.interviewees
    : []).map((person) => String(person?.name || "").replace(/\s+/gu, "").trim())
    .filter(Boolean);
  overview.lifeTrajectories = (Array.isArray(overview.lifeTrajectories)
    ? overview.lifeTrajectories
    : []).map((trajectory) => {
    const rawName = String(trajectory?.personName || "").replace(/\s+/gu, "").trim();
    const matchedName = intervieweeNames.find((name) =>
      name === rawName || name.includes(rawName) || rawName.includes(name));
    return {
      ...trajectory,
      personName: matchedName || (intervieweeNames.length === 1 ? intervieweeNames[0] : rawName),
      events: (Array.isArray(trajectory?.events) ? trajectory.events : [])
        .filter((event) => event?.title && event?.description)
        .map((event) => ({
          ...event,
          period: normalizeLifePeriod(event.period),
          mentionedAt: nearestTranscriptTime(event.mentionedAt, existingTimes)
        }))
        .slice(0, 8)
    };
  }).filter((trajectory) =>
    trajectory.personName &&
    (!intervieweeNames.length || intervieweeNames.includes(trajectory.personName))
  );
}

function nearestTranscriptTime(value, existingTimes) {
  const target = Number(value);
  if (!Number.isFinite(target) || target < 0 || !existingTimes.length) return -1;
  let nearest = existingTimes[0];
  let distance = Math.abs(nearest - target);
  for (const time of existingTimes) {
    const nextDistance = Math.abs(time - target);
    if (nextDistance >= distance) continue;
    nearest = time;
    distance = nextDistance;
  }
  return distance <= 90 ? nearest : -1;
}

function stripUnsupportedYears(value, evidenceText) {
  return String(value || "")
    .replace(/((?:乘风|浪姐)\s*)20\d{2}/gu, "$1")
    .replace(/(?:19|20)\d{2}/gu, (year) => evidenceText.includes(year) ? year : "")
    .replace(/\s+》/gu, "》")
    .replace(/[ ]{2,}/gu, " ")
    .trim();
}

function normalizeLifePeriod(value) {
  const period = String(value || "")
    .replace(/\s+/gu, "")
    .replace(/^[,，.。:：;；、\-—–]+|[,，.。:：;；、\-—–]+$/gu, "")
    .trim();
  if (
    !period ||
    /^(?:年|月|日|年代|时期|阶段|时间|未知|不详|未明|待定)$/u.test(period)
  ) {
    return "阶段未明";
  }
  return period;
}

function personProfileSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      role: { type: "string" },
      bio: { type: "string" },
      knownFor: { type: "string" },
      sourceLinks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { title: { type: "string" }, url: { type: "string" } },
          required: ["title", "url"]
        }
      }
    },
    required: ["name", "role", "bio", "knownFor", "sourceLinks"]
  };
}

function filterPersonSourceLinks(people, allowedUrls) {
  return (Array.isArray(people) ? people : []).map((person) => ({
    ...person,
    sourceLinks: (Array.isArray(person.sourceLinks) ? person.sourceLinks : [])
      .filter((link) => allowedUrls.has(link.url))
  }));
}

function preserveIdentifiedPeople(
  originalPeople,
  enrichedPeople,
  candidates,
  evidenceGroups
) {
  return originalPeople.map((original) => {
    const enriched = enrichedPeople.find((person) => person.name === original.name) || original;
    const fallbackResults = evidenceGroups.find((group) => group.name === original.name)
      ?.results.slice(0, 3) || [];
    let withSources = enriched.sourceLinks?.length
      ? enriched
      : {
          ...enriched,
          sourceLinks: fallbackResults.map((item) => ({
            title: item.title,
            url: item.url
          }))
        };
    if (/暂无(?:足够)?可靠资料/u.test(withSources.bio || "")) {
      const fallback = buildSearchFallbackProfile(original, evidenceGroups);
      withSources = {
        ...withSources,
        bio: fallback.bio,
        sourceLinks: withSources.sourceLinks?.length
          ? withSources.sourceLinks
          : fallback.sourceLinks
      };
    }
    return validateHighRiskFacts(withSources, candidates);
  });
}

function buildSearchFallbackProfile(person, evidenceGroups) {
  const results = evidenceGroups.find((group) => group.name === person.name)
    ?.results.slice(0, 3) || [];
  const best = results.find((item) => item.content) || results[0];
  const excerpt = String(best?.content || best?.title || "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 220);
  return {
    ...person,
    role: String(person.role || "").replace(/\*\*/gu, ""),
    bio: excerpt || "未检索到可展示的人物资料。",
    knownFor: "",
    sourceLinks: results.map((item) => ({ title: item.title, url: item.url }))
  };
}

function validateHighRiskFacts(person, candidates = []) {
  const linkedUrls = new Set(
    (Array.isArray(person.sourceLinks) ? person.sourceLinks : [])
      .map((source) => source.url)
  );
  const linkedCandidates = candidates
    .filter((candidate) => linkedUrls.has(candidate.url));
  if (!linkedCandidates.length) {
    return {
      ...person,
      role: "",
      bio: "暂无足够可靠资料。",
      knownFor: "",
      sourceLinks: []
    };
  }
  const sourceText = linkedCandidates
    .map((candidate) =>
      `${candidate.title || ""} ${candidate.content || ""} ${candidate.publishDate || ""}`
    )
    .join(" ");
  const keepSupportedNumbers = (value) => String(value || "")
    .split(/(?<=[。！？；])/u)
    .filter((sentence) => {
      const tokens = sentence.match(/(?:19|20)\d{2}|\d+(?:\.\d+)?/gu) || [];
      const namedYears = [...sentence.matchAll(/《([^》]*(?:19|20)\d{2}[^》]*)》/gu)]
        .map((match) => match[1]);
      return (
        (tokens.length === 0 || tokens.every((token) => sourceText.includes(token))) &&
        namedYears.every((phrase) => sourceText.includes(phrase))
      );
    })
    .join("")
    .trim();
  const removeEntertainmentTimelines = (value) => String(value || "")
    .replace(/\*\*/gu, "")
    .split(/(?<=[。！？；])/u)
    .filter((sentence) =>
      !(
        /(?:参加|加盟|入选|录制|选手).{0,10}《?(?:乘风|浪姐)/u.test(sentence) ||
        /《?(?:乘风|浪姐)\s*20\d{2}》?.{0,8}(?:选手|嘉宾|成员)/u.test(sentence)
      )
    )
    .join("")
    .trim();
  return {
    ...person,
    role: removeEntertainmentTimelines(keepSupportedNumbers(person.role)),
    bio: removeEntertainmentTimelines(keepSupportedNumbers(person.bio)) ||
      "暂无足够可靠资料。",
    knownFor: removeEntertainmentTimelines(keepSupportedNumbers(person.knownFor))
  };
}

function deduplicateSearchResults(results, limit) {
  const seen = new Set();
  const output = [];
  for (const result of results) {
    if (!result?.url || seen.has(result.url)) continue;
    seen.add(result.url);
    output.push(result);
    if (output.length >= limit) break;
  }
  return output;
}

async function generateFollowup(payload = {}) {
  const overview = payload.overview || {};
  const names = (Array.isArray(overview.interviewees)
    ? overview.interviewees.map((person) => person.name)
    : []).filter(Boolean).slice(0, 3);
  const topics = (Array.isArray(overview.thoughtFragments)
    ? overview.thoughtFragments.map((fragment) => fragment?.statement)
    : Array.isArray(overview.takeaways) ? overview.takeaways : [])
    .filter(Boolean)
    .slice(0, 3);
  const title = String(payload.video?.title || "").slice(0, 48);
  const queries = [
    `${names.join(" ") || title} 播客 访谈 视频`,
    `${topics.join(" ").slice(0, 50) || title} 深度访谈`,
    `${names.join(" ") || title} 背景 文章`
  ].map((query) => query.slice(0, 70));
  const videoBatches = await Promise.all(
    queries.slice(0, 2).map((query) =>
      searchBilibiliVideos(query, 8).catch(() => [])
    )
  );
  const webBatches = await Promise.all(
    queries.map((query) => searchWeb(query, 10).catch(() => []))
  );
  const knowledgeBatches = await Promise.all(
    names.map(async (name) => {
      const profile = await fetchPublicKnowledgeProfile(name).catch(() => null);
      if (!profile) return [];
      return profile.sourceLinks.map((source) => ({
        title: source.title,
        content: profile.bio,
        url: source.url,
        media: "公共知识库",
        publishDate: ""
      }));
    })
  );
  const candidates = [];
  const seen = new Set();
  for (const item of [
    ...videoBatches.flat(),
    ...webBatches.flat().filter(isUsableResearchEvidence),
    ...knowledgeBatches.flat()
  ]) {
    if (
      !item.url ||
      seen.has(item.url) ||
      isCurrentVideoResult(item, payload.video)
    ) continue;
    seen.add(item.url);
    candidates.push({ ...item, inferredType: inferFollowupType(item) });
  }
  candidates.sort((a, b) => followupCandidateScore(b) - followupCandidateScore(a));
  candidates.splice(30);
  if (!candidates.length) {
    return {
      ok: true,
      followup: buildFollowupSearchFallback(queries, names, topics)
    };
  }

  let result;
  try {
    result = await callAiJson({
    schemaName: "ai_followup",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        intro: { type: "string" },
        topics: { type: "array", items: { type: "string" } },
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              url: { type: "string" },
              type: {
                type: "string",
                enum: ["podcast", "video", "article"]
              },
              source: { type: "string" },
              why: { type: "string" },
              publishDate: { type: "string" }
            },
            required: ["title", "url", "type", "source", "why", "publishDate"]
          }
        }
      },
      required: ["intro", "topics", "items"]
    },
    instructions:
      "你是播客研究编辑。基于候选搜索结果，挑选6至12条最能帮助用户继续理解本期人物和主题的资料。内容只分三类：podcast 是相关的视频播客、长访谈或对谈节目；video 是其他相关视频；article 是深度文章、人物资料或机构页面。优先选择本人或机构官方页面、政府与高校网站、公共知识库、权威媒体、知名出版物和主流视频平台，排除内容农场、采集站、标题党与信息来源不明的页面。结果优先保证2至5条相关视频播客，其次是其他视频，最后是文章。绝对不要推荐本期原视频。why 要具体说明与本期的连接。只能选择候选中真实存在的 URL，必须原样复制，绝不能编造链接。",
    input: JSON.stringify({
      videoTitle: title,
      interviewees: names,
      keyTopics: topics,
      candidates
    }),
    temperature: 0.2,
    maxTokens: 5000
    });
  } catch {
    return {
      ok: true,
      followup: buildCandidateFollowup(candidates, names, topics)
    };
  }
  const allowed = new Set(candidates.map((item) => item.url));
  result.items = (Array.isArray(result.items) ? result.items : [])
    .filter((item) => allowed.has(item.url))
    .map((item) => ({
      ...item,
      type: ["podcast", "video", "article"].includes(item.type)
        ? item.type
        : inferFollowupType(item)
    }))
    .sort((a, b) => followupTypeRank(a.type) - followupTypeRank(b.type));
  if (!result.items.length) {
    result.items = candidates.slice(0, 10).map((item) => ({
      title: item.title,
      url: item.url,
      type: item.inferredType || inferFollowupType(item),
      source: item.media || "网页",
      why: item.content.slice(0, 120),
      publishDate: item.publishDate || ""
    }));
  }
  return { ok: true, followup: result };
}

function isCurrentVideoResult(item, video = {}) {
  const currentBvid = String(video.bvid || "").toUpperCase();
  const resultBvid = String(item.url || "")
    .match(/\/video\/(BV[a-zA-Z0-9]+)/u)?.[1]
    ?.toUpperCase() || "";
  if (currentBvid && resultBvid === currentBvid) return true;
  const currentTitle = normalizeComparableTitle(video.title);
  const resultTitle = normalizeComparableTitle(item.title);
  return Boolean(currentTitle && resultTitle && currentTitle === resultTitle);
}

function normalizeComparableTitle(value) {
  return String(value || "")
    .replace(/<[^>]+>/gu, "")
    .replace(/[\s|｜·•—–_《》“”"'：:，,。！？!?（）()【】\[\]]+/gu, "")
    .toLocaleLowerCase();
}

async function searchBilibiliVideos(query, count = 8) {
  const url = new URL("https://api.bilibili.com/x/web-interface/search/type");
  url.search = new URLSearchParams({
    search_type: "video",
    keyword: String(query || "").slice(0, 60),
    page: "1",
    page_size: String(Math.min(20, Math.max(1, count)))
  });
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw new Error(`Bilibili search HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.code !== 0) throw new Error(payload.message || "Bilibili search failed");
  return (Array.isArray(payload.data?.result) ? payload.data.result : [])
    .filter((item) => item.bvid)
    .map((item) => ({
      title: stripSearchMarkup(item.title) || "Bilibili 视频",
      content: stripSearchMarkup(item.description),
      url: `https://www.bilibili.com/video/${item.bvid}`,
      media: item.author || "Bilibili",
      publishDate: item.pubdate
        ? new Date(Number(item.pubdate) * 1000).toISOString().slice(0, 10)
        : ""
    }));
}

function stripSearchMarkup(value) {
  return String(value || "")
    .replace(/<[^>]+>/gu, "")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

function buildCandidateFollowup(candidates, names, topics) {
  return {
    intro: "已从 Bilibili 与公共知识来源找到以下延伸资料。",
    topics: [...names, ...topics].filter(Boolean).slice(0, 6),
    items: [...candidates]
      .sort((a, b) => followupCandidateScore(b) - followupCandidateScore(a))
      .slice(0, 10).map((item) => ({
      title: item.title,
      url: item.url,
      type: item.inferredType || inferFollowupType(item),
      source: item.media || "网页",
      why: item.content?.slice(0, 140) || "与本期人物或话题相关。",
      publishDate: item.publishDate || ""
    }))
  };
}

function buildFollowupSearchFallback(queries, names, topics) {
  return {
    intro: "检索接口暂未返回具体条目，可通过以下入口继续查找。",
    topics: [...names, ...topics].filter(Boolean).slice(0, 6),
    items: queries.slice(0, 3).map((query) => ({
      title: `在 Bilibili 搜索：${query}`,
      url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`,
      type: "podcast",
      source: "Bilibili 搜索",
      why: "打开搜索结果页，查看相关播客、访谈和视频。",
      publishDate: ""
    }))
  };
}

function inferFollowupType(item = {}) {
  const text = `${item.title || ""} ${item.content || ""}`.toLocaleLowerCase();
  let hostname = "";
  try {
    hostname = new URL(item.url).hostname.toLocaleLowerCase();
  } catch {
    return "article";
  }
  const videoHost = [
    "bilibili.com", "youtube.com", "youtu.be", "vimeo.com",
    "youku.com", "iqiyi.com", "v.qq.com", "ximalaya.com"
  ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (
    videoHost &&
    /播客|podcast|访谈|采访|对谈|对话|圆桌|conversation|interview/u.test(text)
  ) {
    return "podcast";
  }
  return videoHost ? "video" : "article";
}

function followupTypeRank(type) {
  return ({ podcast: 0, video: 1, article: 2 })[type] ?? 3;
}

function followupCandidateScore(item) {
  const type = item.inferredType || inferFollowupType(item);
  const typeScore = ({ podcast: 300, video: 200, article: 100 })[type] || 0;
  return typeScore + Math.max(-5, researchSourceScore(item)) * 5;
}

async function searchWeb(query, count = 10) {
  const searchUrl = new URL("/v1/web-search", AI_CONFIG.proxyUrl).href;
  let response;
  try {
    response = await proxyFetch(searchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: String(query).slice(0, 70), count })
    }, "web_search");
  } catch (error) {
    throw createError("WEB_SEARCH_NETWORK_ERROR", `联网检索失败：${error.message}`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createError(
      "WEB_SEARCH_API_ERROR",
      payload?.error?.message || `联网检索失败（HTTP ${response.status}）。`
    );
  }
  return (Array.isArray(payload.search_result) ? payload.search_result : [])
    .map((item) => ({
      title: String(item.title || "未命名结果"),
      content: String(item.content || ""),
      url: normalizeExternalUrl(item.link),
      media: String(item.media || ""),
      icon: normalizeExternalUrl(item.icon),
      publishDate: String(item.publish_date || "")
    }))
    .filter((item) => item.url);
}

function normalizeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

async function generateRemix(payload = {}) {
  const segments = requireTranscriptSegments(payload.segments);
  const transcript = prepareTranscriptForAi(segments);
  const style = String(payload.style || "profile");
  const length = String(payload.length || "medium");
  const styleInstructions = {
    profile: "人物特写：以人物选择、转折、性格和方法为叙事主线，兼具现场感与分析。",
    magazine: "杂志报道：采用专业媒体报道结构，有导语、场景、观点推进和克制结尾。",
    biography: "人物传记片段：按关键经历和观念变化组织，但不得编造逐字稿未提供的生平。",
    first_person: "第一人称自述：以被采访者口吻重组内容；只能改写其明确表达，不得虚构内心或经历。",
    insight_essay: "观点深度文章：围绕采访中最重要的命题建立论点、论据和反思，人物作为观点来源。"
  };
  const lengthTargets = {
    short: "约800至1200字",
    medium: "约1600至2400字",
    long: "约2800至3800字"
  };
  const result = await callAiJson({
    schemaName: "remix_article",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        deck: { type: "string" },
        body: { type: "string" },
        disclaimer: { type: "string" }
      },
      required: ["title", "deck", "body", "disclaimer"]
    },
    instructions:
      `你是中文非虚构写作编辑。写作形式：${styleInstructions[style] || styleInstructions.profile}目标篇幅：${lengthTargets[length] || lengthTargets.medium}。文章要像完整作品而不是摘要，保留人物观点的细节、冲突与转折。可以压缩、重排和转述，但不得编造事实、场景、引语或心理活动；直接引语只能来自逐字稿。body 使用自然段纯文本，不要 Markdown 标题符号。disclaimer 简短说明改写边界。`,
    input: JSON.stringify({
      videoTitle: payload.video?.title || "",
      transcript
    }),
    temperature: 0.55,
    maxTokens: 8000
  });
  return { ok: true, remix: result };
}

async function askPodcast(payload = {}) {
  const question = String(payload.question || "").trim();
  if (!question) {
    throw createError("EMPTY_QUESTION", "请输入想向这期采访提出的问题。");
  }
  const segments = requireTranscriptSegments(payload.segments);
  const transcript = prepareTranscriptForAi(segments);
  const videoTitle = String(payload.video?.title || "");
  const normalizedQuestion = question.replace(/[*_#`]/gu, " ").replace(/\s+/gu, " ").trim();
  const webResults = selectPreferredResearchEvidence(deduplicateSearchResults(
    (await Promise.all([
      searchWeb(normalizedQuestion.slice(0, 100), 10).catch(() => []),
      searchWeb(
        `${normalizedQuestion.slice(0, 80)} 权威资料 简介 主要作品`,
        10
      ).catch(() => [])
    ])).flat().filter(isUsableResearchEvidence),
    16
  ), 12);
  const result = await callAiJson({
    schemaName: "podcast_answer",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        directAnswer: { type: "string" },
        contextExplanation: { type: "string" },
        citations: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              from: { type: "number" },
              label: { type: "string" },
              quote: { type: "string" }
            },
            required: ["from", "label", "quote"]
          }
        },
        sources: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              url: { type: "string" }
            },
            required: ["title", "url"]
          }
        }
      },
      required: ["directAnswer", "contextExplanation", "citations", "sources"]
    },
    instructions:
      "你是访谈陪看研究助手。directAnswer 只回答用户问题本身，不能以‘在访谈中’‘某某提到’开头，也不能复述当前谈话；contextExplanation 才用于说明这个问题与当前访谈的关系。对于‘某人是谁、主要作品是什么’这类问题，directAnswer 直接说明其身份、重要性与3至6项公认代表作，contextExplanation 再用一两句话解释这里为什么提到此人。对于电影、书籍、人物、历史事件或专业概念，可以使用联网搜索候选补充背景。只采用搜索候选明确支持的事实，优先百科、本人或机构页面、权威媒体；不要引用内容农场式推荐清单来支撑人物身份和作品。搜索结果不足或冲突时明确说明不确定性。两部分合计控制在160至420字，不使用模板化标题。citations 只引用逐字稿，最多2个最相关时间点；sources 最多4个，只能逐字复制联网候选 URL，不得生成链接。",
    input: JSON.stringify({
      videoTitle,
      question,
      playbackTimeWhenAsked: Number(payload.currentTime) || 0,
      nearbyTranscript: selectTranscriptAroundTime(
        transcript,
        Number(payload.currentTime) || 0,
        8
      ),
      transcript,
      webResults
    }),
    temperature: 0.2,
    maxTokens: 4200
  });
  const allowedUrls = new Set(webResults.map((item) => item.url));
  const transcriptTimes = transcript.map((segment) => Number(segment.from))
    .filter((time) => Number.isFinite(time));
  result.citations = (Array.isArray(result.citations) ? result.citations : [])
    .map((citation) => ({
      ...citation,
      from: nearestTranscriptTime(citation.from, transcriptTimes)
    }))
    .filter((citation) => citation.from >= 0)
    .slice(0, 2);
  const seenSources = new Set();
  result.sources = (Array.isArray(result.sources) ? result.sources : [])
    .filter((source) =>
      source?.url &&
      allowedUrls.has(source.url) &&
      !seenSources.has(source.url) &&
      seenSources.add(source.url)
    )
    .slice(0, 4);
  result.answer = [
    String(result.directAnswer || "").trim(),
    String(result.contextExplanation || "").trim()
  ].filter(Boolean).join("\n\n");
  return { ok: true, answer: result };
}

function rankResearchEvidence(results) {
  return [...results].sort(
    (a, b) => researchSourceScore(b) - researchSourceScore(a)
  );
}

function selectPreferredResearchEvidence(results, limit = 12) {
  const ranked = rankResearchEvidence(results);
  const preferred = ranked.filter((result) => researchSourceScore(result) >= 5);
  const selection = preferred.length >= Math.min(4, limit)
    ? preferred
    : ranked.filter((result) => researchSourceScore(result) >= 1);
  return selection.slice(0, limit);
}

function researchSourceScore(result) {
  try {
    const host = new URL(result.url).hostname.toLocaleLowerCase();
    if (host.endsWith(".gov.cn") || /\.(?:gov|edu|ac)\.cn$/u.test(host)) return 10;
    if (/(?:wikipedia\.org|wikidata\.org|britannica\.com)$/u.test(host)) return 9;
    if (/(?:imdb\.com|oscars\.org|criterion\.com|bfi\.org\.uk|loc\.gov)$/u.test(host)) return 8;
    if (/(?:people\.com\.cn|xinhuanet\.com|cctv\.com|chinanews\.com|thepaper\.cn|caixin\.com|bjnews\.com\.cn|infzm\.com|gmw\.cn|cnr\.cn)$/u.test(host)) return 8;
    if (/(?:bbc\.com|reuters\.com|apnews\.com|nytimes\.com|theguardian\.com|ft\.com|economist\.com)$/u.test(host)) return 8;
    if (/(?:douban\.com|mtime\.com|baike\.baidu\.com|bilibili\.com|youtube\.com|ximalaya\.com)$/u.test(host)) return 5;
    if (/(?:sohu\.com|163\.com|qq\.com|sina\.com\.cn)$/u.test(host)) return 3;
    if (/(?:toutiao\.com|360kuai\.com|hao123\.com|baijiahao\.baidu\.com)$/u.test(host)) return -3;
    return 1;
  } catch {
    return -5;
  }
}

function isUsableResearchEvidence(result) {
  try {
    const host = new URL(result.url).hostname.toLocaleLowerCase();
    if (researchSourceScore(result) < 0) return false;
    const title = String(result.title || "");
    if (/(?:好电影推荐|必看电影|十部经典|十大经典|演员列表|盘点\d*)/u.test(title)) {
      return false;
    }
    return Boolean(title.trim() && String(result.content || "").trim());
  } catch {
    return false;
  }
}

function selectTranscriptAroundTime(transcript, seconds, radius) {
  if (!transcript.length) return [];
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  transcript.forEach((segment, index) => {
    const distance = Math.abs((Number(segment.from) || 0) - seconds);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return transcript.slice(
    Math.max(0, nearestIndex - radius),
    Math.min(transcript.length, nearestIndex + radius + 1)
  );
}

async function askPageContext(payload = {}, sourceTab = null) {
  const question = String(payload.question || "").trim();
  if (!question) {
    throw createError("EMPTY_QUESTION", "请输入此刻想了解的问题。");
  }
  const tab = sourceTab?.id && SUPPORTED_VIDEO_URL.test(sourceTab.url || "")
    ? sourceTab
    : await getActiveBilibiliTab();
  let { lastTranscript } = await chrome.storage.session.get("lastTranscript");
  if (!lastTranscript?.video || lastTranscript.tabId !== tab.id) {
    const pageInfo = parseVideoPage(tab.url);
    const loaded = await fetchBilibiliTranscript(pageInfo, tab.title);
    lastTranscript = {
      tabId: tab.id,
      video: loaded.video,
      track: loaded.track,
      segments: loaded.segments,
      loadedAt: Date.now()
    };
    await chrome.storage.session.set({ lastTranscript });
  }
  const response = await askPodcast({
    video: lastTranscript.video,
    question,
    currentTime: Math.max(0, Number(payload.seconds) || 0),
    segments: lastTranscript.segments
  });
  const key = `timelineNotes:${getVideoCacheKey(lastTranscript.video)}`;
  const stored = await chrome.storage.local.get(key);
  const notes = Array.isArray(stored[key]) ? stored[key] : [];
  const note = {
    id: crypto.randomUUID(),
    type: "qa",
    time: Math.max(0, Number(payload.seconds) || 0),
    question,
    answer: response.answer.answer,
    citations: response.answer.citations || [],
    sources: response.answer.sources || [],
    createdAt: Date.now()
  };
  notes.push(note);
  await chrome.storage.local.set({ [key]: notes });
  chrome.runtime.sendMessage({ type: "PAGE_NOTE_SAVED", note }).catch(() => {});
  return { ok: true, answer: response.answer, note };
}

function requireTranscriptSegments(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw createError("NO_SEGMENTS", "没有可分析的智能稿本段落。");
  }
  return value;
}

function prepareTranscriptForAi(segments, maxCharacters = 220000) {
  const normalized = segments.map(toAiSegment);
  const totalCharacters = normalized.reduce(
    (sum, segment) => sum + String(segment.text || "").length + 60,
    0
  );
  if (totalCharacters <= maxCharacters) {
    return normalized;
  }

  const stride = Math.max(2, Math.ceil(totalCharacters / maxCharacters));
  const sampled = normalized.filter((_, index) => index % stride === 0);
  const last = normalized[normalized.length - 1];
  if (sampled[sampled.length - 1]?.id !== last.id) {
    sampled.push(last);
  }
  return sampled;
}

function prepareTranscriptForHighlights(segments, maxCharacters = 90000) {
  const normalized = segments.map(toAiSegment);
  const characterCost = (segment) =>
    String(segment.text || "").length + 60;
  const totalCharacters = normalized.reduce(
    (sum, segment) => sum + characterCost(segment),
    0
  );
  if (totalCharacters <= maxCharacters) return normalized;

  const selectedIndexes = new Set();
  const coverageStride = Math.max(1, Math.ceil(normalized.length / 80));
  for (let index = 0; index < normalized.length; index += coverageStride) {
    selectedIndexes.add(index);
  }
  selectedIndexes.add(normalized.length - 1);

  const signalPattern =
    /(?:但是|然而|后来|没想到|第一次|最后|真正|最重要|问题是|代价|后悔|失败|成功|害怕|愤怒|崩溃|决定|选择|改变|为什么|意味着|本质|其实|原来|直到)/gu;
  const ranked = normalized.map((segment, index) => {
    const text = String(segment.text || "");
    const signalCount = text.match(signalPattern)?.length || 0;
    const punctuationCount = text.match(/[！？“”]/gu)?.length || 0;
    return {
      index,
      score:
        Math.min(text.length, 800) +
        signalCount * 90 +
        punctuationCount * 24
    };
  }).sort((a, b) => b.score - a.score);

  let usedCharacters = [...selectedIndexes].reduce(
    (sum, index) => sum + characterCost(normalized[index]),
    0
  );
  for (const candidate of ranked) {
    if (usedCharacters >= maxCharacters) break;
    for (const index of [candidate.index - 1, candidate.index, candidate.index + 1]) {
      if (
        index < 0 ||
        index >= normalized.length ||
        selectedIndexes.has(index)
      ) {
        continue;
      }
      const nextCost = characterCost(normalized[index]);
      if (usedCharacters + nextCost > maxCharacters) continue;
      selectedIndexes.add(index);
      usedCharacters += nextCost;
    }
  }

  return [...selectedIndexes]
    .sort((a, b) => a - b)
    .map((index) => normalized[index]);
}

function toAiSegment(segment) {
  return {
    id: segment.id,
    from: segment.from,
    to: segment.to,
    text: segment.text,
    speaker: segment.speaker || undefined
  };
}

async function callAiJson({
  schemaName,
  schema,
  instructions,
  input,
  temperature,
  maxTokens = AI_CONFIG.defaultMaxTokens,
  validateResult
}) {
  const systemPrompt =
    `${instructions}\n你必须只返回一个符合以下 JSON Schema 的 JSON 对象。` +
    `不要道歉，不要解释任务，不要输出 Markdown：\n${JSON.stringify(schema)}`;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input }
  ];
  let payload = await requestAiProxyCompletion({
    messages,
    temperature,
    maxTokens,
    enforceJson: true,
    feature: schemaName
  });
  let outputText = extractChatCompletionText(payload);

  if (!outputText) {
    throw createError(
      "AI_PROXY_EMPTY_OUTPUT",
      "云端 AI 没有返回可用文本。",
      { responseId: payload.id }
    );
  }

  let parsed = tryParseModelJson(outputText);
  let validationIssues = parsed.ok
    ? normalizeValidationIssues(validateResult, parsed.value)
    : ["回复不是有效 JSON"];
  if (parsed.ok && validationIssues.length === 0) {
    return parsed.value;
  }

  payload = await requestAiProxyCompletion({
    messages: [
      ...messages,
      { role: "assistant", content: outputText },
      {
        role: "user",
        content:
          `上一条回复不符合要求：${validationIssues.join("；")}。` +
          "请重新完成原任务，补齐所有必需内容，只输出 JSON 对象；不要复述、解释或道歉。"
      }
    ],
    temperature: 0,
    maxTokens,
    enforceJson: true,
    feature: schemaName
  });
  outputText = extractChatCompletionText(payload);
  parsed = tryParseModelJson(outputText);
  validationIssues = parsed.ok
    ? normalizeValidationIssues(validateResult, parsed.value)
    : ["回复不是有效 JSON"];
  if (parsed.ok && validationIssues.length === 0) {
    return parsed.value;
  }

  const outputPreview = safeOutputPreview(outputText);
  throw createError(
    parsed.ok ? "AI_PROXY_INCOMPLETE_RESULT" : "AI_PROXY_INVALID_JSON",
    `云端 AI 连续两次没有返回完整结果：${validationIssues.join("；")}。` +
      (outputPreview ? ` 模型回复：${outputPreview}` : ""),
    {
      responseId: payload.id,
      model: "proxy-default",
      outputPreview
    }
  );
}

function normalizeValidationIssues(validateResult, value) {
  if (typeof validateResult !== "function") return [];
  try {
    const result = validateResult(value);
    if (result === true || result == null) return [];
    if (result === false) return ["结果未通过完整性校验"];
    return (Array.isArray(result) ? result : [result])
      .map((issue) => String(issue || "").trim())
      .filter(Boolean);
  } catch {
    return ["结果完整性校验失败"];
  }
}

async function requestAiProxyCompletion({
  messages,
  temperature,
  maxTokens,
  enforceJson,
  feature
}) {
  let result = await sendAiProxyRequest({
    messages,
    temperature,
    maxTokens,
    enforceJson,
    feature
  });

  if (!result.response.ok && enforceJson && result.response.status === 400) {
    result = await sendAiProxyRequest({
      messages,
      temperature,
      maxTokens,
      enforceJson: false,
      feature
    });
  }

  if (!result.response.ok) {
    throw createError(
      "AI_PROXY_API_ERROR",
      result.payload?.error?.message ||
        `AI API 代理请求失败（HTTP ${result.response.status}）。`,
      {
        status: result.response.status,
        type: result.payload?.error?.type,
        code: result.payload?.error?.code,
        model: "proxy-default"
      }
    );
  }

  return result.payload;
}

async function sendAiProxyRequest({
  messages,
  temperature,
  maxTokens,
  enforceJson,
  feature
}) {
  let response;
  try {
    response = await proxyFetch(AI_CONFIG.proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages,
        temperature,
        max_tokens: maxTokens,
        thinking: { type: "disabled" },
        ...(enforceJson
          ? { response_format: { type: "json_object" } }
          : {})
      })
    }, feature);
  } catch (error) {
    throw createError(
      "AI_PROXY_NETWORK_ERROR",
      `无法连接 AI API 代理（${AI_CONFIG.proxyUrl}）：${error.message || "Failed to fetch"}`
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw createError(
      "AI_PROXY_INVALID_RESPONSE",
      `AI API 代理返回了无法解析的响应（HTTP ${response.status}）。`
    );
  }

  return { response, payload };
}

async function proxyFetch(url, options = {}, feature = "unknown", retry = true) {
  const consent = await chrome.storage.local.get("aiDataConsent");
  if (
    consent.aiDataConsent?.granted !== true ||
    consent.aiDataConsent?.version !== 1
  ) {
    throw createError(
      "AI_CONSENT_REQUIRED",
      "请先打开播客智能阅读助手，在“AI 能力”中阅读数据说明并授权云端 AI。"
    );
  }
  const session = await getProxySession();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${session.token}`);
  headers.set("X-Installation-ID", session.installationId);
  headers.set("X-AI-Feature", feature);
  headers.set("X-Request-ID", crypto.randomUUID());
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && retry) {
    await chrome.storage.local.remove(PROXY_SESSION_KEY);
    return proxyFetch(url, options, feature, false);
  }
  return response;
}

async function getProxySession() {
  const stored = await chrome.storage.local.get([
    PROXY_INSTALLATION_KEY,
    PROXY_SESSION_KEY
  ]);
  let installationId = String(stored[PROXY_INSTALLATION_KEY] || "");
  if (!/^[a-zA-Z0-9_-]{16,80}$/u.test(installationId)) {
    installationId = crypto.randomUUID().replace(/-/gu, "");
    await chrome.storage.local.set({
      [PROXY_INSTALLATION_KEY]: installationId
    });
  }
  const cached = stored[PROXY_SESSION_KEY];
  if (
    cached?.token &&
    cached.installationId === installationId &&
    Number(cached.expiresAt) > Date.now() + 60_000
  ) {
    return cached;
  }

  const registerUrl = new URL("/v1/register", AI_CONFIG.proxyUrl).href;
  const response = await fetch(registerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-ID": crypto.randomUUID()
    },
    body: JSON.stringify({ installationId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) {
    throw createError(
      "AI_PROXY_SESSION_ERROR",
      payload?.error?.message ||
        `无法建立 AI 服务会话（HTTP ${response.status}）。`
    );
  }
  const session = {
    installationId,
    token: payload.token,
    expiresAt: Date.now() + Math.max(300, Number(payload.expiresIn) || 3600) * 1000
  };
  await chrome.storage.local.set({ [PROXY_SESSION_KEY]: session });
  return session;
}

function extractChatCompletionText(payload) {
  return payload?.choices?.[0]?.message?.content || "";
}

function stripJsonFence(text) {
  return String(text)
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .trim();
}

function tryParseModelJson(text) {
  const normalized = stripJsonFence(text);
  const candidates = [normalized];
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(normalized.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // Try the next candidate before requesting a repair.
    }
  }

  return { ok: false };
}

function safeOutputPreview(text) {
  return String(text || "")
    .replace(/sk-[a-zA-Z0-9_-]+/gu, "[REDACTED_KEY]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 180);
}

async function seekActiveVideo(seconds) {
  if (!Number.isFinite(Number(seconds)) || Number(seconds) < 0) {
    throw createError("INVALID_TIMESTAMP", "时间戳无效。");
  }

  const tab = await getActiveBilibiliTab();
  const response = await sendMessageToVideoTab(tab.id, {
    type: "SEEK_VIDEO",
    seconds: Number(seconds)
  });

  if (!response?.ok) {
    throw createError(
      response?.error?.code || "SEEK_FAILED",
      response?.error?.message || "无法控制当前播放器。"
    );
  }

  return {
    ok: true,
    seconds: response.seconds
  };
}

async function getPlaybackState() {
  const tab = await getActiveBilibiliTab();
  const response = await sendMessageToVideoTab(tab.id, {
    type: "GET_PLAYBACK_STATE"
  });
  if (!response?.ok) {
    throw createError(
      response?.error?.code || "VIDEO_NOT_FOUND",
      response?.error?.message || "无法读取播放器时间。"
    );
  }
  return response;
}

async function sendMessageToVideoTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const text = String(error?.message || error);
    const receiverMissing =
      text.includes("Receiving end does not exist") ||
      text.includes("Could not establish connection");
    if (!receiverMissing) throw error;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (injectionError) {
      throw createError(
        "PLAYER_BRIDGE_UNAVAILABLE",
        `播放器连接脚本无法启动：${injectionError.message || injectionError}`
      );
    }
  }
}

async function savePageNote(payload = {}, sourceTab = null) {
  const seconds = Math.max(0, Number(payload.seconds) || 0);
  const text = String(payload.text || "").trim().slice(0, 1000);
  if (!text) {
    throw createError("EMPTY_NOTE", "笔记内容不能为空。");
  }

  const tab = sourceTab?.id && SUPPORTED_VIDEO_URL.test(sourceTab.url || "")
    ? sourceTab
    : await getActiveBilibiliTab();
  const { lastTranscript } = await chrome.storage.session.get("lastTranscript");
  if (!lastTranscript?.video || lastTranscript.tabId !== tab.id) {
    throw createError("TRANSCRIPT_NOT_READY", "请先在侧栏中加载当前视频的智能稿本。");
  }

  const key = `timelineNotes:${getVideoCacheKey(lastTranscript.video)}`;
  const stored = await chrome.storage.local.get(key);
  const notes = Array.isArray(stored[key]) ? stored[key] : [];
  const note = {
    id: crypto.randomUUID(),
    type: "note",
    time: seconds,
    text,
    createdAt: Date.now()
  };
  notes.push(note);
  await chrome.storage.local.set({ [key]: notes });
  chrome.runtime.sendMessage({ type: "PAGE_NOTE_SAVED", note }).catch(() => {});
  return { ok: true, note };
}

async function getActiveBilibiliTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id || !tab.url) {
    throw createError(
      "ACTIVE_TAB_NOT_FOUND",
      "没有找到当前活动页面。"
    );
  }

  if (!SUPPORTED_VIDEO_URL.test(tab.url)) {
    throw createError(
      "UNSUPPORTED_PAGE",
      "请先打开一个普通的 Bilibili 视频页面。"
    );
  }

  return tab;
}

function parseVideoPage(urlString) {
  const url = new URL(urlString);
  const match = url.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);

  if (!match) {
    throw createError(
      "BVID_NOT_FOUND",
      "无法从当前地址识别 BV 号。"
    );
  }

  const requestedPage = Number.parseInt(url.searchParams.get("p") || "1", 10);

  return {
    bvid: match[1],
    pageNumber:
      Number.isInteger(requestedPage) && requestedPage > 0
        ? requestedPage
        : 1
  };
}

async function fetchBilibiliTranscript(pageInfo, tabTitle = "") {
  const diagnostics = {
    requestContext: "extension-service-worker",
    completedStages: [],
    playerEndpointAttempts: []
  };

  try {
    const requestJson = async (url, stage, label) => {
      let response;
      try {
        response = await fetch(url, {
          method: "GET",
          credentials: "include",
          cache: "no-store"
        });
      } catch (error) {
        throw {
          code: "NETWORK_ERROR",
          message: `${label}无法发起请求：${error.message || "Failed to fetch"}`,
          details: {
            stage,
            url: String(url),
            requestContext: diagnostics.requestContext,
            cause: error.name || "TypeError"
          }
        };
      }

      diagnostics.completedStages.push(`${stage}:response`);

      if (!response.ok) {
        throw {
          code: "HTTP_ERROR",
          message: `${label}请求失败（HTTP ${response.status}）。`,
          details: {
            stage,
            url: String(url),
            status: response.status,
            statusText: response.statusText
          }
        };
      }

      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw {
          code: "INVALID_JSON",
          message: `${label}没有返回有效 JSON。`,
          details: {
            stage,
            url: String(url),
            cause: error.message || String(error)
          }
        };
      }

      diagnostics.completedStages.push(`${stage}:json`);

      if (payload?.code !== undefined && payload.code !== 0) {
        throw {
          code: "BILIBILI_API_ERROR",
          message: `${label}返回错误：${payload.message || payload.code}`,
          details: {
            stage,
            apiCode: payload.code,
            apiMessage: payload.message,
            url: String(url)
          }
        };
      }

      return payload;
    };

    const viewUrl = new URL(
      "https://api.bilibili.com/x/web-interface/view"
    );
    viewUrl.searchParams.set("bvid", pageInfo.bvid);

    const viewPayload = await requestJson(
      viewUrl,
      "video-metadata",
      "视频信息接口"
    );
    const videoData = viewPayload.data;
    const pages = Array.isArray(videoData?.pages) ? videoData.pages : [];
    const selectedPage =
      pages.find((page) => page.page === pageInfo.pageNumber) || pages[0];

    if (!selectedPage?.cid) {
      throw {
        code: "CID_NOT_FOUND",
        message: "没有找到当前分 P 对应的 CID。",
        details: {
          stage: "select-cid",
          requestedPage: pageInfo.pageNumber,
          pageCount: pages.length
        }
      };
    }

    diagnostics.completedStages.push("select-cid");

    const playerEndpoints = [
      "https://api.bilibili.com/x/player/wbi/v2",
      "https://api.bilibili.com/x/player/v2"
    ];
    let playerPayload = null;
    let lastPlayerError = null;

    for (const endpoint of playerEndpoints) {
      const playerUrl = new URL(endpoint);
      playerUrl.searchParams.set("bvid", pageInfo.bvid);
      playerUrl.searchParams.set("cid", String(selectedPage.cid));

      try {
        playerPayload = await requestJson(
          playerUrl,
          "player-subtitles",
          "播放器字幕接口"
        );
        diagnostics.playerEndpointAttempts.push({
          endpoint,
          ok: true
        });
        break;
      } catch (error) {
        lastPlayerError = error;
        diagnostics.playerEndpointAttempts.push({
          endpoint,
          ok: false,
          code: error.code || "UNKNOWN_ERROR",
          message: error.message || String(error)
        });
      }
    }

    if (!playerPayload) {
      throw {
        ...(lastPlayerError || {
          code: "PLAYER_API_FAILED",
          message: "播放器字幕接口不可用。"
        }),
        details: {
          ...(lastPlayerError?.details || {}),
          attempts: diagnostics.playerEndpointAttempts
        }
      };
    }

    const playerData = playerPayload.data || {};
    const tracks = Array.isArray(playerData.subtitle?.subtitles)
      ? playerData.subtitle.subtitles
      : [];

    if (playerData.need_login_subtitle === true && !playerData.login_mid) {
      throw {
        code: "LOGIN_REQUIRED",
        message:
          "字幕接口没有识别到 Bilibili 登录态。请确认登录发生在当前 Edge 配置文件中，刷新视频页后重试。",
        details: {
          stage: "check-login",
          needLoginSubtitle: true,
          loginMid: playerData.login_mid || 0,
          requestContext: diagnostics.requestContext
        }
      };
    }

    diagnostics.completedStages.push("check-login");

    const track =
      tracks.find((item) => item.lan === "ai-zh") ||
      tracks.find(
        (item) =>
          String(item.lan_doc || "").includes("中文") &&
          String(item.lan_doc || "").toLowerCase().includes("ai")
      ) ||
      tracks.find((item) => String(item.lan || "").startsWith("zh")) ||
      null;

    if (!track?.subtitle_url) {
      throw {
        code: "AI_SUBTITLE_NOT_FOUND",
        message:
          "尚未检测到中文 AI 字幕。请在播放器中选择“字幕 → 中文 AI”，确认字幕已经显示，再点击重新检测。",
        details: {
          stage: "select-subtitle-track",
          loggedIn: Boolean(playerData.login_mid),
          needLoginSubtitle:
            playerData.need_login_subtitle === true,
          availableTracks: tracks.map((item) => ({
            lan: item.lan,
            lanDoc: item.lan_doc,
            hasUrl: Boolean(item.subtitle_url)
          }))
        }
      };
    }

    diagnostics.completedStages.push("select-subtitle-track");

    const subtitleUrl = track.subtitle_url.startsWith("//")
      ? `https:${track.subtitle_url}`
      : track.subtitle_url;
    const subtitlePayload = await requestJson(
      subtitleUrl,
      "subtitle-file",
      "字幕文件"
    );
    const body = Array.isArray(subtitlePayload.body)
      ? subtitlePayload.body
      : [];

    const segments = body
      .map((item, index) => ({
        id: index,
        from: Number(item.from),
        to: Number(item.to),
        text: String(item.content || "").trim()
      }))
      .filter(
        (item) =>
          Number.isFinite(item.from) &&
          Number.isFinite(item.to) &&
          item.to >= item.from &&
          item.text
      );

    if (!segments.length) {
      throw {
        code: "EMPTY_SUBTITLE",
        message: "字幕文件已下载，但其中没有可用文本。",
        details: {
          stage: "parse-subtitle-file",
          subtitleUrl
        }
      };
    }

    diagnostics.completedStages.push("parse-subtitle-file");

    return {
      ok: true,
      video: {
        aid: videoData.aid,
        bvid: pageInfo.bvid,
        cid: selectedPage.cid,
        page: selectedPage.page,
        pageCount: pages.length,
        part: selectedPage.part || "",
        title: videoData.title || tabTitle,
        description: videoData.desc || "",
        publishedAt: videoData.pubdate || 0,
        duration: selectedPage.duration || videoData.duration || 0,
        cover: normalizeBilibiliMediaUrl(videoData.pic),
        publisher: videoData.owner?.name || "",
        publisherAvatar: normalizeBilibiliMediaUrl(videoData.owner?.face)
      },
      track: {
        id: track.id,
        lan: track.lan,
        label: track.lan_doc || track.lan || "中文字幕",
        subtitleUrl
      },
      segments,
      diagnostics: {
        ...diagnostics,
        loggedIn: Boolean(playerData.login_mid),
        loginMid: playerData.login_mid || 0,
        needLoginSubtitle:
          playerData.need_login_subtitle === true,
        availableTrackCount: tracks.length,
        extractedSegmentCount: segments.length
      }
    };
  } catch (error) {
    throw createError(
      error?.code || "TRANSCRIPT_REQUEST_FAILED",
      error?.message || String(error),
      {
        ...(error?.details || {}),
        completedStages: diagnostics.completedStages,
        playerEndpointAttempts:
          diagnostics.playerEndpointAttempts,
        requestContext: diagnostics.requestContext
      }
    );
  }
}

function normalizeBilibiliMediaUrl(value) {
  try {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    const hostname = url.hostname.toLocaleLowerCase();
    const trustedBilibiliMedia = [
      "hdslb.com",
      "biliimg.com",
      "bilivideo.com"
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (!trustedBilibiliMedia) return url.protocol === "https:" ? url.href : "";
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function createError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function toFailure(error) {
  return {
    ok: false,
    error: {
      code: error?.code || "UNKNOWN_ERROR",
      message: error?.message || String(error),
      details: error?.details || null
    }
  };
}
