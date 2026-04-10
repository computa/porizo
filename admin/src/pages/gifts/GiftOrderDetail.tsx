import { useState } from 'react';
import { formatDateTime } from '../../utils/date';
import type { GiftOrderDetailResponse } from './types';

interface Props {
  detail: GiftOrderDetailResponse | null;
  isSuperadmin: boolean;
  actionLoading: string | null;
  onRetry: (giftId: string) => void;
  onCancel: (giftId: string) => void;
  onAddNote: (giftId: string, note: string) => void;
}

export function GiftOrderDetail({ detail, isSuperadmin, actionLoading, onRetry, onCancel, onAddNote }: Props) {
  const [note, setNote] = useState('');

  if (!detail) {
    return (
      <div className="card rounded-xl p-6 text-slate-500">
        Select a gift order to inspect channel state, incidents, and recovery actions.
      </div>
    );
  }

  const { gift, outbox, incidents, audit_logs } = detail;
  const noteEntries = audit_logs.filter((entry) => entry.note);

  return (
    <div className="card rounded-xl p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-white">{gift.content_title || `${gift.content_type} gift`}</h2>
          <p className="text-slate-400 text-sm mt-1">{gift.id}</p>
          <p className="text-slate-400 text-sm mt-1">Scheduled {formatDateTime(gift.send_at)} • {gift.status} / {gift.dispatch_status}</p>
        </div>
        {isSuperadmin && (
          <div className="flex gap-2">
            <button
              onClick={() => onRetry(gift.id)}
              disabled={!gift.can_retry || actionLoading === `retry:${gift.id}`}
              className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-300 disabled:opacity-40"
            >
              Retry
            </button>
            <button
              onClick={() => onCancel(gift.id)}
              disabled={!gift.can_cancel || actionLoading === `cancel:${gift.id}`}
              className="px-3 py-2 rounded-lg bg-rose-500/10 text-rose-300 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg bg-slate-900/40 border border-slate-700/60 p-4">
          <div className="text-slate-500">Recipient</div>
          <div className="text-slate-100 mt-1">{gift.recipient_phone || gift.recipient_email || 'No recipient'}</div>
          <div className="text-xs text-slate-500 mt-2">Claim policy: {gift.claim_policy}</div>
        </div>
        <div className="rounded-lg bg-slate-900/40 border border-slate-700/60 p-4">
          <div className="text-slate-500">Share</div>
          <div className="text-slate-100 mt-1">{gift.share_url || gift.share_url_masked || gift.share_token_id || 'No share'}</div>
          <div className="text-xs text-slate-500 mt-2">
            {gift.delivery_lag_ms != null ? `Dispatch lag ${Math.round(gift.delivery_lag_ms / 1000)}s` : 'Dispatch lag pending'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
        <div className="rounded-lg bg-slate-900/40 border border-slate-700/60 p-4">
          <div className="text-slate-500">Dispatch</div>
          <div className="text-slate-100 mt-1">{gift.first_dispatch_started_at ? formatDateTime(gift.first_dispatch_started_at) : 'Not started'}</div>
          <div className="text-xs text-slate-500 mt-2">Completed {gift.last_dispatch_completed_at ? formatDateTime(gift.last_dispatch_completed_at) : 'pending'}</div>
        </div>
        <div className="rounded-lg bg-slate-900/40 border border-slate-700/60 p-4">
          <div className="text-slate-500">Successful delivery</div>
          <div className="text-slate-100 mt-1">{gift.last_successful_delivery_at ? formatDateTime(gift.last_successful_delivery_at) : 'None yet'}</div>
          {gift.overdue_detected_at && <div className="text-xs text-amber-300 mt-2">Overdue since {formatDateTime(gift.overdue_detected_at)}</div>}
        </div>
        <div className="rounded-lg bg-slate-900/40 border border-slate-700/60 p-4">
          <div className="text-slate-500">Recovery posture</div>
          <div className="text-slate-100 mt-1">
            {gift.sent_count > 0 ? 'Partial/manual recovery only' : (gift.can_retry ? 'Retry eligible' : 'No automatic retry')}
          </div>
          <div className="text-xs text-slate-500 mt-2">{gift.can_cancel ? 'Cancellable' : 'Cancellation locked'}</div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-3">Channel Delivery</h3>
        <div className="space-y-3">
          {outbox.map((row) => (
            <div key={row.id} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-slate-100 font-medium">{row.channel} via {row.provider_name || 'unknown'}</div>
                  <div className="text-sm text-slate-400 mt-1">{row.recipient}</div>
                  <div className="text-xs text-slate-500 mt-2">status={row.status} receipt={row.receipt_status || 'none'} attempts={row.attempt_count}</div>
                  {row.provider_message_id && <div className="text-xs text-slate-500 mt-1 font-data">provider id {row.provider_message_id}</div>}
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>send after {formatDateTime(row.send_after)}</div>
                  {row.next_retry_at && <div>retry {formatDateTime(row.next_retry_at)}</div>}
                  {row.provider_accepted_at && <div>accepted {formatDateTime(row.provider_accepted_at)}</div>}
                  {row.receipt_event_at && <div>receipt {formatDateTime(row.receipt_event_at)}</div>}
                </div>
              </div>
              {row.last_error && <p className="text-sm text-amber-300 mt-2">{row.last_error}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-3">Incidents</h3>
        <div className="space-y-3">
          {incidents.length === 0 ? (
            <p className="text-slate-500 text-sm">No incidents for this gift.</p>
          ) : incidents.map((incident) => (
            <div key={incident.id} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
              <div className="text-slate-100 font-medium">{incident.summary}</div>
              <div className="text-xs text-slate-500 mt-1">{incident.incident_type} • {incident.severity} • {incident.status}</div>
              {incident.detail && <p className="text-sm text-slate-300 mt-2">{incident.detail}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-3">Operator Notes</h3>
        {isSuperadmin && (
          <div className="flex gap-2 mb-3">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a manual recovery note"
              className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100"
            />
            <button
              onClick={() => {
                const next = note.trim();
                if (!next) return;
                onAddNote(gift.id, next);
                setNote('');
              }}
              className="px-3 py-2 rounded-lg bg-sky-500/10 text-sky-300"
            >
              Save note
            </button>
          </div>
        )}
        <div className="space-y-2">
          {noteEntries.length === 0 ? (
            <p className="text-slate-500 text-sm">No audit history.</p>
          ) : noteEntries.map((entry) => (
            <div key={entry.id} className="rounded-lg bg-slate-900/40 border border-slate-700/60 p-3">
              <div className="text-sm text-slate-100">{entry.action}</div>
              {entry.note && <div className="text-sm text-slate-300 mt-1">{entry.note}</div>}
              <div className="text-xs text-slate-500 mt-1">{formatDateTime(entry.created_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
