import { useEffect, useState, useCallback } from 'react';
import { Briefcase, RefreshCw, AlertCircle, CheckCircle, Clock, PlayCircle, Filter, RotateCcw } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { getTimeSince, formatDateTime } from '../utils/date';

interface Job {
  id: string;
  track_version_id: string;
  track_id: string;
  workflow_type: string;
  status: string;
  step: string | null;
  progress_pct: number;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface JobsResponse {
  jobs: Job[];
}

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
  completed: { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  running: { icon: PlayCircle, color: 'text-sky-400', bg: 'bg-sky-500/10' },
  queued: { icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
  failed: { icon: AlertCircle, color: 'text-rose-400', bg: 'bg-rose-500/10' },
};

const workflowLabels: Record<string, string> = {
  enrollment_qc: 'Enrollment QC',
  voice_embedding: 'Voice Embedding',
  preview_render: 'Preview Render',
  full_render: 'Full Render',
};

export function Jobs() {
  const { get, post, loading, error } = useApi();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [workflowFilter, setWorkflowFilter] = useState<string>('');
  const [retrying, setRetrying] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.append('status', statusFilter);
    if (workflowFilter) params.append('workflowType', workflowFilter);
    params.append('limit', '50');

    const queryString = params.toString();
    const data = await get<JobsResponse>(`/jobs${queryString ? `?${queryString}` : ''}`);
    setJobs(data.jobs);
  }, [get, statusFilter, workflowFilter]);

  useEffect(() => {
    fetchJobs().catch(console.error);
  }, [fetchJobs]);

  const handleRetry = async (jobId: string) => {
    setRetrying(jobId);
    try {
      await post(`/jobs/${jobId}/retry`, {});
      await fetchJobs();
    } catch (err) {
      console.error('Failed to retry job:', err);
    } finally {
      setRetrying(null);
    }
  };

  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-400">
          <span className="w-5 h-5 border-2 border-slate-600 border-t-rose-500 rounded-full animate-spin" />
          Loading jobs...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-rose-400 bg-rose-500/10 px-4 py-3 rounded-lg">
          <AlertCircle className="w-5 h-5" />
          Error loading jobs: {error}
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
            <Briefcase className="w-7 h-7 text-sky-400" />
            Jobs
          </h1>
          <p className="text-slate-400 text-sm mt-1">Workflow processing queue</p>
        </div>
        <button
          onClick={() => fetchJobs()}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="card rounded-xl p-4">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-slate-400" aria-hidden="true" />
          <div className="flex gap-3 flex-1">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by job status"
              className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
            >
              <option value="">All Statuses</option>
              <option value="queued">Queued</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <select
              value={workflowFilter}
              onChange={(e) => setWorkflowFilter(e.target.value)}
              aria-label="Filter by workflow type"
              className="bg-slate-800/50 border border-slate-600/50 rounded-lg px-3 py-2 text-sm text-slate-300 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
            >
              <option value="">All Workflows</option>
              <option value="enrollment_qc">Enrollment QC</option>
              <option value="voice_embedding">Voice Embedding</option>
              <option value="preview_render">Preview Render</option>
              <option value="full_render">Full Render</option>
            </select>
          </div>
          <span className="text-sm text-slate-500 font-data">{jobs.length} jobs</span>
        </div>
      </div>

      {/* Jobs Table */}
      <div className="card rounded-xl overflow-hidden">
        <table>
          <thead>
            <tr className="bg-slate-800/50">
              <th scope="col">Status</th>
              <th scope="col">Job ID</th>
              <th scope="col">Workflow</th>
              <th scope="col">Step</th>
              <th scope="col">Progress</th>
              <th scope="col">Created</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-8 text-slate-500">
                  No jobs found matching filters
                </td>
              </tr>
            ) : (
              jobs.map((job) => {
                const config = statusConfig[job.status] || statusConfig.queued;
                const StatusIcon = config.icon;

                return (
                  <tr key={job.id} className="group">
                    <td>
                      <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full ${config.bg}`}>
                        <StatusIcon className={`w-4 h-4 ${config.color}`} />
                        <span className={`text-xs font-medium capitalize ${config.color}`}>
                          {job.status}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="font-data text-xs text-slate-400">
                        {job.id.slice(0, 12)}...
                      </span>
                    </td>
                    <td>
                      <span className="text-slate-300">
                        {workflowLabels[job.workflow_type] || job.workflow_type}
                      </span>
                    </td>
                    <td>
                      <span className="text-slate-400 text-sm">
                        {job.step || '-'}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div
                          role="progressbar"
                          aria-valuenow={job.progress_pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Job progress: ${job.progress_pct}%`}
                          className="w-16 h-1.5 bg-slate-700 rounded-full overflow-hidden"
                        >
                          <div
                            className="h-full bg-sky-500 transition-all"
                            style={{ width: `${job.progress_pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-data text-slate-500" aria-hidden="true">
                          {job.progress_pct}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="text-slate-400 text-sm" title={formatDateTime(job.created_at)}>
                        {getTimeSince(job.created_at)}
                      </span>
                    </td>
                    <td>
                      {job.status === 'failed' && (
                        <button
                          onClick={() => handleRetry(job.id)}
                          disabled={retrying === job.id}
                          aria-label={`Retry job ${job.id.slice(0, 12)}`}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${retrying === job.id ? 'animate-spin' : ''}`} aria-hidden="true" />
                          Retry
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Failed Jobs Detail */}
      {jobs.some(j => j.status === 'failed') && (
        <div className="card rounded-xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-400" aria-hidden="true" />
            Failed Job Details
          </h2>
          <div className="space-y-3">
            {jobs.filter(j => j.status === 'failed').map((job) => (
              <div key={job.id} className="bg-slate-800/50 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-data text-rose-400 text-sm">{job.error_code || 'UNKNOWN_ERROR'}</span>
                    <p className="text-slate-400 text-sm mt-1">{job.error_message || 'No error message available'}</p>
                    <p className="text-slate-500 text-xs mt-2">
                      Attempt {job.attempts}/{job.max_attempts} • {formatDateTime(job.updated_at)}
                    </p>
                  </div>
                  <button
                    onClick={() => handleRetry(job.id)}
                    disabled={retrying === job.id}
                    aria-label={`Retry failed job ${job.error_code || job.id.slice(0, 12)}`}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    <RotateCcw className={`w-3.5 h-3.5 ${retrying === job.id ? 'animate-spin' : ''}`} aria-hidden="true" />
                    Retry
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
