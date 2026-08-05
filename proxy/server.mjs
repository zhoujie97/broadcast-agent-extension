import http from "node:http";
import crypto from "node:crypto";

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 8787;
const IS_VERCEL = process.env.VERCEL === "1";
const IS_LOCAL = !IS_VERCEL && HOST === "127.0.0.1";
const DEEPSEEK_API_KEY = String(process.env.DEEPSEEK_API_KEY || "").trim();
const MODEL = String(process.env.AI_MODEL || "deepseek-v4-flash").trim();
const FALLBACK_MODEL = String(process.env.AI_FALLBACK_MODEL || "").trim();
const SESSION_SIGNING_SECRET = String(
  process.env.SESSION_SIGNING_SECRET || (
    IS_LOCAL ? "local-development-only-secret" : ""
  )
).trim();
const DEEPSEEK_CHAT_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_ANTHROPIC_MESSAGES_URL =
  "https://api.deepseek.com/anthropic/v1/messages";
const MAX_BODY_BYTES = clamp(
  Number(process.env.MAX_BODY_BYTES),
  64 * 1024,
  2 * 1024 * 1024,
  1024 * 1024
);
const REQUEST_TIMEOUT_MS = clamp(
  Number(process.env.REQUEST_TIMEOUT_MS),
  10_000,
  180_000,
  90_000
);
const SESSION_TTL_SECONDS = clamp(
  Number(process.env.SESSION_TTL_SECONDS),
  300,
  30 * 24 * 3600,
  7 * 24 * 3600
);
const RATE_LIMIT_PER_MINUTE = clamp(
  Number(process.env.RATE_LIMIT_PER_MINUTE),
  1,
  120,
  8
);
const DAILY_INSTALLATION_UNITS = clamp(
  Number(process.env.DAILY_INSTALLATION_UNITS),
  1,
  10_000,
  80
);
const GLOBAL_DAILY_UNITS = clamp(
  Number(process.env.GLOBAL_DAILY_UNITS),
  1,
  1_000_000,
  5000
);
const FREE_DAILY_CALLS_PER_FEATURE = clamp(
  Number(process.env.FREE_DAILY_CALLS_PER_FEATURE),
  1,
  100,
  2
);
const allowedOriginRules = String(
  process.env.ALLOWED_EXTENSION_ORIGINS || ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedOrigins = new Set(
  allowedOriginRules.filter((value) => !value.endsWith("://*"))
);
const allowedExtensionSchemes = new Set(
  allowedOriginRules
    .filter((value) =>
      ["chrome-extension://*", "moz-extension://*"].includes(value)
    )
    .map((value) => value.slice(0, -3))
);
const minuteUsage = new Map();
const dailyUsage = new Map();
let globalDailyUsage = { day: utcDay(), units: 0 };

export async function handleProxyRequest(request, response) {
  const requestId = request.headers["x-request-id"] || crypto.randomUUID();
  const origin = String(request.headers.origin || "");
  const corsOrigin = resolveCorsOrigin(origin);
  setSecurityHeaders(response, requestId);

  try {
    assertProductionConfiguration();
  } catch (error) {
    return sendProxyError(response, error);
  }

  if (request.method === "OPTIONS") {
    if (!corsOrigin) {
      logRejectedOrigin({ requestId, path: request.url, origin });
      return sendJson(response, 403, {
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: `Origin not allowed（收到：${originForDiagnostics(origin)}）`
        }
      });
    }
    setCorsHeaders(response, corsOrigin);
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    if (corsOrigin) setCorsHeaders(response, corsOrigin);
    return sendJson(response, 200, {
      ok: true,
      provider: "deepseek",
      model: MODEL,
      fallbackConfigured: Boolean(FALLBACK_MODEL),
      streaming: true,
      webSearchProvider: "deepseek",
      webSearchConfigured: isWebSearchConfigured(),
      freeDailyCallsPerFeature: FREE_DAILY_CALLS_PER_FEATURE
    });
  }

  if (!corsOrigin) {
    logRejectedOrigin({ requestId, path: request.url, origin });
    return sendJson(response, 403, {
      error: {
        code: "ORIGIN_NOT_ALLOWED",
        message: `Origin not allowed（收到：${originForDiagnostics(origin)}）`
      }
    });
  }
  setCorsHeaders(response, corsOrigin);

  if (request.method === "POST" && request.url === "/v1/register") {
    try {
      enforceRegistrationRateLimit(clientIp(request));
      const input = await readJsonBody(request);
      const installationId = normalizeInstallationId(input.installationId);
      const token = signSessionToken(installationId);
      return sendJson(response, 200, {
        ok: true,
        token,
        expiresIn: SESSION_TTL_SECONDS
      });
    } catch (error) {
      return sendProxyError(response, error);
    }
  }

  if (request.method !== "POST") {
    return sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Not found" }
    });
  }

  let session;
  try {
    session = authenticateRequest(request);
  } catch (error) {
    return sendProxyError(response, error);
  }

  const feature = normalizeFeature(request.headers["x-ai-feature"]);
  const quotaFeature = quotaFeatureForRequest(feature);
  const actionId = normalizeActionId(request.headers["x-ai-action-id"]);
  let userApiKey = "";
  const units = featureUnits(feature);
  try {
    userApiKey = normalizeUserApiKey(request.headers["x-deepseek-api-key"]);
    enforceMinuteRateLimit(session.installationId, clientIp(request));
    if (!userApiKey) {
      consumeFreeQuota(
        session.installationId,
        quotaFeature,
        actionId,
        units
      );
    }
  } catch (error) {
    return sendProxyError(response, error);
  }

  const startedAt = Date.now();
  try {
    if (request.url === "/v1/web-search") {
      const input = await readJsonBody(request);
      const searchQuery = String(input.query || "").trim().slice(0, 100);
      if (!searchQuery) {
        throw httpError(400, "INVALID_QUERY", "query is required");
      }
      const upstream = await requestWebSearch({
        query: searchQuery,
        count: clamp(Number(input.count), 1, 20, 10),
        domain: normalizeSearchDomain(input.domain),
        apiKey: userApiKey || DEEPSEEK_API_KEY
      });
      return relayUpstream(response, upstream);
    }

    if (request.url === "/v1/chat/completions") {
      const input = await readJsonBody(request);
      const messages = sanitizeMessages(input.messages);
      const upstream = await requestChatCompletion({
        model: MODEL,
        messages,
        temperature: input.temperature,
        maxTokens: input.max_tokens,
        responseFormat: input.response_format,
        stream: input.stream === true,
        apiKey: userApiKey || DEEPSEEK_API_KEY
      });
      return await relayUpstream(response, upstream);
    }

    return sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Not found" }
    });
  } catch (error) {
    return sendProxyError(response, error);
  } finally {
    logRequest({
      requestId,
      path: request.url,
      feature,
      units,
      durationMs: Date.now() - startedAt
    });
  }
}

function assertProductionConfiguration() {
  if (!DEEPSEEK_API_KEY) {
    throw httpError(503, "PROXY_NOT_CONFIGURED", "缺少 DEEPSEEK_API_KEY。");
  }
  if (!SESSION_SIGNING_SECRET || SESSION_SIGNING_SECRET.length < 24) {
    throw httpError(
      503,
      "PROXY_NOT_CONFIGURED",
      "生产环境必须配置至少 24 字符的 SESSION_SIGNING_SECRET。"
    );
  }
  if (!IS_LOCAL && allowedOriginRules.length === 0) {
    throw httpError(
      503,
      "PROXY_NOT_CONFIGURED",
      "生产环境必须配置 ALLOWED_EXTENSION_ORIGINS。"
    );
  }
}

async function requestChatCompletion({
  model,
  messages,
  temperature,
  maxTokens,
  responseFormat,
  stream,
  apiKey
}) {
  const requestModel = async (selectedModel) => fetchWithTimeout(
    DEEPSEEK_CHAT_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        stream: stream === true,
        temperature: clamp(Number(temperature), 0, 1, 0.2),
        max_tokens: clamp(Number(maxTokens), 1, 8192, 4096),
        thinking: { type: "disabled" },
        ...(responseFormat?.type === "json_object"
          ? { response_format: { type: "json_object" } }
          : {})
      })
    }
  );

  const primary = await requestModel(model);
  if (primary.ok || !FALLBACK_MODEL || primary.status < 500) return primary;
  return requestModel(FALLBACK_MODEL);
}

function isWebSearchConfigured() {
  return Boolean(DEEPSEEK_API_KEY);
}

async function requestWebSearch({ query, count, domain = "", apiKey }) {
  if (!apiKey) {
    throw httpError(
      503,
      "WEB_SEARCH_NOT_CONFIGURED",
      "联网搜索未配置；请设置 DEEPSEEK_API_KEY。"
    );
  }
  const upstream = await fetchWithTimeout(DEEPSEEK_ANTHROPIC_MESSAGES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      thinking: { type: "disabled" },
      messages: [{
        role: "user",
        content: `请联网搜索“${query}”，只返回与查询直接相关的可靠结果。`
      }],
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 1,
        ...(domain ? { allowed_domains: [domain] } : {})
      }]
    })
  });
  if (!upstream.ok) return upstream;
  const payload = await upstream.json().catch(() => ({}));
  return new Response(JSON.stringify({
    search_result: normalizeDeepSeekWebSearchResponse(payload, count)
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export function normalizeDeepSeekWebSearchResponse(payload, count = 10) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  const results = [];
  const seenUrls = new Set();
  for (const block of blocks) {
    if (block?.type !== "web_search_tool_result") continue;
    const items = Array.isArray(block.content) ? block.content : [];
    for (const item of items) {
      if (item?.type !== "web_search_result") continue;
      const link = String(item.url || item.link || "").trim();
      if (!/^https?:\/\//iu.test(link) || seenUrls.has(link)) continue;
      seenUrls.add(link);
      results.push({
        title: String(item.title || "未命名结果"),
        content: String(item.snippet || item.content || item.title || ""),
        link,
        media: String(item.source || ""),
        publish_date: String(item.page_age || item.publish_date || "")
      });
      if (results.length >= clamp(Number(count), 1, 20, 10)) return results;
    }
  }
  return results;
}

export function normalizeSearchDomain(value) {
  const domain = String(value || "").trim().toLowerCase();
  return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/u.test(domain) ? domain : "";
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw httpError(504, "UPSTREAM_TIMEOUT", "AI service timed out");
    }
    throw httpError(502, "UPSTREAM_NETWORK_ERROR", "AI service unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

async function relayUpstream(response, upstream) {
  const contentType = upstream.headers.get("content-type") || "application/json";
  response.writeHead(upstream.status, {
    "Content-Type": contentType,
    "Cache-Control": contentType.includes("text/event-stream")
      ? "no-cache, no-transform"
      : "no-store",
    ...(contentType.includes("text/event-stream")
      ? { "X-Accel-Buffering": "no" }
      : {})
  });
  response.flushHeaders?.();
  if (!upstream.body) {
    response.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    while (!response.destroyed) {
      const { done, value } = await reader.read();
      if (done) break;
      response.write(Buffer.from(value));
      response.flush?.();
    }
  } finally {
    reader.releaseLock();
  }
  if (!response.destroyed) response.end();
}

function resolveCorsOrigin(origin) {
  return isOriginAllowed(origin) ? origin : "";
}

function originForDiagnostics(origin) {
  const normalized = String(origin || "").trim();
  return /^(?:chrome-extension|moz-extension):\/\/[a-z0-9-]{1,80}$/iu.test(normalized)
    ? normalized
    : normalized ? "非扩展 Origin" : "未携带 Origin";
}

function logRejectedOrigin({ requestId, path, origin }) {
  console.warn(JSON.stringify({
    level: "warning",
    event: "origin_rejected",
    requestId,
    path,
    origin: originForDiagnostics(origin)
  }));
}

export function isOriginAllowed(origin, {
  exactOrigins = allowedOrigins,
  extensionSchemes = allowedExtensionSchemes,
  allowAnyExtension = IS_LOCAL
} = {}) {
  if (exactOrigins.has(origin)) return true;
  const extensionOrigin = origin.match(
    /^(chrome-extension|moz-extension):\/\/[a-z0-9-]+$/iu
  );
  if (
    extensionOrigin &&
    extensionSchemes.has(extensionOrigin[1].toLowerCase())
  ) {
    return true;
  }
  return Boolean(allowAnyExtension && extensionOrigin);
}

function setCorsHeaders(response, origin) {
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Installation-ID, X-AI-Feature, X-AI-Action-ID, X-DeepSeek-API-Key, X-Request-ID"
  );
}

function setSecurityHeaders(response, requestId) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Request-ID", requestId);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw httpError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "INVALID_JSON", "Invalid JSON body");
  }
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 100) {
    throw httpError(
      400,
      "INVALID_MESSAGES",
      "messages must contain 1-100 items"
    );
  }
  let totalCharacters = 0;
  return messages.map((message) => {
    const role = String(message?.role || "");
    const content = String(message?.content || "");
    totalCharacters += content.length;
    if (
      !["system", "user", "assistant"].includes(role) ||
      !content ||
      totalCharacters > 900_000
    ) {
      throw httpError(400, "INVALID_MESSAGE", "Invalid message");
    }
    return { role, content };
  });
}

function normalizeInstallationId(value) {
  const installationId = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,80}$/u.test(installationId)) {
    throw httpError(400, "INVALID_INSTALLATION_ID", "Invalid installation ID");
  }
  return installationId;
}

function signSessionToken(installationId) {
  const payload = Buffer.from(JSON.stringify({
    installationId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  })).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SESSION_SIGNING_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

function authenticateRequest(request) {
  const installationId = normalizeInstallationId(
    request.headers["x-installation-id"]
  );
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    throw httpError(401, "SESSION_REQUIRED", "Session token required");
  }
  const expected = crypto
    .createHmac("sha256", SESSION_SIGNING_SECRET)
    .update(payload)
    .digest("base64url");
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    throw httpError(401, "INVALID_SESSION", "Invalid session token");
  }
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw httpError(401, "INVALID_SESSION", "Invalid session token");
  }
  if (
    decoded.installationId !== installationId ||
    Number(decoded.exp) <= Math.floor(Date.now() / 1000)
  ) {
    throw httpError(401, "SESSION_EXPIRED", "Session expired");
  }
  return decoded;
}

function enforceMinuteRateLimit(installationId, ip) {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  const minuteKey = `${installationId}:${ip}:${minute}`;
  const minuteCount = minuteUsage.get(minuteKey) || 0;
  if (minuteCount >= RATE_LIMIT_PER_MINUTE) {
    throw httpError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。");
  }
  minuteUsage.set(minuteKey, minuteCount + 1);
  cleanupUsageMaps(minute, utcDay());
}

function consumeFreeQuota(installationId, quotaFeature, actionId, units) {
  const day = utcDay();
  const installation = dailyUsage.get(installationId);
  const installationUnits = installation?.day === day ? installation.units : 0;
  if (installationUnits + units > DAILY_INSTALLATION_UNITS) {
    throw httpError(429, "DAILY_QUOTA_EXCEEDED", "今日 AI 使用额度已用完。");
  }
  const features = installation?.day === day && installation.features
    ? installation.features
    : {};
  const featureUsage = quotaFeature
    ? features[quotaFeature] || { count: 0, actionIds: [] }
    : null;
  const duplicateAction = Boolean(
    featureUsage &&
    actionId &&
    featureUsage.actionIds.includes(actionId)
  );
  if (
    featureUsage &&
    !duplicateAction &&
    featureUsage.count >= FREE_DAILY_CALLS_PER_FEATURE
  ) {
    throw httpError(
      429,
      "DAILY_FEATURE_QUOTA_EXCEEDED",
      `该功能今日 ${FREE_DAILY_CALLS_PER_FEATURE} 次免费额度已用完，请在“AI 能力”中填写自己的 DeepSeek API Key。`
    );
  }
  if (globalDailyUsage.day !== day) globalDailyUsage = { day, units: 0 };
  if (globalDailyUsage.units + units > GLOBAL_DAILY_UNITS) {
    throw httpError(503, "SERVICE_BUDGET_EXCEEDED", "AI 服务今日额度已用完。");
  }
  if (featureUsage && !duplicateAction) {
    features[quotaFeature] = {
      count: featureUsage.count + 1,
      actionIds: [...featureUsage.actionIds, actionId].filter(Boolean).slice(-20)
    };
  }
  dailyUsage.set(installationId, {
    day,
    units: installationUnits + units,
    features
  });
  globalDailyUsage.units += units;
  cleanupUsageMaps(Math.floor(Date.now() / 60_000), day);
}

function enforceRegistrationRateLimit(ip) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `register:${ip}:${minute}`;
  const count = minuteUsage.get(key) || 0;
  if (count >= 10) {
    throw httpError(429, "RATE_LIMITED", "Too many registration requests");
  }
  minuteUsage.set(key, count + 1);
}

function cleanupUsageMaps(currentMinute, currentDay) {
  if (minuteUsage.size > 10_000) {
    for (const key of minuteUsage.keys()) {
      const minute = Number(key.split(":").at(-1));
      if (minute < currentMinute - 2) minuteUsage.delete(key);
    }
  }
  if (dailyUsage.size > 50_000) {
    for (const [key, value] of dailyUsage) {
      if (value.day !== currentDay) dailyUsage.delete(key);
    }
  }
}

function normalizeFeature(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/gu, "").slice(0, 64);
}

export function quotaFeatureForRequest(feature) {
  return ({
    selection_insight: "smart_transcript",
    content_map: "content_map",
    content_map_correction: "content_map",
    clip_candidates: "highlight_clips",
    remix_article: "content_remix",
    podcast_answer: "ai_question",
    ai_followup: "extended_discovery"
  })[normalizeFeature(feature)] || "";
}

function normalizeActionId(value) {
  const actionId = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{8,80}$/u.test(actionId) ? actionId : "";
}

export function normalizeUserApiKey(value) {
  const apiKey = String(value || "").trim();
  if (!apiKey) return "";
  if (!/^sk-[a-zA-Z0-9_-]{8,240}$/u.test(apiKey)) {
    throw httpError(400, "INVALID_USER_API_KEY", "DeepSeek API Key 格式不正确。");
  }
  return apiKey;
}

function featureUnits(feature) {
  return ({
    explain_segment: 1,
    podcast_answer: 1,
    ai_followup: 2,
    content_map: 3,
    content_map_correction: 3,
    person_context_verification: 2,
    interview_people: 2,
    clip_candidates: 3,
    remix_article: 5,
    web_search: 1
  })[feature] || 1;
}

function clientIp(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "")
    .split(",")[0]
    .trim()
    .slice(0, 80);
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sendProxyError(response, error) {
  const status = Number(error?.status) || 500;
  return sendJson(response, status, {
    error: {
      code: error?.code || "PROXY_ERROR",
      message: error?.message || "Proxy request failed"
    }
  });
}

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function logRequest({ requestId, path, feature, units, durationMs }) {
  console.log(JSON.stringify({
    level: "info",
    event: "proxy_request",
    requestId,
    path,
    feature,
    units,
    durationMs
  }));
}

if (!IS_VERCEL) {
  try {
    assertProductionConfiguration();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const server = http.createServer(handleProxyRequest);
  server.listen(PORT, HOST, () => {
    console.log(JSON.stringify({
      level: "info",
      event: "server_started",
      host: HOST,
      port: PORT,
      provider: "deepseek",
      model: MODEL
    }));
  });

  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}
