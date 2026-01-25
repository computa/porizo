import { useEffect, useState } from 'react';
import { Users, Music, Briefcase, AlertCircle, Clock, TrendingUp, Share2, CreditCard, Mic, Zap, Shield } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { KPICard } from '../components/KPICard';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';

interface OverviewMetrics {
  totalUsers: number;
  newUsersToday: number;
  newUsersWeek: number;
  tierDist: Array<{ tier: string; count: number }>;
  jobStats: Array<{ status: string; count: number }>;
  rendersToday: number;
}

interface JobMetrics {
  jobsByStatus: Array<{ status: string; count: number }>;
  jobsByWorkflow: Array<{ workflow_type: string; status: string; count: number }>;
  staleJobs: number;
  recentFailures: Array<{ error_code: string; count: number }>;
  dlqCount: number;
}

interface KPITrends {
  thisWeek: {
    total_dau: number;
    total_new_users: number;
    total_renders: number;
    total_shares: number;
    total_revenue: number;
  };
  lastWeek: {
    total_dau: number;
    total_new_users: number;
    total_renders: number;
    total_shares: number;
    total_revenue: number;
  };
  changes: {
    dau: string;
    newUsers: string;
    renders: string;
    shares: string;
    revenue: string;
  };
}

interface EnrollmentSummary {
  completionRate: number;
  averageQualityScore: number;
}

interface PipelineSummary {
  successRate: { preview: number; full: number };
}

interface RiskSummary {
  distribution: Array<{ level: string; count: number }>;
  lockedAccounts: number;
}

const tierLabels: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  unlimited: 'Unlimited',
};

const statusColors: Record<string, string> = {
  completed: 'bg-emerald-500',
  running: 'bg-sky-500',
  queued: 'bg-amber-500',
  failed: 'bg-rose-500',
};

/**
 * Determine trend direction from a percentage change string
 */
function getTrendDirection(changeStr: string): 'up' | 'down' | 'neutral' {
  const value = parseFloat(changeStr);
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'neutral';
}

/**
 * Format a change percentage with sign prefix
 */
function formatChange(changeStr: string): string {
  const value = parseFloat(changeStr);
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${changeStr}% vs last week`;
}

export function Overview() {
  const { get, loading, error } = useApi();
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [jobMetrics, setJobMetrics] = useState<JobMetrics | null>(null);
  const [kpiTrends, setKpiTrends] = useState<KPITrends | null>(null);
  const [enrollmentSummary, setEnrollmentSummary] = useState<EnrollmentSummary | null>(null);
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary | null>(null);
  const [riskSummary, setRiskSummary] = useState<RiskSummary | null>(null);

  useEffect(() => {
    Promise.all([
      get<OverviewMetrics>('/metrics/overview'),
      get<JobMetrics>('/metrics/jobs'),
      get<KPITrends>('/kpis/trends').catch(() => null),
      get<EnrollmentSummary>('/metrics/enrollment').catch(() => null),
      get<PipelineSummary>('/metrics/render-pipeline').catch(() => null),
      get<RiskSummary>('/security/risk-metrics').catch(() => null),
    ]).then(([overview, jobs, trends, enrollment, pipeline, risk]) => {
      setMetrics(overview);
      setJobMetrics(jobs);
      if (trends) setKpiTrends(trends);
      if (enrollment) setEnrollmentSummary(enrollment);
      if (pipeline) setPipelineSummary(pipeline);
      if (risk) setRiskSummary(risk);
    }).catch(console.error);
  }, [get]);

  if (loading && !metrics) {
    return <LoadingState message="Loading dashboard..." />;
  }

  if (error) {
    return <ErrorState message={`Error loading dashboard: ${error}`} />;
  }

  if (!metrics) return null;

  const failedJobs = metrics.jobStats.find(j => j.status === 'failed')?.count || 0;
  const queuedJobs = metrics.jobStats.find(j => j.status === 'queued')?.count || 0;
  const runningJobs = metrics.jobStats.find(j => j.status === 'running')?.count || 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white mb-1">Dashboard Overview</h1>
        <p className="text-slate-400 text-sm font-data">
          Last updated: {new Date().toLocaleTimeString()}
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        <KPICard
          title="Total Users"
          value={metrics.totalUsers.toLocaleString()}
          subtitle={`+${metrics.newUsersToday} today`}
          icon={Users}
          trend="up"
          accentColor="rose"
        />
        <KPICard
          title="Renders Today"
          value={metrics.rendersToday.toLocaleString()}
          icon={Music}
          accentColor="emerald"
        />
        <KPICard
          title="Active Jobs"
          value={runningJobs + queuedJobs}
          subtitle={`${queuedJobs} queued, ${runningJobs} running`}
          icon={Clock}
          accentColor="sky"
        />
        <KPICard
          title="Failed Jobs"
          value={failedJobs}
          subtitle={failedJobs > 0 ? 'Needs attention' : 'All clear'}
          icon={AlertCircle}
          trend={failedJobs > 0 ? 'down' : 'neutral'}
          accentColor={failedJobs > 0 ? 'amber' : 'emerald'}
        />
      </div>

      {/* Weekly Trends */}
      {kpiTrends && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            Week-over-Week Trends
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <KPICard
              title="Weekly Active Users"
              value={(kpiTrends.thisWeek.total_dau || 0).toLocaleString()}
              subtitle={formatChange(kpiTrends.changes.dau)}
              icon={Users}
              trend={getTrendDirection(kpiTrends.changes.dau)}
              accentColor="sky"
            />
            <KPICard
              title="Renders Completed"
              value={(kpiTrends.thisWeek.total_renders || 0).toLocaleString()}
              subtitle={formatChange(kpiTrends.changes.renders)}
              icon={Music}
              trend={getTrendDirection(kpiTrends.changes.renders)}
              accentColor="emerald"
            />
            <KPICard
              title="Shares Created"
              value={(kpiTrends.thisWeek.total_shares || 0).toLocaleString()}
              subtitle={formatChange(kpiTrends.changes.shares)}
              icon={Share2}
              trend={getTrendDirection(kpiTrends.changes.shares)}
              accentColor="amber"
            />
            <KPICard
              title="Revenue"
              value={`$${((kpiTrends.thisWeek.total_revenue || 0) / 100).toFixed(2)}`}
              subtitle={formatChange(kpiTrends.changes.revenue)}
              icon={CreditCard}
              trend={getTrendDirection(kpiTrends.changes.revenue)}
              accentColor="rose"
            />
          </div>
        </div>
      )}

      {/* Operational Health */}
      {(enrollmentSummary || pipelineSummary || riskSummary) && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-sky-400" />
            Operational Health
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {enrollmentSummary && (
              <KPICard
                title="Enrollment Rate"
                value={`${enrollmentSummary.completionRate.toFixed(1)}%`}
                subtitle={`Avg quality: ${enrollmentSummary.averageQualityScore.toFixed(0)}`}
                icon={Mic}
                trend={enrollmentSummary.completionRate >= 70 ? 'up' : 'down'}
                accentColor="sky"
              />
            )}
            {pipelineSummary && (
              <KPICard
                title="Render Success"
                value={`${pipelineSummary.successRate.preview.toFixed(1)}%`}
                subtitle={`Full: ${pipelineSummary.successRate.full.toFixed(1)}%`}
                icon={Zap}
                trend={pipelineSummary.successRate.preview >= 95 ? 'up' : 'down'}
                accentColor="emerald"
              />
            )}
            {riskSummary && (
              <KPICard
                title="Security Alerts"
                value={riskSummary.distribution.find(d => d.level === 'high')?.count || 0}
                subtitle={`${riskSummary.lockedAccounts} locked accounts`}
                icon={Shield}
                trend={riskSummary.lockedAccounts > 0 ? 'down' : 'neutral'}
                accentColor={riskSummary.lockedAccounts > 0 ? 'amber' : 'emerald'}
              />
            )}
          </div>
        </div>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Users by Tier */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-rose-400" />
            Users by Tier
          </h2>
          <div className="space-y-3">
            {metrics.tierDist.map(({ tier, count }) => {
              const total = metrics.tierDist.reduce((sum, t) => sum + t.count, 0);
              const percentage = total > 0 ? (count / total) * 100 : 0;

              return (
                <div key={tier} className="group">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-300 capitalize">{tierLabels[tier] || tier}</span>
                    <span className="font-data text-white">{count.toLocaleString()}</span>
                  </div>
                  <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-rose-500 to-rose-400 transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Job Status */}
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-sky-400" />
            Job Status
          </h2>
          <div className="space-y-3">
            {metrics.jobStats.map(({ status, count }) => (
              <div key={status} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full ${statusColors[status] || 'bg-slate-500'}`} />
                  <span className="text-slate-300 capitalize">{status}</span>
                </div>
                <span className={`font-data font-medium ${status === 'failed' ? 'text-rose-400' : 'text-white'}`}>
                  {count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>

          {/* Stale jobs warning */}
          {jobMetrics && jobMetrics.staleJobs > 0 && (
            <div className="mt-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <div className="flex items-center gap-2 text-amber-400 text-sm">
                <AlertCircle className="w-4 h-4" />
                {jobMetrics.staleJobs} stale job{jobMetrics.staleJobs > 1 ? 's' : ''} (running &gt; 30 min)
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Failures */}
      {jobMetrics && jobMetrics.recentFailures.length > 0 && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-400" />
            Recent Failures (7 days)
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {jobMetrics.recentFailures.map(({ error_code, count }) => (
              <div key={error_code} className="bg-slate-800/50 rounded-lg p-4">
                <div className="text-rose-400 font-data text-sm mb-1">
                  {error_code || 'Unknown'}
                </div>
                <div className="text-2xl font-bold text-white">{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
