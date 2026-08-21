import test from "node:test";
import assert from "node:assert/strict";
import { chunkDocument, estimateTokens, selectRelevantChunks } from "../src/pipeline/chunk.js";

const document = {
  title: "Demo",
  blocks: [
    { id: "b1", type: "heading", level: 1, text: "Architecture" },
    { id: "b2", type: "paragraph", text: "alpha ".repeat(180) },
    { id: "b3", type: "heading", level: 2, text: "Performance" },
    { id: "b4", type: "paragraph", text: "latency throughput benchmark" },
  ],
};

test("chunkDocument preserves block references and respects the configured size", () => {
  const chunks = chunkDocument(document, { maxChars: 1000, overlapChars: 0 });
  assert.ok(chunks.length >= 2);
  assert.match(chunks[0].text, /\[block:b1\]/);
  assert.deepEqual(chunks.at(-1).headingPath, ["Architecture", "Performance"]);
  assert.ok(chunks.every((chunk) => chunk.blockIds.length > 0));
});

test("selectRelevantChunks prioritizes matching content", () => {
  const chunks = chunkDocument(document, { maxChars: 1000, overlapChars: 0 });
  const selected = selectRelevantChunks(chunks, "latency benchmark", 1);
  assert.match(selected[0].text, /latency throughput benchmark/);
});

test("estimateTokens handles CJK and latin text", () => {
  assert.ok(estimateTokens("这是中文 token estimate") > 0);
});
