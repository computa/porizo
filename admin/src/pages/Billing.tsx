import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreditCard, TrendingUp, DollarSign, Calendar, Package, Gift } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatCurrency, formatMoney, formatShortDate } from '../utils/date';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { PlansTab } from './billing/PlansTab';
import { GiftBundlesTab } from './billing/GiftBundlesTab';

interface CostMetrics {
  dailyCosts: Array<{
    date: string;
    renders: number;
    total_cost_usd: number | null;
  }>;
  costByType: Array<{
    render_type: string;
    count: number;
    avg_cost_usd: number | null;
    total_cost_usd: number | null;
  }>;
}

interface SubscriptionHealth {
  activeSubscriptions: Array<{ tier: string; count: number }>;
  totalActive: number;
  trialCount: number;
  expiringThisWeek: number;
  recentCancellations: number;
  inGracePeriod: number;
}

interface RevenueBucket {
  currency: string;
  amount: number;
  count: number;
}

interface BillingSale {
  id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  sale_type: 'subscription' | 'gift' | 'purchase';
  product_id: string;
  product_name: string;
  platform: string;
  transaction_id: string;
  purchase_date: string;
  amount: number | null;
  currency: string | null;
  amount_source: string;
  gift_tokens_granted: number | null;
  subscription_status: string | null;
  subscription_tier: string | null;
  subscription_expires_at: string | null;
  is_current_subscriber: boolean;
}

interface CurrentSubscriber {
  id: string;
  user_id: string;
  user_email: string | null;
  user_display_name: string | null;
  product_id: string;
  tier: string;
  status: string;
  platform: string;
  latest_transaction_id: string | null;
  original_purchase_date: string | null;
  expires_at: string | null;
  auto_renew_enabled: boolean;
  updated_at: string;
}

interface BillingSalesResponse {
  summary: {
    totalSalesCount: number;
    subscriptionSalesCount: number;
    giftSalesCount: number;
    giftTokensGranted: number;
    payingUsers: number;
    activeSubscriberCount: number;
    revenueByCurrency: RevenueBucket[];
    subscriptionRevenueByCurrency: RevenueBucket[];
    giftRevenueByCurrency: RevenueBucket[];
    unknownAmountCount: number;
  };
  recentSales: BillingSale[];
  currentSubscribers: CurrentSubscriber[];
}

const renderTypeLabels: Record<string, string> = {
  preview: 'Preview',
  full: 'Full Render',
};

const TABS = [
  { id: 'overview', label: 'Overview', icon: CreditCard },
  { id: 'plans', label: 'Plans', icon: Package },
  { id: 'gift-bundles', label: 'Gift Bundles', icon: Gift },
] as const;
type TabId = typeof TABS[number]['id'];

function formatRevenueBuckets(buckets: RevenueBucket[]): string {
  if (!buckets.length) return '—';
  return buckets.map((bucket) => formatMoney(bucket.amount, bucket.currency)).join(' + ');
}

function formatPersonName(user: { user_display_name: string | null; user_email: string | null; user_id: string }) {
  return user.user_display_name || user.user_email || user.user_id;
}

function userLink(userId: string) {
  return `/users?userId=${encodeURIComponent(userId)}`;
}

export function Billing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabId) || 'overview';
  const setTab = (tab: TabId) => setSearchParams({ tab });

  const { get, loading, error } = useApi();
  const [metrics, setMetrics] = useState<CostMetrics | null>(null);
  const [salesDashboard, setSalesDashboard] = useState<BillingSalesResponse | null>(null);
  const [subscriptionHealth, setSubscriptionHealth] = useState<SubscriptionHealth | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (activeTab !== 'overview') return;
    Promise.all([
      get<CostMetrics>(`/metrics/costs?days=${days}`),
      get<BillingSalesResponse>(`/billing/sales?days=${days}&limit=100`),
      get<SubscriptionHealth>('/billing/subscriptions'),
    ]).then(([costs, salesData, subscriptionData]) => {
      setMetrics(costs);
      setSalesDashboard(salesData);
      setSubscriptionHealth(subscriptionData);
    }).catch(console.error);
  }, [get, days, activeTab]);

  const totalCost = metrics?.dailyCosts.reduce((sum, d) => sum + (d.total_cost_usd || 0), 0) || 0;
  const totalRenders = metrics?.dailyCosts.reduce((sum, d) => sum + d.renders, 0) || 0;
  const avgCostPerRender = totalRenders > 0 ? totalCost / totalRenders : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <CreditCard className="w-7 h-7 text-emerald-400" />
            Billing & Costs
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage subscription plan entitlements, pricing, and gift bundles</p>
        </div>
        {activeTab === 'overview' && (
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value))}
            className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-300"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        )}
      </div>

      {/* Tab Bar */}
      <div className="border-b border-slate-700/50">
        <nav className="flex gap-6" aria-label="Billing tabs">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                activeTab === id
                  ? 'text-rose-400 border-rose-500'
                  : 'text-slate-400 hover:text-slate-200 border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview tab */}
      <div className={activeTab === 'overview' ? '' : 'hidden'}>
        {loading && !metrics && !salesDashboard ? (
          <LoadingState message="Loading billing data..." />
        ) : error && !metrics ? (
          <ErrorState message={`Error loading billing data: ${error}`} />
        ) : (
          <div className="space-y-6">

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Total Cost</p>
              <p className="text-3xl font-bold text-white font-data">{formatCurrency(totalCost)}</p>
              <p className="text-slate-500 text-sm mt-2">Last {days} days</p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/10">
              <DollarSign className="w-6 h-6 text-emerald-400" />
            </div>
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Total Renders</p>
              <p className="text-3xl font-bold text-white font-data">{totalRenders.toLocaleString()}</p>
              <p className="text-slate-500 text-sm mt-2">Last {days} days</p>
            </div>
            <div className="p-3 rounded-lg bg-sky-500/10">
              <TrendingUp className="w-6 h-6 text-sky-400" />
            </div>
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Avg Cost/Render</p>
              <p className="text-3xl font-bold text-white font-data">{formatCurrency(avgCostPerRender)}</p>
              <p className="text-slate-500 text-sm mt-2">Per render</p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10">
              <Calendar className="w-6 h-6 text-amber-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Revenue & Subscription Health */}
      {(salesDashboard || subscriptionHealth) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Apple Sales Summary</h2>
            {salesDashboard ? (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Gross Sales</span>
                  <span className="text-emerald-400 font-data">
                    {formatRevenueBuckets(salesDashboard.summary.revenueByCurrency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Subscriptions</span>
                  <span className="text-slate-200 font-data">
                    {salesDashboard.summary.subscriptionSalesCount.toLocaleString()} · {formatRevenueBuckets(salesDashboard.summary.subscriptionRevenueByCurrency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Gift Buys</span>
                  <span className="text-slate-200 font-data">
                    {salesDashboard.summary.giftSalesCount.toLocaleString()} · {formatRevenueBuckets(salesDashboard.summary.giftRevenueByCurrency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Paying Users</span>
                  <span className="text-slate-200 font-data">{salesDashboard.summary.payingUsers.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Gift Tokens Granted</span>
                  <span className="text-slate-200 font-data">{salesDashboard.summary.giftTokensGranted.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Unknown Amounts</span>
                  <span className="text-slate-200 font-data">{salesDashboard.summary.unknownAmountCount.toLocaleString()} unknown</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-sm">No revenue data available.</p>
            )}
          </div>

          <div className="card rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Subscription Health</h2>
            {subscriptionHealth ? (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Active Subscriptions</span>
                  <span className="text-slate-200 font-data">{subscriptionHealth.totalActive}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Trials</span>
                  <span className="text-slate-200 font-data">{subscriptionHealth.trialCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Expiring This Week</span>
                  <span className="text-slate-200 font-data">{subscriptionHealth.expiringThisWeek}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Recent Cancellations</span>
                  <span className="text-slate-200 font-data">{subscriptionHealth.recentCancellations}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Grace Period</span>
                  <span className="text-slate-200 font-data">{subscriptionHealth.inGracePeriod}</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-sm">No subscription data available.</p>
            )}
          </div>
        </div>
      )}

      {/* Cost by Type */}
      {metrics?.costByType && metrics.costByType.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Cost by Render Type</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {metrics.costByType.map((item) => (
              <div key={item.render_type} className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-white font-medium">
                    {renderTypeLabels[item.render_type] || item.render_type}
                  </span>
                  <span className="text-slate-400 font-data text-sm">{item.count} renders</span>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500">Total</p>
                    <p className="text-white font-data">{formatCurrency(item.total_cost_usd)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Average</p>
                    <p className="text-white font-data">{formatCurrency(item.avg_cost_usd)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Breakdown */}
      {metrics?.dailyCosts && metrics.dailyCosts.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Daily Breakdown</h2>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr className="bg-slate-800/50">
                  <th>Date</th>
                  <th>Renders</th>
                  <th>Cost</th>
                  <th>Cost/Render</th>
                </tr>
              </thead>
              <tbody>
                {metrics.dailyCosts.slice(0, 14).map((day) => {
                  const costPerRender = day.renders > 0 ? (day.total_cost_usd || 0) / day.renders : 0;
                  return (
                    <tr key={day.date}>
                      <td className="text-slate-300">{formatShortDate(day.date)}</td>
                      <td className="font-data text-white">{day.renders}</td>
                      <td className="font-data text-emerald-400">{formatCurrency(day.total_cost_usd)}</td>
                      <td className="font-data text-slate-400">{formatCurrency(costPerRender)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Apple Sales */}
      {salesDashboard && salesDashboard.recentSales.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Apple Sales</h2>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr className="bg-slate-800/50">
                  <th>User</th>
                  <th>Sale</th>
                  <th>Product</th>
                  <th>Amount</th>
                  <th>Current</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {salesDashboard.recentSales.map((sale) => (
                  <tr key={sale.id}>
                    <td className="max-w-[240px] truncate">
                      <Link
                        to={userLink(sale.user_id)}
                        className="text-sky-300 hover:text-sky-200 transition-colors"
                      >
                        {formatPersonName(sale)}
                      </Link>
                    </td>
                    <td className="text-slate-400 capitalize">{sale.sale_type}</td>
                    <td className="text-slate-400 max-w-[260px] truncate">
                      <div>{sale.product_name || sale.product_id}</div>
                      <div className="text-xs text-slate-600 font-data truncate">{sale.transaction_id}</div>
                    </td>
                    <td className="text-emerald-400 font-data">
                      {formatMoney(sale.amount, sale.currency)}
                      {sale.amount_source === 'product_catalog' && (
                        <span className="ml-2 text-xs text-slate-500">catalog</span>
                      )}
                    </td>
                    <td>
                      {sale.is_current_subscriber ? (
                        <span className="text-sky-300 text-sm">Yes</span>
                      ) : (
                        <span className="text-slate-500 text-sm">
                          {sale.sale_type === 'gift' ? `${sale.gift_tokens_granted || 0} gifts` : sale.subscription_status || 'No'}
                        </span>
                      )}
                    </td>
                    <td className="text-slate-400">{formatShortDate(sale.purchase_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Current Subscribers */}
      {salesDashboard && salesDashboard.currentSubscribers.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Current Subscribers</h2>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr className="bg-slate-800/50">
                  <th>User</th>
                  <th>Tier</th>
                  <th>Product</th>
                  <th>Status</th>
                  <th>Auto Renew</th>
                  <th>Renews</th>
                </tr>
              </thead>
              <tbody>
                {salesDashboard.currentSubscribers.map((subscriber) => (
                  <tr key={subscriber.id}>
                    <td className="max-w-[260px] truncate">
                      <Link
                        to={userLink(subscriber.user_id)}
                        className="text-sky-300 hover:text-sky-200 transition-colors"
                      >
                        {formatPersonName(subscriber)}
                      </Link>
                    </td>
                    <td className="text-slate-400 capitalize">{subscriber.tier}</td>
                    <td className="text-slate-400 max-w-[260px] truncate">
                      <div>{subscriber.product_id}</div>
                      {subscriber.latest_transaction_id && (
                        <div className="text-xs text-slate-600 font-data truncate">{subscriber.latest_transaction_id}</div>
                      )}
                    </td>
                    <td className="text-sky-300 capitalize">{subscriber.status.replaceAll('_', ' ')}</td>
                    <td className="text-slate-300">{subscriber.auto_renew_enabled ? 'Yes' : 'No'}</td>
                    <td className="text-slate-400">
                      {subscriber.expires_at ? formatShortDate(subscriber.expires_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {(!metrics?.dailyCosts || metrics.dailyCosts.length === 0) && !salesDashboard?.recentSales.length && (
        <div className="card rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center mx-auto mb-4">
            <DollarSign className="w-8 h-8 text-slate-500" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">No Cost Data</h2>
          <p className="text-slate-400">No render costs recorded in the selected period</p>
            </div>
        )}
      </div>
      )}
      </div>

      {/* Plans tab */}
      <div className={activeTab === 'plans' ? '' : 'hidden'}>
        <PlansTab />
      </div>

      {/* Gift Bundles tab */}
      <div className={activeTab === 'gift-bundles' ? '' : 'hidden'}>
        <GiftBundlesTab />
      </div>
    </div>
  );
}
