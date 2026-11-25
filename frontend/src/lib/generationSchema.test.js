import { describe, it, expect } from "vitest";
import { generationRequestSchema, toGenerationBody, PROMPT_MAX_CHARS, GENERATION_OPTIONS } from "./schemas.js";

const base = { prompt: "Explain TCP", subject: "", audienceLevel: "undergraduate", detail: "standard", visualStyle: "hand_drawn_clean", preferredOutput: "auto" };
const errorsFor = (values) => {
  const r = generationRequestSchema.safeParse(values);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("generationRequestSchema", () => {
  it("accepts a valid request and trims the prompt", () => {
    const r = generationRequestSchema.parse({ ...base, prompt: "  Explain TCP  " });
    expect(r.prompt).toBe("Explain TCP");
  });

  it.each([
    ["empty prompt", { prompt: "" }, "prompt"],
    ["whitespace prompt", { prompt: "   \n " }, "prompt"],
    ["prompt over the limit", { prompt: "a".repeat(PROMPT_MAX_CHARS + 1) }, "prompt"],
    ["subject too long", { subject: "s".repeat(121) }, "subject"],
    ["unknown level", { audienceLevel: "phd" }, "audienceLevel"],
    ["unknown diagram type", { preferredOutput: "pie" }, "preferredOutput"],
  ])("rejects %s", (_label, override, field) => {
    expect(errorsFor({ ...base, ...override })).toContain(field);
  });

  it("accepts exactly the maximum prompt length", () => {
    expect(errorsFor({ ...base, prompt: "a".repeat(PROMPT_MAX_CHARS) })).toEqual([]);
  });

  it("offers the same options the API accepts", () => {
    expect(GENERATION_OPTIONS.preferredOutput.map(([v]) => v)).toEqual([
      "auto", "flowchart", "sequence", "mindmap", "comparison", "timeline", "er_diagram", "class_diagram",
    ]);
    expect(GENERATION_OPTIONS.audienceLevel.map(([v]) => v)).toEqual(["school", "undergraduate", "postgraduate", "professional"]);
  });
});

describe("toGenerationBody", () => {
  it("builds the POST /api/v1/generations body", () => {
    expect(toGenerationBody({ ...base, prompt: " Explain TCP ", subject: " Networks " })).toEqual({
      inputType: "prompt",
      prompt: "Explain TCP",
      settings: { subject: "Networks", audienceLevel: "undergraduate", detail: "standard", visualStyle: "hand_drawn_clean", preferredOutput: "auto" },
    });
  });
});
