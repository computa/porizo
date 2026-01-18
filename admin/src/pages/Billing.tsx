import { useEffect, useState } from 'react';
import { CreditCard, TrendingUp, DollarSign, Calendar, AlertCircle } from 'lucide-react';
import { useApi } from '../hooks/useApi';

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

const renderTypeLabels: Record<string, string> = {
  preview: 'Preview',
  full: 'Full Render',
};

export function Billing() {
  const { get, loading, error } = useApi();
  const [metrics, setMetrics] = useState<CostMetrics | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    get<CostMetrics>(`/metrics/costs?days=${days}`).then(setMetrics).catch(console.error);
  }, [get, days]);

  const formatCurrency = (value: number | null) => {
    if (value === null || value === undefined) return '$0.00';
    return `$${value.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const totalCost = metrics?.dailyCosts.reduce((sum, d) => sum + (d.total_cost_usd || 0), 0) || 0;
  const totalRenders = metrics?.dailyCosts.reduce((sum, d) => sum + d.renders, 0) || 0;
  const avgCostPerRender = totalRenders > 0 ? totalCost / totalRenders : 0;

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading billing data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          Error loading billing data: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <CreditCard className="w-7 h-7 text-emerald-400" />
            Billing & Costs
          </h1>
          <p className="text-slate-400 text-sm mt-1">API usage and cost analytics</p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-300"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

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
                      <td className="text-slate-300">{formatDate(day.date)}</td>
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
  );
}
