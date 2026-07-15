import type { JobStatus } from "./api/funnel";

export function stageForJob(job: JobStatus): number {
  const step = (job.step ?? "").toLowerCase();
  const progress = job.progress ?? 0;

  if (step.includes("mix") || progress >= 80) return 4;
  if (step.includes("vocal") || step.includes("record") || progress >= 60) return 3;
  if (step.includes("music") || step.includes("melody") || progress >= 40) return 2;
  if (step.includes("lyric") || progress >= 20) return 1;
  return 0;
}
