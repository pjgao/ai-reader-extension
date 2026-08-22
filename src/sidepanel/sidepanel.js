import { OpenCodeClient } from "../opencode/client.js";
import { chunkDocument, selectRelevantChunks } from "../pipeline/chunk.js";
import { chunkSummaryPrompt, questionPrompt, synthesisPrompt, translationPrompt } from "../pipeline/prompts.js";
import { BlockTranslationStream } from "../pipeline/translation-stream.js";
import { safeError } from "../shared/security.js";
import { DEFAULT_VOLCENGINE_BASE_URL, VolcengineClient } from "../volcengine/client.js";

const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  "connection-mode", "volcengine-settings", "volcengine-base-url", "volcengine-api-key", "volcengine-model",
  "volcengine-custom-model-row", "volcengine-custom-model-id", "volcengine-model-hint",
  "opencode-settings", "server-url", "username", "password", "chunk-chars", "connect", "provider", "model", "extract",
  "article-title", "article-meta", "translate", "restore", "analyze", "question", "ask", "stop", "copy", "export",
  "phase", "progress", "output", "sources", "error", "connection-badge",
].map((id) => [id.replaceAll("-", "_"), $(id)]));

const state = {
  mode: "volcengine",
  client: null,
  providers: [],
  document: null,
  chunks: [],
  tabId: null,
  controller: null,
  sessionId: null,
  qaSessionId: null,
  output: "",
};

class PageTranslationWriter {
  constructor(tabId) {
    this.tabId = tabId;
    this.pending = new Map();
    this.timer = null;
    this.writeChain = Promise.resolve();
  }

  queue(update) {
    this.pending.set(update.id, update);
    if (this.timer && update.final) clearTimeout(this.timer);
    if (!this.timer || update.final) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.writeChain = this.writeChain.then(() => this.flushPending());
      }, update.final ? 0 : 50);
    }
  }

  async flushPending() {
    if (!this.pending.size) return;
    const updates = [...this.pending.values()];
    this.pending.clear();
    const response = await chrome.tabs.sendMessage(this.tabId, { type: "AI_READER_TRANSLATE_BLOCKS", updates });
    if (!response?.ok) throw new Error("无法把译文写回原网页");
  }

  async finish() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.writeChain = this.writeChain.then(() => this.flushPending());
    await this.writeChain;
  }
}

function showError(error, hint = "") {
  const message = safeError(error);
  ui.error.textContent = [message, hint].filter(Boolean).join("\n");
  ui.error.hidden = false;
  ui.phase.textContent = "ERROR";
}

function clearError() {
  ui.error.hidden = true;
  ui.error.textContent = "";
}

function setProgress(current, total, label) {
  ui.progress.hidden = false;
  ui.progress.querySelector("span").style.width = `${Math.max(0, Math.min(100, (current / total) * 100))}%`;
  ui.phase.textContent = label.toUpperCase();
}

function setBusy(busy) {
  ui.stop.disabled = !busy;
  ui.connect.disabled = busy;
  ui.extract.disabled = busy;
  ui.translate.disabled = busy || !state.client || !modelReady();
  ui.restore.disabled = busy || !state.document;
  ui.analyze.disabled = busy || !state.client || !modelReady();
  ui.ask.disabled = busy || !state.client || !modelReady();
  ui.question.disabled = busy || !state.client || !modelReady();
}

function setOutput(text, append = false) {
  state.output = append && state.output ? `${state.output}\n\n${text}` : text;
  ui.output.textContent = state.output;
  ui.copy.disabled = !state.output;
  ui.export.disabled = !state.output;
  renderSources();
}

function renderSources() {
  ui.sources.replaceChildren();
  const ids = [...new Set([...state.output.matchAll(/\[block:([A-Za-z0-9_-]+)\]/g)].map((match) => match[1]))];
  for (const id of ids) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = id;
    button.title = "跳回网页原文";
    button.addEventListener("click", () => highlightBlock(id));
    ui.sources.append(button);
  }
}

async function loadSettings() {
  const local = await chrome.storage.local.get([
    "connectionMode", "volcengineBaseUrl", "volcengineApiKey", "volcengineModelID",
    "serverUrl", "username", "providerID", "modelID", "chunkChars",
  ]);
  const session = await chrome.storage.session.get(["password", "volcengineApiKey"]);
  const volcengineApiKey = local.volcengineApiKey || session.volcengineApiKey || "";
  if (!local.volcengineApiKey && session.volcengineApiKey) {
    await chrome.storage.local.set({ volcengineApiKey: session.volcengineApiKey });
    await chrome.storage.session.remove("volcengineApiKey");
  }
  state.mode = local.connectionMode || "volcengine";
  ui.connection_mode.value = state.mode;
  ui.volcengine_base_url.value = local.volcengineBaseUrl || DEFAULT_VOLCENGINE_BASE_URL;
  ui.volcengine_api_key.value = volcengineApiKey;
  ui.volcengine_custom_model_id.value = local.volcengineModelID || "";
  ui.server_url.value = local.serverUrl || "http://127.0.0.1:4096";
  ui.username.value = local.username || "opencode";
  ui.password.value = session.password || "";
  ui.chunk_chars.value = local.chunkChars || 12000;
  updateModeUI();
  return local;
}

async function saveSettings() {
  await chrome.storage.local.set({
    connectionMode: state.mode,
    volcengineBaseUrl: ui.volcengine_base_url.value.trim(),
    volcengineApiKey: ui.volcengine_api_key.value,
    volcengineModelID: selectedDirectModelID(),
    serverUrl: ui.server_url.value.trim(),
    username: ui.username.value.trim(),
    providerID: ui.provider.value,
    modelID: ui.model.value,
    chunkChars: Number(ui.chunk_chars.value),
  });
  await chrome.storage.session.set({
    password: ui.password.value,
  });
}

function updateModeUI() {
  const direct = state.mode === "volcengine";
  ui.volcengine_settings.hidden = !direct;
  ui.opencode_settings.hidden = direct;
  ui.connect.textContent = "连接并读取模型";
  ui.connection_badge.textContent = direct ? "待配置" : "未连接";
  ui.connection_badge.className = "badge offline";
}

function selectedDirectModelID() {
  return ui.volcengine_model.value === "__custom__"
    ? ui.volcengine_custom_model_id.value.trim()
    : ui.volcengine_model.value;
}

function modelReady() {
  if (state.mode === "volcengine") return Boolean(selectedDirectModelID());
  return Boolean(ui.provider.value && ui.model.value);
}

function fillVolcengineModels(models, preferredModel = "") {
  ui.volcengine_model.replaceChildren();
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name === model.id ? model.id : `${model.name} · ${model.id}`;
    ui.volcengine_model.append(option);
  }
  const custom = document.createElement("option");
  custom.value = "__custom__";
  custom.textContent = "手动填写 Model ID…";
  ui.volcengine_model.append(custom);
  ui.volcengine_model.disabled = false;

  if (models.some((model) => model.id === preferredModel)) {
    ui.volcengine_model.value = preferredModel;
  } else if (preferredModel || !models.length) {
    ui.volcengine_model.value = "__custom__";
    ui.volcengine_custom_model_id.value = preferredModel;
  }
  updateCustomModelUI();
}

function updateCustomModelUI() {
  ui.volcengine_custom_model_row.hidden = ui.volcengine_model.value !== "__custom__";
}

function updateDirectReadyUI() {
  if (state.mode !== "volcengine" || !state.client) return;
  ui.connection_badge.textContent = modelReady() ? "直连就绪" : "请选择模型";
  ui.connection_badge.className = "badge online";
}

function fillProviders(preferredProvider, preferredModel) {
  ui.provider.replaceChildren();
  for (const provider of state.providers) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = provider.name;
    ui.provider.append(option);
  }
  ui.provider.disabled = false;
  if (state.providers.some((provider) => provider.id === preferredProvider)) ui.provider.value = preferredProvider;
  fillModels(preferredModel);
}

function fillModels(preferredModel) {
  const provider = state.providers.find((item) => item.id === ui.provider.value);
  ui.model.replaceChildren();
  for (const model of provider?.models || []) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.context ? `${model.name} · ${model.context.toLocaleString()} ctx` : model.name;
    ui.model.append(option);
  }
  ui.model.disabled = !provider?.models.length;
  if (provider?.models.some((model) => model.id === preferredModel)) ui.model.value = preferredModel;
}

function selectedModel() {
  if (state.mode === "volcengine") {
    const modelID = selectedDirectModelID();
    if (!modelID) throw new Error("请选择模型或填写 Model ID");
    return { providerID: "volcengine", modelID };
  }
  if (!ui.provider.value || !ui.model.value) throw new Error("请先选择 provider 和 model");
  return { providerID: ui.provider.value, modelID: ui.model.value };
}

async function connect(preferred = {}) {
  clearError();
  if (state.mode === "volcengine") {
    try {
      state.client = new VolcengineClient({
        baseUrl: ui.volcengine_base_url.value.trim(),
        apiKey: ui.volcengine_api_key.value,
      });
      ui.connection_badge.textContent = "读取模型";
      ui.connection_badge.className = "badge offline";
      const preferredModel = preferred.volcengineModelID || selectedDirectModelID();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const models = await state.client.models(controller.signal);
        fillVolcengineModels(models, preferredModel);
        ui.volcengine_model_hint.textContent = `已读取 ${models.length} 个可用模型，选择后会自动保存。`;
      } catch (error) {
        fillVolcengineModels([], preferredModel);
        ui.volcengine_model_hint.textContent = `网关不支持读取模型列表，请手动填写 Model ID。${safeError(error)}`;
      } finally {
        clearTimeout(timeout);
      }
      await saveSettings();
      ui.connection_badge.textContent = modelReady() ? "直连就绪" : "请选择模型";
      ui.connection_badge.className = "badge online";
      ui.phase.textContent = "READY";
    } catch (error) {
      state.client = null;
      ui.connection_badge.textContent = "待配置";
      ui.connection_badge.className = "badge offline";
      showError(error, "API Key 会保存在当前浏览器扩展的本地配置中。 ");
    }
    setBusy(false);
    return;
  }
  ui.connection_badge.textContent = "连接中";
  try {
    state.client = new OpenCodeClient({
      baseUrl: ui.server_url.value.trim(),
      username: ui.username.value.trim(),
      password: ui.password.value,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      await state.client.health(controller.signal);
      state.providers = await state.client.providers(controller.signal);
    } finally {
      clearTimeout(timeout);
    }
    if (!state.providers.length) throw new Error("OpenCode 没有返回可用 provider/model");
    fillProviders(preferred.providerID, preferred.modelID);
    await saveSettings();
    ui.connection_badge.textContent = "已连接";
    ui.connection_badge.className = "badge online";
    ui.phase.textContent = "CONNECTED";
    setBusy(false);
  } catch (error) {
    state.client = null;
    ui.connection_badge.textContent = "未连接";
    ui.connection_badge.className = "badge offline";
    showError(error, "请确认 OpenCode 正监听 127.0.0.1:4096、密码正确，并为当前扩展 ID 配置 --cors。 ");
    setBusy(false);
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("无法读取当前标签页");
  return tab;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function extractCurrentPage() {
  ui.phase.textContent = "EXTRACTING";
  const tab = await activeTab();
  if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("当前页面不是可读取的普通 HTTP/HTTPS 网页");
  await withTimeout(
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content/page-bridge.js"] }),
    10_000,
    "向当前网页加载阅读脚本超时，请刷新网页后重试",
  );
  const response = await withTimeout(
    chrome.tabs.sendMessage(tab.id, { type: "AI_READER_EXTRACT" }),
    20_000,
    "网页正文抽取超时，请刷新网页后重试",
  );
  if (!response?.ok || !response.document?.blocks?.length) throw new Error("未从当前页面抽取到正文块");
  state.document = response.document;
  state.tabId = tab.id;
  state.qaSessionId = null;
  const configuredChunkChars = Number(ui.chunk_chars.value);
  const effectiveChunkChars = state.mode === "volcengine" ? Math.min(configuredChunkChars, 4000) : configuredChunkChars;
  state.chunks = chunkDocument(state.document, { maxChars: effectiveChunkChars });
  ui.article_title.textContent = state.document.title;
  ui.article_meta.textContent = `${state.document.blocks.length} 个内容块 · ${state.document.extractedChars.toLocaleString()} 字符 · ${state.chunks.length} 个模型分块${state.mode === "volcengine" && effectiveChunkChars < configuredChunkChars ? " · 已按直连稳定性自动细分" : ""}${state.document.truncated ? " · 已按安全上限截断" : ""}`;
  return state.document;
}

async function extractPage() {
  clearError();
  setBusy(true);
  try {
    await extractCurrentPage();
    ui.phase.textContent = "EXTRACTED";
    setOutput(`已读取《${state.document.title}》。\n可以翻译、分析或直接提问。`);
  } catch (error) {
    showError(error, "Chrome 内置页、扩展商店和部分受保护页面不允许脚本注入。 ");
  } finally {
    setBusy(false);
  }
}

async function highlightBlock(blockId) {
  try {
    if (!state.tabId) throw new Error("原始标签页不可用");
    await chrome.tabs.sendMessage(state.tabId, { type: "AI_READER_HIGHLIGHT", blockId });
  } catch (error) {
    showError(error, "网页可能已刷新或切换；请重新抽取。 ");
  }
}

async function runTask(task) {
  clearError();
  state.controller = new AbortController();
  setBusy(true);
  try {
    await task(state.controller.signal);
    ui.phase.textContent = "DONE";
    ui.progress.hidden = true;
  } catch (error) {
    if (error?.name === "AbortError") {
      ui.phase.textContent = "STOPPED";
      setOutput("生成已停止。", true);
    } else {
      showError(error);
    }
  } finally {
    state.controller = null;
    state.sessionId = null;
    setBusy(false);
  }
}

async function translate() {
  return runTask(async (signal) => {
    await extractCurrentPage();
    const model = selectedModel();
    const writer = new PageTranslationWriter(state.tabId);
    const translations = new Map();
    const translatedIds = new Set();
    const blocksById = new Map(state.document.blocks.map((block) => [block.id, block]));
    const totalSegments = state.document.blocks.reduce((sum, block) => sum + (block.segments?.length || 0), 0);
    const updateTranslation = (update) => {
      translations.set(update.id, update.text);
      writer.queue(update);
      if (update.final && !translatedIds.has(update.id)) {
        translatedIds.add(update.id);
        setProgress(translatedIds.size, totalSegments, `已翻译 ${translatedIds.size}/${totalSegments}`);
      }
    };
    const translateBatch = async (chunk, document, segmentIds, title) => {
      setProgress(translatedIds.size, totalSegments, `模型生成中 ${translatedIds.size}/${totalSegments}`);
      state.sessionId = await state.client.createSession(title, signal);
      const parser = new BlockTranslationStream(segmentIds, updateTranslation);
      let activityReported = false;
      let contentReported = false;
      await state.client.messageStream(state.sessionId, model, translationPrompt(chunk, document), {
        signal,
        onDelta: (delta) => {
          if (!contentReported) {
            contentReported = true;
            setProgress(translatedIds.size, totalSegments, `正在翻译 ${translatedIds.size}/${totalSegments}`);
          }
          parser.push(delta);
        },
        onActivity: () => {
          if (activityReported) return;
          activityReported = true;
          setProgress(translatedIds.size, totalSegments, `模型思考中 ${translatedIds.size}/${totalSegments}`);
        },
      });
      parser.finish();
      await writer.finish();
    };
    setOutput("正在把译文直接写回原网页；尚未完成的内容继续保持英文。");
    for (let index = 0; index < state.chunks.length; index += 1) {
      const segmentIds = state.chunks[index].blockIds
        .flatMap((id) => blocksById.get(id)?.segments?.map((segment) => segment.id) || [])
        .filter((id) => !translatedIds.has(id));
      if (!segmentIds.length) continue;
      await translateBatch(state.chunks[index], state.document, segmentIds, `${state.document.title} · ${index + 1}`);

      const missing = segmentIds.filter((id) => !translatedIds.has(id));
      if (missing.length) {
        const missingSet = new Set(missing);
        const retryBlocks = state.chunks[index].blockIds
          .map((id) => blocksById.get(id))
          .filter(Boolean)
          .map((block) => ({ ...block, segments: block.segments?.filter((segment) => missingSet.has(segment.id)) || [] }))
          .filter((block) => block.segments.length);
        await translateBatch(
          { blockIds: retryBlocks.map((block) => block.id) },
          { ...state.document, blocks: retryBlocks },
          missing,
          `${state.document.title} · 补译 ${index + 1}`,
        );
      }
    }
    const missingCount = totalSegments - translatedIds.size;
    const output = state.document.blocks
      .filter((block) => block.segments?.some((segment) => translations.has(segment.id)))
      .map((block) => `[block:${block.id}] ${block.segments.map((segment) => translations.get(segment.id) || segment.text).join("")}`)
      .join("\n\n");
    setOutput(`${output || "原网页翻译完成。"}${missingCount ? `\n\n${missingCount} 个文本节点未返回译文，已保留原文。` : ""}`);
    setProgress(totalSegments - missingCount, totalSegments, missingCount ? "翻译完成（部分保留原文）" : "翻译完成");
  });
}

async function reduceSummaries(summaries, model, sessionId, signal) {
  let current = summaries;
  let level = 0;
  while (current.join("\n\n").length > 40_000) {
    if (level >= 4) throw new Error("分层摘要在 4 轮后仍超过综合上限，请调小单块字符数后重试");
    const previousChars = current.join("\n\n").length;
    const groups = [];
    let group = [];
    let chars = 0;
    for (const summary of current) {
      if (group.length && chars + summary.length > 32_000) {
        groups.push(group);
        group = [];
        chars = 0;
      }
      group.push(summary);
      chars += summary.length;
    }
    if (group.length) groups.push(group);
    current = [];
    for (let index = 0; index < groups.length; index += 1) {
      setProgress(index, groups.length, `压缩摘要 ${index + 1}/${groups.length}`);
      current.push(await state.client.message(
        sessionId,
        model,
        synthesisPrompt({ title: `${state.document.title}（中间汇总）` }, groups[index]),
        signal,
      ));
    }
    if (current.join("\n\n").length >= previousChars) {
      throw new Error("模型未能压缩分块摘要，请换用更适合长文本的模型或调小单块字符数");
    }
    level += 1;
  }
  return current;
}

async function analyze() {
  return runTask(async (signal) => {
    await extractCurrentPage();
    const model = selectedModel();
    state.sessionId = await state.client.createSession(state.document.title, signal);
    const summaries = [];
    setOutput("正在逐块阅读全文……");
    for (let index = 0; index < state.chunks.length; index += 1) {
      setProgress(index, state.chunks.length + 1, `分析 ${index + 1}/${state.chunks.length}`);
      summaries.push(await state.client.message(state.sessionId, model, chunkSummaryPrompt(state.chunks[index]), signal));
    }
    const reduced = await reduceSummaries(summaries, model, state.sessionId, signal);
    setProgress(state.chunks.length, state.chunks.length + 1, "全文综合");
    const result = await state.client.message(state.sessionId, model, synthesisPrompt(state.document, reduced), signal);
    setOutput(result);
    setProgress(state.chunks.length + 1, state.chunks.length + 1, "分析完成");
  });
}

async function ask() {
  const question = ui.question.value.trim();
  if (!question) return;
  return runTask(async (signal) => {
    if (!state.document) await extractCurrentPage();
    const model = selectedModel();
    if (!state.qaSessionId) state.qaSessionId = await state.client.createSession(`${state.document.title} · Q&A`, signal);
    state.sessionId = state.qaSessionId;
    const selected = selectRelevantChunks(state.chunks, question);
    setProgress(0, 1, `检索 ${selected.length} 个相关分块`);
    const answer = await state.client.message(state.qaSessionId, model, questionPrompt(question, selected), signal);
    setOutput(`## 问题\n${question}\n\n## 回答\n${answer}`, state.output.includes("## 问题"));
    ui.question.value = "";
    setProgress(1, 1, "回答完成");
  });
}

async function stop() {
  state.controller?.abort();
  if (state.sessionId && state.sessionId === state.qaSessionId) state.qaSessionId = null;
  if (state.client && state.sessionId) {
    try { await state.client.abort(state.sessionId); } catch { /* 本地取消已生效。 */ }
  }
}

async function restoreOriginal() {
  clearError();
  try {
    if (!state.tabId) throw new Error("没有可恢复的网页");
    const response = await chrome.tabs.sendMessage(state.tabId, { type: "AI_READER_RESTORE" });
    if (!response?.ok) throw new Error("无法恢复原网页");
    ui.phase.textContent = "ORIGINAL";
    setOutput("已恢复原网页文字。再次点击“翻译当前网页”可重新翻译。");
  } catch (error) {
    showError(error, "网页可能已经刷新，请直接重新翻译。 ");
  }
}

async function copyOutput() {
  await navigator.clipboard.writeText(state.output);
  ui.phase.textContent = "COPIED";
}

function exportOutput() {
  const blob = new Blob([state.output], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${(state.document?.title || "ai-reader").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

ui.connect.addEventListener("click", () => connect());
ui.extract.addEventListener("click", extractPage);
ui.connection_mode.addEventListener("change", async () => {
  state.mode = ui.connection_mode.value;
  state.client = null;
  state.providers = [];
  updateModeUI();
  await saveSettings();
  if (state.mode === "volcengine" && ui.volcengine_api_key.value) await connect();
  else if (state.mode === "opencode" && ui.password.value) await connect();
  else setBusy(false);
});
ui.provider.addEventListener("change", () => { fillModels(); saveSettings(); });
ui.model.addEventListener("change", saveSettings);
ui.volcengine_model.addEventListener("change", async () => {
  updateCustomModelUI();
  await saveSettings();
  updateDirectReadyUI();
  setBusy(false);
});
ui.volcengine_custom_model_id.addEventListener("change", async () => {
  await saveSettings();
  updateDirectReadyUI();
  setBusy(false);
});
ui.chunk_chars.addEventListener("change", saveSettings);
ui.translate.addEventListener("click", translate);
ui.restore.addEventListener("click", restoreOriginal);
ui.analyze.addEventListener("click", analyze);
ui.ask.addEventListener("click", ask);
ui.question.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) ask();
});
ui.stop.addEventListener("click", stop);
ui.copy.addEventListener("click", copyOutput);
ui.export.addEventListener("click", exportOutput);

const preferred = await loadSettings();
setBusy(false);
if (state.mode === "volcengine" && ui.volcengine_api_key.value) connect(preferred);
if (state.mode === "opencode" && ui.password.value) connect(preferred);
