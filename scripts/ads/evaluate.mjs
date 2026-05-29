/**
 * Meta ads effectiveness evaluator — pure, deterministic rules.
 *
 * No I/O, no network. Takes normalized metrics + thresholds, returns health
 * flags, per-entity verdicts, A/B/C significance gating, and trend/fatigue
 * signals. The LLM narrative layer (narrate.mjs) consumes this output; it never
 * replaces this math.
 *
 * Unit-tested in evaluate.test.mjs.
 */

export const DEFAULT_THRESHOLDS = {
  targetCpi: 4.0,
  cpiWarnMultiple: 1.5,
  minLinkCtr: 0.008,
  maxFrequency: 2.5,
  learningInstallFloor: 50,
  learningMinAgeDays: 3,
  minInstallsForSignificance: 15,
  significantCpiGapPct: 0.25,
  pacingUnderDeliveryPct: 0.7,
  ctrDecayPct: 0.3,
};

/** CPI bucket vs target. null cpi (no installs) → 'unknown'. */
export function cpiStatus(cpi, t = DEFAULT_THRESHOLDS) {
  if (cpi == null || !Number.isFinite(cpi)) return 'unknown';
  if (cpi <= t.targetCpi) return 'good';
  if (cpi <= t.targetCpi * t.cpiWarnMultiple) return 'warn';
  return 'bad';
}

/** Link CTR vs floor. */
export function ctrStatus(ctr, t = DEFAULT_THRESHOLDS) {
  if (ctr == null || !Number.isFinite(ctr)) return 'unknown';
  return ctr < t.minLinkCtr ? 'low' : 'good';
}

/** Frequency vs fatigue ceiling. */
export function frequencyStatus(freq, t = DEFAULT_THRESHOLDS) {
  if (freq == null || !Number.isFinite(freq)) return 'unknown';
  return freq > t.maxFrequency ? 'fatigue' : 'ok';
}

/** Learning phase: still learning until BOTH enough installs AND old enough. */
export function learningStatus({ installs = 0, ageDays = 0 } = {}, t = DEFAULT_THRESHOLDS) {
  if (installs < t.learningInstallFloor) return 'learning';
  if (ageDays < t.learningMinAgeDays) return 'learning';
  return 'exited';
}

/** Delivery pacing: spend vs daily budget. */
export function pacingStatus({ spend = 0, dailyBudget = 0 } = {}, t = DEFAULT_THRESHOLDS) {
  if (!dailyBudget) return 'unknown';
  const ratio = spend / dailyBudget;
  if (ratio < t.pacingUnderDeliveryPct) return 'under';
  if (ratio > 1.2) return 'over';
  return 'ok';
}

/**
 * Per-entity verdict. Precedence:
 *   learning → HOLD (don't judge yet)
 *   else fatigue → REFRESH
 *   else bad CPI → PAUSE
 *   else good CPI → SCALE
 *   else → MONITOR
 */
export function evaluateEntity(m, t = DEFAULT_THRESHOLDS) {
  const flags = {
    learning: learningStatus({ installs: m.installs, ageDays: m.ageDays }, t),
    cpi: cpiStatus(m.cpi, t),
    ctr: ctrStatus(m.linkCtr, t),
    frequency: frequencyStatus(m.frequency, t),
    pacing: pacingStatus({ spend: m.spend, dailyBudget: m.dailyBudget }, t),
  };

  let verdict;
  if (flags.learning === 'learning') verdict = 'HOLD';
  else if (flags.frequency === 'fatigue') verdict = 'REFRESH';
  else if (flags.cpi === 'bad') verdict = 'PAUSE';
  else if (flags.cpi === 'good') verdict = 'SCALE';
  else verdict = 'MONITOR';

  return { flags, verdict, metrics: m };
}

/**
 * A/B/C significance gate. Only declares a leader when:
 *   - ≥ 2 ads clear minInstallsForSignificance, AND
 *   - the best CPI is meaningfully lower than the runner-up (gap ≥ significantCpiGapPct).
 * Otherwise inconclusive — keep running. Prevents crowning winners on noise.
 */
export function abcVerdict(ads, t = DEFAULT_THRESHOLDS) {
  const qualified = ads
    .filter((a) => a.installs >= t.minInstallsForSignificance && Number.isFinite(a.cpi))
    .sort((a, b) => a.cpi - b.cpi);

  if (qualified.length < 2) {
    return {
      conclusive: false,
      leaderId: null,
      laggardIds: [],
      reason: `Inconclusive — fewer than 2 ads have ≥${t.minInstallsForSignificance} installs. Keep running.`,
    };
  }

  const [best, runnerUp] = qualified;
  const gap = (runnerUp.cpi - best.cpi) / runnerUp.cpi;
  if (gap < t.significantCpiGapPct) {
    return {
      conclusive: false,
      leaderId: null,
      laggardIds: [],
      reason: `Inconclusive — best CPI ($${best.cpi.toFixed(2)}) is only ${(gap * 100).toFixed(0)}% better than runner-up; needs ≥${(t.significantCpiGapPct * 100).toFixed(0)}%. Keep running.`,
    };
  }

  const laggardIds = qualified
    .slice(1)
    .filter((a) => (a.cpi - best.cpi) / a.cpi >= t.significantCpiGapPct)
    .map((a) => a.id);

  return {
    conclusive: true,
    leaderId: best.id,
    laggardIds,
    reason: `${best.id} leads at $${best.cpi.toFixed(2)} CPI vs $${runnerUp.cpi.toFixed(2)} (${(gap * 100).toFixed(0)}% better), both past the ${t.minInstallsForSignificance}-install floor.`,
  };
}

/**
 * Trend signals from a time-ordered series of snapshots for one entity.
 * Compares oldest vs newest. ctr decay beyond ctrDecayPct → fatigue.
 */
export function trendFlags(series, t = DEFAULT_THRESHOLDS) {
  if (!Array.isArray(series) || series.length < 2) {
    return { cpiDirection: 'flat', ctrDecay: false, fatigue: false };
  }
  const first = series[0];
  const last = series[series.length - 1];

  let cpiDirection = 'flat';
  if (Number.isFinite(first.cpi) && Number.isFinite(last.cpi) && first.cpi > 0) {
    const d = (last.cpi - first.cpi) / first.cpi;
    if (d > 0.15) cpiDirection = 'rising';
    else if (d < -0.15) cpiDirection = 'falling';
  }

  let ctrDecay = false;
  if (Number.isFinite(first.linkCtr) && Number.isFinite(last.linkCtr) && first.linkCtr > 0) {
    const drop = (first.linkCtr - last.linkCtr) / first.linkCtr;
    ctrDecay = drop >= t.ctrDecayPct;
  }

  return { cpiDirection, ctrDecay, fatigue: ctrDecay };
}
