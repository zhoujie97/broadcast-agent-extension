(function exposePersonUtils(root) {
  function normalizeName(value) {
    return String(value || "").replace(/\s+/gu, "").trim();
  }

  function findNearNameInTitle(name, title) {
    const normalizedName = normalizeName(name);
    if (
      normalizedName.length < 3 ||
      normalizedName.length > 4 ||
      String(title || "").includes(normalizedName)
    ) {
      return "";
    }
    const candidates = new Set();
    const runs = String(title || "").match(/[\p{Script=Han}]{2,}/gu) || [];
    for (const run of runs) {
      for (let index = 0; index <= run.length - normalizedName.length; index += 1) {
        const candidate = run.slice(index, index + normalizedName.length);
        let differences = 0;
        for (let offset = 0; offset < normalizedName.length; offset += 1) {
          if (candidate[offset] !== normalizedName[offset]) differences += 1;
        }
        if (differences === 1) candidates.add(candidate);
      }
    }
    return candidates.size === 1 ? [...candidates][0] : "";
  }

  function countEvidenceSupport(results, name) {
    const normalizedName = normalizeName(name);
    const urls = new Set();
    for (const item of Array.isArray(results) ? results : []) {
      const evidence = normalizeName(`${item?.title || ""} ${item?.content || ""}`);
      const url = String(item?.url || "").trim();
      if (url && evidence.includes(normalizedName)) urls.add(url);
    }
    return urls.size;
  }

  root.PersonUtils = Object.freeze({
    normalizeName,
    findNearNameInTitle,
    countEvidenceSupport
  });
})(globalThis);
