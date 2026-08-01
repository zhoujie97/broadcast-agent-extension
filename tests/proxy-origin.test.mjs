import assert from "node:assert/strict";
import test from "node:test";

process.env.VERCEL = "1";
const {
  isOriginAllowed,
  normalizeDeepSeekWebSearchResponse,
  normalizeSearchDomain
} = await import("../proxy/server.mjs");

test("allows an exact published extension Origin", () => {
  assert.equal(isOriginAllowed(
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    {
      exactOrigins: new Set([
        "chrome-extension://abcdefghijklmnopabcdefghijklmnop"
      ]),
      extensionSchemes: new Set(),
      allowAnyExtension: false
    }
  ), true);
});

test("allows valid Chrome and Edge extension Origins with an explicit wildcard", () => {
  const options = {
    exactOrigins: new Set(),
    extensionSchemes: new Set(["chrome-extension"]),
    allowAnyExtension: false
  };
  assert.equal(isOriginAllowed(
    "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
    options
  ), true);
});

test("wildcard never permits web pages or malformed extension Origins", () => {
  const options = {
    exactOrigins: new Set(),
    extensionSchemes: new Set(["chrome-extension"]),
    allowAnyExtension: false
  };
  assert.equal(isOriginAllowed("https://example.com", options), false);
  assert.equal(isOriginAllowed("chrome-extension://", options), false);
  assert.equal(isOriginAllowed(
    "chrome-extension://valid-id.example.com",
    options
  ), false);
});

test("accepts only normalized hostnames for search domain filters", () => {
  assert.equal(normalizeSearchDomain("baike.baidu.com"), "baike.baidu.com");
  assert.equal(normalizeSearchDomain(" BAike.Baidu.com "), "baike.baidu.com");
  assert.equal(normalizeSearchDomain("https://baike.baidu.com/path"), "");
  assert.equal(normalizeSearchDomain("baike.baidu.com,example.com"), "");
});

test("normalizes and limits DeepSeek web search results", () => {
  const payload = {
    content: [{
      type: "web_search_tool_result",
      content: [
        {
          type: "web_search_result",
          title: "人物资料",
          url: "https://baike.baidu.com/item/example",
          page_age: "2026-07-31"
        },
        {
          type: "web_search_result",
          title: "重复资料",
          url: "https://baike.baidu.com/item/example"
        },
        {
          type: "web_search_result",
          title: "第二条资料",
          url: "https://example.com/profile",
          content: "公开人物介绍"
        }
      ]
    }]
  };

  assert.deepEqual(normalizeDeepSeekWebSearchResponse(payload, 2), [
    {
      title: "人物资料",
      content: "人物资料",
      link: "https://baike.baidu.com/item/example",
      media: "",
      publish_date: "2026-07-31"
    },
    {
      title: "第二条资料",
      content: "公开人物介绍",
      link: "https://example.com/profile",
      media: "",
      publish_date: ""
    }
  ]);
});
