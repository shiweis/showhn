import test from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  AnalysisRefusedError,
  AnalysisTruncatedError,
  analyzeBatch,
  buildAnthropicRequest,
  readAnthropicResponse,
} from "../src/lib/ai/llm";
import { isResponseFormatFailure } from "../src/lib/ai/failures";
import { estimateCostUsd } from "../src/lib/ai/pricing";

const userContent: Anthropic.Messages.ContentBlockParam[] = [
  { type: "text", text: "Rate this project." },
];

/** A complete Messages API response as Claude Haiku 5.5 returns it. */
function message(overrides: Record<string, unknown>): Anthropic.Messages.Message {
  return {
    id: "msg_01",
    type: "message",
    role: "assistant",
    model: "claude-haiku-5-5",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 120,
      output_tokens: 800,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 5000,
      cache_creation: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: "standard",
    },
    ...overrides,
  } as unknown as Anthropic.Messages.Message;
}

test("Anthropic judge request ends on the user turn, with the rubric as a system block cached for one hour", () => {
  const request = buildAnthropicRequest({
    systemPrompt: "rubric",
    content: userContent,
    model: "claude-haiku-5-5",
  });

  // Claude Haiku 5.5 rejects a trailing assistant prefill with a 400.
  assert.deepEqual(request.messages, [{ role: "user", content: userContent }]);
  // Ingest runs every 30 minutes, so the default 5-minute cache would expire between runs.
  assert.deepEqual(request.system, [
    { type: "text", text: "rubric", cache_control: { type: "ephemeral", ttl: "1h" } },
  ]);
  assert.equal(request.model, "claude-haiku-5-5");
});

test("Anthropic judge request constrains output with the schema, minus the length keywords the API rejects", () => {
  const request = buildAnthropicRequest({
    systemPrompt: "rubric",
    content: userContent,
    model: "claude-haiku-5-5",
    responseSchema: {
      type: "object",
      properties: {
        tier: { type: "string", enum: ["gem", "pass"] },
        summary: { type: "string", minLength: 1, maxLength: 300 },
        strengths: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 240 },
          minItems: 1,
          maxItems: 3,
        },
      },
      required: ["tier", "summary", "strengths"],
      additionalProperties: false,
    },
  });

  assert.deepEqual(request.output_config, {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          tier: { type: "string", enum: ["gem", "pass"] },
          summary: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
        },
        required: ["tier", "summary", "strengths"],
        additionalProperties: false,
      },
    },
  });
});

test("effort and thinking are left to the model's defaults unless configured", () => {
  const request = buildAnthropicRequest({
    systemPrompt: "rubric",
    content: userContent,
    model: "claude-haiku-5-5",
  });

  assert.equal("thinking" in request, false);
  assert.equal(request.output_config?.effort, undefined);
});

test("configured effort and thinking mode reach the Anthropic request", () => {
  const request = buildAnthropicRequest({
    systemPrompt: "rubric",
    content: userContent,
    model: "claude-haiku-5-5",
    effort: "low",
    thinking: "disabled",
  });

  assert.equal(request.output_config?.effort, "low");
  assert.deepEqual(request.thinking, { type: "disabled" });
});

test("the judge's answer is read from the text block that follows thinking blocks", () => {
  const response = readAnthropicResponse(
    message({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: '{"tier":"gem"}', citations: null },
      ],
    }),
    1234,
  );

  assert.equal(response.text, '{"tier":"gem"}');
});

test("Anthropic usage keeps cached prompt tokens separate from fresh input", () => {
  const { usage } = readAnthropicResponse(
    message({ content: [{ type: "text", text: "{}", citations: null }] }),
    1234,
  );

  assert.deepEqual(
    {
      input: usage.inputTokens,
      output: usage.outputTokens,
      cacheRead: usage.cacheReadTokens,
      cacheWrite: usage.cacheCreateTokens,
      durationMs: usage.durationMs,
      finishReason: usage.finishReason,
    },
    { input: 120, output: 800, cacheRead: 5000, cacheWrite: 0, durationMs: 1234, finishReason: "end_turn" },
  );
});

test("thinking tokens are reported separately so effort levels can be costed", () => {
  const base = message({ content: [{ type: "text", text: "{}", citations: null }] });
  const { usage } = readAnthropicResponse(
    {
      ...base,
      usage: { ...base.usage, output_tokens: 800, output_tokens_details: { thinking_tokens: 650 } },
    } as unknown as Anthropic.Messages.Message,
    10,
  );

  assert.equal(usage.reasoningTokens, 650);
  assert.equal(usage.outputTokens, 800);
});

test("the response records which model actually served the request", () => {
  const { usage } = readAnthropicResponse(
    message({ model: "claude-fable-5-2", content: [{ type: "text", text: "{}", citations: null }] }),
    10,
  );

  assert.equal(usage.servedModel, "claude-fable-5-2");
});

test("a safety-classifier refusal raises AnalysisRefusedError carrying its category", () => {
  assert.throws(
    () =>
      readAnthropicResponse(
        message({
          stop_reason: "refusal",
          stop_details: { type: "refusal", category: "cyber", explanation: "declined" },
          content: [],
        }),
        10,
      ),
    (error: unknown) => error instanceof AnalysisRefusedError && error.category === "cyber",
  );
});

test("a reply cut off at max_tokens before any text raises AnalysisTruncatedError", () => {
  assert.throws(
    () =>
      readAnthropicResponse(
        message({
          stop_reason: "max_tokens",
          content: [{ type: "thinking", thinking: "", signature: "sig" }],
        }),
        10,
      ),
    (error: unknown) => error instanceof AnalysisTruncatedError,
  );
});

test("a reply cut off at max_tokens after some text is still returned for partial-batch recovery", () => {
  const response = readAnthropicResponse(
    message({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: '{"results":[{"post_id":1,"tier":"mid"}', citations: null }],
    }),
    10,
  );

  assert.equal(response.text, '{"results":[{"post_id":1,"tier":"mid"}');
  assert.equal(response.usage.finishReason, "max_tokens");
});

test("an unknown ANALYSIS_ANTHROPIC_EFFORT is rejected before any API call", async () => {
  process.env.ANALYSIS_ANTHROPIC_EFFORT = "ultra";
  try {
    await assert.rejects(
      analyzeBatch(
        [{ id: 1, title: "Show HN: Widget", url: null, pageContent: "A widget.", storyText: null }],
        { providerOverride: "anthropic", modelOverride: "claude-haiku-5-5" },
      ),
      /ANALYSIS_ANTHROPIC_EFFORT/,
    );
  } finally {
    delete process.env.ANALYSIS_ANTHROPIC_EFFORT;
  }
});

test("a refused or truncated batch is retried post by post instead of pausing the worker", () => {
  assert.equal(isResponseFormatFailure(new AnalysisRefusedError("cyber")), true);
  assert.equal(isResponseFormatFailure(new AnalysisTruncatedError()), true);
});

test("unparseable model output is retried post by post", () => {
  assert.equal(isResponseFormatFailure(new Error("No JSON object found in response")), true);
});

test("an HTTP error from the provider counts as an outage even when its message mentions JSON", () => {
  const providerError = Object.assign(new Error("404 No endpoints found: JSON schema unsupported"), {
    status: 404,
  });
  assert.equal(isResponseFormatFailure(providerError), false);
});

test("Claude Haiku 5.5 cost bills one-hour cache writes at 2x and cache reads at 0.1x of the input rate", () => {
  const cost = estimateCostUsd("claude-haiku-5-5", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreateTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
  });

  // $0.10 input + $0.20 cache write + $0.01 cache read + $0.50 output
  assert.equal(Number(cost.toFixed(6)), 0.81);
});

test("Claude Fable 5.2 cost uses its own rates, with cache reads at $0.20 per million tokens", () => {
  const cost = estimateCostUsd("claude-fable-5-2", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreateTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
  });

  // $8 input + $16 one-hour cache write + $0.20 cache read + $40 output
  assert.equal(Number(cost.toFixed(6)), 64.2);
});

test("OpenRouter models are priced on prompt tokens, which already include cached tokens", () => {
  const cost = estimateCostUsd("minimax/minimax-m3", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreateTokens: 0,
    cacheReadTokens: 400_000,
  });

  // $0.23 input + $0.96 output; cache reads are not added on top
  assert.equal(Number(cost.toFixed(6)), 1.19);
});

test("a model without a price entry reports zero cost rather than a guess", () => {
  assert.equal(
    estimateCostUsd("unknown/model", {
      inputTokens: 5000,
      outputTokens: 5000,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    }),
    0,
  );
});

test("analyzeBatch sends a system prompt override to Anthropic in place of the built rubric", async (t) => {
  t.mock.method(console, "log", () => {});
  const http = await import("node:http");
  const captured: unknown[] = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      captured.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                summary: "Does a thing",
                category: "Other",
                target_audience: "Developers",
                tier: "solid",
                vibe_tags: ["Cozy"],
                highlight: "Small and neat.",
                strengths: ["Works offline"],
                weaknesses: ["No docs"],
                similar_to: [],
              }),
            },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server has no port");

  const saved = { key: process.env.ANTHROPIC_API_KEY, base: process.env.ANTHROPIC_BASE_URL };
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const { results } = await analyzeBatch(
      [{ id: 7, title: "Show HN: Widget", url: null, pageContent: "A widget.", storyText: null }],
      {
        providerOverride: "anthropic",
        modelOverride: "claude-haiku-5-5",
        anthropicEffort: "medium",
        systemPromptOverride: "CUSTOM RUBRIC",
      },
    );

    assert.equal(results.get(7)?.tier, "solid");
    assert.equal(captured.length, 1);
    const body = captured[0] as {
      system: { text: string }[];
      messages: { role: string }[];
      output_config: { effort: string; format: { type: string } };
    };
    assert.equal(body.system[0].text, "CUSTOM RUBRIC");
    assert.deepEqual(body.messages.map((message) => message.role), ["user"]);
    assert.equal(body.output_config.effort, "medium");
    assert.equal(body.output_config.format.type, "json_schema");
  } finally {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = saved.base;
    await new Promise((resolve) => server.close(resolve));
  }
});
