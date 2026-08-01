import assert from "node:assert/strict";
import test from "node:test";

await import("../extension/content-utils.js");
const {
  balanceFollowupGuestItems,
  findStableTranscriptSegmentIndex,
  isPlausiblePersonName,
  isSameVideoCandidate,
  shouldExcludeFollowupResult,
  normalizeGuestNames,
  remixCacheScope
} = globalThis.ContentUtils;

test("accepts names but rejects titles and generic interview roles", () => {
  assert.equal(isPlausiblePersonName("金靖"), true);
  assert.equal(isPlausiblePersonName("易立竞"), true);
  assert.equal(isPlausiblePersonName("鲁豫对话金靖:什么是真正的自由"), false);
  assert.equal(isPlausiblePersonName("本期嘉宾"), false);
});

test("uses the selected guest in person-specific remix cache scopes", () => {
  assert.equal(
    remixCacheScope("profile", "medium", "詹青云"),
    "profile:medium:詹青云"
  );
  assert.equal(
    remixCacheScope("first_person", "short", "庞颖"),
    "first_person:short:庞颖"
  );
  assert.equal(
    remixCacheScope("insight_essay", "long", "詹青云"),
    "insight_essay:long:all-guests"
  );
});

test("normalizes duplicate interviewee names", () => {
  assert.deepEqual(
    normalizeGuestNames([" 詹青云 ", "庞颖", "詹青云", ""]),
    ["詹青云", "庞颖"]
  );
});

test("keeps recommendations for every interviewee", () => {
  const selected = [
    { guestName: "庞颖", type: "video", url: "https://example.com/pang-1" }
  ];
  const fallbacks = [
    { guestName: "庞颖", type: "video", url: "https://example.com/pang-1" },
    { guestName: "庞颖", type: "article", url: "https://example.com/pang-2" },
    { guestName: "詹青云", type: "video", url: "https://example.com/zhan-1" },
    { guestName: "詹青云", type: "article", url: "https://example.com/zhan-2" }
  ];
  const balanced = balanceFollowupGuestItems(
    selected,
    fallbacks,
    ["庞颖", "詹青云"],
    2
  );

  assert.deepEqual(
    balanced.map((item) => `${item.guestName}:${item.url}`),
    [
      "庞颖:https://example.com/pang-1",
      "庞颖:https://example.com/pang-2",
      "詹青云:https://example.com/zhan-1",
      "詹青云:https://example.com/zhan-2"
    ]
  );
});

test("adds both video and article coverage for each interviewee", () => {
  const balanced = balanceFollowupGuestItems(
    [
      { guestName: "庞颖", type: "video", url: "https://example.com/video-1" },
      { guestName: "庞颖", type: "video", url: "https://example.com/video-2" }
    ],
    [
      { guestName: "庞颖", type: "article", url: "https://example.com/article-1" }
    ],
    ["庞颖"],
    2
  );
  assert.deepEqual(balanced.map((item) => item.type), ["video", "video", "article"]);
});

test("detects the current Bilibili video by BV id or near-identical title", () => {
  const currentVideo = {
    aid: 123456,
    bvid: "BV1ABC123",
    title: "鲁豫有约一日行：金靖谈幽默与成长"
  };
  assert.equal(isSameVideoCandidate({
    title: "任意标题",
    url: "https://www.bilibili.com/video/BV1abc123?p=1"
  }, currentVideo), true);
  assert.equal(isSameVideoCandidate({
    title: "标题经过改写",
    url: "https://www.bilibili.com/video/av123456"
  }, currentVideo), true);
  assert.equal(isSameVideoCandidate({
    title: "鲁豫有约一日行 金靖谈幽默与成长 金靖专访",
    url: "https://www.bilibili.com/video/BV9OTHER"
  }, currentVideo), true);
  assert.equal(isSameVideoCandidate({
    title: "金靖参加另一档访谈节目",
    url: "https://www.bilibili.com/video/BV9OTHER"
  }, currentVideo), false);
  assert.equal(shouldExcludeFollowupResult({
    title: "鲁豫有约一日行 金靖专访",
    url: "https://example.com/unknown",
    why: "这是本期节目的原始视频，但根据要求不推荐，故此处仅作占位。"
  }, currentVideo), true);
});

test("keeps transcript highlighting stable around adjacent boundaries", () => {
  const segments = [
    { from: 76, to: 89 },
    { from: 90, to: 112 }
  ];
  assert.equal(findStableTranscriptSegmentIndex(segments, 90.05, 0), 0);
  assert.equal(findStableTranscriptSegmentIndex(segments, 90.25, 0), 1);
  assert.equal(findStableTranscriptSegmentIndex(segments, 89.9, 1), 1);
  assert.equal(findStableTranscriptSegmentIndex(segments, 89.7, 1), 0);
});
