import { wrapPageContent } from "../shared/security.js";

export function translationPrompt(chunk, document, language = "简体中文") {
  const blocks = new Map(document.blocks.map((block) => [block.id, block]));
  const input = chunk.blockIds
    .map((blockId) => {
      const block = blocks.get(blockId);
      if (!block?.segments?.length) return "";
      return [
        `[context:${blockId}]`,
        ...block.segments.map((segment) => `[block:${segment.id}] ${segment.text} [/block:${segment.id}]`),
        `[/context:${blockId}]`,
      ].join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
  return [
    `把以下网页文本节点忠实翻译为${language}。不要总结、评论或补充信息。`,
    "每个 context 是原网页中的一个完整内容块，block 是其中一个原始文本节点。请结合整个 context 翻译，但每个 block 必须保持一一对应。",
    "按原顺序输出每个 block，严格使用下面的纯文本格式：",
    "[block:原ID]",
    "该文本节点的译文",
    "[/block:原ID]",
    "不得输出 context 标记，不得使用 Markdown 代码围栏，不得遗漏、合并、拆分或改写 block ID。不要添加标题井号、列表符号或其他排版字符；网页原有排版由 DOM 保留。",
    wrapPageContent(input),
  ].join("\n\n");
}

export function chunkSummaryPrompt(chunk) {
  return [
    "提炼以下章节的事实、论点、证据与限制，保留关键 [block:ID] 引用。明确区分原文陈述和你的推断。",
    wrapPageContent(chunk.text),
  ].join("\n\n");
}

export function synthesisPrompt(document, summaries) {
  return [
    `基于分段摘要，对《${document.title}》生成覆盖全文的中文分析。`,
    "结构包含：核心结论、章节脉络、关键证据、假设与限制、值得追问的问题。保留 [block:ID] 引用，区分事实与推断。",
    wrapPageContent(summaries.join("\n\n---\n\n")),
  ].join("\n\n");
}

export function questionPrompt(question, chunks) {
  return [
    `仅根据给定网页片段回答问题：${question}`,
    "如果材料不足，明确说无法从当前网页确认。结论后附对应 [block:ID] 引用。",
    wrapPageContent(chunks.map((chunk) => chunk.text).join("\n\n---\n\n")),
  ].join("\n\n");
}
