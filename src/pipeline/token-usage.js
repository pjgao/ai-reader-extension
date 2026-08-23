import { estimateTokens } from "./chunk.js";

export class TranslationTokenTracker {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.requests = [];
    this.cachedSegments = 0;
  }

  setCachedSegments(count) {
    this.cachedSegments = count;
    this.emit();
  }

  beginRequest(inputText) {
    const request = { estimatedInput: estimateTokens(inputText), outputText: "", usage: null };
    this.requests.push(request);
    this.emit();
    return request;
  }

  addDelta(request, delta) {
    request.outputText += delta || "";
    this.emit();
  }

  setUsage(request, usage) {
    if (!usage) return;
    request.usage = usage;
    this.emit();
  }

  snapshot() {
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    for (const request of this.requests) {
      const estimatedOutput = estimateTokens(request.outputText);
      const input = request.usage?.inputTokens ?? request.estimatedInput;
      const output = request.usage?.outputTokens ?? estimatedOutput;
      inputTokens += input;
      outputTokens += output;
      totalTokens += request.usage?.totalTokens ?? input + output;
    }
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      cachedSegments: this.cachedSegments,
      requestCount: this.requests.length,
      exact: this.requests.length > 0 && this.requests.every((request) => request.usage?.totalTokens != null),
    };
  }

  emit() {
    this.onChange(this.snapshot());
  }
}
