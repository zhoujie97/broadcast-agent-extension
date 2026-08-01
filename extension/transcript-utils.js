(function exposeTranscriptUtils(globalScope) {
  function mergeInterviewTurns(segments) {
    if (!segments.length) {
      return [];
    }

    const turns = [];
    let current = createTurn(segments[0], 0);

    for (let index = 1; index < segments.length; index += 1) {
      const next = segments[index];

      if (shouldStartNewTurn(current, next)) {
        turns.push(finalizeTurn(current, turns.length));
        current = createTurn(next, index);
        continue;
      }

      const gap = Math.max(0, next.from - current.to);
      current.to = next.to;
      current.sourceEndIndex = index;
      current.sentenceCount += 1;
      current.text = joinSubtitleText(
        current.text,
        next.text,
        gap
      );
    }

    turns.push(finalizeTurn(current, turns.length));
    return turns;
  }

  function createTurn(segment, sourceIndex) {
    return {
      id: sourceIndex,
      from: segment.from,
      to: segment.to,
      text: segment.text,
      sourceStartIndex: sourceIndex,
      sourceEndIndex: sourceIndex,
      sentenceCount: 1
    };
  }

  function finalizeTurn(turn, id) {
    return {
      ...turn,
      id,
      text: punctuateParagraph(normalizeParagraphText(turn.text))
    };
  }

  function shouldStartNewTurn(current, next) {
    const gap = Math.max(0, next.from - current.to);
    const duration = current.to - current.from;
    const currentText = current.text.trim();
    const nextText = next.text.trim();
    const currentSpeaker = getSpeakerPrefix(currentText);
    const nextSpeaker = getSpeakerPrefix(nextText);

    if (
      currentSpeaker &&
      nextSpeaker &&
      currentSpeaker !== nextSpeaker
    ) {
      return true;
    }

    if (gap >= 1.8) {
      return true;
    }

    if (
      looksLikeQuestion(currentText) &&
      (gap >= 0.18 || looksLikeAnswerStart(nextText))
    ) {
      return true;
    }

    if (
      gap >= 0.85 &&
      endsAtNaturalBoundary(currentText) &&
      currentText.length >= 32
    ) {
      return true;
    }

    if (duration >= 42 || currentText.length >= 180) {
      return true;
    }

    return (
      current.sentenceCount >= 10 &&
      endsAtNaturalBoundary(currentText)
    );
  }

  function looksLikeQuestion(text) {
    const normalized = text.replace(/[”"’'\s]+$/u, "");
    const lastClause = normalized.split(/[，。；！？?!;：:]/u).pop() || normalized;

    if (/[?？]$/u.test(normalized)) {
      return true;
    }

    return /(?:吗|呢|么|是不是|有没有|能不能|对不对|对吧|是吧)$/u.test(
      lastClause
    ) || /(?:为什么|怎么|如何|谁|什么|哪(?:个|些|里|种)?)/u.test(lastClause);
  }

  function looksLikeAnswerStart(text) {
    return /^(?:对|是的|是|不是|没有|有|嗯|不|我觉得|我认为|其实|因为|所以|但|但是|当时|后来|可能|应该|当然|确实|首先|坦白说|老实说)/u.test(
      text
    );
  }

  function endsAtNaturalBoundary(text) {
    return /[。！？?!；;…]$/u.test(text.trim());
  }

  function getSpeakerPrefix(text) {
    const match = text.match(
      /^(主持人|嘉宾|采访者|受访者|鲁豫|姜思达|陈鲁豫)[：:]/u
    );
    return match?.[1] || "";
  }

  function joinSubtitleText(previous, next, gap = 0) {
    const left = previous.trimEnd();
    const right = next.trimStart();

    if (!left) {
      return right;
    }

    if (!right) {
      return left;
    }

    if (/^[，。！？；：,.!?;:…]/u.test(right)) {
      return `${left}${right}`;
    }
    if (/[，。！？；：,.!?;:…]$/u.test(left)) {
      return `${left}${needsLatinSpace(left, right) ? " " : ""}${right}`;
    }
    const punctuation = inferBoundaryPunctuation(left, gap);
    return `${left}${punctuation}${needsLatinSpace(left, right) ? " " : ""}${right}`;
  }

  function inferBoundaryPunctuation(text, gap) {
    if (looksLikeQuestion(text)) return "？";
    if (gap >= 0.85) return "。";
    if (/(?:对吧|是吧|好吧|没错|确实|当然|知道吗)$/u.test(text)) return "。";
    return "，";
  }

  function punctuateParagraph(text) {
    const normalized = text.trim();
    if (!normalized || /[。！？?!；;…]$/u.test(normalized)) return normalized;
    return `${normalized}${looksLikeQuestion(normalized) ? "？" : "。"}`;
  }

  function needsLatinSpace(left, right) {
    return /[a-zA-Z0-9]$/u.test(left) && /^[a-zA-Z0-9]/u.test(right);
  }

  function normalizeParagraphText(text) {
    return text
      .replace(/\s+([，。！？；：,.!?;:])/gu, "$1")
      .replace(/([，。！？；：])\s+/gu, "$1")
      .replace(/[ \t]{2,}/gu, " ")
      .trim();
  }

  function buildDouyinSearchUrl(title, artist) {
    const query = `${title || ""} ${artist || ""} 歌曲 BGM`
      .replace(/\s+/gu, " ")
      .trim();
    return `https://www.douyin.com/search/${encodeURIComponent(query)}`;
  }

  function applyTranscriptCorrections(segments, corrections) {
    const normalizedCorrections = (Array.isArray(corrections) ? corrections : [])
      .map((correction) => ({
        from: String(correction?.from || "").trim(),
        to: String(correction?.to || "").trim()
      }))
      .filter((correction) =>
        correction.from &&
        correction.to &&
        correction.from !== correction.to
      );
    let replacementCount = 0;
    const correctedSegments = (Array.isArray(segments) ? segments : []).map((segment) => {
      let text = String(segment?.text || "");
      for (const correction of normalizedCorrections) {
        const occurrences = text.split(correction.from).length - 1;
        if (!occurrences) continue;
        replacementCount += occurrences;
        text = text.split(correction.from).join(correction.to);
      }
      return { ...segment, text };
    });
    return { segments: correctedSegments, replacementCount };
  }

  const api = {
    mergeInterviewTurns,
    buildDouyinSearchUrl,
    applyTranscriptCorrections
  };
  globalScope.TranscriptUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
