import { LIMITS } from "../shared/security.js";

function blockText(block) {
  const prefix = block.type === "heading" ? `${"#".repeat(block.level || 2)} ` : "";
  return `${prefix}${block.text}`.trim();
}

export function estimateTokens(text) {
  const cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
  return Math.ceil(cjk / 1.5 + (text.length - cjk) / 4);
}

export function chunkDocument(document, options = {}) {
  const maxChars = options.maxChars || LIMITS.defaultChunkChars;
  const overlapChars = options.overlapChars ?? LIMITS.overlapChars;
  if (maxChars < 1000) throw new Error("单块字符上限不能小于 1000");

  const chunks = [];
  let headingPath = [];
  let entries = [];
  let size = 0;

  const flush = () => {
    if (!entries.length) return;
    const text = entries.map(({ block, text }) => `[block:${block.id}] ${text}`).join("\n\n");
    chunks.push({
      id: `chunk-${chunks.length + 1}`,
      blockIds: entries.map(({ block }) => block.id),
      headingPath: [...entries[0].headingPath],
      text,
      chars: text.length,
      estimatedTokens: estimateTokens(text),
    });
    const overlap = [];
    let overlapSize = 0;
    for (let i = entries.length - 1; i >= 0 && overlapSize < overlapChars; i -= 1) {
      overlap.unshift(entries[i]);
      overlapSize += entries[i].text.length;
    }
    entries = overlap;
    size = overlapSize;
  };

  for (const block of document.blocks.slice(0, LIMITS.maxBlocks)) {
    const text = blockText(block).slice(0, maxChars);
    if (!text) continue;
    if (entries.length && size + text.length > maxChars) flush();
    if (entries.length && size + text.length > maxChars) {
      entries = [];
      size = 0;
    }
    if (block.type === "heading") {
      const level = Math.max(1, Math.min(6, block.level || 2));
      headingPath = headingPath.slice(0, level - 1);
      headingPath[level - 1] = block.text;
      headingPath = headingPath.filter(Boolean);
    }
    entries.push({ block, text, headingPath: [...headingPath] });
    size += text.length;
    if (chunks.length >= LIMITS.maxChunks) break;
  }
  flush();
  return chunks.slice(0, LIMITS.maxChunks);
}

export function selectRelevantChunks(chunks, question, limit = LIMITS.maxAnswerChunks) {
  const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [])];
  return chunks
    .map((chunk, index) => ({
      chunk,
      index,
      score: terms.reduce((sum, term) => sum + (chunk.text.toLowerCase().split(term).length - 1), 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, limit))
    .map(({ chunk }) => chunk);
}
