import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatibleClient, extractChatText, extractModels, extractUsage, normalizeOpenAIBaseUrl } from "../src/openai-compatible/client.js";

test("OpenAI-compatible base URL requires HTTPS and removes a trailing slash", () => {
  assert.equal(normalizeOpenAIBaseUrl("https://api.deepseek.com/"), "https://api.deepseek.com");
  assert.equal(normalizeOpenAIBaseUrl("https://ark.cn-beijing.volces.com/api/v3/"), "https://ark.cn-beijing.volces.com/api/v3");
  assert.throws(() => normalizeOpenAIBaseUrl("http://example.com/v1"), /必须使用 HTTPS/);
});

test("OpenAI-compatible chat completion text is extracted", () => {
  assert.equal(extractChatText({ choices: [{ message: { content: "中文" } }] }), "中文");
});

test("OpenAI-compatible token usage is normalized", () => {
  assert.deepEqual(extractUsage({ usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } }), {
    inputTokens: 12,
    outputTokens: 4,
    totalTokens: 16,
  });
});

test("OpenAI-compatible model lists are normalized", () => {
  assert.deepEqual(extractModels({ data: [{ id: "model-a" }, { id: "model-b", display_name: "Model B" }] }), [
    { id: "model-a", name: "model-a" },
    { id: "model-b", name: "Model B" },
  ]);
  assert.deepEqual(extractModels({ models: { "model-c": { name: "Model C" } } }), [
    { id: "model-c", name: "Model C" },
  ]);
});

test("OpenAI-compatible client reads models from the compatible endpoint", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return Response.json({ data: [{ id: "model-a" }] });
  };
  const client = new OpenAICompatibleClient({
    baseUrl: "https://example.com/v1/chat/completions",
    apiKey: "secret",
    fetchImpl,
  });

  assert.deepEqual(await client.models(), [{ id: "model-a", name: "model-a" }]);
  assert.equal(request.url, "https://example.com/v1/models");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.Authorization, "Bearer secret");
});

test("OpenAI-compatible client streams chat completion deltas", async () => {
  const encoder = new TextEncoder();
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"中"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"文"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  const deltas = [];
  let activities = 0;
  let usage;
  const client = new OpenAICompatibleClient({ baseUrl: "https://api.deepseek.com", apiKey: "x", fetchImpl });
  const output = await client.messageStream("unused", { modelID: "model-id" }, "prompt", {
    onDelta: (delta) => deltas.push(delta),
    onActivity: () => { activities += 1; },
    onUsage: (value) => { usage = value; },
  });

  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  const body = JSON.parse(request.options.body);
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 8192);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(output, "中文");
  assert.deepEqual(deltas, ["中", "文"]);
  assert.equal(activities, 3);
  assert.deepEqual(usage, { inputTokens: 10, outputTokens: 2, totalTokens: 12 });
});
