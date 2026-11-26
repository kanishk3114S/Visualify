import { describe, it, expect, vi } from "vitest";
import {
  GeminiPlannerError,
  generateLearningPlan,
  parseFallbackModels,
  createRenderSemaphore,
  convertMermaidToExcalidraw,
} from "../src/index.js";

const VALID_PLAN_JSON = JSON.stringify({
  schemaVersion: "1.0",
  title: "TCP Three-Way Handshake",
  summary: "Connection establishment in TCP.",
  learningObjectives: ["Understand SYN, SYN-ACK, ACK"],
  sections: [
    {
      id: "handshake",
      title: "Handshake Sequence",
      visualType: "sequence",
      keyConcepts: ["Client", "Server", "SYN"],
      relationships: [{ from: "Client", to: "Server", label: "SYN" }],
      explanation: "Three-step handshake.",
      sourceRefs: [],
      diagramSpec: {
        kind: "sequence",
        participants: [
          { id: "client", label: "Client" },
          { id: "server", label: "Server" },
        ],
        messages: [{ from: "client", to: "server", label: "SYN" }],
      },
    },
  ],
  warnings: [],
});

describe("geminiPlanner (unit tests with fault-injected mock client)", () => {
  it("parses and validates a well-formed provider response", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: VALID_PLAN_JSON,
          usageMetadata: { totalTokenCount: 250 },
        }),
      },
    };

    const result = await generateLearningPlan({
      prompt: "Explain TCP handshake",
      client: mockClient,
      model: "gemini-3.8-flash",
    });

    expect(result.repaired).toBe(false);
    expect(result.plan.title).toBe("TCP Three-Way Handshake");
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("performs 1 bounded repair attempt when initial output is invalid JSON", async () => {
    const mockClient = {
      models: {
        generateContent: vi
          .fn()
          .mockResolvedValueOnce({ text: "{ invalid json" })
          .mockResolvedValueOnce({ text: VALID_PLAN_JSON }),
      },
    };

    const result = await generateLearningPlan({
      prompt: "Explain TCP handshake",
      client: mockClient,
      model: "gemini-3.8-flash",
    });

    expect(result.repaired).toBe(true);
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("performs 1 bounded repair attempt on Zod schema validation failure", async () => {
    const invalidSchemaPayload = JSON.stringify({
      schemaVersion: "1.0",
      title: "Broken Plan",
      summary: "Missing sections",
      learningObjectives: ["One"],
      sections: [],
    });

    const mockClient = {
      models: {
        generateContent: vi
          .fn()
          .mockResolvedValueOnce({ text: invalidSchemaPayload })
          .mockResolvedValueOnce({ text: VALID_PLAN_JSON }),
      },
    };

    const result = await generateLearningPlan({
      prompt: "Explain TCP handshake",
      client: mockClient,
    });

    expect(result.repaired).toBe(true);
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("stops after 1 repair attempt and throws SCHEMA_VALIDATION_FAILED if still invalid", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: '{"bad": true}' }),
      },
    };

    await expect(
      generateLearningPlan({ prompt: "Explain TCP handshake", client: mockClient })
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_FAILED" });
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("classifies blocked safety responses without retrying", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          candidates: [{ finishReason: "SAFETY" }],
          text: "",
        }),
      },
    };

    await expect(
      generateLearningPlan({ prompt: "Explain TCP handshake", client: mockClient })
    ).rejects.toMatchObject({ code: "MODEL_RESPONSE_BLOCKED" });
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("classifies empty model responses without retrying", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({ text: "   " }),
      },
    };

    await expect(
      generateLearningPlan({ prompt: "Explain TCP handshake", client: mockClient })
    ).rejects.toMatchObject({ code: "EMPTY_MODEL_RESPONSE" });
  });

  it("classifies 429 rate-limit errors cleanly without retrying the same model when no fallback differs", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue({ status: 429, message: "Quota exceeded" }),
      },
    };

    await expect(
      generateLearningPlan({ prompt: "Explain TCP handshake", client: mockClient, fallbackModels: [] })
    ).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT" });
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("retries transient 503 errors with bounded backoff and fails cleanly when exhausted", async () => {
    const mockClient = {
      models: {
        generateContent: vi
          .fn()
          .mockRejectedValue({ status: 503, message: "Service unavailable" }),
      },
    };

    await expect(
      generateLearningPlan({
        prompt: "Explain TCP handshake",
        client: mockClient,
        maxTransientRetries: 2,
        retryBaseDelayMs: 5,
      })
    ).rejects.toMatchObject({ code: "PROVIDER_TRANSIENT_ERROR" });
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(3);
  });

  it("aborts and throws PROVIDER_TIMEOUT when request exceeds timeoutMs", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn((params) => {
          return new Promise((_, reject) => {
            params.config.abortSignal.addEventListener("abort", () => {
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }),
      },
    };

    await expect(
      generateLearningPlan({
        prompt: "Explain TCP handshake",
        client: mockClient,
        timeoutMs: 25,
        maxTransientRetries: 0,
      })
    ).rejects.toBeInstanceOf(GeminiPlannerError);
  });

  it("fails over immediately to gemini-3.5-flash-lite with low thinkingLevel when primary hits 503", async () => {
    const mockClient = {
      models: {
        generateContent: vi
          .fn()
          .mockRejectedValueOnce({ status: 503, message: "high demand" })
          .mockResolvedValueOnce({ text: VALID_PLAN_JSON, usageMetadata: { totalTokenCount: 180 } }),
      },
    };

    const result = await generateLearningPlan({
      prompt: "Explain TCP handshake",
      client: mockClient,
      model: "gemini-3.5-flash",
      retryBaseDelayMs: 5,
    });

    expect(result.model).toBe("gemini-3.5-flash-lite");
    expect(result.failedOver).toBe(true);
    expect(result.attempts).toBe(2);
    expect(mockClient.models.generateContent).toHaveBeenCalledTimes(2);
    expect(mockClient.models.generateContent.mock.calls[0][0]).toMatchObject({
      model: "gemini-3.5-flash",
      config: { thinkingConfig: { thinkingLevel: "LOW" } },
    });
    expect(mockClient.models.generateContent.mock.calls[1][0]).toMatchObject({
      model: "gemini-3.5-flash-lite",
      config: { thinkingConfig: { thinkingLevel: "LOW" } },
    });
  });

  it("validates GEMINI_FALLBACK_MODELS: regex, max 3, dedup, and excludes primary", () => {
    expect(parseFallbackModels(undefined, "gemini-3.5-flash-lite")).toBeNull();
    expect(
      parseFallbackModels("gemini-3.5-flash-lite, gemini-3.1-flash-lite, gemini-3.1-flash-lite, gemini-3.5-flash", "gemini-3.5-flash-lite")
    ).toEqual(["gemini-3.1-flash-lite", "gemini-3.5-flash"]);
    expect(() => parseFallbackModels("gpt-4o", "gemini-3.5-flash-lite")).toThrow(/Invalid GEMINI_FALLBACK_MODELS/);
    expect(() =>
      parseFallbackModels("gemini-a,gemini-b,gemini-c,gemini-d", "gemini-3.5-flash-lite")
    ).toThrow(/at most 3/);
  });

  it("fails over on 429, 500, DEADLINE, and per-attempt timeout", async () => {
    for (const err of [
      { status: 429, message: "RESOURCE_EXHAUSTED" },
      { status: 500, message: "Internal Server Error" },
      { status: 504, message: "DEADLINE_EXCEEDED" },
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    ]) {
      const client = {
        models: {
          generateContent: vi
            .fn()
            .mockRejectedValueOnce(err)
            .mockResolvedValueOnce({ text: VALID_PLAN_JSON }),
        },
      };
      const out = await generateLearningPlan({
        prompt: "Explain DNS",
        client,
        model: "gemini-3.5-flash",
        fallbackModels: ["gemini-3.5-flash-lite"],
        retryBaseDelayMs: 1,
      });
      expect(out.model).toBe("gemini-3.5-flash-lite");
      expect(out.failedOver).toBe(true);
      expect(out.attempts).toBe(2);
    }
  });

  it("NEVER fails over on safety block, 400 INVALID_ARGUMENT, schema validation repair failure, or caller abort", async () => {
    // 1. Safety block
    const safetyClient = {
      models: { generateContent: vi.fn().mockResolvedValue({ candidates: [{ finishReason: "SAFETY" }], text: "" }) },
    };
    await expect(
      generateLearningPlan({ prompt: "x", client: safetyClient, model: "gemini-3.5-flash", fallbackModels: ["gemini-3.5-flash-lite"] })
    ).rejects.toMatchObject({ code: "MODEL_RESPONSE_BLOCKED" });
    expect(safetyClient.models.generateContent).toHaveBeenCalledTimes(1);

    // 2. 400 INVALID_ARGUMENT
    const badArgClient = {
      models: { generateContent: vi.fn().mockRejectedValue({ status: 400, message: "INVALID_ARGUMENT" }) },
    };
    await expect(
      generateLearningPlan({ prompt: "x", client: badArgClient, model: "gemini-3.5-flash", fallbackModels: ["gemini-3.5-flash-lite"] })
    ).rejects.toMatchObject({ code: "PROVIDER_INVALID_ARGUMENT" });
    expect(badArgClient.models.generateContent).toHaveBeenCalledTimes(1);

    // 3. Schema validation failure triggers 1-shot repair on the SAME responding model, never failover
    const repairClient = {
      models: { generateContent: vi.fn().mockResolvedValue({ text: '{"bad":true}' }) },
    };
    await expect(
      generateLearningPlan({ prompt: "x", client: repairClient, model: "gemini-3.5-flash", fallbackModels: ["gemini-3.5-flash-lite"] })
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_FAILED" });
    expect(repairClient.models.generateContent).toHaveBeenCalledTimes(2);
    expect(repairClient.models.generateContent.mock.calls[0][0].model).toBe("gemini-3.5-flash");
    expect(repairClient.models.generateContent.mock.calls[1][0].model).toBe("gemini-3.5-flash");

    // 4. Caller abort
    const ac = new AbortController();
    const abortClient = {
      models: {
        generateContent: vi.fn((params) => new Promise((_, reject) => {
          params.config.abortSignal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        })),
      },
    };
    const p = generateLearningPlan({
      prompt: "x",
      client: abortClient,
      model: "gemini-3.5-flash",
      fallbackModels: ["gemini-3.5-flash-lite"],
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 5);
    await expect(p).rejects.toMatchObject({ code: "CANCELLED" });
    expect(abortClient.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("reentrancy-safe render semaphore caps direct CLI calls at configured limit", async () => {
    const sem = createRenderSemaphore(2);
    let inFlight = 0;
    let peak = 0;
    const fakeExec = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight -= 1;
      return { stdout: "", stderr: "" };
    };
    // Direct runCliCommand calls via semaphore never exceed limit 2 even with 6 concurrent invokes
    await Promise.all(
      Array.from({ length: 6 }, () => sem.run(fakeExec))
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(typeof convertMermaidToExcalidraw).toBe("function");
  });
});
