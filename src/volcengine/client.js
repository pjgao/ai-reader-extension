import { PAGE_SYSTEM_PROMPT, safeError } from "../shared/security.js";

export const DEFAULT_VOLCENGINE_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

export function normalizeVolcengineBaseUrl(value) {
  const url = new URL(value || DEFAULT_VOLCENGINE_BASE_URL);
  if (url.protocol !== "https:") throw new Error("火山 Base URL 必须使用 HTTPS");
  if (url.username || url.password || url.search || url.hash) throw new Error("火山 Base URL 不能包含账号、查询参数或锚点");
  return url.href.replace(/\/$/, "");
}

function chatCompletionsUrl(baseUrl) {
  return baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
}

function modelsUrl(baseUrl) {
  return baseUrl.endsWith("/chat/completions")
    ? `${baseUrl.slice(0, -"/chat/completions".length)}/models`
    : `${baseUrl}/models`;
}

export function extractModels(payload) {
  const source = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : payload?.models && typeof payload.models === "object"
        ? Object.entries(payload.models).map(([id, model]) => ({ id, ...model }))
        : [];
  return source
    .map((model) => {
      const id = typeof model === "string" ? model : model?.id || model?.modelID || model?.name;
      const name = typeof model === "object" ? model?.display_name || model?.displayName || model?.name || id : id;
      return id ? { id, name } : null;
    })
    .filter(Boolean);
}

export function extractChatText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content) return content;
  const providerError = payload?.error;
  if (providerError) throw new Error(`模型调用失败：${providerError.message || providerError.code || "未知错误"}`);
  throw new Error("火山响应中没有文本内容");
}

export class VolcengineClient {
  constructor({ baseUrl, apiKey, fetchImpl = fetch }) {
    this.baseUrl = normalizeVolcengineBaseUrl(baseUrl);
    if (!apiKey?.trim()) throw new Error("请填写火山 API Key");
    this.apiKey = apiKey.trim();
    this.fetch = fetchImpl.bind(globalThis);
  }

  createSession() {
    return Promise.resolve(`direct-${Date.now()}`);
  }

  async models(signal) {
    const response = await this.fetch(modelsUrl(this.baseUrl), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      signal,
    });
    if (!response.ok) {
      const body = safeError((await response.text()).slice(0, 500));
      throw new Error(`模型列表 HTTP ${response.status}${body ? `：${body}` : ""}`);
    }
    const models = extractModels(await response.json());
    if (!models.length) throw new Error("接口没有返回可用模型");
    return models;
  }

  async request(model, prompt, stream, signal) {
    if (!model?.modelID) throw new Error("请填写火山 Model ID");
    const response = await this.fetch(chatCompletionsUrl(this.baseUrl), {
      method: "POST",
      headers: {
        Accept: stream ? "text/event-stream" : "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: model.modelID,
        messages: [
          { role: "system", content: PAGE_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        stream,
        temperature: 0.1,
        max_tokens: 8192,
      }),
      signal,
    });
    if (!response.ok) {
      const body = safeError((await response.text()).slice(0, 500));
      throw new Error(`火山 HTTP ${response.status}${body ? `：${body}` : ""}`);
    }
    return response;
  }

  async message(_sessionId, model, prompt, signal) {
    const response = await this.request(model, prompt, false, signal);
    return extractChatText(await response.json());
  }

  async messageStream(_sessionId, model, prompt, { signal, onDelta, onActivity } = {}) {
    const response = await this.request(model, prompt, true, signal);
    if (!response.body) throw new Error("火山流式响应没有响应体");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let output = "";
    let finished = false;

    while (!finished) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") {
          finished = true;
          break;
        }
        let event;
        try { event = JSON.parse(data); } catch { continue; }
        if (event.error) throw new Error(`模型调用失败：${event.error.message || event.error.code || "未知错误"}`);
        const delta = event?.choices?.[0]?.delta?.content;
        const reasoning = event?.choices?.[0]?.delta?.reasoning_content;
        if (typeof reasoning === "string" && reasoning) onActivity?.();
        if (typeof delta === "string" && delta) {
          onActivity?.();
          output += delta;
          onDelta?.(delta);
        }
      }
      if (done) break;
    }
    if (!output) throw new Error("火山流式响应中没有文本内容");
    return output;
  }

  abort() {
    return Promise.resolve();
  }
}
