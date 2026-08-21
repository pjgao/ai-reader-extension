import test from "node:test";
import assert from "node:assert/strict";
import { BlockTranslationStream } from "../src/pipeline/translation-stream.js";

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
