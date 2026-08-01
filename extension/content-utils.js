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
      for (const item of pool) {
        const url = String(item?.url || "").trim();
        if (!url || seenUrls.has(url)) continue;
        seenUrls.add(url);
        output.push(item);
        if (seenUrls.size >= Math.min(target, availableCount)) break;
      }
    }
    return output;
  }

  root.ContentUtils = Object.freeze({
    PERSON_SPECIFIC_REMIX_STYLES,
    normalizeGuestNames,
    remixCacheScope,
    balanceFollowupGuestItems
  });
})(globalThis);
