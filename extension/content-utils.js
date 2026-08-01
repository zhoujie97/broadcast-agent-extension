(function exposeContentUtils(root) {
  const PERSON_SPECIFIC_REMIX_STYLES = new Set(["profile", "first_person"]);

  function normalizeGuestNames(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map((value) => String(value || "").replace(/\s+/gu, "").trim())
      .filter(Boolean))];
  }

  function remixCacheScope(style, length, guestName) {
    const normalizedStyle = String(style || "profile");
    const normalizedLength = String(length || "medium");
    const subject = PERSON_SPECIFIC_REMIX_STYLES.has(normalizedStyle)
      ? String(guestName || "").replace(/\s+/gu, "").trim() || "unselected"
      : "all-guests";
    return `${normalizedStyle}:${normalizedLength}:${subject}`;
  }

  function balanceFollowupGuestItems(
    selectedItems,
    fallbackItems,
    guestNames,
    minimumPerGuest = 3
  ) {
    const names = normalizeGuestNames(guestNames);
    const selected = Array.isArray(selectedItems) ? selectedItems : [];
    const fallbacks = Array.isArray(fallbackItems) ? fallbackItems : [];
    const target = Math.max(1, Number(minimumPerGuest) || 3);
    const output = [];
    for (const guestName of names) {
      const seenUrls = new Set();
      const guestItems = selected.filter((item) => item?.guestName === guestName);
      const guestFallbacks = fallbacks.filter((item) => item?.guestName === guestName);
      const pool = [...guestItems, ...guestFallbacks];
      const availableCount = new Set(pool.map((entry) => entry?.url).filter(Boolean)).size;
      const guestOutput = [];
      const append = (item) => {
        const url = String(item?.url || "").trim();
        if (!url || seenUrls.has(url)) return false;
        seenUrls.add(url);
        guestOutput.push(item);
        return true;
      };
      for (const item of guestItems) {
        append(item);
        if (guestOutput.length >= Math.min(target, availableCount)) break;
      }
      const hasVideo = () => guestOutput.some((item) =>
        item?.type === "podcast" || item?.type === "video"
      );
      const hasArticle = () => guestOutput.some((item) => item?.type === "article");
      if (!hasVideo()) append(guestFallbacks.find((item) =>
        item?.type === "podcast" || item?.type === "video"
      ));
      if (!hasArticle()) append(guestFallbacks.find((item) => item?.type === "article"));
      for (const item of guestFallbacks) {
        append(item);
        if (guestOutput.length >= Math.min(target, availableCount)) break;
      }
      output.push(...guestOutput);
    }
    return output;
  }

  function normalizeComparableTitle(value) {
    return String(value || "")
      .replace(/<[^>]+>/gu, "")
      .replace(/[\s|｜·•—–_《》“”"'：:，,。！？!?（）()【】\[\]]+/gu, "")
      .toLocaleLowerCase();
  }

  function extractBilibiliBvid(value) {
    return String(value || "").match(/(?:\/video\/|\b)(BV[a-zA-Z0-9]+)/iu)?.[1]
      ?.toUpperCase() || "";
  }

  function extractBilibiliAid(value) {
    return String(value || "").match(/(?:\/video\/|\b)av(\d+)/iu)?.[1] || "";
  }

  function titleBigramSimilarity(leftValue, rightValue) {
    const left = normalizeComparableTitle(leftValue);
    const right = normalizeComparableTitle(rightValue);
    if (!left || !right) return 0;
    if (left === right) return 1;
    const bigrams = (value) => {
      if (value.length < 2) return new Set([value]);
      return new Set(Array.from({ length: value.length - 1 }, (_item, index) =>
        value.slice(index, index + 2)
      ));
    };
    const leftPairs = bigrams(left);
    const rightPairs = bigrams(right);
    const overlap = [...leftPairs].filter((pair) => rightPairs.has(pair)).length;
    return (2 * overlap) / (leftPairs.size + rightPairs.size);
  }

  function isSameVideoCandidate(result, currentVideo, explicitUrl = "") {
    const candidateUrl = explicitUrl || result?.url || "";
    const currentBvid = String(currentVideo?.bvid || "").toUpperCase();
    const candidateBvid = extractBilibiliBvid(candidateUrl);
    if (currentBvid && candidateBvid && currentBvid === candidateBvid) return true;
    const currentAid = String(currentVideo?.aid || "");
    const candidateAid = extractBilibiliAid(candidateUrl);
    if (currentAid && candidateAid && currentAid === candidateAid) return true;
    const currentTitle = normalizeComparableTitle(currentVideo?.title);
    const candidateTitle = normalizeComparableTitle(result?.title);
    if (!currentTitle || !candidateTitle) return false;
    if (currentTitle === candidateTitle) return true;
    const shorter = currentTitle.length <= candidateTitle.length
      ? currentTitle
      : candidateTitle;
    const longer = shorter === currentTitle ? candidateTitle : currentTitle;
    if (
      shorter.length >= 8 &&
      longer.includes(shorter) &&
      shorter.length / longer.length >= 0.55
    ) return true;
    return Math.min(currentTitle.length, candidateTitle.length) >= 10 &&
      titleBigramSimilarity(currentTitle, candidateTitle) >= 0.82;
  }

  function shouldExcludeFollowupResult(result, currentVideo, explicitUrl = "") {
    if (isSameVideoCandidate(result, currentVideo, explicitUrl)) return true;
    return /(?:本期(?:节目|视频).{0,12}(?:原始|原)|原始视频|原视频).{0,20}(?:不推荐|占位)|不推荐.{0,20}(?:本期|原视频)/u
      .test(String(result?.why || ""));
  }

  function findStableTranscriptSegmentIndex(
    segments,
    seconds,
    activeIndex = -1,
    hysteresisSeconds = 0.2
  ) {
    const list = Array.isArray(segments) ? segments : [];
    const time = Number(seconds);
    if (!list.length || !Number.isFinite(time)) return -1;
    let low = 0;
    let high = list.length - 1;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (time < Number(list[middle]?.from || 0)) high = middle - 1;
      else low = middle + 1;
    }
    const candidate = high;
    if (candidate < 0 || activeIndex < 0 || activeIndex >= list.length) {
      return candidate;
    }
    if (candidate === activeIndex) return candidate;
    const margin = Math.max(0, Number(hysteresisSeconds) || 0);
    if (candidate > activeIndex) {
      return time >= Number(list[candidate]?.from || 0) + margin
        ? candidate
        : activeIndex;
    }
    return time < Number(list[activeIndex]?.from || 0) - margin
      ? candidate
      : activeIndex;
  }

  root.ContentUtils = Object.freeze({
    PERSON_SPECIFIC_REMIX_STYLES,
    normalizeGuestNames,
    remixCacheScope,
    balanceFollowupGuestItems,
    normalizeComparableTitle,
    extractBilibiliBvid,
    extractBilibiliAid,
    titleBigramSimilarity,
    isSameVideoCandidate,
    shouldExcludeFollowupResult,
    findStableTranscriptSegmentIndex
  });
})(globalThis);
