import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  applyTranscriptCorrections,
  buildDouyinSearchUrl
} = require("../extension/transcript-utils.js");

test("builds a deterministic Douyin song search link", () => {
  assert.equal(
    buildDouyinSearchUrl("孤勇者", "陈奕迅"),
    "https://www.douyin.com/search/%E5%AD%A4%E5%8B%87%E8%80%85%20%E9%99%88%E5%A5%95%E8%BF%85%20%E6%AD%8C%E6%9B%B2%20BGM"
  );
});

test("applies persisted name corrections to every transcript segment", () => {
  const result = applyTranscriptCorrections([
    { id: 1, text: "今天的嘉宾是叶利静老师" },
    { id: 2, text: "叶利静分享了她的采访方法" }
  ], [{ from: "叶利静", to: "易立竞" }]);
  assert.equal(result.replacementCount, 2);
  assert.deepEqual(result.segments.map((segment) => segment.text), [
    "今天的嘉宾是易立竞老师",
    "易立竞分享了她的采访方法"
  ]);
});

test("ignores empty and no-op transcript corrections", () => {
  const result = applyTranscriptCorrections(
    [{ id: 1, text: "杨天真采访易立竞" }],
    [{ from: "易立竞", to: "易立竞" }, { from: "", to: "杨天真" }]
  );
  assert.equal(result.replacementCount, 0);
  assert.equal(result.segments[0].text, "杨天真采访易立竞");
});
