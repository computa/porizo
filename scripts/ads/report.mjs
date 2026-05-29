/**
 * Render the per-run Markdown report from the assembled evaluation + optional
 * LLM narrative. Pure string building.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './store.mjs';

const fmt = (n, d = 2) => (n == null || !Number.isFinite(n) ? '—' : Number(n).toFixed(d));
const money = (n) => (n == null ? '—' : `A$${fmt(n)}`);
const pct = (n) => (n == null ? '—' : `${(n * 100).toFixed(2)}%`);

const VERDICT_ICON = {
  HOLD: '⏳', SCALE: '📈', PAUSE: '🛑', REFRESH: '🔁', MONITOR: '👁️',
};

export function renderMarkdown(ev, narrative) {
  const c = ev.campaign;
  const L = [];
  L.push(`# Meta Ads Report — ${c.name}`);
  L.push('');
  L.push(`**Pulled:** ${ev.pulledAt}  ·  **Campaign:** \`${c.id}\`  ·  **Status:** ${c.status}  ·  **Age:** ${c.ageDays}d  ·  **Daily budget:** ${money(c.dailyBudget)}`);
  L.push('');

  // campaign rollup (maximum window)
  const camp = ev.campaignRollup;
  if (camp) {
    L.push('## Campaign (lifetime)');
    L.push('');
    L.push('| Spend | Impr | Reach | Freq | Link CTR | Installs | CPI |');
    L.push('|---|---|---|---|---|---|---|');
    L.push(`| ${money(camp.spend)} | ${camp.impressions} | ${camp.reach} | ${fmt(camp.frequency)} | ${pct(camp.linkCtr)} | ${camp.installs} | ${money(camp.cpi)} |`);
    L.push('');
  }

  // A/B/C
  L.push('## A/B/C test');
  L.push('');
  L.push(`**Verdict:** ${ev.abc.conclusive ? `✅ ${ev.abc.leaderId} leads` : '⏳ inconclusive'} — ${ev.abc.reason}`);
  L.push('');
  L.push('| Ad | Verdict | Spend | Installs | CPI | Link CTR | Freq | Flags |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const e of ev.entities) {
    const m = e.metrics;
    const flags = Object.entries(e.flags)
      .filter(([, v]) => ['low', 'fatigue', 'bad', 'warn', 'under', 'over', 'learning'].includes(v))
      .map(([k, v]) => `${k}:${v}`)
      .join(', ') || '—';
    L.push(`| ${m.name} | ${VERDICT_ICON[e.verdict] || ''} ${e.verdict} | ${money(m.spend)} | ${m.installs} | ${money(m.cpi)} | ${pct(m.linkCtr)} | ${fmt(m.frequency)} | ${flags} |`);
  }
  L.push('');

  // trends
  if (ev.trends && ev.trends.length) {
    L.push('## Trends (across snapshots)');
    L.push('');
    for (const tr of ev.trends) {
      const bits = [`CPI ${tr.cpiDirection}`];
      if (tr.fatigue) bits.push('⚠️ CTR decay / fatigue');
      L.push(`- **${tr.name}**: ${bits.join(', ')}`);
    }
    L.push('');
  }

  // recommendations (rules-derived, recommend-only)
  L.push('## Recommended actions');
  L.push('');
  if (ev.recommendations.length === 0) {
    L.push('_No actions — campaign healthy / still learning._');
  } else {
    for (const r of ev.recommendations) {
      L.push(`- **${r.action}** — ${r.target}: ${r.reason}`);
      if (r.command) L.push(`  \`\`\`\n  ${r.command}\n  \`\`\``);
    }
  }
  L.push('');

  // LLM narrative
  L.push('## Analyst narrative');
  L.push('');
  L.push(narrative || '_LLM narrative unavailable (no ANTHROPIC_API_KEY) — rules-only report above._');
  L.push('');
  L.push('---');
  L.push('_Recommend-only. No account changes were made. Apply via the `meta` CLI / Graph API after review._');
  return L.join('\n');
}

export async function writeReport(markdown, pulledAt) {
  const dir = path.join(DATA_DIR, 'reports');
  await fs.mkdir(dir, { recursive: true });
  const stamp = pulledAt.replace(/[:.]/g, '-');
  const file = path.join(dir, `${stamp}.md`);
  await fs.writeFile(file, markdown);
  return file;
}
