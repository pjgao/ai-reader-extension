export const MAX_REFINEMENT_BATCH_CHARS = 24_000;

export function buildRefinementBatches(document, translations, maxChars = MAX_REFINEMENT_BATCH_CHARS) {
  const batches = [];
  let batch = [];
  let chars = 0;

  for (const block of document.blocks || []) {
    for (const segment of block.segments || []) {
      const translation = translations.get(segment.id);
      if (!translation) continue;
      const entry = { id: segment.id, source: segment.text, translation };
      const entryChars = segment.text.length + translation.length + 80;
      if (batch.length && chars + entryChars > maxChars) {
        batches.push(batch);
        batch = [];
        chars = 0;
      }
      batch.push(entry);
      chars += entryChars;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}
