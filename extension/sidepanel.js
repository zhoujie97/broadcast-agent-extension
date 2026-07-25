const elements = {
  pageSummary: document.querySelector("#page-summary"),
  reloadButton: document.querySelector("#reload-button"),
  status: document.querySelector("#status"),
  statusTitle: document.querySelector("#status-title"),
  statusMessage: document.querySelector("#status-message"),
  videoInfo: document.querySelector("#video-info"),
  videoTitle: document.querySelector("#video-title"),
  trackLabel: document.querySelector("#track-label"),
  segmentCount: document.querySelector("#segment-count"),
  currentTime: document.querySelector("#current-time"),
  workspaceTabs: document.querySelector("#workspace-tabs"),
  workspaceTabButtons: [...document.querySelectorAll(".workspace-tab")],
  workspacePanels: [...document.querySelectorAll(".workspace-panel")],
  toolbar: document.querySelector("#toolbar"),
  searchInput: document.querySelector("#search-input"),
  copyButton: document.querySelector("#copy-button"),
  backToTopButton: document.querySelector("#back-to-top-button"),
  aiSettings: document.querySelector("#ai-settings"),
  aiConfigState: document.querySelector("#ai-config-state"),
  aiStatus: document.querySelector("#ai-status"),
  aiConsentState: document.querySelector("#ai-consent-state"),
  reviewAiConsentButton: document.querySelector("#review-ai-consent-button"),
  revokeAiConsentButton: document.querySelector("#revoke-ai-consent-button"),
  clearVideoAiDataButton: document.querySelector("#clear-video-ai-data-button"),
  clearAllDataButton: document.querySelector("#clear-all-data-button"),
  aiConsentDialog: document.querySelector("#ai-consent-dialog"),
  closeAiConsentButton: document.querySelector("#close-ai-consent-button"),
  declineAiConsentButton: document.querySelector("#decline-ai-consent-button"),
  acceptAiConsentButton: document.querySelector("#accept-ai-consent-button"),
  generateOverviewButton: document.querySelector("#generate-overview-button"),
  overviewLoading: document.querySelector("#overview-loading"),
  overviewOutput: document.querySelector("#overview-output"),
  overviewOneLiner: document.querySelector("#overview-one-liner"),
  overviewSummary: document.querySelector("#overview-summary"),
  overviewCover: document.querySelector("#overview-cover"),
  overviewInterviewers: document.querySelector("#overview-interviewers"),
  overviewInterviewees: document.querySelector("#overview-interviewees"),
  overviewChapters: document.querySelector("#overview-chapters"),
  overviewLifePaths: document.querySelector("#overview-life-paths"),
  overviewThoughtFragments: document.querySelector("#overview-thought-fragments"),
  overviewError: document.querySelector("#overview-error"),
  generateClipsButton: document.querySelector("#generate-clips-button"),
  clipsLoading: document.querySelector("#clips-loading"),
  clipsOutput: document.querySelector("#clips-output"),
  clipsIntro: document.querySelector("#clips-intro"),
  clipsItems: document.querySelector("#clips-items"),
  clipsError: document.querySelector("#clips-error"),
  clipFilterButtons: [...document.querySelectorAll(".clip-filter")],
  remixStyle: document.querySelector("#remix-style"),
  remixLength: document.querySelector("#remix-length"),
  generateRemixButton: document.querySelector("#generate-remix-button"),
  remixLoading: document.querySelector("#remix-loading"),
  remixOutput: document.querySelector("#remix-output"),
  remixTitle: document.querySelector("#remix-title"),
  remixDeck: document.querySelector("#remix-deck"),
  remixBody: document.querySelector("#remix-body"),
  remixDisclaimer: document.querySelector("#remix-disclaimer"),
  remixError: document.querySelector("#remix-error"),
  copyRemixButton: document.querySelector("#copy-remix-button"),
  generateFollowupButton: document.querySelector("#generate-followup-button"),
  followupLoading: document.querySelector("#followup-loading"),
  followupOutput: document.querySelector("#followup-output"),
  followupIntro: document.querySelector("#followup-intro"),
  followupTopics: document.querySelector("#followup-topics"),
  followupItems: document.querySelector("#followup-items"),
  followupError: document.querySelector("#followup-error"),
  questionForm: document.querySelector("#question-form"),
  questionInput: document.querySelector("#question-input"),
  askButton: document.querySelector("#ask-button"),
  questionLoading: document.querySelector("#question-loading"),
  questionError: document.querySelector("#question-error"),
  addNoteButton: document.querySelector("#add-note-button"),
  noteCount: document.querySelector("#note-count"),
  notesEmpty: document.querySelector("#notes-empty"),
  notesList: document.querySelector("#notes-list"),
  noteDialog: document.querySelector("#note-dialog"),
  noteForm: document.querySelector("#note-form"),
  noteDialogTime: document.querySelector("#note-dialog-time"),
  noteInput: document.querySelector("#note-input"),
  closeNoteButton: document.querySelector("#close-note-button"),
  cancelNoteButton: document.querySelector("#cancel-note-button"),
  transcript: document.querySelector("#transcript"),
  segmentTemplate: document.querySelector("#segment-template"),
  insightDialog: document.querySelector("#insight-dialog"),
  insightKicker: document.querySelector("#insight-kicker"),
  insightExcerpt: document.querySelector("#insight-excerpt"),
  insightLoading: document.querySelector("#insight-loading"),
  insightContent: document.querySelector("#insight-content"),
  insightExplanation: document.querySelector("#insight-explanation"),
  insightError: document.querySelector("#insight-error"),
  insightErrorMessage: document.querySelector("#insight-error-message"),
  closeInsightButton: document.querySelector("#close-insight-button"),
  retryInsightButton: document.querySelector("#retry-insight-button")
};

let transcriptSegments = [];
let rawSubtitleSegments = [];
let renderedSegments = [];
let activeSegmentIndex = -1;
let currentPageTabId = null;
let currentVideo = null;
let aiAvailable = false;
let aiModelName = "云端模型";
let currentPlaybackSeconds = 0;
let notes = [];
let pendingNoteSeconds = 0;
let currentRemix = null;
let currentOverview = null;
let currentClipRadar = null;
let favoriteClipIds = new Set();
let activeClipFilter = "全部";
let previewRange = null;
let previewSeeking = false;
let activeInsightSelection = null;
let insightRequestId = 0;
let aiConsentResolver = null;
const AI_CONSENT_KEY = "aiDataConsent";
const AI_CONSENT_VERSION = 1;

elements.reloadButton.addEventListener("click", loadTranscript);
elements.searchInput.addEventListener("input", filterTranscript);
elements.copyButton.addEventListener("click", copyTranscript);
elements.backToTopButton.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});
window.addEventListener("scroll", updateBackToTopButton, { passive: true });
elements.addNoteButton.addEventListener("click", openNoteDialog);
elements.generateOverviewButton.addEventListener("click", generateOverview);
elements.generateClipsButton.addEventListener("click", generateClipCandidates);
for (const button of elements.clipFilterButtons) {
  button.addEventListener("click", () => setClipFilter(button.dataset.clipFilter));
}
elements.generateRemixButton.addEventListener("click", generateRemix);
elements.generateFollowupButton.addEventListener("click", generateFollowup);
elements.copyRemixButton.addEventListener("click", copyRemix);
elements.remixStyle.addEventListener("change", loadSelectedRemix);
elements.remixLength.addEventListener("change", loadSelectedRemix);
elements.questionForm.addEventListener("submit", askPodcast);
elements.noteForm.addEventListener("submit", saveManualNote);
elements.closeNoteButton.addEventListener("click", () => elements.noteDialog.close());
elements.cancelNoteButton.addEventListener("click", () => elements.noteDialog.close());
for (const button of elements.workspaceTabButtons) {
  button.addEventListener("click", () => activateWorkspace(button.dataset.panel));
}
elements.closeInsightButton.addEventListener("click", () =>
  elements.insightDialog.close()
);
elements.retryInsightButton.addEventListener("click", () => {
  if (activeInsightSelection) {
    requestSelectionInsight(
      activeInsightSelection.segment,
      activeInsightSelection.selectedText,
      true
    );
  }
});
elements.insightDialog.addEventListener("click", (event) => {
  if (event.target === elements.insightDialog) {
    elements.insightDialog.close();
  }
});
elements.reviewAiConsentButton.addEventListener("click", () => {
  showAiConsentDialog();
});
elements.acceptAiConsentButton.addEventListener("click", grantAiConsent);
elements.declineAiConsentButton.addEventListener("click", () => closeAiConsentDialog(false));
elements.closeAiConsentButton.addEventListener("click", () => closeAiConsentDialog(false));
elements.aiConsentDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeAiConsentDialog(false);
});
elements.revokeAiConsentButton.addEventListener("click", revokeAiConsent);
elements.clearVideoAiDataButton.addEventListener("click", clearCurrentVideoAiData);
elements.clearAllDataButton.addEventListener("click", clearAllLocalData);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "PLAYBACK_TIME") {
    currentPlaybackSeconds = Math.max(0, Number(message.seconds) || 0);
    elements.currentTime.textContent = formatTime(message.seconds);
    highlightCurrentSegment(message.seconds);
    maybeLoopClipPreview(message.seconds);
    return;
  }

  if (message?.type === "PAGE_NOTE_SAVED" && currentVideo) {
    const incoming = message.note;
    if (incoming && !notes.some((note) => note.id === incoming.id)) {
      notes.push(incoming);
      renderNotes();
    }
  }
});

initialize();
window.setInterval(syncPlaybackState, 1000);

async function initialize() {
  await updateAiConsentState();
  await loadAiStatus();
  const pageResponse = await chrome.runtime.sendMessage({
    type: "GET_ACTIVE_PAGE"
  });

  if (pageResponse?.ok) {
    currentPageTabId = pageResponse.page.tabId;
    elements.pageSummary.textContent =
      pageResponse.page.title || "Bilibili 视频页";
  } else {
    showError(pageResponse?.error);
    return;
  }

  await loadTranscript();
}

async function readAiConsent() {
  const stored = await chrome.storage.local.get(AI_CONSENT_KEY);
  const consent = stored[AI_CONSENT_KEY];
  return Boolean(consent?.granted && consent?.version === AI_CONSENT_VERSION);
}

async function updateAiConsentState() {
  const granted = await readAiConsent();
  elements.aiConsentState.textContent = granted
    ? "已授权云端 AI；字幕仅在你主动使用 AI 功能时发送。"
    : "尚未授权云端 AI，字幕不会发送到 AI 服务。";
  elements.revokeAiConsentButton.hidden = !granted;
  return granted;
}

function showAiConsentDialog() {
  if (!elements.aiConsentDialog.open) {
    elements.aiConsentDialog.showModal();
  }
}

function closeAiConsentDialog(granted) {
  if (elements.aiConsentDialog.open) {
    elements.aiConsentDialog.close();
  }
  if (aiConsentResolver) {
    const resolve = aiConsentResolver;
    aiConsentResolver = null;
    resolve(granted);
  }
}

async function grantAiConsent() {
  await chrome.storage.local.set({
    [AI_CONSENT_KEY]: {
      granted: true,
      version: AI_CONSENT_VERSION,
      grantedAt: new Date().toISOString()
    }
  });
  await updateAiConsentState();
  closeAiConsentDialog(true);
}

async function ensureAiConsent() {
  if (await readAiConsent()) return true;
  if (aiConsentResolver) return false;
  showAiConsentDialog();
  return new Promise((resolve) => {
    aiConsentResolver = resolve;
  });
}

async function revokeAiConsent() {
  await chrome.storage.local.remove(AI_CONSENT_KEY);
  await updateAiConsentState();
  setAiStatus("已撤回 AI 授权。字幕阅读、笔记和视频跳转仍可使用。", false);
}

async function clearCurrentVideoAiData() {
  if (!currentVideo) return;
  const videoMarker = `:${currentVideo.bvid || "unknown"}:${currentVideo.cid || "unknown"}`;
  const stored = await chrome.storage.local.get(null);
  const keys = Object.keys(stored).filter((key) =>
    key.includes(videoMarker) && !key.startsWith("timelineNotes:")
  );
  if (keys.length) await chrome.storage.local.remove(keys);
  currentOverview = null;
  currentClipRadar = null;
  currentRemix = null;
  elements.overviewOutput.hidden = true;
  elements.clipsOutput.hidden = true;
  elements.remixOutput.hidden = true;
  elements.followupOutput.hidden = true;
  elements.generateOverviewButton.textContent = "生成内容地图";
  elements.generateClipsButton.textContent = "分析内容价值";
  elements.generateFollowupButton.textContent = "生成延伸探索";
  setAiStatus("已清除当前视频的 AI 结果缓存，知识笔记已保留。", false);
}

async function clearAllLocalData() {
  if (!window.confirm("将删除 AI 缓存、知识笔记、授权状态和本机设置。确定继续吗？")) {
    return;
  }
  await chrome.storage.local.clear();
  notes = [];
  renderNotes();
  await updateAiConsentState();
  setAiStatus("已清除插件保存在本机浏览器中的全部数据。", false);
  await loadWorkspaceData();
}

async function syncPlaybackState() {
  if (!currentVideo) return;
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_PLAYBACK_STATE" });
    if (!response?.ok) return;
    currentPlaybackSeconds = Math.max(0, Number(response.seconds) || 0);
    const label = formatTime(currentPlaybackSeconds);
    elements.currentTime.textContent = label;
    highlightCurrentSegment(currentPlaybackSeconds);
    maybeLoopClipPreview(currentPlaybackSeconds);
  } catch {
    // 播放器切换或页面加载期间，下一个轮询周期会自动重试。
  }
}

async function loadAiStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_AI_STATUS" });
    aiAvailable = response?.available === true;
    aiModelName = response?.model || "云端模型";
    if (!aiAvailable) {
      setAiStatus(
        response?.message || "AI API 代理未连接，请先启动或部署代理。",
        true
      );
    }
  } catch (error) {
    aiAvailable = false;
    setAiStatus(`无法检测 AI API 代理：${error.message}`, true);
  }
  updateAiConfigState();
}

function updateAiConfigState() {
  elements.aiConfigState.textContent = aiAvailable
    ? `${aiModelName} 可用`
    : "AI 服务未连接";
  elements.aiConfigState.classList.toggle("configured", aiAvailable);
  const transcriptUnavailable = transcriptSegments.length === 0;
  elements.generateOverviewButton.disabled = transcriptUnavailable;
  elements.generateClipsButton.disabled = transcriptUnavailable;
  elements.generateRemixButton.disabled = transcriptUnavailable;
  elements.askButton.disabled = transcriptUnavailable;
  elements.generateFollowupButton.disabled = transcriptUnavailable;
}

async function loadTranscript() {
  setLoading(
    "正在检测字幕",
    "正在复用当前 Bilibili 登录态读取中文字幕轨。"
  );
  resetTranscript();

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "LOAD_TRANSCRIPT"
    });
  } catch (error) {
    showError({
      code: "EXTENSION_MESSAGE_FAILED",
      message: error.message
    });
    return;
  }

  if (!response?.ok) {
    showError(response?.error);
    return;
  }

  currentPageTabId = response.page.tabId;
  currentVideo = response.video;
  rawSubtitleSegments = response.segments;
  transcriptSegments = TranscriptUtils.mergeInterviewTurns(
    response.segments
  );
  elements.pageSummary.textContent =
    response.video.pageCount > 1
      ? `第 ${response.video.page}/${response.video.pageCount} P`
      : "当前视频";
  elements.videoTitle.textContent = response.video.title;
  elements.trackLabel.textContent = response.track.label;
  elements.segmentCount.textContent =
    `${transcriptSegments.length} 段 · ${rawSubtitleSegments.length} 句`;
  elements.videoInfo.hidden = false;
  elements.toolbar.hidden = false;
  elements.workspaceTabs.hidden = false;
  updateAiConfigState();

  renderTranscript(transcriptSegments);
  await loadWorkspaceData();
  await syncPlaybackState();
  elements.status.hidden = true;
  elements.reloadButton.disabled = false;

  setAiStatus(
    aiAvailable
      ? `${aiModelName} 已就绪，无需下载模型或配置 API Key。`
      : "AI API 代理未连接，请先启动或部署代理。",
    !aiAvailable
  );
}

function renderTranscript(segments) {
  const fragment = document.createDocumentFragment();
  renderedSegments = [];

  for (const segment of segments) {
    const node =
      elements.segmentTemplate.content.firstElementChild.cloneNode(true);
    const timestamp = node.querySelector(".timestamp");
    const text = node.querySelector(".segment-text");

    timestamp.textContent = formatTime(segment.from);
    timestamp.dataset.seconds = String(segment.from);
    timestamp.addEventListener("click", (event) => {
      event.stopPropagation();
      seekVideo(segment.from);
    });
    text.textContent = segment.text;
    node.dataset.segmentId = String(segment.id);
    node.dataset.from = String(segment.from);
    node.dataset.to = String(segment.to);
    node.dataset.text = segment.text.toLocaleLowerCase();
    node.addEventListener("mouseup", () => {
      window.setTimeout(() => openSelectedTextInsight(node, segment), 0);
    });

    fragment.append(node);
    renderedSegments.push(node);
  }

  elements.transcript.replaceChildren(fragment);
}

function activateWorkspace(panelId) {
  if (panelId !== "clips-panel") stopClipPreview();
  for (const button of elements.workspaceTabButtons) {
    button.classList.toggle("active", button.dataset.panel === panelId);
  }
  for (const panel of elements.workspacePanels) {
    panel.hidden = panel.id !== panelId;
  }
  updateBackToTopButton();
}

function updateBackToTopButton() {
  const transcriptActive = !document.querySelector("#transcript-panel")?.hidden;
  elements.backToTopButton.hidden = !transcriptActive || window.scrollY < 360;
}

function videoStorageKey(prefix, suffix = "") {
  const videoKey = `${currentVideo?.bvid || "unknown"}:${currentVideo?.cid || "unknown"}`;
  return `${prefix}:${videoKey}${suffix ? `:${suffix}` : ""}`;
}

function transcriptForAi() {
  return transcriptSegments.map((segment) => ({
    id: segment.id,
    from: segment.from,
    to: segment.to,
    text: segment.text
  }));
}

async function loadWorkspaceData() {
  const overviewKey = videoStorageKey("contentMapV6");
  const notesKey = videoStorageKey("timelineNotes");
  const remixKey = videoStorageKey(
    "remixV4",
    `${elements.remixStyle.value}:${elements.remixLength.value}`
  );
  const followupKey = videoStorageKey("followupV3");
  const clipsKey = videoStorageKey("contentValueRadarV5");
  const clipFavoritesKey = videoStorageKey("contentValueFavoritesV2");
  const stored = await chrome.storage.local.get([
    overviewKey, notesKey, remixKey, followupKey, clipsKey, clipFavoritesKey
  ]);
  notes = Array.isArray(stored[notesKey]) ? stored[notesKey] : [];
  renderNotes();
  if (stored[overviewKey] && isRenderableContentMap(stored[overviewKey])) {
    renderOverview(stored[overviewKey]);
    elements.generateOverviewButton.textContent = "重新生成内容地图";
  } else if (stored[overviewKey]) {
    await chrome.storage.local.remove(overviewKey);
  }
  if (stored[remixKey]) {
    renderRemix(stored[remixKey]);
  }
  if (stored[followupKey]) {
    renderFollowup(stored[followupKey]);
    elements.generateFollowupButton.textContent = "重新生成延伸探索";
  }
  favoriteClipIds = new Set(Array.isArray(stored[clipFavoritesKey])
    ? stored[clipFavoritesKey]
    : []);
  if (stored[clipsKey] && isRenderableClipRadar(stored[clipsKey])) {
    renderClipCandidates(stored[clipsKey]);
    elements.generateClipsButton.textContent = "重新分析内容价值";
  } else if (stored[clipsKey]) {
    await chrome.storage.local.remove(clipsKey);
  }
}

async function generateOverview() {
  if (!(await ensureAiConsent())) return;
  setModuleBusy("overview", true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_OVERVIEW",
      payload: {
        video: currentVideo,
        segments: transcriptForAi()
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message || "内容地图生成失败。");
    }
    renderOverview(response.overview);
    await chrome.storage.local.set({
      [videoStorageKey("contentMapV6")]: response.overview
    });
    elements.generateOverviewButton.textContent = "重新生成内容地图";
  } catch (error) {
    elements.overviewError.textContent = error.message;
    elements.overviewError.hidden = false;
  } finally {
    setModuleBusy("overview", false);
  }
}

function isRenderableContentMap(overview) {
  if (!overview || typeof overview !== "object") return false;
  const chapters = Array.isArray(overview.chapters) ? overview.chapters : [];
  const fragments = Array.isArray(overview.thoughtFragments)
    ? overview.thoughtFragments
    : [];
  return (
    String(overview.oneLiner || "").trim().length >= 12 &&
    String(overview.summary || "").trim().length >= 80 &&
    chapters.filter((chapter) =>
      String(chapter?.title || "").trim() &&
      String(chapter?.content || "").trim()
    ).length >= 4 &&
    fragments.filter((fragment) =>
      String(fragment?.statement || "").trim().length >= 18
    ).length >= 3
  );
}

function renderOverview(overview) {
  if (!isRenderableContentMap(overview)) {
    throw new Error("内容地图结果不完整，未保存空结果。请重新生成。");
  }
  currentOverview = overview;
  elements.overviewOneLiner.textContent = overview.oneLiner || "";
  elements.overviewSummary.textContent = overview.summary || "";
  const coverUrl = safeImageUrl(currentVideo?.cover);
  elements.overviewCover.hidden = !coverUrl;
  if (coverUrl) {
    elements.overviewCover.src = coverUrl;
    elements.overviewCover.referrerPolicy = "no-referrer";
  } else {
    elements.overviewCover.removeAttribute("src");
  }
  renderPeopleGroup(elements.overviewInterviewers, overview.interviewers, "采访者");
  renderPeopleGroup(elements.overviewInterviewees, overview.interviewees, "被采访者");
  elements.overviewChapters.replaceChildren();
  for (const chapter of Array.isArray(overview.chapters) ? overview.chapters : []) {
    const card = document.createElement("article");
    card.className = "chapter-card";
    const heading = document.createElement("div");
    heading.className = "chapter-heading";
    const title = document.createElement("h3");
    title.textContent = chapter.title || "未命名章节";
    const time = document.createElement("button");
    time.className = "chapter-time";
    time.type = "button";
    time.textContent = `${formatTime(chapter.from)} →`;
    time.addEventListener("click", () => seekVideo(Number(chapter.from) || 0));
    heading.append(title, time);
    const content = document.createElement("p");
    content.className = "chapter-content";
    content.textContent = chapter.content || mergeLegacyChapterText(chapter);
    const insight = document.createElement("p");
    insight.className = "chapter-insight";
    insight.textContent = chapter.insight || chapter.summary || summarizeChapterFallback(content.textContent);
    card.append(heading, insight, content);
    elements.overviewChapters.append(card);
  }
  renderLifePaths(overview.lifeTrajectories);
  renderThoughtFragments(overview.thoughtFragments || overview.takeaways);
  elements.overviewError.hidden = true;
  elements.overviewOutput.hidden = false;
}

function summarizeChapterFallback(content) {
  const text = String(content || "").trim();
  const sentence = text.split(/(?<=[。！？])/u).find(Boolean) || text;
  return sentence.slice(0, 72);
}

function renderLifePaths(trajectories) {
  elements.overviewLifePaths.replaceChildren();
  const intervieweeNames = new Set(
    (Array.isArray(currentOverview?.interviewees)
      ? currentOverview.interviewees
      : [])
      .map((person) => String(person?.name || "").replace(/\s+/gu, "").trim())
      .filter(Boolean)
  );
  const seenNames = new Set();
  const validTrajectories = (Array.isArray(trajectories) ? trajectories : [])
    .filter((trajectory) => {
      const name = String(trajectory?.personName || "")
        .replace(/\s+/gu, "")
        .trim();
      if (
        !name ||
        !intervieweeNames.has(name) ||
        seenNames.has(name) ||
        !Array.isArray(trajectory?.events) ||
        !trajectory.events.length
      ) return false;
      seenNames.add(name);
      return true;
    });
  if (!validTrajectories.length) {
    const empty = document.createElement("p");
    empty.className = "life-path-empty";
    empty.textContent = "本期访谈没有提供足够信息来构成可靠的人物轨迹。";
    elements.overviewLifePaths.append(empty);
    return;
  }
  for (const trajectory of validTrajectories) {
    const article = document.createElement("article");
    article.className = "life-path";
    const header = document.createElement("header");
    header.className = "life-path-header";
    const title = document.createElement("h4");
    title.textContent = trajectory.personName || "人物轨迹";
    const overview = document.createElement("p");
    overview.textContent = trajectory.overview || "";
    header.append(title, overview);
    const events = document.createElement("ol");
    events.className = "life-events";
    article.append(header, events);
    for (const event of trajectory.events) {
      const item = document.createElement("li");
      item.className = `life-event${event.turningPoint ? " turning-point" : ""}`;
      const eventTitle = document.createElement("h5");
      eventTitle.textContent = event.title || "重要经历";
      const description = document.createElement("p");
      description.textContent = event.description || "";
      const displayPeriod = displayLifePeriod(event.period);
      if (displayPeriod) {
        const period = document.createElement("span");
        period.className = "life-period";
        period.textContent = displayPeriod;
        item.append(period);
      }
      item.append(eventTitle, description);
      const mentionedAt = Number(event.mentionedAt);
      if (Number.isFinite(mentionedAt) && mentionedAt >= 0) {
        const jump = document.createElement("button");
        jump.className = "life-event-time";
        jump.type = "button";
        jump.textContent = `访谈提及 ${formatTime(mentionedAt)} →`;
        jump.addEventListener("click", () => seekVideo(mentionedAt));
        item.append(jump);
      }
      events.append(item);
    }
    elements.overviewLifePaths.append(article);
  }
}

function displayLifePeriod(value) {
  const period = String(value || "")
    .replace(/\s+/gu, "")
    .replace(/^[,，.。:：;；、\-—–]+|[,，.。:：;；、\-—–]+$/gu, "")
    .trim();
  return (
    period &&
    !/^(?:年|月|日|年代|时期|阶段|时间|未知|不详|未明|待定|阶段未明|时间不详)$/u.test(period)
  ) ? period : "";
}

function renderThoughtFragments(fragments) {
  elements.overviewThoughtFragments.replaceChildren();
  const validFragments = (Array.isArray(fragments) ? fragments : [])
    .filter((fragment) => typeof fragment === "string"
      ? fragment.trim()
      : fragment?.statement?.trim());
  if (!validFragments.length) {
    const empty = document.createElement("p");
    empty.className = "life-path-empty";
    empty.textContent = "暂时没有提炼出能够脱离人物与语境独立成立的观点。";
    elements.overviewThoughtFragments.append(empty);
    return;
  }
  for (const fragment of validFragments) {
    const card = document.createElement("article");
    card.className = "thought-fragment";
    const mark = document.createElement("span");
    mark.className = "thought-fragment-mark";
    mark.textContent = "“";
    const text = document.createElement("p");
    text.textContent = typeof fragment === "string"
      ? fragment
      : fragment?.statement || "";
    const lens = document.createElement("span");
    lens.className = "thought-fragment-lens";
    lens.textContent = typeof fragment === "object" && fragment?.lens
      ? fragment.lens
      : "独立观点";
    card.append(mark, text, lens);
    elements.overviewThoughtFragments.append(card);
  }
}

async function generateClipCandidates() {
  if (!currentVideo) return;
  if (!(await ensureAiConsent())) return;
  stopClipPreview();
  setModuleBusy("clips", true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_CLIP_CANDIDATES",
      payload: {
        video: currentVideo,
        segments: transcriptForAi()
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message || "内容价值分析失败。");
    }
    renderClipCandidates(response.clips);
    await chrome.storage.local.set({
      [videoStorageKey("contentValueRadarV5")]: response.clips
    });
    elements.generateClipsButton.textContent = "重新分析内容价值";
  } catch (error) {
    elements.clipsError.textContent = error.message;
    elements.clipsError.hidden = false;
  } finally {
    setModuleBusy("clips", false);
  }
}

function isRenderableClipRadar(result) {
  return (
    result &&
    typeof result === "object" &&
    String(result.intro || "").trim().length >= 12 &&
    Array.isArray(result.clips) &&
    result.clips.filter((clip) =>
      Number(clip?.to) > Number(clip?.from) + 3 &&
      String(clip?.title || "").trim()
    ).length >= 5
  );
}

function renderClipCandidates(result) {
  if (!isRenderableClipRadar(result)) {
    throw new Error("高光分析结果不完整，未保存空结果。请重新分析。");
  }
  currentClipRadar = result;
  elements.clipsIntro.textContent = result?.intro || "";
  activeClipFilter = "全部";
  for (const button of elements.clipFilterButtons) {
    button.classList.toggle("active", button.dataset.clipFilter === activeClipFilter);
  }
  renderFilteredClipCards();
  elements.clipsError.hidden = true;
  elements.clipsOutput.hidden = false;
}

function setClipFilter(filter) {
  activeClipFilter = filter || "全部";
  for (const button of elements.clipFilterButtons) {
    button.classList.toggle("active", button.dataset.clipFilter === activeClipFilter);
  }
  stopClipPreview();
  renderFilteredClipCards();
}

function renderFilteredClipCards() {
  elements.clipsItems.replaceChildren();
  const clips = [...(Array.isArray(currentClipRadar?.clips) ? currentClipRadar.clips : [])]
    .filter((clip) => activeClipFilter === "全部" || clip.type === activeClipFilter)
    .sort((a, b) => Number(b.valueScore) - Number(a.valueScore) || Number(a.from) - Number(b.from));
  for (const clip of clips) {
    elements.clipsItems.append(createClipCard(clip));
  }
  if (!clips.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state clips-empty";
    empty.textContent = "本期没有识别到这一类型的高价值内容节点。";
    elements.clipsItems.append(empty);
  }
}

function createClipCard(clip) {
  const card = document.createElement("article");
  card.className = "clip-card";
  card.dataset.clipId = clip.id;

  const top = document.createElement("div");
  top.className = "clip-card-top";
  const type = document.createElement("span");
  type.className = "clip-type";
  type.textContent = clip.type || "观点片段";
  top.append(type);

  const title = document.createElement("h3");
  title.textContent = clip.title || "未命名片段";
  const range = document.createElement("button");
  range.className = "clip-range";
  range.type = "button";
  range.textContent = `${formatTime(clip.from)} – ${formatTime(clip.to)}`;
  range.title = "跳转到片段开头";
  range.addEventListener("click", () => {
    stopClipPreview();
    seekVideo(Number(clip.from) || 0);
  });

  const quote = document.createElement("blockquote");
  quote.className = "clip-quote";
  quote.textContent = clip.quote || "";
  const reason = document.createElement("p");
  reason.className = "clip-reason";
  reason.textContent = clip.whyRecommended || "";

  const signals = document.createElement("div");
  signals.className = "clip-signals";
  for (const signalText of Array.isArray(clip.signals) ? clip.signals : []) {
    const signal = document.createElement("span");
    signal.textContent = signalText;
    signals.append(signal);
  }

  const details = document.createElement("details");
  details.className = "clip-details";
  const summary = document.createElement("summary");
  summary.textContent = "查看内容价值画像与利用建议";
  const plan = document.createElement("div");
  plan.className = "clip-plan";
  plan.append(
    createClipScoreAnalysis(clip),
    createScenarioAnalysis(clip),
    clipPlanRow("话题", (clip.topics || []).map((topic) => `#${topic}`).join(" ")),
    clipPlanRow("BGM", clip.bgmSuggestion)
  );
  details.append(summary, plan);
  card.append(top, title, range, quote, reason);
  if (signals.childElementCount) card.append(signals);
  card.append(details);
  return card;
}

function createClipScoreAnalysis(clip) {
  const section = document.createElement("section");
  section.className = "clip-score-analysis";
  const heading = document.createElement("h4");
  heading.textContent = "内容价值画像";
  const portrait = document.createElement("div");
  portrait.className = "clip-value-portrait";
  const metrics = [
    { key: "emotionalIntensity", label: "情绪浓度", angle: -90, labelX: 180, labelY: 22 },
    { key: "storyTension", label: "故事张力", angle: -18, labelX: 310, labelY: 103 },
    { key: "spreadPotential", label: "传播潜力", angle: 54, labelX: 286, labelY: 258 },
    { key: "practicalInspiration", label: "实践启发", angle: 126, labelX: 74, labelY: 258 },
    { key: "depthOfThought", label: "深度思考", angle: 198, labelX: 50, labelY: 103 }
  ];
  const center = { x: 180, y: 145 };
  const radius = 84;
  const pointAt = (angle, distance) => {
    const radians = angle * Math.PI / 180;
    return {
      x: center.x + Math.cos(radians) * distance,
      y: center.y + Math.sin(radians) * distance
    };
  };
  const pointString = (points) =>
    points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("clip-radar-chart");
  svg.setAttribute("viewBox", "0 0 360 290");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "五维内容价值雷达图");
  for (const level of [0.25, 0.5, 0.75, 1]) {
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.classList.add("radar-grid");
    polygon.setAttribute(
      "points",
      pointString(metrics.map((metric) => pointAt(metric.angle, radius * level)))
    );
    svg.append(polygon);
  }
  for (const metric of metrics) {
    const axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const endpoint = pointAt(metric.angle, radius);
    axis.classList.add("radar-axis");
    axis.setAttribute("x1", center.x);
    axis.setAttribute("y1", center.y);
    axis.setAttribute("x2", endpoint.x);
    axis.setAttribute("y2", endpoint.y);
    svg.append(axis);
  }
  const values = metrics.map((metric) =>
    Math.min(100, Math.max(0, Number(clip.scores?.[metric.key]) || 0))
  );
  const dataPoints = metrics.map((metric, index) =>
    pointAt(metric.angle, radius * values[index] / 100)
  );
  const area = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
  area.classList.add("radar-area");
  area.setAttribute("points", pointString(dataPoints));
  svg.append(area);
  dataPoints.forEach((point) => {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.classList.add("radar-dot");
    dot.setAttribute("cx", point.x);
    dot.setAttribute("cy", point.y);
    dot.setAttribute("r", "3.5");
    svg.append(dot);
  });
  metrics.forEach((metric, index) => {
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.classList.add("radar-label");
    label.setAttribute("x", metric.labelX);
    label.setAttribute("y", metric.labelY);
    label.setAttribute("text-anchor", "middle");
    const name = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    name.textContent = metric.label;
    name.setAttribute("x", metric.labelX);
    const value = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    value.classList.add("radar-value");
    value.textContent = (values[index] / 10).toFixed(1);
    value.setAttribute("x", metric.labelX);
    value.setAttribute("dy", "17");
    label.append(name, value);
    svg.append(label);
  });
  portrait.append(svg);
  const summary = document.createElement("p");
  summary.className = "clip-portrait-summary";
  summary.textContent = clip.valuePortrait ||
    "这是一段兼具思考与传播价值的内容，适合进一步观看和再利用。";
  section.append(heading, portrait, summary);
  return section;
}

function createScenarioAnalysis(clip) {
  const section = document.createElement("section");
  section.className = "clip-scenarios";
  const heading = document.createElement("h4");
  heading.textContent = "适配场景与推荐标题";
  section.append(heading);
  for (const scenario of Array.isArray(clip.scenarios) ? clip.scenarios : []) {
    const item = document.createElement("article");
    const meta = document.createElement("p");
    meta.className = "clip-scenario-meta";
    meta.textContent = `${scenario.type || "内容利用"} · 适配度 ${scenario.fit}`;
    const title = document.createElement("strong");
    title.textContent = scenario.title || clip.title;
    const advice = document.createElement("p");
    advice.textContent = scenario.advice || "";
    item.append(meta, title, advice);
    section.append(item);
  }
  return section;
}

function clipPlanRow(label, value) {
  const row = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}：`;
  row.append(strong, document.createTextNode(value || "暂无建议"));
  return row;
}

function formatClipPlan(clip) {
  const portraitLabels = {
    emotionalIntensity: "情绪浓度",
    depthOfThought: "深度思考",
    storyTension: "故事张力",
    practicalInspiration: "实践启发",
    spreadPotential: "传播潜力"
  };
  const portraitText = Object.entries(portraitLabels).map(([key, label]) =>
    `${label} ${((Number(clip.scores?.[key]) || 0) / 10).toFixed(1)}`
  ).join("\n");
  const scenarioText = (clip.scenarios || []).map((scenario) =>
    `${scenario.type}（${scenario.fit}）：${scenario.title}；${scenario.advice}`
  ).join("\n");
  return [
    clip.title,
    `区间：${formatTime(clip.from)} – ${formatTime(clip.to)}`,
    `类型：${clip.type}`,
    `推荐理由：${clip.whyRecommended}`,
    `判断信号：${(clip.signals || []).join("、")}`,
    portraitText,
    `内容价值画像：${clip.valuePortrait || ""}`,
    scenarioText,
    `话题：${(clip.topics || []).map((topic) => `#${topic}`).join(" ")}`,
    `BGM：${clip.bgmSuggestion}`
  ].filter(Boolean).join("\n");
}

async function toggleFavoriteClip(clip, button) {
  if (favoriteClipIds.has(clip.id)) {
    favoriteClipIds.delete(clip.id);
  } else {
    favoriteClipIds.add(clip.id);
  }
  const selected = favoriteClipIds.has(clip.id);
  button.setAttribute("aria-pressed", String(selected));
  button.textContent = selected ? "★ 已收藏" : "☆ 收藏";
  await chrome.storage.local.set({
    [videoStorageKey("contentValueFavoritesV2")]: [...favoriteClipIds]
  });
}

async function toggleClipPreview(clip) {
  if (previewRange?.id === clip.id) {
    stopClipPreview();
    return;
  }
  previewRange = { id: clip.id, from: Number(clip.from) || 0, to: Number(clip.to) || 0 };
  updateClipPreviewButtons();
  previewSeeking = true;
  await seekVideo(previewRange.from, { preservePreview: true });
  previewSeeking = false;
}

function stopClipPreview() {
  previewRange = null;
  previewSeeking = false;
  updateClipPreviewButtons();
}

function updateClipPreviewButtons() {
  for (const button of elements.clipsItems.querySelectorAll(".clip-preview-button")) {
    const card = button.closest(".clip-card");
    const active = Boolean(previewRange && card?.dataset.clipId === previewRange.id);
    button.classList.toggle("active", active);
    button.textContent = active ? "停止循环" : "循环预览";
  }
}

async function maybeLoopClipPreview(seconds) {
  if (!previewRange || previewSeeking) return;
  if (Number(seconds) < previewRange.from - 1 || Number(seconds) > previewRange.to + 2) {
    stopClipPreview();
    return;
  }
  if (Number(seconds) < previewRange.to - 0.25) return;
  previewSeeking = true;
  await seekVideo(previewRange.from, { preservePreview: true });
  previewSeeking = false;
}

function mergeLegacyChapterText(chapter) {
  const parts = [chapter.summary, ...(Array.isArray(chapter.keyPoints)
    ? chapter.keyPoints
    : [])]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .map((part) => /[。！？]$/u.test(part) ? part : `${part}。`);
  return parts.join("");
}

function renderPeopleGroup(container, people, fallbackRole) {
  container.replaceChildren();
  for (const person of Array.isArray(people) ? people : []) {
    const card = document.createElement("article");
    card.className = "person-card";
    const title = document.createElement("h3");
    title.textContent = person.name || "未识别人物";
    const role = document.createElement("p");
    role.className = "person-role";
    role.textContent = person.role || fallbackRole;
    const bio = document.createElement("p");
    bio.textContent = person.bio || "暂无可核实的简介。";
    card.append(title, role, bio);
    if (person.knownFor) {
      const knownFor = document.createElement("p");
      knownFor.className = "person-known-for";
      knownFor.textContent = `相关领域：${person.knownFor}`;
      card.append(knownFor);
    }
    const links = document.createElement("div");
    links.className = "person-links";
    for (const source of Array.isArray(person.sourceLinks)
      ? person.sourceLinks
      : []) {
      const url = safeExternalUrl(source.url);
      if (!url) continue;
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.title || "资料来源";
      links.append(link);
    }
    if (links.childElementCount) card.append(links);
    container.append(card);
  }
}

function setModuleBusy(module, busy) {
  const unavailable = transcriptSegments.length === 0;
  if (module === "overview") {
    elements.generateOverviewButton.disabled = busy || unavailable;
    elements.overviewLoading.hidden = !busy;
    if (busy) elements.overviewError.hidden = true;
  }
  if (module === "clips") {
    elements.generateClipsButton.disabled = busy || unavailable;
    elements.clipsLoading.hidden = !busy;
    if (busy) elements.clipsError.hidden = true;
  }
  if (module === "remix") {
    elements.generateRemixButton.disabled = busy || unavailable;
    elements.remixLoading.hidden = !busy;
    if (busy) elements.remixError.hidden = true;
  }
  if (module === "question") {
    elements.askButton.disabled = busy || unavailable;
    elements.questionLoading.hidden = !busy;
    if (busy) elements.questionError.hidden = true;
  }
  if (module === "followup") {
    elements.generateFollowupButton.disabled = busy || unavailable;
    elements.followupLoading.hidden = !busy;
    if (busy) elements.followupError.hidden = true;
  }
}

async function generateFollowup() {
  if (!currentVideo) return;
  if (!(await ensureAiConsent())) return;
  setModuleBusy("followup", true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_FOLLOWUP",
      payload: { video: currentVideo, overview: currentOverview }
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message || "延伸探索生成失败。");
    }
    renderFollowup(response.followup);
    await chrome.storage.local.set({
      [videoStorageKey("followupV3")]: response.followup
    });
    elements.generateFollowupButton.textContent = "重新生成延伸探索";
  } catch (error) {
    elements.followupError.textContent = error.message;
    elements.followupError.hidden = false;
  } finally {
    setModuleBusy("followup", false);
  }
}

function renderFollowup(followup) {
  elements.followupIntro.textContent = followup.intro || "";
  elements.followupTopics.replaceChildren();
  for (const topic of Array.isArray(followup.topics) ? followup.topics : []) {
    const chip = document.createElement("span");
    chip.className = "followup-topic";
    chip.textContent = topic;
    elements.followupTopics.append(chip);
  }
  elements.followupItems.replaceChildren();
  const groupedResults = (Array.isArray(followup.items) ? followup.items : [])
    .map((result) => ({
      ...result,
      type: normalizeFollowupType(result)
    }))
    .sort((a, b) => followupTypeRank(a.type) - followupTypeRank(b.type));
  let activeGroup = "";
  for (const result of groupedResults) {
    const url = safeExternalUrl(result.url);
    if (!url || isCurrentVideoFollowup(result, url)) continue;
    if (result.type !== activeGroup) {
      activeGroup = result.type;
      const groupTitle = document.createElement("h3");
      groupTitle.className = "followup-group-title";
      groupTitle.textContent = ({
        podcast: "相关视频播客",
        video: "其他视频",
        article: "深度文章与资料"
      })[activeGroup];
      elements.followupItems.append(groupTitle);
    }
    const card = document.createElement("article");
    card.className = "followup-card";
    const title = document.createElement("h3");
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = result.title || "相关资料";
    title.append(link);
    const meta = document.createElement("p");
    meta.className = "followup-meta";
    meta.textContent = [followupTypeLabel(result.type), result.source, result.publishDate]
      .filter(Boolean).join(" · ");
    const why = document.createElement("p");
    why.textContent = result.why || "与本期主题相关。";
    card.append(title, meta, why);
    elements.followupItems.append(card);
  }
  elements.followupError.hidden = true;
  elements.followupOutput.hidden = false;
}

function isCurrentVideoFollowup(result, url) {
  const currentBvid = String(currentVideo?.bvid || "").toUpperCase();
  const resultBvid = url.match(/\/video\/(BV[a-zA-Z0-9]+)/u)?.[1]
    ?.toUpperCase() || "";
  if (currentBvid && resultBvid === currentBvid) return true;
  const normalize = (value) => String(value || "")
    .replace(/[\s|｜·•—–_《》“”"'：:，,。！？!?（）()【】\[\]]+/gu, "")
    .toLocaleLowerCase();
  return normalize(result.title) === normalize(currentVideo?.title);
}

function followupTypeLabel(type) {
  return ({
    podcast: "视频播客", video: "视频", article: "文章"
  })[type] || "文章";
}

function normalizeFollowupType(result = {}) {
  if (["podcast", "video", "article"].includes(result.type)) return result.type;
  let hostname = "";
  try {
    hostname = new URL(result.url).hostname.toLocaleLowerCase();
  } catch {
    return "article";
  }
  const text = `${result.title || ""} ${result.why || ""}`.toLocaleLowerCase();
  const videoHost = [
    "bilibili.com", "youtube.com", "youtu.be", "vimeo.com",
    "youku.com", "iqiyi.com", "v.qq.com", "ximalaya.com"
  ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (videoHost && /播客|podcast|访谈|采访|对谈|对话|圆桌|interview/u.test(text)) {
    return "podcast";
  }
  return videoHost ? "video" : "article";
}

function followupTypeRank(type) {
  return ({ podcast: 0, video: 1, article: 2 })[type] ?? 3;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function safeImageUrl(value) {
  try {
    const raw = String(value || "").trim();
    const url = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
    if (url.protocol === "https:") return url.href;
    const hostname = url.hostname.toLocaleLowerCase();
    const trustedBilibiliImage = [
      "hdslb.com",
      "biliimg.com",
      "bilivideo.com"
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
    if (url.protocol === "http:" && trustedBilibiliImage) {
      url.protocol = "https:";
      return url.href;
    }
    return "";
  } catch {
    return "";
  }
}

async function generateRemix() {
  if (!(await ensureAiConsent())) return;
  setModuleBusy("remix", true);
  try {
    const style = elements.remixStyle.value;
    const length = elements.remixLength.value;
    const referenceRemixes = await loadOtherRemixSamples(style, length);
    const response = await chrome.runtime.sendMessage({
      type: "GENERATE_REMIX",
      payload: {
        video: currentVideo,
        segments: transcriptForAi(),
        style,
        length,
        people: {
          interviewers: (Array.isArray(currentOverview?.interviewers)
            ? currentOverview.interviewers
            : []).map((person) => person?.name).filter(Boolean),
          interviewees: (Array.isArray(currentOverview?.interviewees)
            ? currentOverview.interviewees
            : []).map((person) => person?.name).filter(Boolean)
        },
        referenceRemixes
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message || "内容重构生成失败。");
    }
    renderRemix(response.remix);
    await chrome.storage.local.set({
      [videoStorageKey("remixV4", `${style}:${length}`)]: response.remix
    });
  } catch (error) {
    elements.remixError.textContent = error.message;
    elements.remixError.hidden = false;
  } finally {
    setModuleBusy("remix", false);
  }
}

async function loadSelectedRemix() {
  if (!currentVideo) return;
  const key = videoStorageKey(
    "remixV4",
    `${elements.remixStyle.value}:${elements.remixLength.value}`
  );
  const stored = await chrome.storage.local.get(key);
  if (stored[key]) {
    renderRemix(stored[key]);
  } else {
    currentRemix = null;
    elements.remixOutput.hidden = true;
  }
}

async function loadOtherRemixSamples(activeStyle, length) {
  const styles = ["profile", "first_person", "insight_essay"]
    .filter((style) => style !== activeStyle);
  const keys = styles.map((style) =>
    videoStorageKey("remixV4", `${style}:${length}`)
  );
  const stored = await chrome.storage.local.get(keys);
  return styles.map((style, index) => {
    const remix = stored[keys[index]];
    if (!remix) return null;
    const sections = normalizeRemixSections(remix);
    return {
      mode: style,
      title: String(remix.title || "").slice(0, 80),
      headings: sections.map((section) => section.heading).slice(0, 7),
      opening: sections
        .slice(0, 2)
        .flatMap((section) => section.paragraphs)
        .join("")
        .slice(0, 900)
    };
  }).filter(Boolean);
}

function renderRemix(remix) {
  currentRemix = remix;
  elements.remixTitle.textContent = remix.title || "未命名文章";
  elements.remixDeck.textContent = remix.deck || "";
  elements.remixBody.replaceChildren();
  for (const section of normalizeRemixSections(remix)) {
    const sectionElement = document.createElement("section");
    sectionElement.className = "article-section";
    const heading = document.createElement("h3");
    heading.textContent = section.heading;
    sectionElement.append(heading);
    for (const paragraphText of section.paragraphs) {
      const paragraph = document.createElement("p");
      paragraph.textContent = paragraphText;
      sectionElement.append(paragraph);
    }
    elements.remixBody.append(sectionElement);
  }
  elements.remixDisclaimer.textContent = remix.disclaimer ||
    "本文由 AI 基于采访智能稿本重写，未引入稿本之外的事实。";
  elements.remixError.hidden = true;
  elements.remixOutput.hidden = false;
}

async function copyRemix() {
  if (!currentRemix) return;
  const sectionText = normalizeRemixSections(currentRemix)
    .map((section) => [
      section.heading,
      ...section.paragraphs
    ].join("\n\n"))
    .join("\n\n");
  const text = [currentRemix.title, currentRemix.deck, sectionText]
    .filter(Boolean).join("\n\n");
  const original = elements.copyRemixButton.textContent;
  try {
    await writeClipboardText(text);
    elements.copyRemixButton.textContent = "copied";
  } catch (error) {
    elements.copyRemixButton.textContent = "failed";
    elements.remixError.textContent = `复制失败：${error.message}`;
    elements.remixError.hidden = false;
  }
  window.setTimeout(() => { elements.copyRemixButton.textContent = original; }, 1500);
}

function normalizeRemixSections(remix = {}) {
  const structured = (Array.isArray(remix.sections) ? remix.sections : [])
    .map((section) => ({
      heading: String(section?.heading || "").trim(),
      paragraphs: (Array.isArray(section?.paragraphs) ? section.paragraphs : [])
        .map((paragraph) => String(paragraph || "").trim())
        .filter(Boolean)
    }))
    .filter((section) => section.heading && section.paragraphs.length);
  if (structured.length) return structured;

  const legacyParagraphs = String(remix.body || "")
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return legacyParagraphs.length
    ? [{ heading: "正文", paragraphs: legacyParagraphs }]
    : [];
}

async function writeClipboardText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 部分嵌入式扩展页面会拒绝 Clipboard API，继续使用兼容方案。
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("浏览器拒绝了剪贴板写入");
}

function openNoteDialog() {
  if (!currentVideo) return;
  pendingNoteSeconds = currentPlaybackSeconds;
  elements.noteDialogTime.textContent = formatTime(pendingNoteSeconds);
  elements.noteInput.value = "";
  elements.noteDialog.showModal();
  elements.noteInput.focus();
}

async function saveManualNote(event) {
  event.preventDefault();
  const text = elements.noteInput.value.trim();
  if (!text) return;
  notes.push({
    id: crypto.randomUUID(),
    type: "note",
    time: pendingNoteSeconds,
    text,
    createdAt: Date.now()
  });
  await persistNotes();
  elements.noteDialog.close();
  renderNotes();
}

async function askPodcast(event) {
  event.preventDefault();
  const question = elements.questionInput.value.trim();
  if (!question || !currentVideo) return;
  if (!(await ensureAiConsent())) return;
  setModuleBusy("question", true);
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ASK_PODCAST",
      payload: {
        video: currentVideo,
        question,
        currentTime: currentPlaybackSeconds,
        segments: transcriptForAi()
      }
    });
    if (!response?.ok) {
      throw new Error(response?.error?.message || "AI 问答失败。");
    }
    notes.push({
      id: crypto.randomUUID(),
      type: "qa",
      time: currentPlaybackSeconds,
      question,
      answer: response.answer.answer,
      citations: response.answer.citations || [],
      sources: response.answer.sources || [],
      createdAt: Date.now()
    });
    await persistNotes();
    renderNotes();
    elements.questionInput.value = "";
  } catch (error) {
    elements.questionError.textContent = error.message;
    elements.questionError.hidden = false;
  } finally {
    setModuleBusy("question", false);
  }
}

async function persistNotes() {
  await chrome.storage.local.set({ [videoStorageKey("timelineNotes")]: notes });
}

function renderNotes() {
  notes.sort((a, b) => (a.time - b.time) || (a.createdAt - b.createdAt));
  elements.notesList.replaceChildren();
  elements.noteCount.textContent = String(notes.length);
  elements.notesEmpty.hidden = notes.length > 0;
  for (const note of notes) {
    const card = document.createElement("article");
    card.className = `note-card ${note.type === "qa" ? "ai-note" : ""}`;
    const header = document.createElement("div");
    header.className = "note-card-header";
    const time = document.createElement("button");
    time.type = "button";
    time.className = "note-time";
    time.textContent = formatTime(note.time);
    time.addEventListener("click", () => seekVideo(note.time));
    const type = document.createElement("span");
    type.className = "note-type";
    type.textContent = note.type === "qa" ? "AI 问答" : "我的笔记";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "note-delete";
    remove.textContent = "删除";
    remove.addEventListener("click", async () => {
      notes = notes.filter((item) => item.id !== note.id);
      await persistNotes();
      renderNotes();
    });
    header.append(time, type, remove);
    card.append(header);
    if (note.type === "qa") {
      const question = document.createElement("p");
      question.className = "note-question";
      question.textContent = `Q：${note.question}`;
      const answer = document.createElement("p");
      answer.className = "note-answer";
      answer.textContent = note.answer;
      card.append(question, answer);
      if (Array.isArray(note.sources) && note.sources.length) {
        const sources = document.createElement("div");
        sources.className = "note-sources";
        for (const source of note.sources) {
          const link = document.createElement("a");
          link.href = safeExternalUrl(source.url) || "#";
          link.target = "_blank";
          link.rel = "noreferrer noopener";
          link.textContent = String(source.title || "外部资料").slice(0, 28);
          sources.append(link);
        }
        card.append(sources);
      }
    } else {
      const text = document.createElement("p");
      text.className = "note-text";
      text.textContent = note.text;
      card.append(text);
    }
    elements.notesList.append(card);
  }
}

async function openSelectedTextInsight(node, segment) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!node.contains(range.commonAncestorContainer)) return;
  const selectedText = selection.toString().replace(/\s+/gu, " ").trim();
  if (selectedText.length < 2) return;
  if (!(await ensureAiConsent())) return;
  activeInsightSelection = { segment, selectedText };
  elements.insightKicker.textContent = formatTime(segment.from);
  elements.insightExcerpt.textContent = selectedText;
  elements.insightContent.hidden = true;
  elements.insightError.hidden = true;
  elements.insightLoading.hidden = false;

  if (!elements.insightDialog.open) {
    elements.insightDialog.showModal();
  }

  requestSelectionInsight(segment, selectedText);
}

async function requestSelectionInsight(segment, selectedText, force = false) {
  const requestId = ++insightRequestId;
  elements.insightLoading.hidden = false;
  elements.insightContent.hidden = true;
  elements.insightError.hidden = true;

  const index = transcriptSegments.findIndex((item) => item.id === segment.id);
  const contextSegments = transcriptSegments
    .slice(Math.max(0, index - 3), Math.min(transcriptSegments.length, index + 4))
    .filter((item) => item.id !== segment.id)
    .map((item) => ({ ...item }));

  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "EXPLAIN_SEGMENT",
      force,
      payload: {
        video: currentVideo,
        segment: { ...segment, text: selectedText },
        fullSegmentText: segment.text,
        contextSegments
      }
    });
  } catch (error) {
    if (requestId === insightRequestId) {
      showInsightError(error.message || "AI 选中文字解释失败。");
    }
    return;
  }

  if (requestId !== insightRequestId) {
    return;
  }

  if (!response?.ok) {
    showInsightError(response?.error?.message || "AI 选中文字解释失败。");
    return;
  }

  const insight = response.insight;
  elements.insightExplanation.textContent = insight.explanation || "未能生成解释。";
  elements.insightLoading.hidden = true;
  elements.insightError.hidden = true;
  elements.insightContent.hidden = false;
}

function showInsightError(message) {
  elements.insightLoading.hidden = true;
  elements.insightContent.hidden = true;
  elements.insightError.hidden = false;
  elements.insightErrorMessage.textContent = message;
}

async function seekVideo(seconds, { preservePreview = false } = {}) {
  if (!preservePreview) stopClipPreview();
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "SEEK_ACTIVE_VIDEO",
      seconds
    });
  } catch (error) {
    showError({ code: "SEEK_FAILED", message: `视频跳转失败：${error.message}` });
    return;
  }

  if (!response?.ok) {
    showError(response?.error);
    return;
  }

  currentPlaybackSeconds = Math.max(0, Number(response.seconds) || 0);
  elements.currentTime.textContent = formatTime(response.seconds);
  highlightCurrentSegment(response.seconds, true);
}

function highlightCurrentSegment(seconds, shouldScroll = false) {
  const index = findSegmentIndex(transcriptSegments, seconds);
  if (index === activeSegmentIndex) {
    return;
  }

  if (activeSegmentIndex >= 0) {
    renderedSegments[activeSegmentIndex]?.classList.remove("active");
  }

  activeSegmentIndex = index;
  if (index < 0) {
    return;
  }

  const activeNode = renderedSegments[index];
  activeNode?.classList.add("active");

  if (shouldScroll && !activeNode?.hidden) {
    activeNode.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  }
}

function findSegmentIndex(segments, seconds) {
  let low = 0;
  let high = segments.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];

    if (seconds < segment.from) {
      high = middle - 1;
    } else if (seconds >= segment.to) {
      low = middle + 1;
    } else {
      return middle;
    }
  }

  return high >= 0 && seconds >= segments[high].from
    ? high
    : -1;
}

function filterTranscript() {
  const query = elements.searchInput.value
    .trim()
    .toLocaleLowerCase();

  for (const node of renderedSegments) {
    const searchableText = node.dataset.text.toLocaleLowerCase();
    node.hidden = Boolean(query) && !searchableText.includes(query);
  }
}

async function copyTranscript() {
  const text = transcriptSegments
    .map((segment) => `[${formatTime(segment.from)}] ${segment.text}`)
    .join("\n");

  try {
    await navigator.clipboard.writeText(text);
    const original = elements.copyButton.textContent;
    elements.copyButton.textContent = "已复制";
    window.setTimeout(() => {
      elements.copyButton.textContent = original;
    }, 1500);
  } catch (error) {
    showError({
      code: "COPY_FAILED",
      message: `复制失败：${error.message}`
    });
  }
}

function setAiStatus(message, isError = false) {
  elements.aiStatus.textContent = message;
  elements.aiStatus.classList.toggle("error-text", isError);
}

function setLoading(title, message) {
  elements.status.className = "status loading";
  elements.status.hidden = false;
  elements.statusTitle.textContent = title;
  elements.statusMessage.textContent = message;
  elements.reloadButton.disabled = true;
}

function showError(error = {}) {
  const code = error.code || "UNKNOWN_ERROR";
  elements.status.className = "status error";
  elements.status.hidden = false;
  elements.statusTitle.textContent = errorTitle(code);
  elements.statusMessage.textContent =
    error.message || "发生未知错误，请刷新页面后重试。";
  elements.reloadButton.disabled = false;

}

function errorTitle(code) {
  const titles = {
    LOGIN_REQUIRED: "需要登录 Bilibili",
    AI_SUBTITLE_NOT_FOUND: "尚未找到中文 AI 字幕",
    EMPTY_SUBTITLE: "字幕文件为空",
    VIDEO_NOT_FOUND: "播放器尚未就绪",
    UNSUPPORTED_PAGE: "当前页面不受支持",
    NETWORK_ERROR: "无法连接 Bilibili 接口",
    HTTP_ERROR: "网络请求失败",
    INVALID_JSON: "接口响应格式异常",
    SEEK_FAILED: "视频跳转失败",
    PLAYER_BRIDGE_UNAVAILABLE: "播放器连接失败",
    EXTENSION_MESSAGE_FAILED: "扩展连接失败",
    BILIBILI_API_ERROR: "Bilibili 接口返回错误"
  };

  return titles[code] || "操作失败";
}

function resetTranscript() {
  transcriptSegments = [];
  rawSubtitleSegments = [];
  renderedSegments = [];
  activeSegmentIndex = -1;
  currentVideo = null;
  currentPlaybackSeconds = 0;
  notes = [];
  currentRemix = null;
  currentOverview = null;
  currentClipRadar = null;
  favoriteClipIds = new Set();
  stopClipPreview();
  elements.transcript.replaceChildren();
  elements.videoInfo.hidden = true;
  elements.toolbar.hidden = true;
  elements.workspaceTabs.hidden = true;
  elements.overviewOutput.hidden = true;
  elements.clipsOutput.hidden = true;
  elements.remixOutput.hidden = true;
  elements.followupOutput.hidden = true;
  elements.notesList.replaceChildren();
  elements.noteCount.textContent = "0";
  updateAiConfigState();
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
