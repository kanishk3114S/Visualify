import { describe, it, expect } from "vitest";
import { buildSelectedContext, extractSceneFrames, summarizeFlashcards } from "./frames.js";

describe("Phase 5 frontend helpers", () => {
  it("extractSceneFrames prefers explicit frame elements ordered top-to-bottom", () => {
    const scene = {
      elements: [
        { id: "s2__frame", type: "frame", name: "2. Second", x: 0, y: 400, width: 300, height: 200 },
        { id: "s1__frame", type: "frame", name: "1. First", x: 0, y: 0, width: 300, height: 200 },
        { id: "s1__box", type: "rectangle", x: 20, y: 20, width: 100, height: 60, frameId: "s1__frame" },
        { id: "s2__box", type: "rectangle", x: 20, y: 420, width: 100, height: 60, frameId: "s2__frame" },
      ],
    };
    const frames = extractSceneFrames(scene, { sections: [{ id: "s1", title: "First" }, { id: "s2", title: "Second" }] });
    expect(frames.map((f) => f.title)).toEqual(["1. First", "2. Second"]);
    expect(frames[0].sectionId).toBe("s1");
    expect(frames[0].elementIds).toEqual(["s1__frame", "s1__box"]);
  });

  it("extractSceneFrames falls back to section prefixes for legacy scenes without frames", () => {
    const scene = {
      elements: [
        { id: "alpha__box", type: "rectangle", x: 0, y: 0, width: 80, height: 40 },
        { id: "beta__box", type: "rectangle", x: 0, y: 200, width: 80, height: 40 },
      ],
    };
    const frames = extractSceneFrames(scene, { sections: [{ id: "alpha", title: "Alpha" }, { id: "beta", title: "Beta" }] });
    expect(frames.map((f) => [f.sectionId, f.title])).toEqual([
      ["alpha", "1. Alpha"],
      ["beta", "2. Beta"],
    ]);
  });

  it("buildSelectedContext attaches bound label text and skips frame containers", () => {
    const all = [
      { id: "s1__frame", type: "frame", x: 0, y: 0, width: 200, height: 100 },
      { id: "b1", type: "rectangle", x: 10, y: 10, width: 100, height: 40, boundElements: [{ id: "t1", type: "text" }] },
      { id: "t1", type: "text", x: 20, y: 20, width: 60, height: 20, text: "SYN Packet", containerId: "b1" },
    ];
    const ctx = buildSelectedContext([all[0], all[1]], all);
    expect(ctx).toEqual([{ id: "b1", type: "rectangle", text: "SYN Packet", boundElements: [{ id: "t1", type: "text" }] }]);
  });

  it("summarizeFlashcards tallies known, review and fresh cards", () => {
    expect(
      summarizeFlashcards([{ mastery: "known" }, { mastery: "review" }, { mastery: "new" }, { mastery: "known" }])
    ).toEqual({ total: 4, known: 2, review: 1, fresh: 1 });
  });
});
