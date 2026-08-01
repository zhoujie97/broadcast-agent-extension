import assert from "node:assert/strict";
import test from "node:test";

await import("../extension/content-utils.js");
const {
  balanceFollowupGuestItems,
  normalizeGuestNames,
  remixCacheScope
} = globalThis.ContentUtils;

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
    { guestName: "庞颖", url: "https://example.com/pang-1" }
  ];
  const fallbacks = [
    { guestName: "庞颖", url: "https://example.com/pang-1" },
    { guestName: "庞颖", url: "https://example.com/pang-2" },
    { guestName: "詹青云", url: "https://example.com/zhan-1" },
    { guestName: "詹青云", url: "https://example.com/zhan-2" }
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
