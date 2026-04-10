import { Search } from 'lucide-react';
import { formatDateTime, getTimeSince } from '../../utils/date';
import type { GiftOrderSummary } from './types';

interface Props {
  orders: GiftOrderSummary[];
  loading: boolean;
  statusFilter: string;
  overdueOnly: boolean;
  search: string;
  onStatusFilterChange: (value: string) => void;
  onOverdueOnlyChange: (value: boolean) => void;
  onSearchChange: (value: string) => void;
  onSelect: (order: GiftOrderSummary) => void;
  selectedId: string | null;
}

export function GiftOrdersTable({
  orders,
  loading,
  statusFilter,
  overdueOnly,
  search,
  onStatusFilterChange,
  onOverdueOnlyChange,
  onSearchChange,
  onSelect,
  selectedId,
}: Props) {
  return (
    <div className="card rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-700/50 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search gift id, sender, recipient"
            className="w-full pl-9 pr-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(event) => onStatusFilterChange(event.target.value)}
          className="bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 text-slate-100"
        >
          <option value="">All statuses</option>
          <option value="scheduled">Scheduled</option>
          <option value="dispatch_retry">Retrying</option>
          <option value="dispatching">Dispatching</option>
          <option value="dispatched">Dispatched</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => onOverdueOnlyChange(event.target.checked)}
          />
          Overdue only
        </label>
      </div>
      <table>
        <thead>
          <tr className="bg-slate-800/50">
            <th scope="col">Gift</th>
            <th scope="col">Recipient</th>
            <th scope="col">Schedule</th>
            <th scope="col">State</th>
            <th scope="col">Channels</th>
            <th scope="col">Issues</th>
          </tr>
        </thead>
        <tbody>
          {orders.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center py-10 text-slate-500">
                {loading ? 'Loading gifts…' : 'No gift orders match the current filters'}
              </td>
            </tr>
          ) : (
            orders.map((order) => (
              <tr
                key={order.id}
                onClick={() => onSelect(order)}
                className={`cursor-pointer ${selectedId === order.id ? 'bg-rose-500/5' : ''}`}
              >
                <td>
                  <div>
                    <div className="text-slate-100 font-medium">{order.content_title || `${order.content_type} gift`}</div>
                    <div className="text-xs text-slate-500 font-data">{order.id}</div>
                    <div className="text-xs text-slate-400 mt-1">{order.sender_display_name || order.sender_email || order.sender_user_id}</div>
                  </div>
                </td>
                <td>
                  <div className="text-slate-200 text-sm">{order.recipient_phone || order.recipient_email || 'No recipient'}</div>
                </td>
                <td>
                  <div className="text-slate-200 text-sm" title={formatDateTime(order.send_at)}>{formatDateTime(order.send_at)}</div>
                  <div className="text-xs text-slate-500">{getTimeSince(order.send_at)}</div>
                </td>
                <td>
                  <div className="text-slate-100 capitalize">{order.status}</div>
                  <div className="text-xs text-slate-500">{order.dispatch_status}</div>
                </td>
                <td>
                  <div className="text-slate-300 text-sm">{order.channels.join(', ')}</div>
                  <div className="text-xs text-slate-500">{order.sent_count}/{order.outbox_count} sent</div>
                </td>
                <td>
                  <div className="text-slate-300 text-sm">{order.open_incident_count} open</div>
                  {order.overdue_detected_at && <div className="text-xs text-rose-400">Overdue</div>}
                  {order.last_dispatch_error && <div className="text-xs text-amber-400 truncate max-w-52">{order.last_dispatch_error}</div>}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
