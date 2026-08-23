import test from "node:test";
import assert from "node:assert/strict";
import {
  clearTranslationCache,
  loadCachedTranslations,
  saveCachedTranslations,
  textFingerprint,
  translationCacheScope,
} from "../src/cache/translation-cache.js";

function memoryStorage(initial = {}) {
  const values = { ...initial };
  return {
    values,
    async get(key) { return { [key]: values[key] }; },
    async set(items) { Object.assign(values, items); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; },
  };
}

const descriptor = {
  pageUrl: "https://example.com/article#section",
  baseUrl: "https://api.example.com/v1",
  providerID: "volcengine",
  modelID: "model-a",
};

test("translation cache ignores URL fragments and isolates models", () => {
  assert.equal(
    translationCacheScope(descriptor),
    "https://example.com/article\nhttps://api.example.com/v1\nvolcengine\nmodel-a",
  );
  assert.notEqual(textFingerprint("hello"), textFingerprint("hello!"));
});

test("loading the new cache removes marker-polluted legacy entries", async () => {
  const storage = memoryStorage({ translationCacheV1: { entries: [{ scope: "old", segments: { x: "[/block:x]" } }] } });
  await loadCachedTranslations(storage, descriptor);
  assert.equal(storage.values.translationCacheV1, undefined);
});

test("translation cache saves, reads, and clears page translations", async () => {
  const storage = memoryStorage();
  const segments = new Map([[textFingerprint("hello"), "你好"]]);
  await saveCachedTranslations(storage, descriptor, segments);
  assert.deepEqual([...await loadCachedTranslations(storage, descriptor)], [...segments]);
  assert.equal((await loadCachedTranslations(storage, { ...descriptor, modelID: "model-b" })).size, 0);
  await clearTranslationCache(storage);
  assert.equal((await loadCachedTranslations(storage, descriptor)).size, 0);
});
