import { describe, expect, it } from "vitest";
import { clamp, lerp, rangeProgress, segmentInOut, smoothstep } from "../../src/cinematic/timeline";

describe("cinematic timeline math", () => {
  it("clamps and interpolates without overshoot", () => {
    expect(clamp(-1)).toBe(0);
    expect(clamp(2)).toBe(1);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
  });

  it("maps a local range and eases its edges", () => {
    expect(rangeProgress(0.2, 0.2, 0.4)).toBe(0);
    expect(rangeProgress(0.3, 0.2, 0.4)).toBeCloseTo(0.5);
    expect(smoothstep(0.5)).toBe(0.5);
  });

  it("creates deterministic enter, hold, and exit visibility", () => {
    expect(segmentInOut(0.1, 0.2, 0.3, 0.5, 0.6)).toBe(0);
    expect(segmentInOut(0.4, 0.2, 0.3, 0.5, 0.6)).toBe(1);
    expect(segmentInOut(0.6, 0.2, 0.3, 0.5, 0.6)).toBe(0);
  });
});
