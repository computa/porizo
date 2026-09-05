import type { EtsyBrief } from "./types";

const labels = [
  ["recipient_name", "Recipient's name"],
  ["relationship", "Relationship"],
  ["occasion", "Occasion"],
  ["style", "Song style"],
  ["specific_memory", "Specific memory or message"],
] satisfies Array<[keyof EtsyBrief, string]>;

export function Brief({ brief }: { brief: EtsyBrief }) {
  return <dl className="space-y-3">
    {labels.map(([key, label]) => <div key={key}>
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-slate-100">{brief[key]}</dd>
    </div>)}
  </dl>;
}
