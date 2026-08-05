importScripts("person-utils.js", "content-utils.js", "stream-utils.js");

const SUPPORTED_VIDEO_URL = /^https:\/\/www\.bilibili\.com\/video\/BV[a-zA-Z0-9]+/;
const AI_CONFIG = Object.freeze({
  // Production builds should replace this with the deployed HTTPS proxy URL.
  // The proxy keeps provider API keys on the server; never put a key here.
  proxyUrl: "http://127.0.0.1:8787/v1/chat/completions",
  defaultMaxTokens: 4096
});
const PROXY_INSTALLATION_KEY = "proxyInstallationId";
const PROXY_SESSION_KEY = "proxyAnonymousSession";
const WEB_SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const pendingWebSearches = new Map();

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
      key.startsWith("contentValueRadarV4:") ||
      key.startsWith("contentValueRadarV5:") ||
      key.startsWith("contentValueRadarV6:") ||
      key.startsWith("contentValueRadarV7:") ||
      key.startsWith("contentMap:") ||
      key.startsWith("contentMapV2:") ||
      key.startsWith("contentMapV3:") ||
      key.startsWith("contentMapV4:") ||
      key.startsWith("contentMapV5:") ||
      key.startsWith("contentMapV6:") ||
      key.startsWith("contentMapV7:") ||
      key.startsWith("remix:") ||
      key.startsWith("remixV2:") ||
      key.startsWith("remixV3:") ||
      key.startsWith("remixV4:") ||
      key.startsWith("followupV2:") ||
      key.startsWith("followupV3:") ||
      key.startsWith("followupV4:")
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

  if (message?.type === "CORRECT_OVERVIEW") {
    correctOverview(message.payload)
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

  if (message?.type === "SET_CORRECTED_TRANSCRIPT") {
    setCorrectedTranscript(message.payload)
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

async function setCorrectedTranscript(payload = {}) {
  const segments = requireTranscriptSegments(payload.segments);
  const { lastTranscript } = await chrome.storage.session.get("lastTranscript");
  if (
    !lastTranscript?.video ||
    getVideoCacheKey(lastTranscript.video) !== getVideoCacheKey(payload.video)
  ) {
    throw createError(
      "TRANSCRIPT_NOT_READY",
      "当前视频稿本尚未准备完成，请重新加载后再修正。"
    );
  }
  await chrome.storage.session.set({
    lastTranscript: {
      ...lastTranscript,
      segments: segments.map(toAiSegment),
      correctedAt: Date.now()
    }
  });
  return { ok: true };
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
    temperature: 0.3,
    maxTokens: 900
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
  const transcript = prepareTranscriptForAi(segments, 80000);
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
      "你是资深播客编辑与人物叙事研究者。请把完整访谈重组为内容地图，并严格区分三种信息结构。第一，chapters 是节目时间线：按 from 递增，边界只能取自原声文稿已有时间戳，建议6至12章；每章 title 是8至18字的主题题目，insight 是35至70字的一句话提炼，必须说清该章最重要的判断或矛盾，不能只是内容预告；content 是120至240字的主要内容，用一段完整自然的中文说明论证过程、经验和结论，不分点、不编号、不使用项目符号。第二，lifeTrajectories 只能包含 interviewees 中的被采访者，绝对不能为主持人、采访者或其他被提及人物生成轨迹；即使访谈谈到采访者的人生，也必须忽略。人生轨迹不按节目顺序，而按童年、求学、入行、转型、低谷、突破、当下等生命阶段或有可靠证据的年份排序；每位主要被采访者最多生成一条轨迹，在信息充分时给出4至8个事件，personName 必须逐字复制 interviewees 中对应姓名，overview 用一句话概括其人生轨迹，turningPoint 只标记真正改变后续方向的节点。事件若在访谈中明确出现，mentionedAt 使用对应原声文稿时间戳；仅由搜索材料支持时填-1。不得编造年份、经历或因果关系，年份不确定时使用‘职业早期’‘转型阶段’等阶段词；period 绝不能返回单独的‘年’‘月’‘日’‘时期’或‘阶段’，资料不足时 events 返回空数组。第三，thoughtFragments 是从具体人物和事件中抽离出的5至8条思想碎片：每条 statement 必须是脱离上下文仍成立、具有解释力的完整观点或陈述，35至80字，尽量包含条件、张力、因果或方法，不得以任何人名、‘他、她、我、他们、嘉宾、主持人’等人物或代词作主语，不得写成‘某某认为’‘某某提到’，也不能只是漂亮但空泛的鸡汤；优先使用‘真正的…’‘当…时…’‘一种选择的代价是…’等能够独立传播的观点结构。lens 用2至6字标记观察角度，如成长、选择、创作、职业、关系、方法论或社会观察。oneLiner 用一句话说明本期最值得看的原因；summary 用150至300字概括主线。必须区分采访者与被采访者：interviewers 只列提问或主持采访的人，interviewees 只列主要回答问题的人。视频标题和 publisher 中的人名采用原字，严禁写成同音字；当字幕与标题冲突时以标题为准。人物简介可以参考搜索结果但不得猜测；sourceLinks 的 URL 必须逐字使用搜索候选中的 URL。不要输出 Markdown 星号。",
    input: JSON.stringify({
      videoTitle,
      publisher: payload.video?.publisher || "",
      transcript,
      webResults
    }),
    temperature: 0.2,
    maxTokens: 4800,
    validateResult: contentMapValidationIssues
  });
  const allowedUrls = new Set(webResults.map((item) => item.url));
  canonicalizePeopleFromVideo(result, payload.video);
  await correctPeopleNamesFromTitle(result, payload.video);
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
  const [enriched] = await Promise.all([
    enrichPeople(result, payload.video, transcript, webResults).catch(() => null),
    enrichMissingLifePeriods(result, webResults).catch(() => {})
  ]);
  if (enriched) {
    result.interviewers = enriched.interviewers;
    result.interviewees = enriched.interviewees;
  }
  return { ok: true, overview: result };
}

async function identifyInterviewPeople(payload = {}) {
  const segments = requireTranscriptSegments(payload.segments);
  const transcript = prepareTranscriptForAi(segments, 26000);
  const video = payload.video || {};
  const webResults = await searchWeb(
    `${String(video.title || "").slice(0, 52)} ${video.publisher || ""} 主持人 嘉宾`,
    10
  ).catch(() => []);
  const result = await callAiJson({
    schemaName: "interview_people_identification",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        interviewers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              role: { type: "string" }
            },
            required: ["name", "role"]
          }
        },
        interviewees: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              role: { type: "string" }
            },
            required: ["name", "role"]
          }
        }
      },
      required: ["interviewers", "interviewees"]
    },
    instructions:
      "你是采访角色识别编辑。仅识别当前视频中实际参与对话的人：interviewers 是主要负责提问、主持或引导话题的人；interviewees 是主要回答、讲述经历或表达观点的嘉宾。只返回人名，不得把节目名、视频标题、主题、机构、组合名或‘主持人、嘉宾’等角色词当成人名。多人访谈必须完整列出每一位主要被采访者，不能只返回第一位。姓名优先逐字采用视频标题和发布者中的写法；字幕与标题发生同音字冲突时以标题为准。不要把被谈到但没有参与本期对话的人列入。role 只写简短的本期角色，如‘采访者’‘被采访者’。",
    input: JSON.stringify({
      videoTitle: video.title || "",
      publisher: video.publisher || "",
      description: String(video.description || "").slice(0, 1600),
      transcript,
      webResults: webResults.slice(0, 10)
    }),
    temperature: 0,
    maxTokens: 1200,
    validateResult: (value) => {
      const people = Array.isArray(value?.interviewees) ? value.interviewees : [];
      return people.some((person) => ContentUtils.isPlausiblePersonName(person?.name))
        ? []
        : ["没有识别到有效的被采访者姓名"];
    }
  });
  const interviewerNames = new Set();
  const toProfiles = (people, fallbackRole) => (Array.isArray(people) ? people : [])
    .filter((person) => ContentUtils.isPlausiblePersonName(person?.name))
    .map((person) => {
      const name = String(person.name).replace(/\s+/gu, "").trim();
      const evidence = webResults.filter((item) =>
        PersonUtils.countEvidenceSupport([item], name) === 1
      ).slice(0, 2);
      return {
        name,
        role: String(person.role || fallbackRole).slice(0, 24),
        bio: "",
        knownFor: "",
        sourceLinks: evidence.map((item) => ({ title: item.title, url: item.url }))
      };
    });
  const interviewers = toProfiles(result.interviewers, "采访者")
    .filter((person) => {
      if (interviewerNames.has(person.name)) return false;
      interviewerNames.add(person.name);
      return true;
    });
  const interviewerSet = new Set(interviewers.map((person) => person.name));
  const seenInterviewees = new Set();
  const interviewees = toProfiles(result.interviewees, "被采访者")
    .filter((person) => {
      if (interviewerSet.has(person.name) || seenInterviewees.has(person.name)) return false;
      seenInterviewees.add(person.name);
      return true;
    });
  if (!interviewees.length) {
    throw createError(
      "INTERVIEW_PEOPLE_NOT_IDENTIFIED",
      "暂时无法从标题和智能稿本中可靠识别被采访者，请稍后重试。"
    );
  }
  return { interviewers, interviewees };
}

async function correctOverview(payload = {}) {
  const feedback = String(payload.feedback || "").replace(/\s+/gu, " ").trim();
  if (feedback.length < 4 || feedback.length > 1000) {
    throw createError(
      "INVALID_CORRECTION_FEEDBACK",
      "请用 4 至 1000 个字符说明需要核实的问题。"
    );
  }
  const currentOverview = payload.overview;
  const currentIssues = contentMapValidationIssues(currentOverview);
  if (currentIssues.length) {
    throw createError(
      "INVALID_CURRENT_OVERVIEW",
      `当前内容地图不完整：${currentIssues.join("；")}。`
    );
  }
  const segments = requireTranscriptSegments(payload.segments);
  const transcript = prepareTranscriptForAi(segments, 60000);
  const video = payload.video || {};
  const webResults = await searchWeb(
    `${String(video.title || "").slice(0, 42)} ${feedback.slice(0, 24)} 核实`,
    15
  ).catch(() => []);
  const decision = await callAiJson({
    schemaName: "content_map_correction",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        issueConfirmed: { type: "boolean" },
        explanation: { type: "string" },
        correctedOverview: { type: "object" }
      },
      required: ["issueConfirmed", "explanation", "correctedOverview"]
    },
    instructions:
      "你是内容地图的事实纠错编辑。用户反馈只是待核实线索，不能无条件采纳。先结合视频标题、发布者、原声文稿、现有内容地图和搜索证据判断反馈是否成立。姓名冲突时优先采用视频标题中的原字，但只有当至少两条不同搜索结果也明确支持该姓名时才可改字。人物身份必须确认其确实是本期采访者或被采访者，并确认外部简介属于当前视频中的同一人。人物资料优先采用百度百科；不要使用 Wikidata 或维基百科。若反馈不成立，issueConfirmed=false，correctedOverview 原样返回。若成立，只修正有证据支持的问题，其他字段保持不变，并返回完整 correctedOverview。sourceLinks 只能使用现有内容地图或搜索候选中真实存在的 URL，不得编造。不要把推测写成事实。",
    input: JSON.stringify({
      feedback,
      video: {
        title: video.title || "",
        publisher: video.publisher || "",
        description: video.description || ""
      },
      transcript,
      currentOverview,
      webResults
    }),
    temperature: 0,
    maxTokens: 5600
  });
  if (decision.issueConfirmed !== true) {
    return {
      ok: true,
      corrected: false,
      explanation: decision.explanation || "未找到足够证据支持这项修改。"
    };
  }

  const corrected = decision.correctedOverview;
  canonicalizePeopleFromVideo(corrected, video);
  await correctPeopleNamesFromTitle(corrected, video);
  sanitizeUnsupportedContentMapYears(corrected, [
    video.title || "",
    video.description || "",
    ...transcript.map((segment) => segment.text || ""),
    ...webResults.flatMap((item) => [item.title || "", item.content || ""])
  ].join(" "));
  normalizeContentMapResult(corrected, transcript);
  const correctedIssues = contentMapValidationIssues(corrected);
  if (correctedIssues.length) {
    throw createError(
      "AI_CORRECTION_INCOMPLETE",
      `AI 核实了问题，但修正结果不完整：${correctedIssues.join("；")}。`
    );
  }
  const [enriched] = await Promise.all([
    enrichPeople(corrected, video, transcript, webResults).catch(() => null),
    enrichMissingLifePeriods(corrected, webResults).catch(() => {})
  ]);
  if (enriched) {
    corrected.interviewers = enriched.interviewers;
    corrected.interviewees = enriched.interviewees;
  }
  return {
    ok: true,
    corrected: true,
    explanation: decision.explanation || "问题已核实并修正。",
    overview: corrected
  };
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
              topics: { type: "array", items: { type: "string" } },
              bgmSuggestions: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    artist: { type: "string" },
                    reason: { type: "string" }
                  },
                  required: ["title", "artist", "reason"]
                }
              }
            },
            required: [
              "from", "to", "type", "title", "quote", "scores", "valuePortrait",
              "whyRecommended", "signals", "scenarios",
              "topics", "bgmSuggestions"
            ]
          }
        }
      },
      required: ["intro", "clips"]
    },
    instructions:
      "你是长内容价值分析师，不是单纯的短视频剪辑助手。请从完整原声文稿中识别8至10个彼此不重复、最值得观看、理解或二次利用的关键内容节点。type 必须且只能是情绪共鸣、认知突破、金句传播、故事高潮、争议观点之一。每个区间应包含必要背景、观点展开和自然收尾，通常30至180秒；from 和 to 必须取自逐字稿已有时间边界。五项 scores 均为0至100：emotionalIntensity评估情绪浓度，depthOfThought评估思考深度，storyTension评估故事冲突、转折与叙事张力，practicalInspiration评估能否转化为行动或方法启发，spreadPotential评估传播与讨论潜力。valuePortrait 用一句自然中文概括该片段的内容人格，例如‘这是一个高情绪、高故事、高共鸣的转折片段，更适合需要心理支持与人生经验的观众’，不要复述分数。whyRecommended 用一段话说明推荐逻辑；signals 从观点转折、个人经历、情绪变化、普适价值、具体案例、冲突张力、表达凝练等信号中选择2至5项。scenarios 只保留短视频传播、深度文章两种场景，fit只能为高、中、低，并分别给出推荐标题和简短适配建议，不要出现任何平台名称。topics 和 bgmSuggestions 仅服务于短视频场景。每个片段必须推荐三首彼此不同、真实存在且可在抖音搜索的歌曲。title 必须填写歌曲正式名称，artist 必须填写准确歌手或音乐人；reason 只说明歌曲的情绪、节奏和内容气质为什么适合当前片段，不要给出任何切入时间、播放位置、使用步骤或‘高潮处播放’之类的建议。优先选择辨识度较高、适合作为短视频背景音乐且容易按歌名与歌手检索的歌曲，但不要声称歌曲当前热门，不得编造歌名或歌手。quote 必须是文稿原句。不得为了制造爆点夸大、歪曲或拼接人物原意。intro 应概括本期内容价值分布，而不是宣传口号。",
    input: JSON.stringify({
      videoTitle: payload.video?.title || "",
      duration: Number(payload.video?.duration) || null,
      transcript
    }),
    temperature: 0.3,
    maxTokens: 6500,
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
      topics: (Array.isArray(raw.topics) ? raw.topics : [])
        .map((topic) => String(topic || "").replace(/^#+/u, "").trim())
        .filter(Boolean).slice(0, 6),
      bgmSuggestions: (Array.isArray(raw.bgmSuggestions)
        ? raw.bgmSuggestions
        : []).map((bgm) => ({
        title: String(bgm?.title || "").trim(),
        artist: String(bgm?.artist || "").trim(),
        reason: String(bgm?.reason || "").trim()
      })).filter((bgm) => bgm.title && bgm.artist).slice(0, 3)
    });
  }
  clips.sort((a, b) => b.valueScore - a.valueScore || a.from - b.from);
  return {
    version: 6,
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
    String(clip?.whyRecommended || "").trim().length >= 12 &&
    Array.isArray(clip?.bgmSuggestions) &&
    clip.bgmSuggestions.filter((bgm) =>
      String(bgm?.title || "").trim() &&
      String(bgm?.artist || "").trim() &&
      String(bgm?.reason || "").trim() &&
      !containsBgmUsageInstruction(bgm.reason)
    ).length === 3
  );
  if (validClips.length < 6) {
    issues.push(`有效高光区间不足 6 个（当前 ${validClips.length} 个）`);
  }
  return issues;
}

function containsBgmUsageInstruction(reason) {
  return /(?:切入|进入时机|播放位置|开始播放|高潮处|在.{0,18}(?:时|处|后)(?:开始)?播放)/u.test(
    String(reason || "")
  );
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

async function correctPeopleNamesFromTitle(overview, video = {}) {
  const title = String(video.title || "").trim();
  if (!title) return;
  const groups = [
    ...(Array.isArray(overview.interviewers) ? overview.interviewers : []),
    ...(Array.isArray(overview.interviewees) ? overview.interviewees : [])
  ];
  await Promise.all(groups.map(async (person) => {
    const originalName = PersonUtils.normalizeName(person?.name);
    const candidate = PersonUtils.findNearNameInTitle(originalName, title);
    if (!candidate) return;
    const results = await searchWeb(
      `"${candidate}" ${title.slice(0, 42)}`,
      10
    ).catch(() => []);
    if (PersonUtils.countEvidenceSupport(results, candidate) < 2) return;
    person.name = candidate;
    for (const trajectory of Array.isArray(overview.lifeTrajectories)
      ? overview.lifeTrajectories
      : []) {
      if (PersonUtils.normalizeName(trajectory?.personName) === originalName) {
        trajectory.personName = candidate;
      }
    }
  }));
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

async function enrichPeople(
  overview,
  video = {},
  transcript = [],
  existingEvidence = []
) {
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

  const videoContext = String(video.title || "").slice(0, 54);
  const evidenceGroups = await Promise.all(people.map(async (person) => {
    const queries = [
      {
        query: person.name,
        count: 6,
        domain: "baike.baidu.com"
      },
      {
        query: videoContext
          ? `"${person.name}" ${videoContext}`
          : `"${person.name}" 内容创作者 职业经历`,
        count: 8
      }
    ];
    const batches = await Promise.all(
      queries.map(({ query, count, domain }) =>
        searchWeb(query, count, { domain }).catch(() => [])
      )
    );
    return {
      name: person.name,
      results: rankPersonEvidence(deduplicateSearchResults([
        ...existingEvidence.filter((item) =>
          PersonUtils.countEvidenceSupport([item], person.name) === 1
        ),
        ...batches.flat()
      ], 12))
    };
  }));
  const candidates = deduplicateSearchResults(
    evidenceGroups.flatMap((group) => group.results),
    40
  );
  if (!candidates.length) {
    return attachBaiduLinks({ interviewers, interviewees }, evidenceGroups);
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
      "你是严格的采访人物身份复核与事实核查编辑。先逐一判断输入人物是否确实是当前视频中的采访者或被采访者，并判断候选外部资料是否属于同一个人，再输出通过核实的人物资料；只被谈到但没有参与本期对话的人必须删除，姓名相同但职业、作品或经历与视频语境冲突的候选必须排除，证据不足时保留人物但清空不确定的外部简介。不得互换采访者和被采访者。人物外部资料优先采用百度百科，不使用 Wikidata 或维基百科。只写搜索候选明确支持的稳定事实，其次采用本人、政府、机构官网和权威媒体等一手或权威来源。人物简介仅包含职业身份、长期经历与代表性作品；禁止写近期节目阵容、热搜或未经可靠来源支持的娱乐履历。奖项、职务、纪录、数字和时间必须有直接证据；来源冲突且无法消除时删除该事实，绝不凭模型记忆补全。sourceLinks 只能原样复制实际用于核实内容的候选 URL。不要输出 Markdown 星号。宁可少写也不要猜测。",
    input: JSON.stringify({
      currentDate: new Date().toISOString().slice(0, 10),
      video: {
        title: video.title || "",
        publisher: video.publisher || "",
        description: video.description || ""
      },
      interviewers,
      interviewees,
      transcriptContext: prepareTranscriptForAi(transcript, 16000),
      evidenceGroups
    }),
    temperature: 0,
    maxTokens: 2800
    });
  } catch {
    return {
      interviewers: interviewers.map((person) =>
        validateHighRiskFacts(
          buildSearchFallbackProfile(person, evidenceGroups),
          candidates
        )
      ),
      interviewees: interviewees.map((person) =>
        validateHighRiskFacts(
          buildSearchFallbackProfile(person, evidenceGroups),
          candidates
        )
      )
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
  return attachBaiduLinks({
    interviewers: verifiedInterviewers,
    interviewees: verifiedInterviewees
  }, evidenceGroups);
}

function attachBaiduLinks(peopleGroups, evidenceGroups) {
  const attach = (people) => (Array.isArray(people) ? people : []).map((person) => {
    const existingLinks = Array.isArray(person.sourceLinks)
      ? person.sourceLinks
      : [];
    if (existingLinks.some((link) => {
      try {
        const host = new URL(link.url).hostname.toLowerCase();
        return host === "baike.baidu.com" || host.endsWith(".baike.baidu.com");
      } catch {
        return false;
      }
    })) {
      return person;
    }
    const baiduCandidate = evidenceGroups
      .find((group) => group.name === person.name)
      ?.results.find((item) => {
        try {
          const host = new URL(item.url).hostname.toLowerCase();
          return (
            (host === "baike.baidu.com" || host.endsWith(".baike.baidu.com")) &&
            PersonUtils.countEvidenceSupport([item], person.name) === 1
          );
        } catch {
          return false;
        }
      });
    const source = baiduCandidate
      ? { title: `百度百科：${person.name}`, url: baiduCandidate.url }
      : {
          title: `在百度百科中核实：${person.name}`,
          url: `https://baike.baidu.com/search?word=${encodeURIComponent(person.name)}`
        };
    return { ...person, sourceLinks: [...existingLinks, source] };
  });
  return {
    interviewers: attach(peopleGroups.interviewers),
    interviewees: attach(peopleGroups.interviewees)
  };
}

function rankPersonEvidence(results) {
  const authorityScore = (value) => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (host === "baike.baidu.com" || host.endsWith(".baike.baidu.com")) return 7;
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
  const normalizedTrajectories = (Array.isArray(overview.lifeTrajectories)
    ? overview.lifeTrajectories
    : []).map((trajectory) => {
    const rawName = String(trajectory?.personName || "").replace(/\s+/gu, "").trim();
    const matchedName = intervieweeNames.find((name) =>
      name === rawName || name.includes(rawName) || rawName.includes(name));
    if (!matchedName) return null;
    return {
      ...trajectory,
      personName: matchedName,
      events: (Array.isArray(trajectory?.events) ? trajectory.events : [])
        .filter((event) => event?.title && event?.description)
        .map((event) => ({
          ...event,
          period: normalizeLifePeriod(event.period),
          mentionedAt: nearestTranscriptTime(event.mentionedAt, existingTimes)
        }))
        .slice(0, 8)
    };
  }).filter(Boolean);
  const trajectoryByPerson = new Map();
  for (const trajectory of normalizedTrajectories) {
    const existing = trajectoryByPerson.get(trajectory.personName);
    if (!existing || trajectory.events.length > existing.events.length) {
      trajectoryByPerson.set(trajectory.personName, trajectory);
    }
  }
  overview.lifeTrajectories = [...trajectoryByPerson.values()];
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
    /^(?:年|月|日|年代|时期|阶段|时间|未知|不详|未明|待定|阶段未明|时间不详)$/u.test(period)
  ) {
    return "";
  }
  return period;
}

async function enrichMissingLifePeriods(overview, existingEvidence = []) {
  const pendingByPerson = new Map();
  for (const trajectory of Array.isArray(overview?.lifeTrajectories)
    ? overview.lifeTrajectories
    : []) {
    const personName = String(trajectory?.personName || "").trim();
    for (const event of Array.isArray(trajectory?.events) ? trajectory.events : []) {
      if (normalizeLifePeriod(event?.period)) continue;
      if (!personName || !event?.title) continue;
      if (!pendingByPerson.has(personName)) pendingByPerson.set(personName, []);
      pendingByPerson.get(personName).push(event);
    }
  }

  for (const [personName, events] of [...pendingByPerson.entries()].slice(0, 2)) {
    const unresolved = events.filter((event) => {
      const eventTerm = lifeEventSearchTerm(event);
      const supported = findSupportedLifePeriod(
        existingEvidence,
        personName,
        eventTerm
      );
      if (supported) event.period = supported;
      return !supported;
    });
    if (!unresolved.length) continue;

    const terms = unresolved.slice(0, 4).map(lifeEventSearchTerm).filter(Boolean);
    const query = [`"${personName}"`, ...terms.map((term) => `"${term}"`), "年份"]
      .join(" ")
      .slice(0, 100);
    const searchedEvidence = (await searchWeb(query, 12).catch(() => []))
      .filter(isUsableResearchEvidence);
    for (const event of unresolved) {
      const supported = findSupportedLifePeriod(
        searchedEvidence,
        personName,
        lifeEventSearchTerm(event)
      );
      if (supported) event.period = supported;
    }
  }
}

function lifeEventSearchTerm(event) {
  const title = String(event?.title || "").trim();
  return title.match(/《([^》]{2,30})》/u)?.[1] || title.slice(0, 24);
}

function findSupportedLifePeriod(results, personName, eventTerm) {
  const currentYear = new Date().getFullYear() + 1;
  const normalizedPerson = normalizeComparableTitle(personName);
  const normalizedEvent = normalizeComparableTitle(eventTerm);
  const candidates = new Map();

  for (const result of results) {
    const text = `${result.title || ""}。${result.content || ""}`;
    const matches = text.matchAll(
      /((?:19|20)\d{2})年(?:\s*(\d{1,2})月)?/gu
    );
    for (const match of matches) {
      const year = Number(match[1]);
      if (year < 1900 || year > currentYear) continue;
      const index = Number(match.index) || 0;
      const context = normalizeComparableTitle(
        text.slice(Math.max(0, index - 70), index + match[0].length + 70)
      );
      const personHit = normalizedPerson && context.includes(normalizedPerson);
      const eventHit = normalizedEvent && context.includes(normalizedEvent);
      if (!personHit && !eventHit) continue;
      const period = match[2] ? `${year}年${Number(match[2])}月` : `${year}年`;
      const evidenceWeight = Math.max(1, researchSourceScore(result));
      const contextWeight = (personHit ? 2 : 0) + (eventHit ? 4 : 0);
      const current = candidates.get(period) || {
        score: 0,
        sources: new Set(),
        maxAuthority: 0
      };
      current.score += evidenceWeight + contextWeight;
      current.sources.add(result.url);
      current.maxAuthority = Math.max(current.maxAuthority, evidenceWeight);
      candidates.set(period, current);
    }
  }

  const [bestPeriod, support] = [...candidates.entries()]
    .sort((a, b) => b[1].score - a[1].score)[0] || [];
  if (!support) return "";
  const authoritative = support.maxAuthority >= 5 && support.score >= 7;
  const corroborated = support.sources.size >= 2 && support.score >= 10;
  return authoritative || corroborated ? bestPeriod : "";
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
      role: String(person.role || "").replace(/\*\*/gu, "").trim(),
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
  let overview = payload.overview || {};
  let identifiedPeople = null;
  let names = ContentUtils.normalizeGuestNames(Array.isArray(overview.interviewees)
    ? overview.interviewees.map((person) => person.name)
    : [])
    .map(cleanFollowupSearchTerm)
    .filter((name) => name.length >= 2);
  if (!names.length) {
    identifiedPeople = await identifyInterviewPeople(payload);
    overview = { ...overview, ...identifiedPeople };
    names = ContentUtils.normalizeGuestNames(
      identifiedPeople.interviewees.map((person) => person.name)
    );
  }
  const topics = collectFollowupTopics(overview);
  const title = String(payload.video?.title || "").slice(0, 48);
  const subjects = names;
  const candidateGroups = (await Promise.all(subjects.map((guestName) =>
    collectFollowupCandidatesForGuest({
      guestName,
      topics,
      title,
      video: payload.video,
      profile: (Array.isArray(overview.interviewees)
        ? overview.interviewees
        : []).find((person) =>
          cleanFollowupSearchTerm(person?.name) === guestName
        )
    })
  ))).map((group, index) =>
    ensureFollowupCategoryCoverage(group, subjects[index])
  );
  const missingGuests = subjects.filter((_name, index) => !candidateGroups[index].length);
  if (missingGuests.length) {
    throw createError(
      "FOLLOWUP_GUEST_RESULTS_MISSING",
      `暂未检索到${missingGuests.join("、")}的可靠延伸资料，请稍后重试。`
    );
  }
  const categoryGaps = subjects.map((name, index) => {
    const group = candidateGroups[index];
    const hasVideo = group.some((item) =>
      item.inferredType === "podcast" || item.inferredType === "video"
    );
    const hasArticle = group.some((item) => item.inferredType === "article");
    return {
      name,
      missing: [!hasVideo ? "视频" : "", !hasArticle ? "文章" : ""].filter(Boolean)
    };
  }).filter((item) => item.missing.length);
  if (categoryGaps.length) {
    throw createError(
      "FOLLOWUP_GUEST_CATEGORY_MISSING",
      `延伸资料仍不完整：${categoryGaps.map((item) =>
        `${item.name}缺少${item.missing.join("和")}`
      ).join("；")}。请稍后重试。`
    );
  }
  const candidates = candidateGroups.flat();
  if (!candidates.length) {
    throw createError(
      "FOLLOWUP_NO_CONCRETE_RESULTS",
      "没有检索到与本期人物或主题直接相关的具体视频和文章，请稍后重试。"
    );
  }

  const fallbackItems = candidates.map(followupItemFromCandidate);
  const aiCandidates = candidates.filter((item) => !item.searchFallback);
  if (!aiCandidates.length) {
    return {
      ok: true,
      followup: buildCandidateFollowup(candidates, subjects, topics),
      ...(identifiedPeople ? { people: identifiedPeople } : {})
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
              guestName: { type: "string", enum: subjects },
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
            required: [
              "guestName", "title", "url", "type", "source", "why", "publishDate"
            ]
          }
        }
      },
      required: ["intro", "topics", "items"]
    },
    instructions:
      `你是播客研究编辑。候选资料已按被采访者标注 guestName。必须为${subjects.join("、")}每人分别挑选3至6条最能帮助用户继续理解该人物及本期主题的资料，而且每人至少包含1条 podcast 或 video 以及1条 article；不能只返回第一位嘉宾，不能把甲的资料归到乙名下。内容只分三类：podcast 是相关的视频播客、长访谈或对谈节目；video 是其他相关视频；article 是深度文章、人物资料或机构页面。优先选择本人或机构官方页面、政府与高校网站、公共知识库、权威媒体、知名出版物和主流视频平台，排除内容农场、采集站、标题党与信息来源不明的页面。绝对不要推荐本期原视频，也不要输出“原视频仅作占位”之类的项目。why 要具体说明资料与对应嘉宾及本期的连接。guestName 和 URL 必须逐字复制候选值，绝不能编造链接或改变归属。`,
    input: JSON.stringify({
      videoTitle: title,
      interviewees: subjects,
      keyTopics: topics,
      candidates: aiCandidates
    }),
    temperature: 0.2,
    maxTokens: 4200
    });
  } catch {
    return {
      ok: true,
      followup: buildCandidateFollowup(candidates, subjects, topics),
      ...(identifiedPeople ? { people: identifiedPeople } : {})
    };
  }
  const allowedPairs = new Set(aiCandidates.map((item) =>
    `${item.guestName}\n${item.url}`
  ));
  const selectedItems = (Array.isArray(result.items) ? result.items : [])
    .filter((item) => allowedPairs.has(`${item.guestName}\n${item.url}`))
    .map((item) => ({
      ...item,
      type: ["podcast", "video", "article"].includes(item.type)
        ? item.type
        : inferFollowupType(item)
    }))
    .filter((item) =>
      item?.url &&
      !isSearchLandingPage(item.url) &&
      !isCurrentVideoResult(item, payload.video)
    );
  result.items = ContentUtils.balanceFollowupGuestItems(
    selectedItems,
    fallbackItems,
    subjects,
    4
  ).sort((a, b) => {
    const guestDifference = subjects.indexOf(a.guestName) - subjects.indexOf(b.guestName);
    return guestDifference || followupTypeRank(a.type) - followupTypeRank(b.type);
  });
  if (!result.items.length) {
    throw createError(
      "FOLLOWUP_NO_VERIFIED_RESULTS",
      "没有得到可验证的具体资料链接，结果未保存。"
    );
  }
  result.intro = String(result.intro ||
    `已分别整理${subjects.join("、")}的延伸资料。`);
  if (candidates.some((item) => item.searchFallback)) {
    result.intro += " 部分分类暂未找到足够可靠的具体链接，已提供对应平台的搜索入口。";
  }
  result.topics = deduplicateStrings([
    ...subjects,
    ...(Array.isArray(result.topics) ? result.topics : []),
    ...topics
  ]).slice(0, 8);
  return {
    ok: true,
    followup: result,
    ...(identifiedPeople ? { people: identifiedPeople } : {})
  };
}

async function collectFollowupCandidatesForGuest({
  guestName,
  topics,
  title,
  video,
  profile = {}
}) {
  const biliQueries = deduplicateStrings([
    `${guestName} 访谈`,
    `${guestName} 对话 播客`
  ]).map((query) => query.slice(0, 48));
  const webQueries = deduplicateStrings([
    `${guestName} 深度访谈`,
    `${guestName} 人物专访`,
    topics[0] ? `${guestName} ${topics[0]}` : ""
  ]).filter(Boolean).map((query) => query.slice(0, 70));
  const [videoBatches, videoWebResults, webBatches, knowledgeResults] = await Promise.all([
    Promise.all(biliQueries.map((query) =>
      searchBilibiliVideos(query, 8).catch(() => [])
    )),
    searchWeb(`${guestName} 访谈 视频`, 10, { domain: "bilibili.com" })
      .catch(() => []),
    Promise.all(webQueries.map((query) => searchWeb(query, 10).catch(() => []))),
    searchWeb(`"${guestName}" 百度百科`, 8).catch(() => [])
  ]);
  const knowledge = knowledgeResults
    .filter((item) => {
      try {
        const host = new URL(item.url).hostname.toLowerCase();
        return host === "baike.baidu.com" || host.endsWith(".baike.baidu.com");
      } catch {
        return false;
      }
    })
    .map((item) => ({ ...item, media: "百度百科" }));
  const profileSources = (Array.isArray(profile?.sourceLinks)
    ? profile.sourceLinks
    : []).map((source) => ({
      title: String(source?.title || `${guestName}人物资料`),
      url: String(source?.url || ""),
      content: `${guestName} ${profile?.bio || ""} ${profile?.knownFor || ""}`.trim(),
      media: "人物资料",
      publishDate: ""
    }));
  const candidates = [];
  const seen = new Set();
  for (const item of [
    ...videoBatches.flat(),
    ...videoWebResults,
    ...webBatches.flat().filter(isUsableResearchEvidence),
    ...knowledge,
    ...profileSources
  ]) {
    const relevanceScore = followupRelevanceScore(item, [guestName], topics, title);
    if (
      !item.url ||
      seen.has(item.url) ||
      isCurrentVideoResult(item, video) ||
      isSearchLandingPage(item.url) ||
      relevanceScore < 1
    ) continue;
    seen.add(item.url);
    candidates.push({
      ...item,
      guestName,
      inferredType: inferFollowupType(item),
      relevanceScore
    });
  }
  candidates.sort((a, b) => followupCandidateScore(b) - followupCandidateScore(a));
  return candidates.slice(0, 18);
}

function ensureFollowupCategoryCoverage(candidates, guestName) {
  const output = Array.isArray(candidates) ? [...candidates] : [];
  const hasVideo = output.some((item) =>
    item.inferredType === "podcast" || item.inferredType === "video"
  );
  const hasArticle = output.some((item) => item.inferredType === "article");
  if (!hasVideo) {
    const query = `${guestName} 访谈`;
    output.push({
      guestName,
      title: `在 Bilibili 搜索“${query}”`,
      content: `暂未检索到${guestName}可验证的具体视频，点击查看 Bilibili 的实时搜索结果。`,
      url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(query)}`,
      media: "Bilibili 搜索",
      publishDate: "",
      inferredType: "video",
      relevanceScore: 1,
      searchFallback: true
    });
  }
  if (!hasArticle) {
    const query = `${guestName} 人物专访`;
    output.push({
      guestName,
      title: `在百度搜索“${query}”`,
      content: `暂未检索到${guestName}可验证的具体文章，点击查看百度的实时搜索结果。`,
      url: `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`,
      media: "百度搜索",
      publishDate: "",
      inferredType: "article",
      relevanceScore: 1,
      searchFallback: true
    });
  }
  return output;
}

function cleanFollowupSearchTerm(value) {
  return String(value || "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function collectFollowupTopics(overview = {}) {
  const lenses = (Array.isArray(overview.thoughtFragments)
    ? overview.thoughtFragments.map((fragment) => fragment?.lens)
    : []);
  const chapters = (Array.isArray(overview.chapters)
    ? overview.chapters.map((chapter) => chapter?.title)
    : []);
  return deduplicateStrings([...lenses, ...chapters]
    .map(cleanFollowupSearchTerm)
    .filter((term) => term.length >= 2 && term.length <= 18))
    .slice(0, 5);
}

function deduplicateStrings(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function followupRelevanceScore(item, names, topics, videoTitle) {
  const haystack = normalizeComparableTitle(
    `${item.title || ""} ${item.content || ""}`
  );
  const nameHits = names.filter((name) =>
    haystack.includes(normalizeComparableTitle(name))
  ).length;
  const topicHits = topics.filter((topic) =>
    haystack.includes(normalizeComparableTitle(topic))
  ).length;
  const titleTerms = cleanFollowupSearchTerm(videoTitle)
    .split(/[\s|｜：:，,。！？!?《》【】（）()—–-]+/u)
    .map(normalizeComparableTitle)
    .filter((term) => term.length >= 2 && term.length <= 12);
  const titleHits = titleTerms.filter((term) => haystack.includes(term)).length;
  return nameHits * 20 + topicHits * 5 + Math.min(3, titleHits);
}

function isSearchLandingPage(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLocaleLowerCase();
    return (
      /(?:^|\.)search\.bilibili\.com$/u.test(host) ||
      /(?:^|\.)bing\.com$/u.test(host) && url.pathname.startsWith("/search") ||
      /(?:^|\.)baidu\.com$/u.test(host) && url.pathname.startsWith("/s")
    );
  } catch {
    return true;
  }
}

function isCurrentVideoResult(item, video = {}) {
  return ContentUtils.shouldExcludeFollowupResult(item, video);
}

function normalizeComparableTitle(value) {
  return ContentUtils.normalizeComparableTitle(value);
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
  const fallbackItems = [...candidates]
    .sort((a, b) => followupCandidateScore(b) - followupCandidateScore(a))
    .map(followupItemFromCandidate);
  return {
    intro: `已分别整理${names.join("、")}的延伸资料。${
      candidates.some((item) => item.searchFallback)
        ? " 部分分类暂未找到足够可靠的具体链接，已提供对应平台的搜索入口。"
        : ""
    }`,
    topics: [...names, ...topics].filter(Boolean).slice(0, 8),
    items: ContentUtils.balanceFollowupGuestItems(
      [],
      fallbackItems,
      names,
      4
    ).sort((a, b) => {
      const guestDifference = names.indexOf(a.guestName) - names.indexOf(b.guestName);
      return guestDifference || followupTypeRank(a.type) - followupTypeRank(b.type);
    })
  };
}

function followupItemFromCandidate(item = {}) {
  return {
    guestName: item.guestName,
    title: item.title,
    url: item.url,
    type: item.inferredType || inferFollowupType(item),
    source: item.media || "网页",
    why: item.content?.slice(0, 140) || `与${item.guestName || "本期嘉宾"}相关。`,
    publishDate: item.publishDate || ""
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
  return (
    typeScore +
    Math.max(-5, researchSourceScore(item)) * 5 +
    Math.max(0, Number(item.relevanceScore) || 0) * 10
  );
}

async function searchWeb(query, count = 10, options = {}) {
  const normalizedQuery = String(query || "").replace(/\s+/gu, " ").trim().slice(0, 70);
  const normalizedCount = Math.min(20, Math.max(1, Number(count) || 10));
  const domain = String(options.domain || "").trim().toLowerCase();
  const cacheKey =
    `webSearchCache:v2:${simpleTextHash(`${normalizedQuery}:${domain}`)}:${normalizedCount}`;
  const cached = await chrome.storage.session.get(cacheKey).catch(() => ({}));
  const cachedEntry = cached[cacheKey];
  if (
    cachedEntry?.query === normalizedQuery &&
    cachedEntry?.domain === domain &&
    Date.now() - Number(cachedEntry.cachedAt) < WEB_SEARCH_CACHE_TTL_MS &&
    Array.isArray(cachedEntry.results)
  ) {
    return cachedEntry.results;
  }
  if (pendingWebSearches.has(cacheKey)) {
    return pendingWebSearches.get(cacheKey);
  }
  const pending = performWebSearch(normalizedQuery, normalizedCount, domain)
    .then(async (results) => {
      await chrome.storage.session.set({
        [cacheKey]: {
          query: normalizedQuery,
          domain,
          cachedAt: Date.now(),
          results
        }
      }).catch(() => {});
      return results;
    })
    .finally(() => pendingWebSearches.delete(cacheKey));
  pendingWebSearches.set(cacheKey, pending);
  return pending;
}

async function performWebSearch(query, count, domain = "") {
  const searchUrl = new URL("/v1/web-search", AI_CONFIG.proxyUrl).href;
  let response;
  try {
    response = await proxyFetch(searchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, count, ...(domain ? { domain } : {}) })
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
    .filter((item) => item.url && !isDisallowedKnowledgeSource(item.url));
}

function isDisallowedKnowledgeSource(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (
      host === "wikidata.org" ||
      host.endsWith(".wikidata.org") ||
      host === "wikipedia.org" ||
      host.endsWith(".wikipedia.org")
    );
  } catch {
    return true;
  }
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
  const transcript = prepareTranscriptForAi(segments, 90000);
  const allowedStyles = ["profile", "first_person", "insight_essay"];
  const requestedStyle = String(payload.style || "profile");
  const style = allowedStyles.includes(requestedStyle) ? requestedStyle : "profile";
  const length = String(payload.length || "medium");
  let people = payload.people || {};
  let interviewees = ContentUtils.normalizeGuestNames(people.interviewees);
  let identifiedPeople = null;
  if (!interviewees.length) {
    identifiedPeople = await identifyInterviewPeople(payload);
    people = {
      interviewers: identifiedPeople.interviewers.map((person) => person.name),
      interviewees: identifiedPeople.interviewees.map((person) => person.name)
    };
    interviewees = ContentUtils.normalizeGuestNames(people.interviewees);
  }
  const interviewers = (Array.isArray(people.interviewers)
    ? people.interviewers
    : []).map((name) => String(name || "").trim()).filter(Boolean);
  const requestedGuest = String(payload.selectedGuest || "")
    .replace(/\s+/gu, "")
    .trim();
  if (
    ContentUtils.PERSON_SPECIFIC_REMIX_STYLES.has(style) &&
    interviewees.length > 1 &&
    !interviewees.includes(requestedGuest)
  ) {
    if (identifiedPeople) {
      return {
        ok: true,
        selectionRequired: true,
        people: identifiedPeople
      };
    }
    throw createError("REMIX_GUEST_REQUIRED", "请选择要写作的嘉宾对象。");
  }
  const primaryGuest = interviewees.includes(requestedGuest)
    ? requestedGuest
    : interviewees[0] || "主要被采访者";
  const allGuestsLabel = interviewees.join("、") || "主要被采访者";
  const styleInstructions = {
    profile:
      `你正在单独创作“人物特写”，中心人物是${primaryGuest}。文章回答“这个人如何在一连串选择与代价中成为今天的自己”。必须全程采用第三人称非虚构叙事，作者可以观察和分析，但不能冒充嘉宾说“我”。开篇从访谈中真实出现的一个场景、动作、语气、矛盾或决定切入，不写概括式导语；随后以2至4次关键选择或转折构成叙事弧线，把经历、性格张力、行动方式和代价交织起来，不能按年份罗列履历，也不能把观点逐条复述。每节必须既有可感知的具体经历，也有克制的第三人称解释；直接引语只能来自稿本。结尾回到人物尚未解决的问题、仍在坚持的价值或下一步处境。禁止使用自传口吻，禁止写成观点议论文。`,
    first_person:
      `你正在单独创作“嘉宾第一人称自述”，叙述者只能是${primaryGuest}。文章回答“我如何回望自己的经历、选择与代价”。从标题、导语到正文都要像嘉宾本人完成的一篇自传性文章：主体叙述持续使用“我”，不得出现“嘉宾认为”“他/她表示”“作为被采访者”等外部记者口吻，也不得把主持人${interviewers.join("、") || "的"}的问题或经历写成“我”的人生。按记忆触发、关键选择、遭遇的阻力、付出的代价、今天的理解组织出清晰时间流动，保留嘉宾的语言个性与情绪，但删除重复、口头禅和问答痕迹。只能改写嘉宾在稿本中明确表达的事实、感受和判断，绝不能代写其未说过的内心活动、动机、场景或结论。结尾必须是“我”对当下处境或未来选择的自我回答。禁止第三人称人物评价，禁止写成媒体人物特写。`,
    insight_essay:
      `你正在单独创作“深度文章”。文章不是${allGuestsLabel}中任何一人的生平介绍，也不是其第一人称自传，而是从整场访谈中选择一个最有解释力、最值得展开的核心观点或认知冲突，回答“这个观点在什么条件下成立，它解释了什么，又忽略了什么”。开篇提出一个具体问题或反常识判断；随后建立清楚的中心论点，每一节承担不同的论证任务，综合使用${allGuestsLabel}在访谈中的经历、观点、差异、细节和后果作为证据，而不是只围绕第一位嘉宾或按时间讲完某个人生。至少分析一处矛盾、限制条件、反例或可能的反对意见，再把个人经验推向更普遍的职业、关系、创作或社会观察。作者使用分析性第三人称，不冒充嘉宾说“我”，也不对人物作传记式赞颂。结尾给出有边界的结论或值得继续追问的问题，禁止鸡汤式升华和空泛总结。`
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
        mode: { type: "string", enum: [style] },
        sections: {
          type: "array",
          minItems: 3,
          maxItems: 7,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              heading: { type: "string" },
              paragraphs: {
                type: "array",
                minItems: 2,
                maxItems: 5,
                items: { type: "string" }
              }
            },
            required: ["heading", "paragraphs"]
          }
        },
        disclaimer: { type: "string" }
      },
      required: ["title", "deck", "mode", "sections", "disclaimer"]
    },
    instructions:
      `${styleInstructions[style]}目标篇幅：${lengthTargets[length] || lengthTargets.medium}。这是一次完整文章创作，不是访谈摘要、提纲或问答整理。必须有明确开篇、持续推进的中段和有回响的结尾；相邻段落之间要有因果、时间、转折或论证关系，不能把互不相干的句子拼在一起。可以压缩、重排和转述，但不得编造事实、场景、引语或心理活动；直接引语只能来自稿本。sections 应有3至7节，每节 heading 使用12至28个汉字，写成信息充分、具有叙事或论证张力的小标题，不能只写“成长”“转折”“选择”等空泛短词；每节 paragraphs 是2至5个完整自然段，每段至少包含两句意义连贯的中文。不要在段落中使用 Markdown 标题、项目符号、编号、时间戳或说话人标签。各节之间必须形成清晰推进。输入中的 otherModeSamples 是同一访谈其他写作模式的样例，只用于提醒你避免照抄其标题、开篇句式和章节顺序；人物、事实和必要专有名词可以正常重合。mode 必须严格返回 ${style}。disclaimer 简短说明改写边界。`,
    input: JSON.stringify({
      taskMode: style,
      primaryGuest,
      selectedGuest: ContentUtils.PERSON_SPECIFIC_REMIX_STYLES.has(style)
        ? primaryGuest
        : "",
      interviewees,
      interviewers,
      videoTitle: payload.video?.title || "",
      transcript,
      otherModeSamples: (Array.isArray(payload.referenceRemixes)
        ? payload.referenceRemixes
        : []).slice(0, 2)
    }),
    temperature: 0.42,
    maxTokens: ({ short: 3200, medium: 5200, long: 7200 })[length] || 5200,
    validateResult: (value) => remixValidationIssues(
      value,
      style,
      length
    )
  });
  return {
    ok: true,
    remix: result,
    ...(identifiedPeople ? { people: identifiedPeople } : {})
  };
}

function remixValidationIssues(result, style, length) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return ["结果不是文章对象"];
  }
  const issues = [];
  if (result.mode !== style) issues.push(`叙事模式必须为 ${style}`);
  if (String(result.title || "").trim().length < 6) issues.push("文章标题过短");
  if (String(result.deck || "").trim().length < 25) issues.push("导语没有建立文章问题");
  const sections = Array.isArray(result.sections) ? result.sections : [];
  if (sections.length < 3) issues.push("文章结构不足三节");
  const headings = [];
  const paragraphs = [];
  for (const section of sections) {
    const heading = String(section?.heading || "").replace(/\s+/gu, "").trim();
    headings.push(heading);
    if (heading.length < 10) issues.push(`小标题“${heading || "空"}”过短`);
    const sectionParagraphs = Array.isArray(section?.paragraphs)
      ? section.paragraphs.map((paragraph) => String(paragraph || "").trim()).filter(Boolean)
      : [];
    if (sectionParagraphs.length < 2) {
      issues.push(`“${heading || "未命名小节"}”不足两个自然段`);
    }
    for (const paragraph of sectionParagraphs) {
      paragraphs.push(paragraph);
      if (paragraph.replace(/\s+/gu, "").length < 55) {
        issues.push(`“${heading || "未命名小节"}”存在过短段落`);
      }
      if (!/[。！？][^。！？]*[。！？]/u.test(paragraph)) {
        issues.push(`“${heading || "未命名小节"}”的段落不像完整文章段落`);
      }
    }
  }
  const body = paragraphs.join("\n");
  const compactLength = body.replace(/\s+/gu, "").length;
  const minimumLength = ({ short: 650, medium: 1200, long: 2000 })[length] || 1200;
  if (compactLength < minimumLength) {
    issues.push(`正文过短，至少需要约 ${minimumLength} 个汉字`);
  }

  const firstPersonOpenings = paragraphs.filter((paragraph) =>
    /^(?:“|「)?我/u.test(paragraph)
  ).length;
  const externalNarratorPhrases = (
    body.match(/(?:嘉宾认为|嘉宾表示|被采访者|他认为|她认为|他表示|她表示)/gu) || []
  ).length;
  if (style === "first_person") {
    const firstPersonMentions = (body.match(/我/gu) || []).length;
    if (firstPersonMentions < Math.max(6, paragraphs.length)) {
      issues.push("第一人称“我”的叙述密度不足，不像嘉宾自传");
    }
    if (externalNarratorPhrases > 1) {
      issues.push("混入了第三人称记者或嘉宾评价视角");
    }
  } else if (firstPersonOpenings > 1) {
    issues.push("第三人称文章混入了连续第一人称自述");
  }
  if (style === "insight_essay") {
    const reasoningMarkers = (
      body.match(/(?:因为|因此|但是|然而|意味着|关键在于|问题在于|如果|并非|反而|前提|代价)/gu) || []
    ).length;
    if (reasoningMarkers < 5) {
      issues.push("论证连接不足，仍像人物摘要而不是深度文章");
    }
  }

  return [...new Set(issues)].slice(0, 8);
}

async function askPodcast(payload = {}) {
  const question = String(payload.question || "").trim();
  if (!question) {
    throw createError("EMPTY_QUESTION", "请输入想向这期采访提出的问题。");
  }
  const segments = requireTranscriptSegments(payload.segments);
  const transcript = prepareTranscriptForAi(segments, 45000);
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
    maxTokens: 1800
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
    if (host === "baike.baidu.com" || host.endsWith(".baike.baidu.com")) return 9;
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
    return Boolean(
      title.trim() &&
      (String(result.content || "").trim() || researchSourceScore(result) >= 5)
    );
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

function prepareTranscriptForHighlights(segments, maxCharacters = 65000) {
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
  const streamReporter = createAiStreamReporter(schemaName);
  const systemPrompt =
    `${instructions}\n你必须只返回一个符合以下 JSON Schema 的纯 JSON 对象。` +
    "第一个非空字符必须是 {，最后一个非空字符必须是 }；" +
    "必须包含 required 中的全部字段，不得输出 additionalProperties 未声明的字段；" +
    "禁止 Markdown 代码块、注释、前后说明、尾随逗号和未转义的字符串换行：\n" +
    JSON.stringify(schema);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: input }
  ];
  let payload = await requestAiProxyCompletion({
    messages,
    temperature,
    maxTokens,
    enforceJson: true,
    feature: schemaName,
    onStream: streamReporter
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
      {
        role: "system",
        content:
          "你是 JSON 结果修复器。只根据校验问题修复候选结果，保留其中正确内容，" +
          `并返回符合此 JSON Schema 的完整对象：${JSON.stringify(schema)}`
      },
      {
        role: "user",
        content:
          `校验问题：${validationIssues.join("；")}\n` +
          `待修复结果：${outputText}\n` +
          "只输出修复后的 JSON 对象，不要解释或道歉。"
      }
    ],
    temperature: 0,
    maxTokens,
    enforceJson: true,
    feature: schemaName,
    onStream: streamReporter
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
  const previewMessage = !parsed.ok && outputPreview
    ? ` 模型回复：${outputPreview}`
    : "";
  throw createError(
    parsed.ok ? "AI_PROXY_INCOMPLETE_RESULT" : "AI_PROXY_INVALID_JSON",
    `云端 AI 连续两次没有返回完整结果：${validationIssues.join("；")}。` +
      previewMessage,
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
  feature,
  onStream
}) {
  const sendWithTransportFallback = async (jsonMode) => {
    try {
      return await sendAiProxyRequest({
        messages,
        temperature,
        maxTokens,
        enforceJson: jsonMode,
        feature,
        onStream,
        stream: true
      });
    } catch (error) {
      if (error?.code !== "AI_PROXY_INVALID_RESPONSE") throw error;
      onStream?.({ fallback: true, receivedCharacters: 0, done: false });
      return sendAiProxyRequest({
        messages,
        temperature,
        maxTokens,
        enforceJson: jsonMode,
        feature,
        onStream,
        stream: false
      });
    }
  };
  let result = await sendWithTransportFallback(enforceJson);

  if (!result.response.ok && enforceJson && result.response.status === 400) {
    result = await sendWithTransportFallback(false);
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
  feature,
  onStream,
  stream = true
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
        stream,
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
    payload = await readAiProxyPayload(response, onStream);
  } catch (error) {
    throw createError(
      "AI_PROXY_INVALID_RESPONSE",
      `AI API 代理返回了无法解析的响应（HTTP ${response.status}）。`,
      { cause: String(error?.message || error).slice(0, 160) }
    );
  }

  return { response, payload };
}

async function readAiProxyPayload(response, onStream) {
  const contentType = String(response.headers.get("content-type") || "");
  if (!contentType.includes("text/event-stream")) {
    const rawText = await response.text();
    if (!/^\s*(?:data:|:\s*keep-alive)/u.test(rawText)) {
      return JSON.parse(rawText);
    }
    return readAiSseText(rawText, onStream);
  }
  if (!response.body) {
    throw new Error("流式响应没有可读取的内容。");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let responseId = "";
  let model = "";
  let invalidBlocks = 0;
  const processBlock = (block) => {
    const event = StreamUtils.parseSseDataBlock(block);
    if (event.invalid) invalidBlocks += 1;
    if (event.id) responseId = event.id;
    if (event.model) model = event.model;
    if (!event.text) return;
    outputText += event.text;
    onStream?.({
      delta: event.text,
      text: outputText,
      receivedCharacters: outputText.length,
      done: false
    });
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/u);
      buffer = blocks.pop() || "";
      for (const block of blocks) processBlock(block);
      if (done) break;
    }
    if (buffer.trim()) processBlock(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!outputText.trim()) {
    throw new Error(
      invalidBlocks
        ? `SSE 包含 ${invalidBlocks} 个无法解析的数据块。`
        : "SSE 没有返回模型正文。"
    );
  }
  onStream?.({
    delta: "",
    text: outputText,
    receivedCharacters: outputText.length,
    done: true
  });
  return {
    id: responseId,
    model,
    choices: [{ message: { role: "assistant", content: outputText } }]
  };
}

function readAiSseText(rawText, onStream) {
  let outputText = "";
  let responseId = "";
  let model = "";
  let invalidBlocks = 0;
  for (const block of String(rawText || "").split(/\r?\n\r?\n/u)) {
    const event = StreamUtils.parseSseDataBlock(block);
    if (event.invalid) invalidBlocks += 1;
    if (event.id) responseId = event.id;
    if (event.model) model = event.model;
    if (!event.text) continue;
    outputText += event.text;
    onStream?.({
      delta: event.text,
      text: outputText,
      receivedCharacters: outputText.length,
      done: false
    });
  }
  if (!outputText.trim()) {
    throw new Error(
      invalidBlocks
        ? `SSE 包含 ${invalidBlocks} 个无法解析的数据块。`
        : "SSE 没有返回模型正文。"
    );
  }
  onStream?.({
    delta: "",
    text: outputText,
    receivedCharacters: outputText.length,
    done: true
  });
  return {
    id: responseId,
    model,
    choices: [{ message: { role: "assistant", content: outputText } }]
  };
}

function createAiStreamReporter(feature) {
  let lastReportedAt = 0;
  return (progress = {}) => {
    const now = Date.now();
    if (!progress.done && now - lastReportedAt < 120) return;
    lastReportedAt = now;
    const message = {
      type: "AI_STREAM_PROGRESS",
      feature,
      receivedCharacters: Number(progress.receivedCharacters) || 0,
      done: progress.done === true,
      fallback: progress.fallback === true
    };
    chrome.runtime.sendMessage(message).catch(() => {});
    if (feature === "podcast_answer") {
      chrome.tabs.query({ active: true, currentWindow: true })
        .then(([tab]) => tab?.id
          ? chrome.tabs.sendMessage(tab.id, message).catch(() => {})
          : undefined)
        .catch(() => {});
    }
  };
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
