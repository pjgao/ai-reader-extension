import test from "node:test";
import assert from "node:assert/strict";
import { buildRefinementBatches } from "../src/pipeline/refinement.js";

test("refinement batches preserve segment order and translated pairs", () => {
  const document = {
    blocks: [{
      segments: [
        { id: "s1", text: "draft model" },
        { id: "s2", text: "target model" },
      ],
    }],
  };
  const batches = buildRefinementBatches(document, new Map([
    ["s1", "草拟模型"],
    ["s2", "目标模型"],
  ]), 100);

  assert.deepEqual(batches.flat().map((entry) => entry.id), ["s1", "s2"]);
  assert.equal(batches.flat()[0].translation, "草拟模型");
  assert.ok(batches.length >= 1);
});
