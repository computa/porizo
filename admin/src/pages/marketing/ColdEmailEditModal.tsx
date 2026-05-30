import { useState } from "react";
import { X, AlertCircle } from "lucide-react";

export interface ColdEmailCampaign {
  id: string;
  campaign_tag: string;
  subject: string;
  template_html_path: string;
  template_text_path: string;
  from_address: string;
  reply_to: string;
  per_day: number;
  schedule_pace_seconds: number;
  schedule_offset_minutes: number;
  fire_after_utc_hour: number;
  fire_until_utc_hour: number;
  min_minutes_between_runs: number;
  earliest_run_date_utc: string | null;
  active: number;
  started_at: string | null;
  last_run_at: string | null;
  last_run_date_utc: string | null;
  last_batch_size: number | null;
  total_queued: number;
  created_at: string;
  updated_at?: string | null;
  pending_count: number;
}

// NOTE: Keep in sync with the server-side allowlist in
// src/routes/admin.js inside PATCH /admin/dashboard/marketing/cold-email/:id.
// Adding a new editable field requires updating BOTH sides — the backend
// is the authoritative validator.
const EDITABLE_FIELDS: Array<{
  key: keyof ColdEmailCampaign;
  label: string;
  type: "text" | "number";
  min?: number;
  max?: number;
  hint?: string;
}> = [
  { key: "subject", label: "Subject", type: "text", hint: "Up to 200 chars." },
  { key: "campaign_tag", label: "Cohort tag (Resend)", type: "text" },
  {
    key: "per_day",
    label: "Per day",
    type: "number",
    min: 1,
    max: 100,
    hint: "Resend batch limit is 100.",
  },
  {
    key: "schedule_pace_seconds",
    label: "Pace seconds",
    type: "number",
    min: 30,
    max: 3600,
  },
  {
    key: "schedule_offset_minutes",
    label: "Offset minutes",
    type: "number",
    min: 0,
    max: 600,
    hint: "Capped at 600 (10h) to avoid UTC-day overflow.",
  },
  {
    key: "fire_after_utc_hour",
    label: "Fire after UTC hour",
    type: "number",
    min: 0,
    max: 23,
    hint: "First fire of the daily window starts at/after this UTC hour.",
  },
  {
    key: "fire_until_utc_hour",
    label: "Fire until UTC hour",
    type: "number",
    min: 1,
    max: 24,
    hint: "No fires at or after this UTC hour. 24 = no upper bound.",
  },
  {
    key: "min_minutes_between_runs",
    label: "Min minutes between runs",
    type: "number",
    min: 1,
    max: 1440,
    hint: "1440 = once-per-day. Lower for intraday cadence (60 = up to 10×/day in a 10h window).",
  },
  { key: "from_address", label: "From address", type: "text" },
  { key: "reply_to", label: "Reply-to", type: "text" },
];

export type ColdEmailPatch = Partial<ColdEmailCampaign> & {
  if_match?: string | null;
};

export function ColdEmailEditModal({
  campaign,
  onSave,
  onClose,
  saving,
}: {
  campaign: ColdEmailCampaign;
  onSave: (patch: ColdEmailPatch) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Partial<ColdEmailCampaign>>(() => {
    const init: Partial<ColdEmailCampaign> = {};
    for (const f of EDITABLE_FIELDS) {
      (init as Record<string, unknown>)[f.key] = campaign[f.key];
    }
    init.earliest_run_date_utc = campaign.earliest_run_date_utc;
    return init;
  });
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSave = async () => {
    setSubmitError(null);
    const patch: ColdEmailPatch = {};
    for (const f of EDITABLE_FIELDS) {
      const newVal = form[f.key];
      const oldVal = campaign[f.key];
      if (newVal === undefined) continue;
      if (newVal !== oldVal) {
        (patch as Record<string, unknown>)[f.key] = newVal;
      }
    }
    if (form.earliest_run_date_utc !== campaign.earliest_run_date_utc) {
      patch.earliest_run_date_utc = form.earliest_run_date_utc;
    }
    if (Object.keys(patch).length === 0) {
      setSubmitError("No changes to save.");
      return;
    }
    if (
      "per_day" in patch &&
      !window.confirm(
        `Change per_day from ${campaign.per_day} to ${patch.per_day}? This affects the next batch size.`,
      )
    ) {
      return;
    }
    // Include the optimistic-concurrency token from the loaded campaign.
    if (campaign.updated_at) patch.if_match = campaign.updated_at;
    try {
      await onSave(patch);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Save failed");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <h2 className="text-white text-lg font-semibold">
            Edit campaign · <span className="text-rose-400">{campaign.id}</span>
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {EDITABLE_FIELDS.map((f) => (
            <div key={String(f.key)}>
              <label className="block text-slate-300 text-sm font-medium mb-1">
                {f.label}
              </label>
              <input
                type={f.type}
                value={form[f.key] === undefined ? "" : String(form[f.key])}
                onChange={(e) => {
                  const raw = e.target.value;
                  // Cleared number input → undefined (skipped in the diff),
                  // not 0 — avoids silently PATCHing per_day=0 etc.
                  let next: unknown;
                  if (f.type === "number") {
                    if (raw === "") next = undefined;
                    else {
                      const n = Number(raw);
                      next = Number.isFinite(n) ? n : undefined;
                    }
                  } else {
                    next = raw;
                  }
                  setForm((prev) => ({ ...prev, [f.key]: next as never }));
                }}
                min={f.min}
                max={f.max}
                className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-rose-500"
              />
              {f.hint && (
                <p className="text-slate-500 text-xs mt-1">{f.hint}</p>
              )}
            </div>
          ))}
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1">
              Earliest run date (UTC, YYYY-MM-DD)
            </label>
            <input
              type="text"
              placeholder="2026-05-12"
              value={form.earliest_run_date_utc ?? ""}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  earliest_run_date_utc: e.target.value || null,
                }))
              }
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-rose-500"
            />
          </div>
          {submitError && (
            <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{submitError}</span>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-300 hover:text-white text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-rose-500/40 text-white text-sm font-medium rounded"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
