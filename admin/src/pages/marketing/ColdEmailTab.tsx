import { useCallback, useEffect, useState } from "react";
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
import {
  ColdEmailEditModal,
  type ColdEmailCampaign,
  type ColdEmailPatch,
} from "./ColdEmailEditModal";
import { ColdEmailTriggerModal } from "./ColdEmailTriggerModal";

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

const BANNER_AUTO_DISMISS_MS = 6_000;

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

export function ColdEmailTab() {
  const { get, post, patch, loading, error, setError } = useApi();
  const [campaigns, setCampaigns] = useState<ColdEmailCampaign[]>([]);
  const [editing, setEditing] = useState<ColdEmailCampaign | null>(null);
  const [triggering, setTriggering] = useState<ColdEmailCampaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await get<{ campaigns: ColdEmailCampaign[] }>(
        "/marketing/cold-email",
      );
      setCampaigns(data.campaigns);
    } catch {
      setCampaigns([]);
    }
  }, [get]);

  useEffect(() => {
    setError(null);
    void refresh();
  }, [refresh, setError]);

  // Auto-dismiss banner so it doesn't sit on screen forever if the user
  // ignores it. Errors stay slightly longer.
  useEffect(() => {
    if (!banner) return;
    const ms =
      banner.kind === "error"
        ? BANNER_AUTO_DISMISS_MS * 2
        : BANNER_AUTO_DISMISS_MS;
    const t = setTimeout(() => setBanner(null), ms);
    return () => clearTimeout(t);
  }, [banner]);

  const handleTriggerConfirmed = async () => {
    if (!triggering) return;
    const c = triggering;
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
        setBanner({ kind: "info", text: `Not fired: ${r.reason}` });
      }
      setTriggering(null);
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
        if_match: c.updated_at ?? null,
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

  const handleSave = async (patchBody: ColdEmailPatch) => {
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
          Cold-intro outbound emails. Each active campaign fires batches inside
          its daily window (
          <code className="text-slate-300">fire_after_utc_hour</code> ≤ hour
          &lt; <code className="text-slate-300">fire_until_utc_hour</code>),
          spaced at least{" "}
          <code className="text-slate-300">min_minutes_between_runs</code>{" "}
          apart.
        </p>
      </div>

      {banner && (
        <div
          role="status"
          aria-live="polite"
          className={`flex items-start gap-2 p-3 rounded border text-sm transition-opacity ${
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
            aria-label="Dismiss notification"
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
                <th className="text-right px-4 py-3 font-medium">Per batch</th>
                <th className="text-right px-4 py-3 font-medium">Window</th>
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
                const triggerReason =
                  c.active !== 1
                    ? "Resume the campaign first"
                    : c.pending_count === 0
                      ? "No pending recipients"
                      : "Trigger today’s batch";
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
                    <td className="px-4 py-3 text-right text-slate-200 tabular-nums text-xs">
                      <div>
                        {c.fire_after_utc_hour}–{c.fire_until_utc_hour ?? 24}{" "}
                        UTC
                      </div>
                      <div className="text-slate-400">
                        every {c.min_minutes_between_runs ?? 1440}min
                      </div>
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
                        <button
                          onClick={() => setTriggering(c)}
                          disabled={
                            isBusy || c.active !== 1 || c.pending_count === 0
                          }
                          title={triggerReason}
                          aria-label={`${triggerReason} for campaign ${c.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Send className="w-3 h-3" /> Trigger
                        </button>
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
                          aria-label={`Edit campaign ${c.id}`}
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
        <ColdEmailEditModal
          campaign={editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
          saving={saving}
        />
      )}

      {triggering && (
        <ColdEmailTriggerModal
          campaign={triggering}
          busy={busyId === triggering.id}
          onConfirm={handleTriggerConfirmed}
          onClose={() => setTriggering(null)}
        />
      )}
    </div>
  );
}
