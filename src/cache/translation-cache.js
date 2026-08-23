const STORAGE_KEY = "translationCacheV1";
const MAX_PAGES = 20;
const MAX_SERIALIZED_CHARS = 2_000_000;

function normalizedUrl(value) {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

export function textFingerprint(text) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${text.length}:${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
}

export function translationCacheScope({ pageUrl, baseUrl, providerID, modelID }) {
  return [normalizedUrl(pageUrl), baseUrl, providerID, modelID].join("\n");
}

export async function loadCachedTranslations(storage, descriptor) {
  const scope = translationCacheScope(descriptor);
  const data = await storage.get(STORAGE_KEY);
  const entry = (data[STORAGE_KEY]?.entries || []).find((item) => item.scope === scope);
  return new Map(Object.entries(entry?.segments || {}));
}

export async function saveCachedTranslations(storage, descriptor, segments) {
  const scope = translationCacheScope(descriptor);
  const data = await storage.get(STORAGE_KEY);
  const entries = (data[STORAGE_KEY]?.entries || []).filter((item) => item.scope !== scope);
  entries.unshift({ scope, updatedAt: Date.now(), segments: Object.fromEntries(segments) });
  entries.splice(MAX_PAGES);
  while (entries.length && JSON.stringify({ entries }).length > MAX_SERIALIZED_CHARS) entries.pop();
  await storage.set({ [STORAGE_KEY]: { entries } });
}

export async function clearTranslationCache(storage) {
  await storage.remove(STORAGE_KEY);
}
