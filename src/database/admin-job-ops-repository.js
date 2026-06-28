"use strict";

function rowCountFrom(result) {
  return Number(result?.changes ?? result?.rowCount ?? 0);
}

function mapDlqRow(row) {
  return {
    id: row.id,
    job_id: row.job_id,
    workflow_type: row.workflow_type,
    step: row.step,
    error_code: row.error_code || null,
    error_message: row.error_message || row.failure_reason || null,
    payload_json:
      row.step_data == null
        ? null
        : typeof row.step_data === "string"
          ? row.step_data
          : JSON.stringify(row.step_data),
    created_at: row.moved_at,
    reprocessed_at: row.reprocessed_at,
  };
}

function createAdminJobOpsRepository(db) {
  async function getJobMetrics({ staleBefore, failuresAfter }) {
    const jobsByStatus = db
      .prepare(
        "SELECT status, COUNT(*) as count FROM jobs GROUP BY status ORDER BY status ASC",
      )
      .all();

    const jobsByWorkflow = db
      .prepare(
        "SELECT workflow_type, status, COUNT(*) as count FROM jobs GROUP BY workflow_type, status ORDER BY workflow_type ASC, status ASC",
      )
      .all();

    const staleJobs =
      (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM jobs WHERE status = 'running' AND updated_at < ?",
          )
          .get(staleBefore)
      )?.count ?? 0;

    const recentFailures = db
      .prepare(
        "SELECT error_code, COUNT(*) as count FROM jobs WHERE status = 'failed' AND created_at > ? GROUP BY error_code ORDER BY count DESC LIMIT 10",
      )
      .all(failuresAfter);

    const dlqCount =
      (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM dead_letter_queue WHERE reprocessed_at IS NULL",
          )
          .get()
      )?.count ?? 0;

    return { jobsByStatus, jobsByWorkflow, staleJobs, recentFailures, dlqCount };
  }

  async function listJobs({ status, workflowType, limit, offset }) {
    let sql =
      "SELECT j.*, tv.track_id FROM jobs j LEFT JOIN track_versions tv ON j.track_version_id = tv.id WHERE 1=1";
    const params = [];

    if (status) {
      sql += " AND j.status = ?";
      params.push(status);
    }
    if (workflowType) {
      sql += " AND j.workflow_type = ?";
      params.push(workflowType);
    }

    sql += " ORDER BY j.created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    return db.prepare(sql).all(...params);
  }

  async function findJobById(jobId) {
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
  }

  async function retryFailedJob({ jobId, now }) {
    return db
      .prepare(
        "UPDATE jobs SET status = 'queued', attempts = 0, error_code = NULL, error_message = NULL, updated_at = ? WHERE id = ? AND status = 'failed'",
      )
      .run(now, jobId);
  }

  async function listDLQ({ limit, offset }) {
    const rows = db
      .prepare(
        `SELECT
          dlq.id,
          dlq.job_id,
          dlq.failure_reason,
          dlq.moved_at,
          dlq.reprocessed_at,
          j.workflow_type,
          j.step,
          j.error_code,
          j.error_message,
          j.step_data
        FROM dead_letter_queue dlq
        LEFT JOIN jobs j ON j.id = dlq.job_id
        ORDER BY dlq.moved_at DESC
        LIMIT ? OFFSET ?`,
      )
      .all(limit, offset);

    return rows.map(mapDlqRow);
  }

  async function findDLQById(dlqId) {
    return db.prepare("SELECT * FROM dead_letter_queue WHERE id = ?").get(dlqId);
  }

  async function reprocessDLQEntry({ dlqId, jobId, now }) {
    return db.transaction(async (query) => {
      const jobResult = await query(
        "UPDATE jobs SET status = 'queued', attempts = 0, error_code = NULL, error_message = NULL, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, updated_at = ? WHERE id = ?",
        [now, jobId],
      );
      if (rowCountFrom(jobResult) === 0) {
        throw new Error("Job not found");
      }

      const dlqResult = await query(
        "UPDATE dead_letter_queue SET reprocessed_at = ?, reprocess_job_id = ? WHERE id = ? AND reprocessed_at IS NULL",
        [now, jobId, dlqId],
      );
      if (rowCountFrom(dlqResult) === 0) {
        throw new Error("DLQ entry not found or already reprocessed");
      }
    });
  }

  async function getSystemHealth({ since }) {
    const jobs = db
      .prepare(
        `SELECT
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
          SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM jobs
        WHERE created_at > ?`,
      )
      .get(since);

    const dlqCount =
      (
        db
          .prepare(
            "SELECT COUNT(*) as count FROM dead_letter_queue WHERE reprocessed_at IS NULL",
          )
          .get()
      )?.count ?? 0;

    const recentErrors = db
      .prepare(
        `SELECT workflow_type, step, COUNT(*) as count
        FROM jobs
        WHERE status = 'failed' AND updated_at > ?
        GROUP BY workflow_type, step
        ORDER BY count DESC LIMIT 10`,
      )
      .all(since);

    return { jobs, dlqCount, recentErrors };
  }

  async function listJobStepHistory(jobId) {
    return db
      .prepare("SELECT * FROM job_step_history WHERE job_id = ? ORDER BY started_at ASC")
      .all(jobId);
  }

  return {
    getJobMetrics,
    listJobs,
    findJobById,
    retryFailedJob,
    listDLQ,
    findDLQById,
    reprocessDLQEntry,
    getSystemHealth,
    listJobStepHistory,
  };
}

module.exports = {
  createAdminJobOpsRepository,
};
