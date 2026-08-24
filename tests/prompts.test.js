import test from "node:test";
import assert from "node:assert/strict";
import { refinementPrompt, translationPrompt } from "../src/pipeline/prompts.js";

test("translation prompt preserves one output per original text node", () => {
  const document = {
    blocks: [
      {
        id: "b00001",
        type: "paragraph",
        text: "Read the paper today.",
        segments: [
          { id: "b00001-s001", text: "Read the " },
          { id: "b00001-s002", text: "paper" },
          { id: "b00001-s003", text: " today." },
        ],
      },
    ],
  };
  const prompt = translationPrompt({ blockIds: ["b00001"] }, document);

  assert.match(prompt, /\[context:b00001\]/);
  assert.match(prompt, /\[block:b00001-s002\] paper \[\/block:b00001-s002\]/);
  assert.doesNotMatch(prompt, /\[block:b00001\] Read the paper today/);
  assert.match(prompt, /不得遗漏、合并、拆分或改写 block ID/);
});

test("refinement prompt requests patches only and preserves segment IDs", () => {
  const prompt = refinementPrompt([
    { id: "b00001-s001", source: "draft model", translation: "草稿模型" },
    { id: "b00002-s001", source: "draft model", translation: "草拟模型" },
  ], { title: "Speculative decoding" });

  assert.match(prompt, /只修改确实存在问题的文本节点/);
  assert.match(prompt, /\[context:b00001-s001\]/);
  assert.match(prompt, /\[block:原ID\]/);
  assert.match(prompt, /\[no_changes\]/);
});
