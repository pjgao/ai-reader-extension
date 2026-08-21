import test from "node:test";
import assert from "node:assert/strict";
import { VolcengineClient, extractChatText, normalizeVolcengineBaseUrl } from "../src/volcengine/client.js";

test("Volcengine base URL requires HTTPS and removes a trailing slash", () => {
  assert.equal(normalizeVolcengineBaseUrl("https://ark.cn-beijing.volces.com/api/v3/"), "https://ark.cn-beijing.volces.com/api/v3");
  assert.throws(() => normalizeVolcengineBaseUrl("http://example.com/v1"), /必须使用 HTTPS/);
});

test("Volcengine chat completion text is extracted", () => {
  assert.equal(extractChatText({ choices: [{ message: { content: "中文" } }] }), "中文");
});

test("Volcengine client streams OpenAI-compatible chat completion deltas", async () => {
  const encoder = new TextEncoder();
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"思考"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"中"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"文"}}]}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  const deltas = [];
  let activities = 0;
  const client = new VolcengineClient({ baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiKey: "x", fetchImpl });
  const output = await client.messageStream("unused", { modelID: "model-id" }, "prompt", {
    onDelta: (delta) => deltas.push(delta),
    onActivity: () => { activities += 1; },
  });

  assert.equal(request.url, "https://ark.cn-beijing.volces.com/api/v3/chat/completions");
  const body = JSON.parse(request.options.body);
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, 8192);
  assert.equal(output, "中文");
  assert.deepEqual(deltas, ["中", "文"]);
  assert.equal(activities, 3);
});
