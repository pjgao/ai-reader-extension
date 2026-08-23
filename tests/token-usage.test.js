import test from "node:test";
import assert from "node:assert/strict";
import { TranslationTokenTracker } from "../src/pipeline/token-usage.js";

test("cached segments do not add token usage", () => {
  const tracker = new TranslationTokenTracker();
  tracker.setCachedSegments(12);
  assert.deepEqual(tracker.snapshot(), {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedSegments: 12,
    requestCount: 0,
    exact: false,
  });
});

test("token usage updates dynamically and exact provider usage replaces estimates", () => {
  const snapshots = [];
  const tracker = new TranslationTokenTracker((snapshot) => snapshots.push(snapshot));
  const request = tracker.beginRequest("Translate this text");
  tracker.addDelta(request, "翻译");
  assert.ok(snapshots.at(-1).totalTokens > 0);
  assert.equal(snapshots.at(-1).exact, false);
  tracker.setUsage(request, { inputTokens: 10, outputTokens: 3, totalTokens: 13 });
  assert.deepEqual(snapshots.at(-1), {
    inputTokens: 10,
    outputTokens: 3,
    totalTokens: 13,
    cachedSegments: 0,
    requestCount: 1,
    exact: true,
  });
});
