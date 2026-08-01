import assert from "node:assert/strict";
import test from "node:test";

await import("../extension/person-utils.js");
const { findNearNameInTitle, countEvidenceSupport } = globalThis.PersonUtils;

test("finds a single one-character name correction in the video title", () => {
  assert.equal(
    findNearNameInTitle("张若楠", "金靖和章若楠聊女性成长"),
    "章若楠"
  );
});

test("does not change names already present in the title", () => {
  assert.equal(findNearNameInTitle("金靖", "金靖和章若楠聊女性成长"), "");
});

test("requires two distinct search results to support a correction", () => {
  const results = [
    { title: "章若楠人物资料", content: "中国女演员章若楠", url: "https://a.test/1" },
    { title: "章若楠专访", content: "章若楠谈表演", url: "https://b.test/2" },
    { title: "重复结果", content: "章若楠", url: "https://b.test/2" }
  ];
  assert.equal(countEvidenceSupport(results, "章若楠"), 2);
});
