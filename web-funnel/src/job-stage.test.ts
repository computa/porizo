import { describe, expect, it } from "vitest";
import { stageForJob } from "./job-stage";

describe("job stage mapping", () => {
  it.each([
    [0, 0],
    [1, 0],
    [20, 1],
    [40, 2],
    [60, 3],
    [80, 4],
    [100, 4],
  ])("maps %i percent to stage %i", (progress, stage) => {
    expect(stageForJob({ status: "running", progress })).toBe(stage);
  });

  it("uses a specific backend step when progress is unavailable", () => {
    expect(stageForJob({ status: "running", step: "recording_vocals" })).toBe(3);
  });
});
