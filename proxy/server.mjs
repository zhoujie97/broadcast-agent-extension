// Retained only to retire previously deployed endpoints. New extensions call DeepSeek directly.
export function handleProxyRequest(request, response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Installation-ID, X-AI-Feature, X-AI-Action-ID, X-DeepSeek-API-Key, X-Request-ID");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    return response.end();
  }
  response.writeHead(410, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: {
    code: "AI_PROXY_RETIRED",
    message: "免费 AI 代理已停止服务。请更新插件，并在 AI 能力中填写自己的 DeepSeek API Key。"
  } }));
}
