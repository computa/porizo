import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CreditCard, TrendingUp, DollarSign, Calendar, Package, Gift } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatCurrency, formatShortDate } from '../utils/date';
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

interface RevenueMetrics {
  totalRevenue: number;
  subscriptionRevenue: number;
  songPurchases: number;
  payingUsers: number;
  subscriptionsByTier: Array<{ tier: string; count: number; active_count: number }>;
  trialCount: number;
  trialConversions: number;
  cancellations: number;
  churnRate: string;
}

interface SubscriptionHealth {
  activeSubscriptions: Array<{ tier: string; count: number }>;
  totalActive: number;
  trialCount: number;
  expiringThisWeek: number;
  recentCancellations: number;
  inGracePeriod: number;
}

interface BillingTransaction {
  id: string;
  user_id: string;
  user_email: string | null;
  type: string;
  amount: number;
  created_at: string;
}

interface TransactionsResponse {
  transactions: BillingTransaction[];
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

export function Billing() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as TabId) || 'overview';
  const setTab = (tab: TabId) => setSearchParams({ tab });

  const { get, loading, error } = useApi();
  const [metrics, setMetrics] = useState<CostMetrics | null>(null);
  const [revenue, setRevenue] = useState<RevenueMetrics | null>(null);
  const [subscriptionHealth, setSubscriptionHealth] = useState<SubscriptionHealth | null>(null);
  const [transactions, setTransactions] = useState<BillingTransaction[]>([]);
  const [days, setDays] = useState(30);

  useEffect(() => {
    if (activeTab !== 'overview') return;
    Promise.all([
      get<CostMetrics>(`/metrics/costs?days=${days}`),
      get<RevenueMetrics>(`/billing/revenue?days=${days}`),
      get<SubscriptionHealth>('/billing/subscriptions'),
      get<TransactionsResponse>('/billing/transactions?limit=25'),
    ]).then(([costs, revenueData, subscriptionData, transactionData]) => {
      setMetrics(costs);
      setRevenue(revenueData);
      setSubscriptionHealth(subscriptionData);
      setTransactions(transactionData.transactions || []);
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
        {loading && !metrics && !revenue ? (
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
      {(revenue || subscriptionHealth) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card rounded-xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Revenue Summary</h2>
            {revenue ? (
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">Total Revenue</span>
                  <span className="text-emerald-400 font-data">{formatCurrency(revenue.totalRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Subscriptions</span>
                  <span className="text-slate-200 font-data">{formatCurrency(revenue.subscriptionRevenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Song Purchases</span>
                  <span className="text-slate-200 font-data">{formatCurrency(revenue.songPurchases)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Paying Users</span>
                  <span className="text-slate-200 font-data">{revenue.payingUsers.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Trials → Paid</span>
                  <span className="text-slate-200 font-data">
                    {revenue.trialConversions}/{revenue.trialCount}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Churn Rate</span>
                  <span className="text-slate-200 font-data">{revenue.churnRate}%</span>
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

      {/* Recent Transactions */}
      {transactions.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Transactions</h2>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr className="bg-slate-800/50">
                  <th>ID</th>
                  <th>User</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.slice(0, 25).map((tx) => (
                  <tr key={tx.id}>
                    <td className="text-slate-400 font-data text-xs">{tx.id.slice(0, 10)}...</td>
                    <td className="text-slate-300">{tx.user_email || tx.user_id}</td>
                    <td className="text-slate-400 capitalize">{tx.type}</td>
                    <td className="text-emerald-400 font-data">{formatCurrency(tx.amount)}</td>
                    <td className="text-slate-400">{formatShortDate(tx.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {(!metrics?.dailyCosts || metrics.dailyCosts.length === 0) && (
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
