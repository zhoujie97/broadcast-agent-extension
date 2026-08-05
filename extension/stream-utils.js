(function exposeStreamUtils(root) {
  function parseSseDataBlock(block) {
    const data = String(block || "")
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") return { done: data === "[DONE]" };
    try {
      const payload = JSON.parse(data);
      const choice = payload?.choices?.[0] || {};
      return {
        done: false,
        id: String(payload?.id || ""),
        model: String(payload?.model || ""),
        text: String(choice?.delta?.content || choice?.message?.content || ""),
        finishReason: choice?.finish_reason || null
      };
    } catch {
      return { done: false, invalid: true, text: "" };
    }
  }

  root.StreamUtils = Object.freeze({ parseSseDataBlock });
})(globalThis);
