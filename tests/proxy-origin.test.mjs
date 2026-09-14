import assert from "node:assert/strict";
import test from "node:test";
import { handleProxyRequest } from "../proxy/server.mjs";

for (const path of ["/health", "/v1/register", "/v1/chat/completions", "/v1/web-search"]) {
  test(`retired endpoint ${path} never calls a provider, even with a developer key`, () => {
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.DEEPSEEK_API_KEY;
    let calls = 0;
    globalThis.fetch = () => { calls++; throw new Error("Unexpected upstream call"); };
    process.env.DEEPSEEK_API_KEY = "sk-test-developer-key";
    const response = { setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    try {
      handleProxyRequest({ method: "POST", url: path, headers: {} }, response);
      assert.equal(response.status, 410);
      assert.equal(JSON.parse(response.body).error.code, "AI_PROXY_RETIRED");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = originalKey;
    }
  });
}
