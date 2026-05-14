import { useState } from "react";
import { X, AlertTriangle, Send } from "lucide-react";
import type { ColdEmailCampaign } from "./ColdEmailEditModal";

/**
 * Typed-confirmation modal for manual cold-email trigger. The action
 * schedules up to `per_day` real emails to a cold list with no recall.
 * The operator must type the campaign id verbatim to enable the
 * confirm button — same friction-pattern as destructive admin flows.
 */
export function ColdEmailTriggerModal({
  campaign,
  busy,
  onConfirm,
  onClose,
}: {
  campaign: ColdEmailCampaign;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === campaign.id;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-amber-500/40 rounded-xl max-w-lg w-full overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
          <h2 className="text-white text-lg font-semibold flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            Trigger cold-email batch
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-slate-300">
            This will schedule <strong>up to {campaign.per_day}</strong> real
            emails to recipients on the cold list, paced{" "}
            {Math.round(campaign.schedule_pace_seconds / 60)} min apart starting
            in {campaign.schedule_offset_minutes} min. Resend cannot recall
            scheduled sends once submitted.
          </p>
          <dl className="grid grid-cols-3 gap-2 text-xs bg-slate-800/60 rounded p-3 border border-slate-700/50">
            <dt className="text-slate-500">Campaign</dt>
            <dd className="col-span-2 text-slate-200 font-mono">
              {campaign.id}
            </dd>
            <dt className="text-slate-500">From</dt>
            <dd className="col-span-2 text-slate-200 break-all">
              {campaign.from_address}
            </dd>
            <dt className="text-slate-500">Reply-to</dt>
            <dd className="col-span-2 text-slate-200 break-all">
              {campaign.reply_to}
            </dd>
            <dt className="text-slate-500">Subject</dt>
            <dd className="col-span-2 text-slate-200 break-words">
              {campaign.subject}
            </dd>
            <dt className="text-slate-500">Pending</dt>
            <dd className="col-span-2 text-slate-200 tabular-nums">
              {campaign.pending_count.toLocaleString()} recipient
              {campaign.pending_count === 1 ? "" : "s"}
            </dd>
          </dl>
          <div>
            <label className="block text-slate-300 text-sm font-medium mb-1">
              Type the campaign id to confirm:
            </label>
            <input
              type="text"
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={campaign.id}
              className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-slate-700/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-300 hover:text-white text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!matches || busy}
            className="inline-flex items-center gap-2 px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-rose-500/30 disabled:cursor-not-allowed text-white text-sm font-medium rounded"
          >
            <Send className="w-4 h-4" />
            {busy ? "Firing…" : "Fire batch"}
          </button>
        </div>
      </div>
    </div>
  );
}
