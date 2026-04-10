import { AlertTriangle } from 'lucide-react';
import { formatDateTime } from '../../utils/date';
import type { GiftIncident } from './types';

interface Props {
  incidents: GiftIncident[];
  isSuperadmin: boolean;
  onAcknowledge: (incident: GiftIncident) => void;
  onSelectGift?: (giftId: string) => void;
}

export function GiftIncidentsPanel({ incidents, isSuperadmin, onAcknowledge, onSelectGift }: Props) {
  return (
    <div className="card rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        <h2 className="text-lg font-semibold text-white">Open Incidents</h2>
      </div>
      <div className="space-y-3">
        {incidents.length === 0 ? (
          <p className="text-slate-500 text-sm">No open or acknowledged incidents.</p>
        ) : incidents.map((incident) => (
          <div key={incident.id} className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-slate-100 font-medium">{incident.summary}</div>
                <div className="text-xs text-slate-500 mt-1">{incident.incident_type} • {incident.severity} • {incident.status}</div>
                {incident.gift_order_id && <div className="text-xs text-slate-400 mt-1 font-data">{incident.gift_order_id}</div>}
                {incident.detail && <p className="text-sm text-slate-300 mt-2">{incident.detail}</p>}
              </div>
              <div className="flex flex-col gap-2 items-end">
                {incident.gift_order_id && onSelectGift && (
                  <button
                    onClick={() => onSelectGift(incident.gift_order_id!)}
                    className="px-3 py-1.5 rounded-lg bg-slate-700/60 text-slate-200 text-sm hover:bg-slate-700"
                  >
                    Open gift
                  </button>
                )}
                {isSuperadmin && incident.status === 'open' && (
                  <button
                    onClick={() => onAcknowledge(incident)}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-300 text-sm hover:bg-amber-500/20"
                  >
                    Acknowledge
                  </button>
                )}
              </div>
            </div>
            <div className="text-xs text-slate-500 mt-2">{formatDateTime(incident.updated_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
