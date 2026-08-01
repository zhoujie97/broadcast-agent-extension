(() => {
try {
  globalThis.__podcastReaderCleanup?.();
} catch {
  // The extension may have been reloaded, invalidating the previous cleanup callback.
}
for (const staleOverlay of document.querySelectorAll("#podcast-reader-note-overlay")) {
  staleOverlay.remove();
}
for (const stalePanel of document.querySelectorAll("#podcast-reader-floating-panel")) {
  stalePanel.remove();
}

let observedVideo = null;
let lastReportedTick = -1;
let noteOverlay = null;
let noteOverlayPosition = null;
let floatingPanel = null;
let floatingPanelSaveTimer = null;

const handleRuntimeMessage = (message, sender, sendResponse) => {
  if (message?.type === "SEEK_VIDEO") {
    seekVideo(message.seconds)
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  if (message?.type === "GET_PLAYBACK_STATE") {
    const video = findVideo();
    sendResponse(video
      ? {
          ok: true,
          seconds: Number(video.currentTime) || 0,
          duration: Number.isFinite(video.duration) ? video.duration : null,
          paused: video.paused
        }
      : toFailure(createError("VIDEO_NOT_FOUND", "没有找到视频播放器。")));
    return false;
  }

  if (message?.type === "TOGGLE_FLOATING_PANEL") {
    toggleFloatingPanel()
      .then(sendResponse)
      .catch((error) => sendResponse(toFailure(error)));
    return true;
  }

  return false;
};
chrome.runtime.onMessage.addListener(handleRuntimeMessage);

async function toggleFloatingPanel() {
  if (!floatingPanel?.isConnected) {
    await createFloatingPanel();
    floatingPanel.hidden = false;
    await persistFloatingPanelState({ open: true });
    return { ok: true, visible: true };
  }
  const nextVisible = floatingPanel.hidden;
  floatingPanel.hidden = !nextVisible;
  await persistFloatingPanelState({ open: nextVisible });
  return { ok: true, visible: nextVisible };
}

async function createFloatingPanel() {
  const stored = await chrome.storage.local.get("floatingPanelState");
  const state = stored.floatingPanelState || {};
  const hasSavedPosition = state.layoutVersion === 3;
  const viewportWidth = Math.max(320, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  const maxPanelWidth = Math.max(296, viewportWidth - 24);
  const minPanelWidth = Math.min(480, maxPanelWidth);
  const width = clamp(Number(state.width) || 640, minPanelWidth, maxPanelWidth);
  const savedTop = Number(state.top);
  const top = hasSavedPosition && Number.isFinite(savedTop)
    ? clamp(savedTop, 0, Math.max(0, viewportHeight - 120))
    : 0;
  const availableHeight = Math.max(1, viewportHeight - top);
  const minPanelHeight = Math.min(420, availableHeight);
  const height = clamp(
    hasSavedPosition && Number(state.height) > 0
      ? Number(state.height)
      : availableHeight,
    minPanelHeight,
    availableHeight
  );
  const host = document.createElement("div");
  host.id = "podcast-reader-floating-panel";
  host.style.cssText = [
    "position:fixed",
    `top:${top}px`,
    hasSavedPosition && Number.isFinite(Number(state.left))
      ? `left:${clamp(Number(state.left), 0, Math.max(0, viewportWidth - width))}px`
      : "right:0",
    `width:${width}px`,
    `height:${height}px`,
    "z-index:2147483647",
    "pointer-events:auto"
  ].join(";");
  host.hidden = false;
  if (state.minimizedLeft != null && Number.isFinite(Number(state.minimizedLeft))) {
    host.dataset.minimizedLeft = String(state.minimizedLeft);
  }
  if (state.minimizedTop != null && Number.isFinite(Number(state.minimizedTop))) {
    host.dataset.minimizedTop = String(state.minimizedTop);
  }
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial;color-scheme:light}
      *{box-sizing:border-box}
      .window{position:relative;width:100%;height:100%;overflow:hidden;border:1px solid #23366f66;border-radius:8px;background:#f7f3df;box-shadow:0 18px 55px #0f183d40}
      .titlebar{height:46px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 10px 0 14px;color:#f7f3df;background:#23366f;cursor:move;user-select:none;touch-action:none}
      .identity{min-width:0;display:flex;align-items:center;gap:9px;font:700 14px/1.2 "PingFang SC","Microsoft YaHei",sans-serif}
      .identity i{width:7px;height:7px;flex:0 0 auto;border-radius:50%;background:#e7dc8b;box-shadow:0 0 0 2px #f7f3df33}
      .identity span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .actions{display:flex;gap:5px}
      button{width:29px;height:29px;padding:0;color:#f7f3df;border:1px solid #f7f3df55;border-radius:3px;background:transparent;cursor:pointer;font:700 16px/1 sans-serif}
      button:hover{color:#23366f;background:#f7f3df}
      iframe{display:block;width:100%;height:calc(100% - 46px);border:0;background:#f7f3df}
      .resize-width-handle{position:absolute;z-index:2;top:46px;bottom:0;left:-1px;width:9px;cursor:ew-resize;touch-action:none}
      .resize-width-handle:hover:after{content:"";position:absolute;top:0;bottom:0;left:3px;width:2px;background:#a8433b}
      .resize-height-handle{position:absolute;z-index:3;right:0;bottom:-1px;left:0;height:9px;cursor:ns-resize;touch-action:none}
      .resize-height-handle:hover:after{content:"";position:absolute;right:0;bottom:3px;left:0;height:2px;background:#a8433b}
      .window.minimized{width:34px;height:34px;border-radius:50%;box-shadow:0 5px 14px #0f183d32;opacity:1;transition:opacity .25s ease}
      .window.minimized.idle{opacity:.38}
      .window.minimized .titlebar{width:32px;height:32px;justify-content:center;padding:0;border-radius:50%;cursor:default}
      .window.minimized .identity,.window.minimized .close,.window.minimized iframe,.window.minimized .resize-width-handle,.window.minimized .resize-height-handle{display:none}
      .window.minimized .actions{display:block}
      .window.minimized .minimize{width:32px;height:32px;border:0;border-radius:50%;font:800 11px/1 "PingFang SC","Microsoft YaHei",sans-serif;cursor:grab;touch-action:none}
      .window.minimized .minimize:active{cursor:grabbing}
    </style>
    <section class="window" aria-label="播客智能阅读助手">
      <header class="titlebar">
        <div class="identity"><i></i><span>播客智能阅读助手</span></div>
        <div class="actions">
          <button class="minimize" type="button" title="最小化" aria-label="最小化">–</button>
          <button class="close" type="button" title="关闭" aria-label="关闭">×</button>
        </div>
      </header>
      <div class="resize-width-handle" title="拖动调整宽度"></div>
      <div class="resize-height-handle" title="拖动调整高度"></div>
      <iframe src="${chrome.runtime.getURL("sidepanel.html")}" title="播客智能阅读助手内容面板"></iframe>
    </section>`;
  document.documentElement.append(host);
  floatingPanel = host;
  bindFloatingPanelInteractions(host, shadow);
}

function bindFloatingPanelInteractions(host, shadow) {
  const panelWindow = shadow.querySelector(".window");
  const titlebar = shadow.querySelector(".titlebar");
  const minimizeButton = shadow.querySelector(".minimize");
  const closeButton = shadow.querySelector(".close");
  const resizeWidthHandle = shadow.querySelector(".resize-width-handle");
  const resizeHeightHandle = shadow.querySelector(".resize-height-handle");
  let suppressNextMinimizeClick = false;
  let floatingIdleTimer = null;
  const wakeFloatingControl = () => {
    window.clearTimeout(floatingIdleTimer);
    panelWindow.classList.remove("idle");
  };
  const scheduleFloatingControlIdle = () => {
    window.clearTimeout(floatingIdleTimer);
    if (!panelWindow.classList.contains("minimized")) return;
    floatingIdleTimer = window.setTimeout(() => {
      if (!host.matches(":hover") && panelWindow.classList.contains("minimized")) {
        panelWindow.classList.add("idle");
      }
    }, 3000);
  };
  host.addEventListener("pointerenter", wakeFloatingControl);
  host.addEventListener("pointerleave", scheduleFloatingControlIdle);

  closeButton.addEventListener("click", async () => {
    host.hidden = true;
    await persistFloatingPanelState({ open: false });
  });
  minimizeButton.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    wakeFloatingControl();
    if (!panelWindow.classList.contains("minimized")) return;
    event.preventDefault();
    minimizeButton.setPointerCapture(event.pointerId);
    const rect = host.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    let moved = false;
    const move = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (Math.hypot(deltaX, deltaY) > 3) moved = true;
      if (!moved) return;
      const left = clamp(startLeft + deltaX, 6, Math.max(6, window.innerWidth - 40));
      const top = clamp(startTop + deltaY, 6, Math.max(6, window.innerHeight - 40));
      host.style.right = "auto";
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
      host.dataset.minimizedLeft = String(left);
      host.dataset.minimizedTop = String(top);
    };
    const finish = () => {
      minimizeButton.removeEventListener("pointermove", move);
      minimizeButton.removeEventListener("pointerup", finish);
      minimizeButton.removeEventListener("pointercancel", finish);
      if (moved) {
        suppressNextMinimizeClick = true;
        scheduleFloatingPanelStateSave();
        window.setTimeout(() => { suppressNextMinimizeClick = false; }, 0);
      }
      scheduleFloatingControlIdle();
    };
    minimizeButton.addEventListener("pointermove", move);
    minimizeButton.addEventListener("pointerup", finish);
    minimizeButton.addEventListener("pointercancel", finish);
  });
  minimizeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (suppressNextMinimizeClick) return;
    const minimized = !panelWindow.classList.contains("minimized");
    if (minimized) {
      const rect = host.getBoundingClientRect();
      host.dataset.expandedWidth = String(rect.width);
      host.dataset.expandedHeight = String(rect.height);
      host.dataset.expandedLeft = String(rect.left);
      host.dataset.expandedTop = String(rect.top);
      panelWindow.classList.add("minimized");
      host.style.width = "34px";
      host.style.height = "34px";
      const minimizedLeft = Number(host.dataset.minimizedLeft);
      const minimizedTop = Number(host.dataset.minimizedTop);
      if (Number.isFinite(minimizedLeft) && Number.isFinite(minimizedTop)) {
        host.style.right = "auto";
        host.style.left = `${clamp(minimizedLeft, 6, Math.max(6, window.innerWidth - 40))}px`;
        host.style.top = `${clamp(minimizedTop, 6, Math.max(6, window.innerHeight - 40))}px`;
      } else {
        host.style.left = "auto";
        host.style.right = "12px";
        host.style.top = `${Math.max(12, Math.round((window.innerHeight - 34) / 2))}px`;
      }
      minimizeButton.textContent = "播";
      minimizeButton.title = "展开播客助手";
      minimizeButton.setAttribute("aria-label", "展开播客助手");
      scheduleFloatingControlIdle();
    } else {
      window.clearTimeout(floatingIdleTimer);
      panelWindow.classList.remove("idle");
      const fullscreenContainer = document.fullscreenElement;
      if (fullscreenContainer && host.parentElement !== fullscreenContainer) {
        fullscreenContainer.append(host);
      }
      panelWindow.classList.remove("minimized");
      const width = Number(host.dataset.expandedWidth) || 640;
      const height = Number(host.dataset.expandedHeight) || 720;
      host.style.width = `${width}px`;
      host.style.height = `${height}px`;
      host.style.right = "auto";
      host.style.left = `${Number(host.dataset.expandedLeft) || 20}px`;
      host.style.top = `${Number(host.dataset.expandedTop) || 64}px`;
      minimizeButton.textContent = "–";
      minimizeButton.title = "最小化";
      minimizeButton.setAttribute("aria-label", "最小化");
      keepFloatingPanelInViewport();
    }
    scheduleFloatingPanelStateSave();
  });

  titlebar.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button")) return;
    event.preventDefault();
    titlebar.setPointerCapture(event.pointerId);
    const rect = host.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    const move = (moveEvent) => {
      const left = clamp(
        startLeft + moveEvent.clientX - startX,
        8,
        Math.max(8, window.innerWidth - host.offsetWidth - 8)
      );
      const top = clamp(
        startTop + moveEvent.clientY - startY,
        8,
        Math.max(8, window.innerHeight - 54)
      );
      host.style.right = "auto";
      host.style.left = `${left}px`;
      host.style.top = `${top}px`;
    };
    const finish = () => {
      titlebar.removeEventListener("pointermove", move);
      titlebar.removeEventListener("pointerup", finish);
      titlebar.removeEventListener("pointercancel", finish);
      scheduleFloatingPanelStateSave();
    };
    titlebar.addEventListener("pointermove", move);
    titlebar.addEventListener("pointerup", finish);
    titlebar.addEventListener("pointercancel", finish);
  });

  resizeWidthHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resizeWidthHandle.setPointerCapture(event.pointerId);
    const rect = host.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = rect.width;
    const startLeft = rect.left;
    const move = (moveEvent) => {
      const maxWidth = Math.max(296, window.innerWidth - 24);
      const minWidth = Math.min(480, maxWidth);
      const width = clamp(
        startWidth + startX - moveEvent.clientX,
        minWidth,
        maxWidth
      );
      const left = clamp(startLeft + startWidth - width, 8, window.innerWidth - width - 8);
      host.style.right = "auto";
      host.style.left = `${left}px`;
      host.style.width = `${width}px`;
    };
    const finish = () => {
      resizeWidthHandle.removeEventListener("pointermove", move);
      resizeWidthHandle.removeEventListener("pointerup", finish);
      resizeWidthHandle.removeEventListener("pointercancel", finish);
      scheduleFloatingPanelStateSave();
    };
    resizeWidthHandle.addEventListener("pointermove", move);
    resizeWidthHandle.addEventListener("pointerup", finish);
    resizeWidthHandle.addEventListener("pointercancel", finish);
  });

  resizeHeightHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    resizeHeightHandle.setPointerCapture(event.pointerId);
    const rect = host.getBoundingClientRect();
    const startY = event.clientY;
    const startHeight = rect.height;
    const move = (moveEvent) => {
      const maxHeight = Math.max(320, window.innerHeight - rect.top - 8);
      const minHeight = Math.min(420, maxHeight);
      const height = clamp(
        startHeight + moveEvent.clientY - startY,
        minHeight,
        maxHeight
      );
      host.style.height = `${height}px`;
      host.dataset.expandedHeight = String(height);
    };
    const finish = () => {
      resizeHeightHandle.removeEventListener("pointermove", move);
      resizeHeightHandle.removeEventListener("pointerup", finish);
      resizeHeightHandle.removeEventListener("pointercancel", finish);
      scheduleFloatingPanelStateSave();
    };
    resizeHeightHandle.addEventListener("pointermove", move);
    resizeHeightHandle.addEventListener("pointerup", finish);
    resizeHeightHandle.addEventListener("pointercancel", finish);
  });

  const initialRect = host.getBoundingClientRect();
  host.dataset.expandedWidth = String(initialRect.width);
  host.dataset.expandedHeight = String(initialRect.height);
  host.dataset.expandedLeft = String(initialRect.left);
  host.dataset.expandedTop = String(initialRect.top);
}

function scheduleFloatingPanelStateSave() {
  window.clearTimeout(floatingPanelSaveTimer);
  floatingPanelSaveTimer = window.setTimeout(() => {
    if (!floatingPanel?.isConnected) return;
    const rect = floatingPanel.getBoundingClientRect();
    const minimized = floatingPanel.shadowRoot
      ?.querySelector(".window")
      ?.classList.contains("minimized");
    persistFloatingPanelState({
      open: !floatingPanel.hidden,
      width: Math.round(minimized
        ? Number(floatingPanel.dataset.expandedWidth) || 640
        : rect.width),
      height: Math.round(minimized
        ? Number(floatingPanel.dataset.expandedHeight) || 720
        : rect.height),
      top: Math.round(minimized
        ? Number(floatingPanel.dataset.expandedTop) || 64
        : rect.top),
      left: Math.round(minimized
        ? Number(floatingPanel.dataset.expandedLeft) || 20
        : rect.left),
      minimizedLeft: Number(floatingPanel.dataset.minimizedLeft) || null,
      minimizedTop: Number(floatingPanel.dataset.minimizedTop) || null
    });
  }, 180);
}

async function persistFloatingPanelState(patch) {
  const stored = await chrome.storage.local.get("floatingPanelState");
  await chrome.storage.local.set({
    floatingPanelState: {
      ...(stored.floatingPanelState || {}),
      layoutVersion: 3,
      ...patch
    }
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function keepFloatingPanelInViewport() {
  if (!floatingPanel?.isConnected) return;
  const rect = floatingPanel.getBoundingClientRect();
  const minimized = floatingPanel.shadowRoot
    ?.querySelector(".window")
    ?.classList.contains("minimized");
  const maxWidth = Math.max(296, window.innerWidth - 24);
  const maxHeight = Math.max(320, window.innerHeight - 24);
  if (minimized) {
    floatingPanel.style.width = "34px";
    floatingPanel.style.height = "34px";
    const minimizedLeft = Number(floatingPanel.dataset.minimizedLeft);
    const minimizedTop = Number(floatingPanel.dataset.minimizedTop);
    if (Number.isFinite(minimizedLeft) && Number.isFinite(minimizedTop)) {
      const left = clamp(minimizedLeft, 6, Math.max(6, window.innerWidth - 40));
      const top = clamp(minimizedTop, 6, Math.max(6, window.innerHeight - 40));
      floatingPanel.style.right = "auto";
      floatingPanel.style.left = `${left}px`;
      floatingPanel.style.top = `${top}px`;
      floatingPanel.dataset.minimizedLeft = String(left);
      floatingPanel.dataset.minimizedTop = String(top);
    } else {
      floatingPanel.style.left = "auto";
      floatingPanel.style.right = "12px";
      floatingPanel.style.top = `${Math.max(12, Math.round((window.innerHeight - 34) / 2))}px`;
    }
    return;
  }
  const width = Math.min(rect.width, maxWidth);
  const expandedHeight = Math.min(
    Number(floatingPanel.dataset.expandedHeight) || rect.height,
    maxHeight
  );
  const height = minimized ? 46 : expandedHeight;
  floatingPanel.style.width = `${width}px`;
  floatingPanel.style.height = `${height}px`;
  floatingPanel.style.right = "auto";
  floatingPanel.style.left = `${clamp(rect.left, 8, window.innerWidth - width - 8)}px`;
  floatingPanel.style.top = `${clamp(rect.top, 8, window.innerHeight - Math.min(height, 54))}px`;
  floatingPanel.dataset.expandedHeight = String(expandedHeight);
  scheduleFloatingPanelStateSave();
}

function findVideo() {
  const videos = [...document.querySelectorAll("video")];
  if (!videos.length) return null;
  const candidates = videos.map((video) => {
    const rect = video.getBoundingClientRect();
    const style = window.getComputedStyle(video);
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const visible =
      area >= 10_000 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0;
    return { video, area, visible };
  });
  const visibleCandidates = candidates.filter((item) => item.visible);
  const pool = visibleCandidates.length ? visibleCandidates : candidates;
  const playing = pool.filter((item) =>
    !item.video.paused && !item.video.ended && item.video.readyState > 0
  );
  if (playing.length) {
    const observedPlaying = playing.find((item) => item.video === observedVideo);
    if (observedPlaying) return observedPlaying.video;
    return playing.sort((a, b) => b.area - a.area)[0].video;
  }
  const stable = pool.find((item) => item.video === observedVideo);
  if (stable) return stable.video;
  return pool.sort((a, b) =>
    Number(b.video.readyState > 0) - Number(a.video.readyState > 0) ||
    b.area - a.area
  )[0].video;
}

async function seekVideo(seconds) {
  const target = Number(seconds);
  if (!Number.isFinite(target) || target < 0) {
    throw createError("INVALID_TIMESTAMP", "时间戳无效。");
  }

  let video = findVideo();
  if (!video) {
    video = await waitForVideo(4000);
  }
  if (!video) {
    throw createError("VIDEO_NOT_FOUND", "没有找到视频播放器，请等待播放器加载后重试。");
  }

  attachPlaybackObserver(video);
  if (video.readyState === 0) {
    await waitForEvent(video, "loadedmetadata", 4000).catch(() => {});
  }

  const duration = Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : target;
  const safeTarget = Math.min(target, Math.max(0, duration - 0.05));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (typeof video.fastSeek === "function") {
      try {
        video.fastSeek(safeTarget);
      } catch {
        video.currentTime = safeTarget;
      }
    } else {
      video.currentTime = safeTarget;
    }

    await Promise.race([
      waitForEvent(video, "seeked", 1200),
      new Promise((resolve) => window.setTimeout(resolve, 180))
    ]).catch(() => {});

    if (Math.abs((Number(video.currentTime) || 0) - safeTarget) <= 1.5) {
      break;
    }
  }

  try {
    await video.play();
  } catch {
    // 自动播放被阻止时仍保留已经完成的跳转。
  }

  reportPlaybackTime(true);
  return { ok: true, seconds: Number(video.currentTime) || safeTarget };
}

function waitForVideo(timeoutMs) {
  return new Promise((resolve) => {
    const existing = findVideo();
    if (existing) return resolve(existing);
    let settled = false;
    let observer = null;
    const finish = (video) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      observer?.disconnect();
      resolve(video);
    };
    const timeout = window.setTimeout(() => {
      finish(null);
    }, timeoutMs);
    observer = new MutationObserver(() => {
      const video = findVideo();
      if (video) finish(video);
    });
    if (!document.documentElement) {
      finish(null);
      return;
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function waitForEvent(target, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      target.removeEventListener(type, onEvent);
      reject(new Error(`${type} timeout`));
    }, timeoutMs);
    function onEvent() {
      window.clearTimeout(timeout);
      target.removeEventListener(type, onEvent);
      resolve();
    }
    target.addEventListener(type, onEvent, { once: true });
  });
}

function attachPlaybackObserver(video) {
  if (observedVideo === video) return;
  if (observedVideo) {
    for (const event of ["timeupdate", "play", "seeked", "loadedmetadata"]) {
      observedVideo.removeEventListener(event, reportPlaybackTime);
    }
  }
  observedVideo = video;
  lastReportedTick = -1;
  for (const event of ["timeupdate", "play", "seeked", "loadedmetadata"]) {
    observedVideo.addEventListener(event, reportPlaybackTime);
  }
  reportPlaybackTime(true);
  ensureNoteOverlay();
}

function reportPlaybackTime(force = false) {
  const video = observedVideo || findVideo();
  if (!video) return;
  const playbackTick = Math.floor((Number(video.currentTime) || 0) * 4);
  if (!force && playbackTick === lastReportedTick) return;
  lastReportedTick = playbackTick;
  safeRuntimeSend({
    type: "PLAYBACK_TIME",
    seconds: Number(video.currentTime) || 0,
    duration: Number.isFinite(video.duration) ? video.duration : null
  });
  updateOverlayTime(video.currentTime);
}

function findPlayerContainer(video) {
  return video?.closest(
    ".bpx-player-container, .bilibili-player, #bilibili-player, .player-wrap"
  ) || video?.parentElement;
}

function ensureNoteOverlay() {
  const video = observedVideo || findVideo();
  const container = findPlayerContainer(video);
  if (!video || !container) return;
  for (const duplicate of document.querySelectorAll("#podcast-reader-note-overlay")) {
    if (duplicate !== noteOverlay) duplicate.remove();
  }
  removeLegacyVideoNoteControls(container);
  if (noteOverlay?.isConnected && noteOverlay.parentElement === container) {
    updateNoteOverlayLayout();
    return;
  }
  noteOverlay?.remove();

  const overlay = document.createElement("div");
  overlay.id = "podcast-reader-note-overlay";
  overlay.innerHTML = `
    <div class="podcast-help-control">
      <div class="podcast-help-trigger-wrap">
        <span class="podcast-help-label"><time class="podcast-help-time">00:00:00</time></span>
        <button class="podcast-help-trigger" type="button" aria-label="记笔记或在此提问" aria-expanded="false">?</button>
      </div>
      <div class="podcast-help-actions">
        <button type="button" data-mode="note">＋ 记笔记</button>
        <button type="button" data-mode="ask">？ 在此提问</button>
      </div>
    </div>
    <form class="podcast-help-editor" hidden>
      <strong>记录当前时间点</strong>
      <textarea rows="3" maxlength="1000" placeholder="写下此刻的想法…"></textarea>
      <div><button type="button" data-action="cancel">取消</button><button type="submit" data-action="submit">保存</button></div>
      <small aria-live="polite"></small>
    </form>
    <article class="podcast-help-answer" hidden>
      <div><strong>AI 回答</strong><button type="button" data-action="close-answer" aria-label="关闭回答">×</button></div>
      <p></p>
      <div class="podcast-help-references"></div>
    </article>`;
  const style = document.createElement("style");
  style.textContent = `
    #podcast-reader-note-overlay{--answer-width:320px;--answer-max-height:240px;position:absolute;right:14px;top:14px;z-index:2147483646;display:flex;max-width:calc(100% - 28px);flex-direction:column;align-items:flex-end;gap:7px;font:13px/1.48 "PingFang SC","Microsoft YaHei",sans-serif;color:#1f2f63;pointer-events:auto}
    #podcast-reader-note-overlay *{box-sizing:border-box}
    #podcast-reader-note-overlay [hidden]{display:none!important}
    #podcast-reader-note-overlay .podcast-help-control{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
    #podcast-reader-note-overlay .podcast-help-trigger-wrap{position:relative;display:flex;align-items:center;justify-content:flex-end}
    #podcast-reader-note-overlay .podcast-help-trigger{width:34px;height:34px;padding:0;color:#f7f3df;border:1px solid #23366f;border-radius:50%;background:#23366f;box-shadow:0 5px 14px #0f183d32;cursor:grab;touch-action:none;font:800 18px/1 Georgia,serif;opacity:1;transition:opacity .25s ease}
    #podcast-reader-note-overlay.idle .podcast-help-trigger{opacity:.38}
    #podcast-reader-note-overlay.dragging .podcast-help-trigger{cursor:grabbing}
    #podcast-reader-note-overlay .podcast-help-trigger:hover,#podcast-reader-note-overlay .podcast-help-trigger:focus-visible{color:#23366f;background:#e7dc8b;outline:2px solid #fffdf3;outline-offset:2px}
    #podcast-reader-note-overlay .podcast-help-label{position:absolute;right:42px;top:50%;padding:7px 10px;color:#1f2f63;border:1px solid #23366f55;border-radius:4px;background:#fffdf3;box-shadow:0 5px 16px #0004;font-size:12px;font-weight:700;opacity:0;pointer-events:none;transform:translate(8px,-50%);transition:opacity .14s ease,transform .14s ease;white-space:nowrap}
    #podcast-reader-note-overlay .podcast-help-control:hover .podcast-help-label,#podcast-reader-note-overlay .podcast-help-control:focus-within .podcast-help-label{opacity:1;transform:translate(0,-50%)}
    #podcast-reader-note-overlay .podcast-help-actions{display:flex;gap:6px;padding:6px;border:1px solid #23366f55;border-radius:5px;background:#fffdf3;box-shadow:0 8px 24px #0005;opacity:0;visibility:hidden;pointer-events:none;transform:translateY(-5px);transition:opacity .14s ease,transform .14s ease}
    #podcast-reader-note-overlay .podcast-help-control:hover .podcast-help-actions,#podcast-reader-note-overlay .podcast-help-control:focus-within .podcast-help-actions{opacity:1;visibility:visible;pointer-events:auto;transform:none}
    #podcast-reader-note-overlay .podcast-help-actions button{padding:7px 10px;color:#1f2f63;border:1px solid #c8c2a8;border-radius:3px;background:#f7f3df;cursor:pointer;font:700 13px/1.3 "PingFang SC","Microsoft YaHei",sans-serif}
    #podcast-reader-note-overlay .podcast-help-actions button:hover{color:#f7f3df;border-color:#23366f;background:#23366f}
    #podcast-reader-note-overlay .podcast-help-editor{width:min(var(--answer-width),100%);padding:11px;border:1px solid #23366f66;border-radius:6px;background:#fffdf3;box-shadow:0 12px 36px #0007}
    #podcast-reader-note-overlay textarea{width:100%;margin:9px 0;padding:9px;color:#1f2f63;border:1px solid #c8c2a8;border-radius:4px;background:#fffdf3;resize:vertical;font:inherit}
    #podcast-reader-note-overlay .podcast-help-editor>div{display:flex;justify-content:flex-end;gap:7px}
    #podcast-reader-note-overlay .podcast-help-editor button{padding:6px 10px;color:#1f2f63;border:1px solid #c8c2a8;border-radius:3px;background:#f7f3df;cursor:pointer}
    #podcast-reader-note-overlay [data-action=submit]{color:#f7f3df!important;border-color:#23366f!important;background:#23366f!important}
    #podcast-reader-note-overlay small{display:block;margin-top:6px;color:#746f60}
    #podcast-reader-note-overlay .podcast-help-answer{width:min(var(--answer-width),100%);max-height:var(--answer-max-height);padding:11px;color:#1f2f63;border:1px solid #23366f66;border-radius:6px;background:#fffdf3;box-shadow:0 12px 36px #0008;overflow:auto}
    #podcast-reader-note-overlay .podcast-help-answer>div:first-child{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-bottom:7px;border-bottom:1px solid #23366f22}
    #podcast-reader-note-overlay .podcast-help-answer [data-action=close-answer]{width:25px;height:25px;padding:0;color:#746f60;border:0;background:transparent;cursor:pointer;font-size:18px}
    #podcast-reader-note-overlay .podcast-help-answer p{margin:9px 0 0;white-space:pre-wrap}
    #podcast-reader-note-overlay .podcast-help-references{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}
    #podcast-reader-note-overlay .podcast-help-references:empty{display:none}
    #podcast-reader-note-overlay .podcast-help-references button,#podcast-reader-note-overlay .podcast-help-references a{padding:4px 6px;color:#23366f;border:1px solid #23366f33;border-radius:3px;background:#f7f3df;cursor:pointer;font:700 11px/1.3 "PingFang SC","Microsoft YaHei",sans-serif;text-decoration:none}
    #podcast-reader-note-overlay .podcast-help-references a{color:#a8433b;border-color:#a8433b44}
    #podcast-reader-note-overlay.fullscreen{right:20px;top:20px;font-size:14px}
    #podcast-reader-note-overlay.fullscreen .podcast-help-trigger{width:34px;height:34px}
    @media (max-height:520px){#podcast-reader-note-overlay{right:10px;top:10px}}
    @media (prefers-reduced-motion:reduce){#podcast-reader-note-overlay .podcast-help-label,#podcast-reader-note-overlay .podcast-help-actions{transition:none}}
  `;
  overlay.prepend(style);
  if (getComputedStyle(container).position === "static") {
    container.style.position = "relative";
  }
  container.append(overlay);
  noteOverlay = overlay;
  if (noteOverlayPosition) {
    const triggerLeft = clamp(
      noteOverlayPosition.x * container.clientWidth,
      4,
      Math.max(4, container.clientWidth - 38)
    );
    const triggerTop = clamp(
      noteOverlayPosition.y * container.clientHeight,
      4,
      Math.max(4, container.clientHeight - 38)
    );
    overlay.style.right = `${Math.max(4, container.clientWidth - triggerLeft - 34)}px`;
    overlay.style.top = `${triggerTop}px`;
  }
  for (const eventName of ["click", "dblclick", "pointerdown", "mousedown"]) {
    overlay.addEventListener(eventName, (event) => event.stopPropagation());
  }

  const trigger = overlay.querySelector(".podcast-help-trigger");
  const control = overlay.querySelector(".podcast-help-control");
  const actions = overlay.querySelector(".podcast-help-actions");
  const editor = overlay.querySelector(".podcast-help-editor");
  const textarea = overlay.querySelector("textarea");
  const message = overlay.querySelector("small");
  const editorTitle = editor.querySelector("strong");
  const submitButton = editor.querySelector('[data-action="submit"]');
  const answerCard = overlay.querySelector(".podcast-help-answer");
  const answerText = answerCard.querySelector("p");
  const references = answerCard.querySelector(".podcast-help-references");
  let questionDragMoved = false;
  trigger.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    trigger.setPointerCapture(event.pointerId);
    const containerRect = container.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = triggerRect.left - containerRect.left;
    const startTop = triggerRect.top - containerRect.top;
    questionDragMoved = false;
    overlay.classList.remove("idle");
    overlay.classList.add("dragging");
    const move = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (Math.hypot(deltaX, deltaY) > 3) questionDragMoved = true;
      if (!questionDragMoved) return;
      const left = clamp(startLeft + deltaX, 4, Math.max(4, containerRect.width - 38));
      const top = clamp(startTop + deltaY, 4, Math.max(4, containerRect.height - 38));
      overlay.style.right = `${Math.max(4, containerRect.width - left - 34)}px`;
      overlay.style.top = `${top}px`;
      noteOverlayPosition = {
        x: left / Math.max(1, containerRect.width),
        y: top / Math.max(1, containerRect.height)
      };
    };
    const finish = () => {
      trigger.removeEventListener("pointermove", move);
      trigger.removeEventListener("pointerup", finish);
      trigger.removeEventListener("pointercancel", finish);
      overlay.classList.remove("dragging");
    };
    trigger.addEventListener("pointermove", move);
    trigger.addEventListener("pointerup", finish);
    trigger.addEventListener("pointercancel", finish);
  });
  trigger.addEventListener("click", (event) => event.stopPropagation());
  for (const modeButton of actions.querySelectorAll("[data-mode]")) {
    modeButton.addEventListener("click", () => {
      const mode = modeButton.dataset.mode;
      editor.dataset.mode = mode;
      editorTitle.textContent = mode === "ask" ? "对此刻的谈话提问" : "记录当前时间点";
      textarea.placeholder = mode === "ask"
        ? "例如：这里提到的电影《天与地》是什么？"
        : "写下此刻的想法…";
      submitButton.textContent = mode === "ask" ? "向 AI 提问" : "保存";
      textarea.value = "";
      message.textContent = "";
      trigger.setAttribute("aria-expanded", "false");
      editor.hidden = false;
      textarea.focus();
    });
  }
  overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => {
    editor.hidden = true;
    textarea.value = "";
    message.textContent = "";
  });
  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = textarea.value.trim();
    if (!text) return;
    const currentVideo = findVideo() || observedVideo || video;
    const seconds = Number(currentVideo?.currentTime) || 0;
    const mode = editor.dataset.mode || "note";
    submitButton.disabled = true;
    message.textContent = mode === "ask" ? "AI 正在结合当前谈话与外部资料回答…" : "正在保存…";
    const response = await safeRuntimeSend({
      type: mode === "ask" ? "ASK_PAGE_CONTEXT" : "SAVE_PAGE_NOTE",
      payload: mode === "ask"
        ? { seconds, question: text }
        : { seconds, text }
    });
    submitButton.disabled = false;
    if (!response?.ok) {
      message.textContent = response?.error?.message || (mode === "ask" ? "回答失败" : "保存失败");
      return;
    }
    if (mode === "ask") {
      renderPageAnswer(response.answer, answerText, references);
      answerCard.hidden = false;
      editor.hidden = true;
      textarea.value = "";
      message.textContent = "";
      return;
    }
    message.textContent = `已保存 ${formatTime(seconds)}`;
    textarea.value = "";
  });
  overlay.querySelector('[data-action="close-answer"]').addEventListener("click", () => {
    answerCard.hidden = true;
  });
  let fadeOverlayTimer = null;
  overlay.addEventListener("mouseenter", () => {
    window.clearTimeout(fadeOverlayTimer);
    overlay.classList.remove("idle");
  });
  overlay.addEventListener("mouseleave", () => {
    window.clearTimeout(fadeOverlayTimer);
    fadeOverlayTimer = window.setTimeout(() => {
      if (!overlay.matches(":hover")) overlay.classList.add("idle");
    }, 3000);
  });
  fadeOverlayTimer = window.setTimeout(() => {
    if (!overlay.matches(":hover")) overlay.classList.add("idle");
  }, 3000);
  updateOverlayTime(video.currentTime);
  updateNoteOverlayLayout();
}

function removeLegacyVideoNoteControls(container) {
  for (const element of container.querySelectorAll("button, [role='button']")) {
    if (element.closest("#podcast-reader-note-overlay")) continue;
    const label = String(element.textContent || "").replace(/\s+/gu, " ").trim();
    if (/^\+\s*记笔记\s+\d{2}:\d{2}:\d{2}/u.test(label)) {
      element.remove();
    }
  }
}

function renderPageAnswer(answer, answerText, references) {
  answerText.textContent = answer?.answer || "暂时没有得到可用回答。";
  references.replaceChildren();
  for (const source of Array.isArray(answer?.sources) ? answer.sources : []) {
    let url;
    try {
      url = new URL(source.url);
      if (!["http:", "https:"].includes(url.protocol)) continue;
    } catch {
      continue;
    }
    const link = document.createElement("a");
    link.href = url.href;
    link.target = "_blank";
    link.rel = "noreferrer noopener";
    link.textContent = String(source.title || "外部资料").slice(0, 24);
    references.append(link);
  }
}

function updateNoteOverlayLayout() {
  if (!noteOverlay?.isConnected) return;
  const container = noteOverlay.parentElement;
  const rect = container?.getBoundingClientRect();
  if (!rect?.width || !rect?.height) return;
  const fullscreen = Boolean(document.fullscreenElement);
  const width = fullscreen
    ? clamp(rect.width * 0.32, 340, 480)
    : clamp(rect.width * 0.38, 260, 330);
  const maxHeight = fullscreen
    ? clamp(rect.height * 0.52, 260, 460)
    : clamp(rect.height * 0.42, 180, 280);
  noteOverlay.classList.toggle("fullscreen", fullscreen);
  noteOverlay.style.setProperty("--answer-width", `${Math.round(width)}px`);
  noteOverlay.style.setProperty("--answer-max-height", `${Math.round(maxHeight)}px`);
}

function updateOverlayTime(seconds) {
  const formatted = formatTime(seconds);
  for (const time of noteOverlay?.querySelectorAll("time") || []) {
    time.textContent = formatted;
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  return [Math.floor(safe / 3600), Math.floor((safe % 3600) / 60), safe % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function createError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function safeRuntimeSend(message) {
  try {
    if (!chrome?.runtime?.id) {
      return {
        ok: false,
        error: { message: "扩展刚刚重新加载，请刷新 Bilibili 页面后再试。" }
      };
    }
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return {
      ok: false,
      error: {
        message: String(error?.message || error).includes("context invalidated")
          ? "扩展刚刚重新加载，请刷新 Bilibili 页面后再试。"
          : error?.message || "扩展消息发送失败。"
      }
    };
  }
}

function toFailure(error) {
  return {
    ok: false,
    error: { code: error.code || "SEEK_FAILED", message: error.message || String(error) }
  };
}

function connectToCurrentPlayer() {
  const video = findVideo();
  if (video) attachPlaybackObserver(video);
}

connectToCurrentPlayer();
const playbackInterval = window.setInterval(() => {
  const video = findVideo();
  if (video && video !== observedVideo) attachPlaybackObserver(video);
  reportPlaybackTime();
  ensureNoteOverlay();
}, 1000);

const playerObserver = new MutationObserver(connectToCurrentPlayer);
playerObserver.observe(document.documentElement, { childList: true, subtree: true });
const handleFullscreenChange = () => {
  window.setTimeout(() => {
    connectToCurrentPlayer();
    ensureNoteOverlay();
    if (floatingPanel?.isConnected) {
      const parent = document.fullscreenElement || document.documentElement;
      parent.append(floatingPanel);
      keepFloatingPanelInViewport();
    }
  }, 50);
};
document.addEventListener("fullscreenchange", handleFullscreenChange);
window.addEventListener("resize", keepFloatingPanelInViewport);
window.addEventListener("resize", updateNoteOverlayLayout);

globalThis.__podcastReaderCleanup = () => {
  window.clearInterval(playbackInterval);
  window.clearTimeout(floatingPanelSaveTimer);
  playerObserver.disconnect();
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  window.removeEventListener("resize", keepFloatingPanelInViewport);
  window.removeEventListener("resize", updateNoteOverlayLayout);
  chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
  if (observedVideo) {
    for (const event of ["timeupdate", "play", "seeked", "loadedmetadata"]) {
      observedVideo.removeEventListener(event, reportPlaybackTime);
    }
  }
  noteOverlay?.remove();
  floatingPanel?.remove();
};
})();
