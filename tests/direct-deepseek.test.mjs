import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs/promises";
const source = await fs.readFile(new URL("../extension/background.js", import.meta.url), "utf8");
function storage(values = {}) {
  return { values, async get(key) { return key === null ? { ...values } : typeof key === "string" ? { [key]: values[key] } : Object.fromEntries(key.map(k => [k, values[k]])); },
    async set(input) { Object.assign(values, input); }, async remove(keys) { for (const k of [].concat(keys)) delete values[k]; }, async setAccessLevel() {} };
}
function setup({ key = "", consent = true, reply = {} , status = 200 } = {}) {
  const calls = [];
  const local = storage({ aiDataConsent: { granted: consent, version: 2 } });
  const session = storage(key ? { deepseekUserApiKeySession: key } : {});
  const event = { addListener() {} };
  const context = vm.createContext({ Headers, Response, URL, TextDecoder, AbortController, setTimeout, clearTimeout, console,
    crypto: globalThis.crypto, importScripts() {},
    chrome: { storage: { local, session }, runtime: { onInstalled: event, onMessage: event }, action: { onClicked: event } },
    fetch: async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } }); }
  });
  vm.runInContext(source, context);
  return { context, calls, local, session };
}
const key = "sk-personal-test-key";
test("missing personal key blocks chat and search without network requests", async () => {
  const { context, calls } = setup();
  await assert.rejects(context.sendAiProxyRequest({ messages: [] }), e => e.code === "USER_API_KEY_REQUIRED");
  await assert.rejects(context.performWebSearch("人物", 2), e => e.code === "USER_API_KEY_REQUIRED");
  assert.equal(calls.length, 0);
});
test("consent must be granted before sending content", async () => {
  const { context, calls } = setup({ key, consent: false });
  await assert.rejects(context.sendAiProxyRequest({ messages: [] }), e => e.code === "AI_CONSENT_REQUIRED");
  assert.equal(calls.length, 0);
});
test("chat uses only personal authorization and fixed DeepSeek model", async () => {
  const { context, calls } = setup({ key, reply: { choices: [{ message: { content: "ok" } }] } });
  await context.sendAiProxyRequest({ messages: [{ role: "user", content: "摘要" }], maxTokens: 32, enforceJson: true, stream: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].options.headers.get("Authorization"), `Bearer ${key}`);
  assert.equal(calls[0].options.headers.has("X-DeepSeek-API-Key"), false);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "deepseek-v4-flash");
  assert.equal(body.response_format.type, "json_object");
  assert.equal(body.stream, false);
});
test("search goes directly to DeepSeek and normalizes unique evidence", async () => {
  const item = { type: "web_search_result", title: "人物", url: "https://example.com/person", content: "简介" };
  const { context, calls } = setup({ key, reply: { content: [{ type: "web_search_tool_result", content: [item, item] }] } });
  const results = await context.performWebSearch("人物", 2, "example.com");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/anthropic/v1/messages");
  assert.equal(calls[0].options.headers.get("x-api-key"), key);
  assert.equal(JSON.parse(calls[0].options.body).tools[0].allowed_domains[0], "example.com");
  assert.equal(results.length, 1);
  assert.equal(results[0].content, "简介");
});
test("invalid key and insufficient balance do not retry another account", async () => {
  for (const status of [401, 402, 429]) {
    const { context, calls } = setup({ key, status, reply: { error: { message: "账户错误" } } });
    await assert.rejects(context.requestAiProxyCompletion({ messages: [] }), /账户错误/);
    assert.equal(calls.length, 1);
  }
});
test("key test requires no registration, and deleting a key blocks subsequent requests", async () => {
  const { context, calls, session, local } = setup();
  await context.testDeepSeekUserKey(key);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${key}`);
  await context.saveDeepSeekUserKey(key, false);
  assert.equal(session.values.deepseekUserApiKeySession, key);
  assert.equal(local.values.deepseekUserApiKey, undefined);
  await context.saveDeepSeekUserKey(key, true);
  assert.equal(session.values.deepseekUserApiKeySession, undefined);
  assert.equal(local.values.deepseekUserApiKey, key);
  await context.clearDeepSeekUserKey();
  await assert.rejects(context.sendAiProxyRequest({ messages: [] }), e => e.code === "USER_API_KEY_REQUIRED");
  assert.equal(calls.length, 1);
});
test("status performs no network requests and redirects cannot leak user keys", async () => {
  const { context, calls } = setup({ key });
  assert.equal((await context.getAiServiceStatus()).available, true);
  assert.equal(calls.length, 0);
  await assert.rejects(context.deepSeekFetch("https://example.com"), e => e.code === "INVALID_AI_ENDPOINT");
  assert.equal(calls.length, 0);
  await context.deepSeekFetch("https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].options.redirect, "error");
});

const panelSource = await fs.readFile(new URL("../extension/sidepanel.js", import.meta.url), "utf8");
const consentGate = panelSource.slice(panelSource.indexOf("async function ensureAiConsent()"), panelSource.indexOf("async function revokeAiConsent()"));
test("generation UI prompts for a key before consent or generation", async () => {
  let prompts = 0;
  let consentReads = 0;
  const context = vm.createContext({
    chrome: { runtime: { sendMessage: async () => ({ ok: true, configured: false }) } },
    showKeyRequiredDialog() { prompts++; },
    async readAiConsent() { consentReads++; return true; }
  });
  vm.runInContext(consentGate, context);
  assert.equal(await context.ensureAiConsent(), false);
  assert.equal(prompts, 1);
  assert.equal(consentReads, 0);
});
test("configured and consented users pass the generation UI gate", async () => {
  const context = vm.createContext({
    chrome: { runtime: { sendMessage: async () => ({ ok: true, configured: true }) } },
    showKeyRequiredDialog() { throw new Error("Unexpected key prompt"); },
    async readAiConsent() { return true; }
  });
  vm.runInContext(consentGate, context);
  assert.equal(await context.ensureAiConsent(), true);
});

test("highlight normalization retains only the short-video scenario", () => {
  const { context } = setup();
  const result = context.normalizeClipCandidates({ clips: [{
    title: "转折片段", from: 0, to: 60,
    scenarios: [
      { type: "短视频传播", fit: "高", title: "视频标题", advice: "保留转折背景" },
      { type: "深度文章", fit: "高", title: "文章标题", advice: "扩写文章" }
    ]
  }] }, [{ from: 0, to: 60, text: "一段完整的访谈内容。" }]);
  assert.equal(result.clips[0].scenarios.length, 1);
  assert.equal(result.clips[0].scenarios[0].type, "短视频传播");
  assert.equal(result.clips[0].scenarios[0].title, "视频标题");
});

test("copying older highlight results omits the article scenario", () => {
  const start = panelSource.indexOf("function formatClipPlan(");
  const end = panelSource.indexOf("async function toggleFavoriteClip", start);
  const context = vm.createContext({ formatTime: String });
  vm.runInContext(panelSource.slice(start, end), context);
  const copy = context.formatClipPlan({ scenarios: [
    { type: "短视频传播", title: "保留的视频标题", fit: "高", advice: "视频建议" },
    { type: "深度文章", title: "移除的文章标题", fit: "高", advice: "文章建议" }
  ] });
  assert.match(copy, /保留的视频标题/);
  assert.doesNotMatch(copy, /深度文章|移除的文章标题/);
});

test("transcript edit notification preserves stored and displayed AI results", async () => {
  const start = panelSource.indexOf("async function notifyGeneratedContentAfterTranscriptEdit()");
  const end = panelSource.indexOf("function renderTranscript(", start);
  let notice = "";
  const existing = { title: "已有结果" };
  const context = vm.createContext({ currentOverview: existing, currentClipRadar: existing, currentRemix: existing,
    setAiStatus(message) { notice = message; },
    chrome: { storage: { local: { remove() { throw new Error("Must preserve cache"); } }, session: { remove() { throw new Error("Must preserve cache"); } } } }
  });
  vm.runInContext(panelSource.slice(start, end), context);
  await context.notifyGeneratedContentAfterTranscriptEdit();
  assert.equal(context.currentOverview, existing);
  assert.equal(context.currentClipRadar, existing);
  assert.equal(context.currentRemix, existing);
  assert.match(notice, /已保留/);
});

test("new highlight output has four scores, per-score reasons and two songs", () => {
  const { context } = setup();
  const result = context.normalizeClipCandidates({ clips: [{ from: 0, to: 60, title: "片段",
    scores: { emotionalIntensity: 90, depthOfThought: 60, storyTension: 80, spreadPotential: 70, practicalInspiration: 99 },
    scoreReasons: { storyTension: "转折前后的叙述形成冲突，同时保留必要背景。" },
    bgmSuggestions: [1, 2, 3].map(i => ({ title: `歌${i}`, artist: "歌手", reason: "情绪匹配" }))
  }] }, [{ from: 0, to: 60, text: "完整访谈内容" }]);
  assert.equal(Object.keys(result.clips[0].scores).length, 4);
  assert.equal(result.clips[0].bgmSuggestions.length, 2);
  assert.match(result.clips[0].scoreReasons.storyTension, /转折/);
});

test("remix can identify and apply guests without generating a content map", async () => {
  const start = panelSource.indexOf("async function identifyRemixGuests()");
  const end = panelSource.indexOf("function updateRemixGuestControl()", start);
  const requests = [];
  let applied;
  const context = vm.createContext({
    currentVideo: { bvid: "BVtest", cid: 1 }, currentOverview: null,
    transcriptSegments: [{ text: "嘉宾甲和嘉宾乙" }],
    elements: { identifyRemixGuests: { disabled: false }, remixGuestsStatus: { textContent: "" } },
    ensureAiConsent: async () => true,
    videoStorageKey: () => "identifiedPeopleV1:BVtest:1",
    transcriptForAi: () => [{ text: "嘉宾甲和嘉宾乙" }],
    chrome: { runtime: { sendMessage: async message => {
      requests.push(message);
      return { ok: true, people: { interviewees: [{ name: "嘉宾甲" }, { name: "嘉宾乙" }] } };
    } } },
    applyIdentifiedPeople: async people => { applied = people; return true; },
    loadSelectedRemix: async () => {}
  });
  vm.runInContext(panelSource.slice(start, end), context);
  await context.identifyRemixGuests();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].type, "IDENTIFY_REMIX_GUESTS");
  assert.equal(applied.interviewees.length, 2);
  assert.equal(context.elements.identifyRemixGuests.disabled, false);
  assert.match(context.elements.remixGuestsStatus.textContent, /可以选择/);
});
