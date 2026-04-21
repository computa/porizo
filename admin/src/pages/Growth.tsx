import { useEffect, useState } from 'react';
import {
  TrendingUp,
  Share2,
  Eye,
  MousePointer,
  UserPlus,
  Link2,
  Globe,
  Megaphone,
  ArrowRight,
} from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { formatShortDate, formatConversionRate } from '../utils/date';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { FunnelSection } from '../components/FunnelSection';

interface Attribution {
  bySource: Array<{
    utm_source: string | null;
    share_count: number;
    claim_count: number;
  }>;
  byMedium: Array<{
    utm_medium: string | null;
    share_count: number;
    claim_count: number;
  }>;
  byCampaign: Array<{
    utm_campaign: string | null;
    share_count: number;
    claim_count: number;
  }>;
}

interface TeaserMetrics {
  total_views: number;
  total_clicks: number;
  click_rate: string;
  byDay: Array<{
    date: string;
    views: number;
    clicks: number;
  }>;
}

interface ShareMetrics {
  total_created: number;
  total_claimed: number;
  claim_rate: string;
  byDay: Array<{
    date: string;
    created: number;
    claimed: number;
  }>;
}

export function Growth() {
  const { get, loading, error } = useApi();
  const [attribution, setAttribution] = useState<Attribution | null>(null);
  const [teasers, setTeasers] = useState<TeaserMetrics | null>(null);
  const [shares, setShares] = useState<ShareMetrics | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    Promise.all([
      get<Attribution>(`/growth/attribution?days=${days}`).then(setAttribution),
      get<TeaserMetrics>(`/growth/teasers?days=${days}`).then(setTeasers),
      get<ShareMetrics>(`/growth/shares?days=${days}`).then(setShares),
    ]).catch(console.error);
  }, [get, days]);

  const formatPercent = (value: string | number | undefined | null) => {
    if (value === undefined || value === null) return '—';
    const num = typeof value === 'string' ? parseFloat(value) : value;
    if (!Number.isFinite(num)) return '—';
    return `${num.toFixed(1)}%`;
  };

  if (loading && !attribution) {
    return <LoadingState message="Loading growth data..." />;
  }

  if (error) {
    return <ErrorState message={`Error loading growth data: ${error}`} />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <TrendingUp className="w-7 h-7 text-emerald-400" />
            Growth & Attribution
          </h1>
          <p className="text-slate-400 text-sm mt-1">Share performance and marketing attribution</p>
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

      {/* Client-side funnel conversion — acquisition → first finished song. */}
      <FunnelSection days={days} />

      {/* Funnel Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Shares Created</p>
              <p className="text-3xl font-bold text-white font-data">
                {(shares?.total_created || 0).toLocaleString()}
              </p>
              <p className="text-slate-500 text-sm mt-2">Last {days} days</p>
            </div>
            <div className="p-3 rounded-lg bg-sky-500/10">
              <Share2 className="w-6 h-6 text-sky-400" />
            </div>
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Teaser Views</p>
              <p className="text-3xl font-bold text-white font-data">
                {(teasers?.total_views || 0).toLocaleString()}
              </p>
              <p className="text-slate-500 text-sm mt-2">Preview page loads</p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10">
              <Eye className="w-6 h-6 text-amber-400" />
            </div>
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Teaser Clicks</p>
              <p className="text-3xl font-bold text-white font-data">
                {(teasers?.total_clicks || 0).toLocaleString()}
              </p>
              <p className="text-slate-500 text-sm mt-2">
                {teasers ? formatPercent(teasers.click_rate) : '0%'} click rate
              </p>
            </div>
            <div className="p-3 rounded-lg bg-rose-500/10">
              <MousePointer className="w-6 h-6 text-rose-400" />
            </div>
          </div>
        </div>

        <div className="card rounded-xl p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-400 mb-1">Share Claims</p>
              <p className="text-3xl font-bold text-white font-data">
                {(shares?.total_claimed || 0).toLocaleString()}
              </p>
              <p className="text-slate-500 text-sm mt-2">
                {shares ? formatPercent(shares.claim_rate) : '0%'} claim rate
              </p>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/10">
              <UserPlus className="w-6 h-6 text-emerald-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Funnel Visualization */}
      <div className="card rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Share Funnel</h2>
        <div className="flex items-center justify-center gap-4 py-4">
          <div className="text-center">
            <div className="w-24 h-24 rounded-full bg-sky-500/20 flex items-center justify-center mb-2 mx-auto">
              <Share2 className="w-10 h-10 text-sky-400" />
            </div>
            <p className="text-2xl font-bold text-white font-data">
              {(shares?.total_created || 0).toLocaleString()}
            </p>
            <p className="text-sm text-slate-400">Created</p>
          </div>
          <ArrowRight className="w-8 h-8 text-slate-600" />
          <div className="text-center">
            <div className="w-24 h-24 rounded-full bg-amber-500/20 flex items-center justify-center mb-2 mx-auto">
              <Eye className="w-10 h-10 text-amber-400" />
            </div>
            <p className="text-2xl font-bold text-white font-data">
              {(teasers?.total_views || 0).toLocaleString()}
            </p>
            <p className="text-sm text-slate-400">Viewed</p>
          </div>
          <ArrowRight className="w-8 h-8 text-slate-600" />
          <div className="text-center">
            <div className="w-24 h-24 rounded-full bg-rose-500/20 flex items-center justify-center mb-2 mx-auto">
              <MousePointer className="w-10 h-10 text-rose-400" />
            </div>
            <p className="text-2xl font-bold text-white font-data">
              {(teasers?.total_clicks || 0).toLocaleString()}
            </p>
            <p className="text-sm text-slate-400">Clicked</p>
          </div>
          <ArrowRight className="w-8 h-8 text-slate-600" />
          <div className="text-center">
            <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mb-2 mx-auto">
              <UserPlus className="w-10 h-10 text-emerald-400" />
            </div>
            <p className="text-2xl font-bold text-white font-data">
              {(shares?.total_claimed || 0).toLocaleString()}
            </p>
            <p className="text-sm text-slate-400">Claimed</p>
          </div>
        </div>
      </div>

      {/* Attribution Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* By Source */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-sky-400" />
            By Source
          </h2>
          {attribution?.bySource && attribution.bySource.length > 0 ? (
            <div className="space-y-3">
              {attribution.bySource.map((item, idx) => {
                const conversionRate = formatConversionRate(item.claim_count, item.share_count);
                return (
                  <div key={idx} className="bg-slate-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-medium">
                        {item.utm_source || 'Direct'}
                      </span>
                      <span className="text-emerald-400 font-data text-sm">
                        {conversionRate}%
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-slate-400">
                        <span className="font-data text-slate-300">{item.share_count}</span> shares
                      </span>
                      <span className="text-slate-400">
                        <span className="font-data text-slate-300">{item.claim_count}</span> claims
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No attribution data</p>
          )}
        </div>

        {/* By Medium */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Link2 className="w-5 h-5 text-amber-400" />
            By Medium
          </h2>
          {attribution?.byMedium && attribution.byMedium.length > 0 ? (
            <div className="space-y-3">
              {attribution.byMedium.map((item, idx) => {
                const conversionRate = formatConversionRate(item.claim_count, item.share_count);
                return (
                  <div key={idx} className="bg-slate-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-medium">
                        {item.utm_medium || 'None'}
                      </span>
                      <span className="text-emerald-400 font-data text-sm">
                        {conversionRate}%
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-slate-400">
                        <span className="font-data text-slate-300">{item.share_count}</span> shares
                      </span>
                      <span className="text-slate-400">
                        <span className="font-data text-slate-300">{item.claim_count}</span> claims
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No attribution data</p>
          )}
        </div>

        {/* By Campaign */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-rose-400" />
            By Campaign
          </h2>
          {attribution?.byCampaign && attribution.byCampaign.length > 0 ? (
            <div className="space-y-3">
              {attribution.byCampaign.map((item, idx) => {
                const conversionRate = formatConversionRate(item.claim_count, item.share_count);
                return (
                  <div key={idx} className="bg-slate-800/50 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-medium truncate max-w-[120px]" title={item.utm_campaign || 'None'}>
                        {item.utm_campaign || 'None'}
                      </span>
                      <span className="text-emerald-400 font-data text-sm">
                        {conversionRate}%
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-slate-400">
                        <span className="font-data text-slate-300">{item.share_count}</span> shares
                      </span>
                      <span className="text-slate-400">
                        <span className="font-data text-slate-300">{item.claim_count}</span> claims
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 text-sm">No attribution data</p>
          )}
        </div>
      </div>

      {/* Daily Breakdown */}
      {shares?.byDay && shares.byDay.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Daily Activity</h2>
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr className="bg-slate-800/50">
                  <th>Date</th>
                  <th>Shares Created</th>
                  <th>Teaser Views</th>
                  <th>Teaser Clicks</th>
                  <th>Claims</th>
                </tr>
              </thead>
              <tbody>
                {shares.byDay.slice(0, 14).map((day) => {
                  const teaserDay = teasers?.byDay?.find(t => t.date === day.date);
                  return (
                    <tr key={day.date}>
                      <td className="text-slate-300">{formatShortDate(day.date)}</td>
                      <td className="font-data text-sky-400">{day.created}</td>
                      <td className="font-data text-amber-400">{teaserDay?.views || 0}</td>
                      <td className="font-data text-rose-400">{teaserDay?.clicks || 0}</td>
                      <td className="font-data text-emerald-400">{day.claimed}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {(!shares?.byDay || shares.byDay.length === 0) && (
        <div className="card rounded-xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center mx-auto mb-4">
            <TrendingUp className="w-8 h-8 text-slate-500" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">No Growth Data</h2>
          <p className="text-slate-400">No share or teaser activity recorded in the selected period</p>
        </div>
      )}
    </div>
  );
}
