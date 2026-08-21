import test from "node:test";
import assert from "node:assert/strict";
import { OpenCodeClient, extractText, normalizeProviders } from "../src/opencode/client.js";

test("provider payload is normalized without hard-coded IDs", () => {
  const providers = normalizeProviders({
    all: [{ id: "火山AI网关", name: "Volc", models: { "deepseek-v4-flash": { name: "DeepSeek", limit: { context: 128000 } } } }],
  });
  assert.deepEqual(providers[0].models[0], { id: "deepseek-v4-flash", name: "DeepSeek", context: 128000 });
});

test("only connected providers are offered when OpenCode supplies that list", () => {
  const providers = normalizeProviders({
    all: [
      { id: "unused", models: { a: {} } },
      { id: "ready", models: { b: {} } },
    ],
    connected: ["ready"],
  });
  assert.deepEqual(providers.map((provider) => provider.id), ["ready"]);
});

test("message always disables tools and marks page data as untrusted", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ parts: [{ type: "text", text: "ok" }] }), { status: 200 });
  };
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", username: "u", password: "p", fetchImpl });
  const result = await client.message("session-1", { providerID: "provider", modelID: "model" }, "<page-content>x</page-content>");
  const body = JSON.parse(request.options.body);
  assert.equal(result, "ok");
  assert.deepEqual(body.tools, {});
  assert.match(body.system, /不可信数据/);
  assert.match(request.options.headers.Authorization, /^Basic /);
});

test("text can be extracted from common OpenCode message envelopes", () => {
  assert.equal(extractText({ message: { parts: [{ type: "text", text: "answer" }] } }), "answer");
});

test("provider errors are surfaced instead of reported as missing text", () => {
  assert.throws(
    () => extractText({ info: { error: { data: { message: "Unauthorized", statusCode: 401 } }, parts: [] } }),
    /模型调用失败 \(401\): Unauthorized/,
  );
});

test("fetch keeps the browser global receiver", async () => {
  function fetchImpl() {
    assert.equal(this, globalThis);
    return Promise.resolve(new Response(JSON.stringify({ healthy: true }), { status: 200 }));
  }
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", username: "u", password: "p", fetchImpl });
  assert.deepEqual(await client.health(), { healthy: true });
});

test("prompt_async text deltas are streamed until the session becomes idle", async () => {
  const encoder = new TextEncoder();
  let eventController;
  const eventStream = new ReadableStream({
    start(controller) {
      eventController = controller;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`));
    },
  });
  const emit = (event) => eventController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  const fetchImpl = async (url) => {
    if (url.endsWith("/event")) return new Response(eventStream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    if (url.endsWith("/prompt_async")) {
      emit({ type: "session.status", properties: { sessionID: "session-1", status: { type: "busy" } } });
      emit({ type: "message.part.delta", properties: { sessionID: "session-1", field: "text", delta: "中" } });
      emit({ type: "message.part.delta", properties: { sessionID: "session-1", field: "text", delta: "文" } });
      emit({ type: "session.status", properties: { sessionID: "session-1", status: { type: "idle" } } });
      eventController.close();
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const deltas = [];
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", username: "u", password: "p", fetchImpl });
  const text = await client.messageStream("session-1", { providerID: "provider", modelID: "model" }, "prompt", {
    onDelta: (delta) => deltas.push(delta),
  });
  assert.equal(text, "中文");
  assert.deepEqual(deltas, ["中", "文"]);
});

test("a completed text part is delivered when the server emitted no delta events", async () => {
  const encoder = new TextEncoder();
  let eventController;
  const eventStream = new ReadableStream({
    start(controller) {
      eventController = controller;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`));
    },
  });
  const emit = (event) => eventController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  const fetchImpl = async (url) => {
    if (url.endsWith("/event")) return new Response(eventStream, { status: 200 });
    if (url.endsWith("/prompt_async")) {
      emit({ type: "session.status", properties: { sessionID: "session-1", status: { type: "busy" } } });
      emit({
        type: "message.part.updated",
        properties: {
          sessionID: "session-1",
          part: { type: "text", text: "[block:b00001-s001]中文[/block:b00001-s001]", time: { end: 1 } },
        },
      });
      emit({ type: "session.status", properties: { sessionID: "session-1", status: { type: "idle" } } });
      eventController.close();
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };
  const chunks = [];
  const client = new OpenCodeClient({ baseUrl: "http://127.0.0.1:4096", username: "u", password: "p", fetchImpl });
  const text = await client.messageStream("session-1", { providerID: "provider", modelID: "model" }, "prompt", {
    onDelta: (delta) => chunks.push(delta),
  });
  assert.equal(text, "[block:b00001-s001]中文[/block:b00001-s001]");
  assert.deepEqual(chunks, [text]);
});
