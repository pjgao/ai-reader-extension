import test from "node:test";
import assert from "node:assert/strict";
import { translationPrompt } from "../src/pipeline/prompts.js";

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
