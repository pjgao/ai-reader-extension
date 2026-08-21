(() => {
  if (globalThis.__aiReaderBridgeInstalled) return;
  globalThis.__aiReaderBridgeInstalled = true;

  const MAX_CHARS = 600_000;
  const MAX_BLOCKS = 5_000;
  const BLOCK_ATTR = "data-ai-reader-id";
  const originalElements = new Map();
  const originalSegments = new Map();
  const ignoredSelector = [
    "script", "style", "noscript", "template", "svg", "canvas", "iframe",
    "nav", "footer", "aside", "[hidden]", "[aria-hidden='true']",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    ".advertisement", ".ads", ".cookie", ".modal", ".popup", ".newsletter",
  ].join(",");

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }

  function cleanText(value) {
    return (value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  function hasVisibleText(value) {
    return value.replace(/[\p{White_Space}\p{Cf}]/gu, "").length > 0;
  }

  function scoreRoot(element) {
    const text = cleanText(element.innerText);
    const paragraphs = element.querySelectorAll("p").length;
    const links = [...element.querySelectorAll("a")].reduce((sum, link) => sum + cleanText(link.innerText).length, 0);
    const semantic = element.matches("article") ? 20_000 : element.matches("main, [role='main']") ? 10_000 : 0;
    return semantic + text.length + paragraphs * 120 - links * 0.8;
  }

  function chooseRoot() {
    const candidates = [...document.querySelectorAll("article, main, [role='main']")].filter(visible);
    if (!candidates.length) return document.body;
    return candidates.sort((a, b) => scoreRoot(b) - scoreRoot(a))[0];
  }

  function absoluteUrl(value) {
    try {
      const url = new URL(value, location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function makeId(index) {
    return `b${String(index + 1).padStart(5, "0")}`;
  }

  function extractSegments(element, blockId) {
    if (element.matches("pre, img")) return [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !hasVisibleText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest("pre, code, script, style, noscript, template")) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const segments = [];
    let node;
    while ((node = walker.nextNode())) {
      const id = `${blockId}-s${String(segments.length + 1).padStart(3, "0")}`;
      const text = cleanText(node.nodeValue);
      if (!text || !hasVisibleText(text)) continue;
      segments.push({ id, text });
      originalSegments.set(id, { node, value: node.nodeValue });
    }
    return segments;
  }

  function extractArticle() {
    restoreAll();
    const root = chooseRoot();
    const selectors = "h1,h2,h3,h4,h5,h6,p,blockquote,pre,table,ul,ol,figure,img";
    const elements = [...root.querySelectorAll(selectors)];
    const blocks = [];
    const seen = new Set();
    let totalChars = 0;

    for (const element of elements) {
      if (blocks.length >= MAX_BLOCKS || totalChars >= MAX_CHARS) break;
      if (!visible(element) || element.closest(ignoredSelector)) continue;
      if (element.matches("img") && element.closest("figure")) continue;
      if (element.matches("p, ul, ol") && element.closest("blockquote")) continue;
      if (element.matches("p") && element.closest("li, td, th, figure")) continue;

      let type = "paragraph";
      let text = cleanText(element.innerText || element.textContent);
      const block = {};

      if (/^H[1-6]$/.test(element.tagName)) {
        type = "heading";
        block.level = Number(element.tagName.slice(1));
      } else if (element.matches("ul, ol")) {
        type = "list";
        text = [...element.children].filter((child) => child.matches("li")).map((item) => `- ${cleanText(item.innerText)}`).join("\n");
      } else if (element.matches("table")) {
        type = "table";
        text = [...element.rows].map((row) => [...row.cells].map((cell) => cleanText(cell.innerText)).join(" | ")).join("\n");
      } else if (element.matches("pre")) {
        type = "code";
      } else if (element.matches("blockquote")) {
        type = "quote";
      } else if (element.matches("figure, img")) {
        type = "image";
        const image = element.matches("img") ? element : element.querySelector("img");
        if (!image) continue;
        const caption = element.matches("figure") ? cleanText(element.querySelector("figcaption")?.innerText) : "";
        block.image = { src: absoluteUrl(image.currentSrc || image.src), alt: cleanText(image.alt), caption };
        text = [block.image.alt, caption].filter(Boolean).join(" — ") || "图片";
      }

      text = text.slice(0, 40_000);
      const signature = `${type}:${text}`;
      if (!text || seen.has(signature)) continue;
      seen.add(signature);

      const id = makeId(blocks.length);
      element.setAttribute(BLOCK_ATTR, id);
      originalElements.set(id, element);
      const segments = extractSegments(element, id);
      const hrefs = [...element.querySelectorAll("a[href]")].map((link) => absoluteUrl(link.href)).filter(Boolean).slice(0, 30);
      blocks.push({ id, type, text, ...(segments.length ? { segments } : {}), ...(hrefs.length ? { hrefs } : {}), ...block });
      totalChars += text.length;
    }

    return {
      title: cleanText(document.title) || cleanText(root.querySelector("h1")?.innerText) || location.hostname,
      url: location.href,
      lang: document.documentElement.lang || undefined,
      byline: cleanText(document.querySelector("[rel='author'], .byline, [itemprop='author']")?.innerText) || undefined,
      publishedAt: document.querySelector("time[datetime]")?.dateTime || undefined,
      blocks,
      truncated: blocks.length >= MAX_BLOCKS || totalChars >= MAX_CHARS,
      extractedChars: totalChars,
    };
  }

  function replaceSegment(id, text, final = false) {
    const original = originalSegments.get(id);
    if (!original?.node?.isConnected || !text) return false;
    const leading = original.value.match(/^\s*/)?.[0] || "";
    const trailing = original.value.match(/\s*$/)?.[0] || "";
    original.node.nodeValue = `${leading}${text.trim()}${trailing}`;
    if (original.node.parentElement) original.node.parentElement.dataset.aiReaderTranslated = final ? "done" : "streaming";
    return true;
  }

  function restoreAll() {
    for (const { node, value } of originalSegments.values()) {
      if (node?.isConnected) node.nodeValue = value;
    }
    for (const element of originalElements.values()) {
      if (!element?.isConnected) continue;
      element.removeAttribute(BLOCK_ATTR);
      element.querySelectorAll("[data-ai-reader-translated]").forEach((child) => delete child.dataset.aiReaderTranslated);
      delete element.dataset.aiReaderTranslated;
    }
    originalElements.clear();
    originalSegments.clear();
  }

  function highlight(id) {
    const element = document.querySelector(`[${BLOCK_ATTR}="${CSS.escape(id)}"]`);
    if (!element) return false;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const previous = element.style.outline;
    const previousOffset = element.style.outlineOffset;
    element.style.outline = "3px solid #ff6b35";
    element.style.outlineOffset = "4px";
    setTimeout(() => {
      element.style.outline = previous;
      element.style.outlineOffset = previousOffset;
    }, 2600);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "AI_READER_EXTRACT") sendResponse({ ok: true, document: extractArticle() });
    if (message?.type === "AI_READER_HIGHLIGHT") sendResponse({ ok: highlight(message.blockId) });
    if (message?.type === "AI_READER_TRANSLATE_BLOCKS") {
      const updated = (message.updates || []).filter((item) => replaceSegment(item.id, item.text, item.final)).length;
      sendResponse({ ok: true, updated });
    }
    if (message?.type === "AI_READER_RESTORE") {
      restoreAll();
      sendResponse({ ok: true });
    }
  });
})();
