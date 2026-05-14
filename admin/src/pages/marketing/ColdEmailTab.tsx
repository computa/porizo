import { useEffect, useState } from "react";
import {
  Send,
  Play,
  Pause,
  Edit3,
  X,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { useApi } from "../../hooks/useApi";
import { LoadingState } from "../../components/LoadingState";
import { ErrorState } from "../../components/ErrorState";

interface ColdEmailCampaign {
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
  earliest_run_date_utc: string | null;
  active: number;
  started_at: string | null;
  last_run_at: string | null;
  last_run_date_utc: string | null;
  last_batch_size: number | null;
  total_queued: number;
  created_at: string;
  pending_count: number;
}

interface TriggerResult {
  fired: boolean;
  queued?: number;
  attempted?: number;
  reason?: string;
}

interface Banner {
  kind: "success" | "error" | "info";
  text: string;
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
  },
  { key: "from_address", label: "From address", type: "text" },
  { key: "reply_to", label: "Reply-to", type: "text" },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ active }: { active: number }) {
  if (active === 1) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="w-3 h-3" /> Active
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-500/10 text-slate-400 border border-slate-500/30">
      <Pause className="w-3 h-3" /> Paused
    </span>
  );
}

function EditModal({
  campaign,
  onSave,
  onClose,
  saving,
}: {
  campaign: ColdEmailCampaign;
  onSave: (patch: Partial<ColdEmailCampaign>) => Promise<void>;
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
    const patch: Partial<ColdEmailCampaign> = {};
    for (const f of EDITABLE_FIELDS) {
      const newVal = form[f.key];
      const oldVal = campaign[f.key];
      if (newVal !== oldVal && newVal !== undefined && newVal !== "") {
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

export function ColdEmailTab() {
  const { get, post, patch, loading, error, setError } = useApi();
  const [campaigns, setCampaigns] = useState<ColdEmailCampaign[]>([]);
  const [editing, setEditing] = useState<ColdEmailCampaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  const refresh = async () => {
    try {
      const data = await get<{ campaigns: ColdEmailCampaign[] }>(
        "/marketing/cold-email",
      );
      setCampaigns(data.campaigns);
    } catch {
      setCampaigns([]);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const data = await get<{ campaigns: ColdEmailCampaign[] }>(
          "/marketing/cold-email",
        );
        if (!cancelled) setCampaigns(data.campaigns);
      } catch {
        if (!cancelled) setCampaigns([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [get, setError]);

  const handleTrigger = async (c: ColdEmailCampaign) => {
    if (
      !window.confirm(
        `Trigger ${c.id} now? This will submit up to ${c.per_day} emails to Resend.`,
      )
    ) {
      return;
    }
    setBusyId(c.id);
    setBanner(null);
    try {
      const r = await post<TriggerResult>(
        `/marketing/cold-email/${encodeURIComponent(c.id)}/trigger`,
        {},
      );
      if (r.fired) {
        setBanner({
          kind: "success",
          text: `Fired ${r.queued}/${r.attempted} emails for ${c.id}.`,
        });
      } else {
        setBanner({
          kind: "info",
          text: `Not fired: ${r.reason}`,
        });
      }
      await refresh();
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Trigger failed",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = async (c: ColdEmailCampaign) => {
    const next = c.active === 1 ? 0 : 1;
    const verb = next === 1 ? "resume" : "pause";
    if (
      !window.confirm(
        `${verb[0].toUpperCase() + verb.slice(1)} campaign ${c.id}?`,
      )
    ) {
      return;
    }
    setBusyId(c.id);
    setBanner(null);
    try {
      await patch(`/marketing/cold-email/${encodeURIComponent(c.id)}`, {
        active: next,
      });
      setBanner({ kind: "success", text: `Campaign ${c.id} ${verb}d.` });
      await refresh();
    } catch (err) {
      setBanner({
        kind: "error",
        text: err instanceof Error ? err.message : "Toggle failed",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleSave = async (patchBody: Partial<ColdEmailCampaign>) => {
    if (!editing) return;
    setSaving(true);
    try {
      await patch(
        `/marketing/cold-email/${encodeURIComponent(editing.id)}`,
        patchBody,
      );
      setBanner({ kind: "success", text: `Saved ${editing.id}.` });
      setEditing(null);
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  if (loading && campaigns.length === 0)
    return <LoadingState message="Loading cold-email campaigns..." />;
  if (error) return <ErrorState message={`Error: ${error}`} />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-slate-400 text-sm">
          Cold-intro outbound emails. Each active campaign fires one batch per
          UTC day after{" "}
          <code className="text-slate-300">fire_after_utc_hour</code>.
        </p>
      </div>

      {banner && (
        <div
          className={`flex items-start gap-2 p-3 rounded border text-sm ${
            banner.kind === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
              : banner.kind === "error"
                ? "bg-rose-500/10 border-rose-500/30 text-rose-300"
                : "bg-slate-500/10 border-slate-500/30 text-slate-300"
          }`}
        >
          {banner.kind === "error" ? (
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          )}
          <span className="flex-1">{banner.text}</span>
          <button
            onClick={() => setBanner(null)}
            className="text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {campaigns.length === 0 ? (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-8 text-center text-slate-500">
          No cold-email campaigns yet. Use{" "}
          <code className="text-slate-400">
            scripts/import-cold-email-list.js
          </code>{" "}
          to create one.
        </div>
      ) : (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700/50">
                <th className="text-left px-4 py-3 font-medium">Campaign</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Per day</th>
                <th className="text-right px-4 py-3 font-medium">Fire after</th>
                <th className="text-right px-4 py-3 font-medium">
                  Pending / total queued
                </th>
                <th className="text-left px-4 py-3 font-medium">Last run</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const isBusy = busyId === c.id;
                return (
                  <tr
                    key={c.id}
                    className="border-b border-slate-700/30 last:border-0 hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3">
                      <div className="text-white font-medium">{c.id}</div>
                      <div className="text-slate-400 text-xs truncate max-w-xs">
                        {c.subject}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge active={c.active} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {c.per_day}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {c.fire_after_utc_hour}:00 UTC
                    </td>
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums">
                      {c.pending_count.toLocaleString()} /{" "}
                      <span className="text-slate-400">
                        {c.total_queued.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs">
                      {fmtDate(c.last_run_at)}
                      {c.last_batch_size != null && (
                        <span className="text-slate-500 ml-1">
                          ({c.last_batch_size})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        {(() => {
                          const triggerReason =
                            c.active !== 1
                              ? "Resume the campaign first"
                              : c.pending_count === 0
                                ? "No pending recipients"
                                : "Trigger today’s batch";
                          return (
                            <button
                              onClick={() => handleTrigger(c)}
                              disabled={
                                isBusy ||
                                c.active !== 1 ||
                                c.pending_count === 0
                              }
                              title={triggerReason}
                              aria-label={`${triggerReason} for campaign ${c.id}`}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <Send className="w-3 h-3" /> Trigger
                            </button>
                          );
                        })()}
                        <button
                          onClick={() => handleToggleActive(c)}
                          disabled={isBusy}
                          title={
                            c.active === 1
                              ? "Pause the campaign. A batch already submitted to Resend cannot be recalled — pause stops the next daily fire, not in-flight deliveries."
                              : "Resume the campaign so the next daily fire can run."
                          }
                          aria-label={
                            c.active === 1
                              ? `Pause campaign ${c.id}`
                              : `Resume campaign ${c.id}`
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                        >
                          {c.active === 1 ? (
                            <>
                              <Pause className="w-3 h-3" /> Pause
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3" /> Resume
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setEditing(c)}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:bg-slate-700 disabled:opacity-40"
                        >
                          <Edit3 className="w-3 h-3" /> Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditModal
          campaign={editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          saving={saving}
        />
      )}
    </div>
  );
}
