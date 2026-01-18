import { useEffect, useState } from 'react';
import { Users, Music, Briefcase, AlertCircle, Clock } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { KPICard } from '../components/KPICard';

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

export function Overview() {
  const { get, loading, error } = useApi();
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [jobMetrics, setJobMetrics] = useState<JobMetrics | null>(null);

  useEffect(() => {
    Promise.all([
      get<OverviewMetrics>('/metrics/overview'),
      get<JobMetrics>('/metrics/jobs'),
    ]).then(([overview, jobs]) => {
      setMetrics(overview);
      setJobMetrics(jobs);
    }).catch(console.error);
  }, [get]);

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading dashboard...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          Error loading dashboard: {error}
        </div>
      </div>
    );
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
