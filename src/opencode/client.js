import { PAGE_SYSTEM_PROMPT, basicAuth, normalizeServerUrl, safeError } from "../shared/security.js";

function extractText(payload) {
  const parts = payload?.parts || payload?.message?.parts || payload?.info?.parts || [];
  const text = parts.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n");
  if (text) return text;
  if (typeof payload?.text === "string") return payload.text;
  const providerError = payload?.info?.error?.data || payload?.error?.data;
  if (providerError) {
    throw new Error(`模型调用失败${providerError.statusCode ? ` (${providerError.statusCode})` : ""}: ${providerError.message || "未知 provider 错误"}`);
  }
  throw new Error("OpenCode 响应中没有文本内容");
}

function normalizeProviders(payload) {
  const providers = Array.isArray(payload) ? payload : payload?.providers || payload?.all || [];
  const connected = Array.isArray(payload?.connected) ? payload.connected : null;
  return providers.map((provider) => {
    const id = provider.id || provider.providerID || provider.name;
    const rawModels = provider.models || {};
    const models = Array.isArray(rawModels)
      ? rawModels
      : Object.entries(rawModels).map(([modelId, value]) => ({ id: modelId, ...value }));
    return {
      id,
      name: provider.name || id,
      models: models.map((model) => ({
        id: model.id || model.modelID,
        name: model.name || model.id || model.modelID,
        context: model.limit?.context || model.context || null,
      })).filter((model) => model.id),
    };
  })
    .filter((provider) => provider.id && provider.models.length && (!connected || connected.includes(provider.id)))
    .sort((a, b) => connected ? connected.indexOf(a.id) - connected.indexOf(b.id) : 0);
}

export class OpenCodeClient {
  constructor({ baseUrl, username, password, fetchImpl = fetch }) {
    this.baseUrl = normalizeServerUrl(baseUrl);
    this.authHeaders = basicAuth(username, password);
    this.fetch = fetchImpl.bind(globalThis);
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...this.authHeaders,
        ...options.headers,
      },
    });
    if (!response.ok) {
      const body = safeError((await response.text()).slice(0, 500));
      throw new Error(`OpenCode HTTP ${response.status}${body ? `: ${body}` : ""}`);
    }
    if (response.status === 204) return null;
    return response.json();
  }

  health(signal) {
    return this.request("/global/health", { signal });
  }

  async providers(signal) {
    return normalizeProviders(await this.request("/provider", { signal }));
  }

  async createSession(title, signal) {
    const payload = await this.request("/session", {
      method: "POST",
      body: JSON.stringify({ title: `AI Reader: ${title}` }),
      signal,
    });
    const id = payload?.id || payload?.sessionID;
    if (!id) throw new Error("OpenCode 未返回 session ID");
    return id;
  }

  async message(sessionId, model, prompt, signal) {
    const payload = await this.request(`/session/${encodeURIComponent(sessionId)}/message`, {
      method: "POST",
      body: JSON.stringify({
        model: { providerID: model.providerID, modelID: model.modelID },
        system: PAGE_SYSTEM_PROMPT,
        tools: {},
        parts: [{ type: "text", text: prompt }],
      }),
      signal,
    });
    return extractText(payload);
  }

  async events(signal, onEvent) {
    const response = await this.fetch(`${this.baseUrl}/event`, {
      headers: { Accept: "text/event-stream", ...this.authHeaders },
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`OpenCode SSE HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        try { onEvent(JSON.parse(data)); } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      }
      if (done) return;
    }
  }

  async latestAssistantText(sessionId, signal) {
    const messages = await this.request(`/session/${encodeURIComponent(sessionId)}/message`, { signal });
    const assistant = [...(messages || [])].reverse().find((message) => message?.info?.role === "assistant");
    return assistant ? extractText(assistant) : "";
  }

  async messageStream(sessionId, model, prompt, { signal, onDelta } = {}) {
    const streamController = new AbortController();
    const abortStream = () => streamController.abort(signal?.reason);
    signal?.addEventListener("abort", abortStream, { once: true });

    let connectedResolve;
    let doneResolve;
    let doneReject;
    const connected = new Promise((resolve) => { connectedResolve = resolve; });
    const completed = new Promise((resolve, reject) => {
      doneResolve = resolve;
      doneReject = reject;
    });
    let busy = false;
    let output = "";

    const stream = this.events(streamController.signal, (event) => {
      if (event.type === "server.connected") connectedResolve();
      const properties = event.properties || {};
      const eventSessionId = properties.sessionID || properties.part?.sessionID;
      if (eventSessionId !== sessionId) return;
      if (event.type === "session.status") {
        if (properties.status?.type === "busy") busy = true;
        if (properties.status?.type === "idle" && (busy || output)) doneResolve();
      }
      if (event.type === "session.idle") doneResolve();
      if (event.type === "session.error") doneReject(new Error(properties.error?.data?.message || properties.error?.message || "OpenCode 会话失败"));
      if (event.type === "message.part.delta" && properties.field === "text" && properties.delta) {
        output += properties.delta;
        onDelta?.(properties.delta);
      }
      if (event.type === "message.part.updated" && properties.part?.type === "text" && properties.part?.time?.end && !output) {
        output = properties.part.text || "";
        if (output) onDelta?.(output);
      }
    }).catch((error) => {
      if (error?.name !== "AbortError") doneReject(error);
    });

    try {
      let connectedTimeout;
      try {
        await Promise.race([
          connected,
          new Promise((_, reject) => {
            connectedTimeout = setTimeout(() => reject(new Error("OpenCode SSE 连接超时")), 8000);
          }),
        ]);
      } finally {
        clearTimeout(connectedTimeout);
      }
      await this.request(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
        method: "POST",
        body: JSON.stringify({
          model: { providerID: model.providerID, modelID: model.modelID },
          system: PAGE_SYSTEM_PROMPT,
          tools: {},
          parts: [{ type: "text", text: prompt }],
        }),
        signal,
      });
      await completed;
    } finally {
      streamController.abort();
      signal?.removeEventListener("abort", abortStream);
      await stream.catch(() => {});
    }

    if (!output) {
      output = await this.latestAssistantText(sessionId, signal);
      if (output) onDelta?.(output);
    }
    if (!output) throw new Error("OpenCode 流式响应中没有文本内容");
    return output;
  }

  abort(sessionId) {
    return this.request(`/session/${encodeURIComponent(sessionId)}/abort`, { method: "POST" });
  }
}

export { extractText, normalizeProviders };
