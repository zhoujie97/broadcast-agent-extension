import assert from "node:assert/strict";
import test from "node:test";

process.env.VERCEL = "1";
const { isOriginAllowed, normalizeSearchDomain } = await import("../proxy/server.mjs");

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
