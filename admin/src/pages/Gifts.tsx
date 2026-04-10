import { useCallback, useEffect, useState } from 'react';
import { Gift, RefreshCw } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getAdminUser } from '../utils/auth';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { GiftOverviewCards } from './gifts/GiftOverviewCards';
import { GiftOrdersTable } from './gifts/GiftOrdersTable';
import { GiftOrderDetail } from './gifts/GiftOrderDetail';
import { GiftIncidentsPanel } from './gifts/GiftIncidentsPanel';
import type { GiftIncident, GiftOrderDetailResponse, GiftOrderSummary, GiftOverview } from './gifts/types';

export function Gifts() {
  const { get, post, loading, error } = useApi();
  const [overview, setOverview] = useState<GiftOverview | null>(null);
  const [orders, setOrders] = useState<GiftOrderSummary[]>([]);
  const [incidents, setIncidents] = useState<GiftIncident[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<GiftOrderDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState('');
  const admin = getAdminUser();
  const isSuperadmin = admin?.role === 'superadmin';

  const fetchDashboard = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (overdueOnly) params.set('overdue', 'true');
    if (search.trim()) params.set('search', search.trim());

    const [overviewData, orderData, incidentData] = await Promise.all([
      get<GiftOverview>('/gifts/overview'),
      get<{ orders: GiftOrderSummary[] }>(`/gifts/orders${params.toString() ? `?${params.toString()}` : ''}`),
      get<{ incidents: GiftIncident[] }>('/gifts/incidents'),
    ]);

    setOverview(overviewData);
    setOrders(orderData.orders || []);
    setIncidents(incidentData.incidents || []);
  }, [get, overdueOnly, search, statusFilter]);

  const fetchDetail = useCallback(async (giftId: string) => {
    setDetailLoading(true);
    try {
      const query = isSuperadmin ? '?include_sensitive=true' : '';
      const data = await get<GiftOrderDetailResponse>(`/gifts/orders/${giftId}${query}`);
      setDetail(data);
      setSelectedId(giftId);
    } finally {
      setDetailLoading(false);
    }
  }, [get, isSuperadmin]);

  useEffect(() => {
    fetchDashboard().catch(console.error);
  }, [fetchDashboard]);

  const refreshAll = async () => {
    await fetchDashboard();
    if (selectedId) {
      await fetchDetail(selectedId);
    }
  };

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionLoading(key);
    try {
      await action();
      await refreshAll();
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !overview && orders.length === 0) {
    return <LoadingState message="Loading gift operations..." />;
  }

  if (error && !overview) {
    return <ErrorState message={`Error loading gift operations: ${error}`} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Gift className="w-7 h-7 text-amber-400" />
            Scheduled Gifts
          </h1>
          <p className="text-slate-400 text-sm mt-1">Monitor queue state, receipts, incidents, and manual recovery actions.</p>
        </div>
        <button
          onClick={() => refreshAll().catch(console.error)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <GiftOverviewCards overview={overview} />

      <div className="grid grid-cols-1 xl:grid-cols-[1.25fr_0.75fr] gap-6 items-start">
        <div className="space-y-6">
          <GiftOrdersTable
            orders={orders}
            loading={loading}
            statusFilter={statusFilter}
            overdueOnly={overdueOnly}
            search={search}
            onStatusFilterChange={setStatusFilter}
            onOverdueOnlyChange={setOverdueOnly}
            onSearchChange={setSearch}
            onSelect={(order) => fetchDetail(order.id).catch(console.error)}
            selectedId={selectedId}
          />
          <GiftIncidentsPanel
            incidents={incidents}
            isSuperadmin={isSuperadmin}
            onSelectGift={(giftId) => {
              fetchDetail(giftId).catch(console.error);
            }}
            onAcknowledge={(incident) => {
              runAction(`ack:${incident.id}`, async () => {
                await post(`/gifts/incidents/${incident.id}/acknowledge`, { note: 'Acknowledged from dashboard' });
              }).catch(console.error);
            }}
          />
        </div>
        {detailLoading ? (
          <LoadingState message="Loading gift detail..." />
        ) : (
          <GiftOrderDetail
            detail={detail}
            isSuperadmin={isSuperadmin}
            actionLoading={actionLoading}
            onRetry={(giftId) => {
              runAction(`retry:${giftId}`, async () => {
                await post(`/gifts/orders/${giftId}/retry`, { reason: 'Admin retry from dashboard' });
              }).catch(console.error);
            }}
            onCancel={(giftId) => {
              runAction(`cancel:${giftId}`, async () => {
                await post(`/gifts/orders/${giftId}/cancel`, { reason: 'Admin cancel from dashboard' });
              }).catch(console.error);
            }}
            onAddNote={(giftId, note) => {
              runAction(`note:${giftId}`, async () => {
                await post(`/gifts/orders/${giftId}/manual-recovery-note`, { note });
              }).catch(console.error);
            }}
          />
        )}
      </div>
    </div>
  );
}
