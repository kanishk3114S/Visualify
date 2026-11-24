import { describe, it, expect, vi } from "vitest";
import {
  GeminiPlannerError,
  generateLearningPlan,
} from "../src/services/geminiPlanner.js";

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

  it("classifies 429 rate-limit errors cleanly without retrying", async () => {
    const mockClient = {
      models: {
        generateContent: vi.fn().mockRejectedValue({ status: 429, message: "Quota exceeded" }),
      },
    };

    await expect(
      generateLearningPlan({ prompt: "Explain TCP handshake", client: mockClient })
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
});
