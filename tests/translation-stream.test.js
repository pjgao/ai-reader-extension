import test from "node:test";
import assert from "node:assert/strict";
import { BlockTranslationStream, sanitizeTranslationText } from "../src/pipeline/translation-stream.js";

test("block translations stream progressively and finish without marker text", () => {
  const updates = [];
  const parser = new BlockTranslationStream(["b00001", "b00002"], (update) => updates.push({ ...update }));
  parser.push("preface [block:b00001]\n中");
  parser.push("文一[/block:b00001]\n[block:b00002]\n中");
  parser.push("文二[/block:b00002]");
  parser.finish();

  assert.deepEqual(updates.filter((item) => item.final), [
    { id: "b00001", text: "中文一", final: true },
    { id: "b00002", text: "中文二", final: true },
  ]);
  assert.ok(updates.some((item) => item.id === "b00001" && !item.final));
  assert.ok(updates.every((item) => !item.text.includes("[/block:")));
});

test("a new block marker closes the previous block when the model omits closing markers", () => {
  const updates = [];
  const parser = new BlockTranslationStream(["b00001", "b00002"], (update) => updates.push({ ...update }));
  parser.push("[block:b00001]\n标题[block:b00002]\n正文");
  parser.finish();
  assert.deepEqual(updates.filter((item) => item.final), [
    { id: "b00001", text: "标题", final: true },
    { id: "b00002", text: "正文", final: true },
  ]);
});

test("wrong closing IDs still separate blocks and never leak protocol markers", () => {
  const updates = [];
  const parser = new BlockTranslationStream(["b00001", "b00002"], (update) => updates.push({ ...update }));
  parser.push("[block:b00001][]\"\"\"第一段[/block:wrong-id] [block:b00002]第二段[/block:b00002]");
  parser.finish();
  assert.deepEqual(updates.filter((item) => item.final), [
    { id: "b00001", text: "第一段", final: true },
    { id: "b00002", text: "第二段", final: true },
  ]);
});

test("all leaked block and context markers are stripped from translated text", () => {
  const polluted = "[]\"\"\"推测解码。[/block:b00005-s005] [block:b00004-s006] 并行 [/block:b00004-s006] [context:b1]文本[/context:b1]\"\"\"";
  const clean = sanitizeTranslationText(polluted);
  assert.equal(clean, "推测解码。  并行  文本");
  assert.doesNotMatch(clean, /\[\/?(?:block|context):/);
});
