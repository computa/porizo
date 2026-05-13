import { promises as fs } from 'node:fs';
import path from 'node:path';
import { computeVerdict, aggregateWindow, VERDICT_COLORS, VERDICT_META } from './spend-verdicts.mjs';

function escapeJsonForScriptTag(json) {
  return json.replace(/<\//g, '<\\/');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const VERDICT_FN_SOURCE = `
  const VERDICT_COLORS = ${JSON.stringify(VERDICT_COLORS)};
  const VERDICT_META = ${JSON.stringify(VERDICT_META)};
  const computeVerdict = ${computeVerdict.toString()};
  const aggregateWindow = ${aggregateWindow.toString()};
`;

export function renderDashboard(store) {
  const updated = store.updated_at ? store.updated_at.slice(0, 10) : 'never';
  const campaignCount = Object.keys(store.campaigns ?? {}).length;
  const keywordCount = Object.keys(store.keywords ?? {}).length;
  const empty = campaignCount === 0 && keywordCount === 0;
  const dataJson = escapeJsonForScriptTag(JSON.stringify(store));

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Porizo — ASO Spend Dashboard</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>
    :root {
      --bg: #fafafa; --fg: #1a1a1a; --muted: #6a6a6a; --card: #fff;
      --border: #e5e5e5; --accent: #c0582a;
    }
    body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
    header { padding: 20px 28px; border-bottom: 1px solid var(--border); background: var(--card);
      display: flex; justify-content: space-between; align-items: baseline; }
    header h1 { font-size: 18px; font-weight: 600; margin: 0; }
    header .meta { color: var(--muted); font-size: 12px; }
    main { max-width: 1280px; margin: 0 auto; padding: 24px; }
    .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 20px;
      flex-wrap: wrap; }
    .controls label { font-size: 12px; color: var(--muted); }
    .controls select, .controls input {
      padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px;
      background: var(--card); font: inherit;
    }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
      padding: 20px; margin-bottom: 20px; }
    .card h2 { font-size: 14px; font-weight: 600; margin: 0 0 12px;
      text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    .chart-wrap { position: relative; height: 360px; }
    .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
      margin-bottom: 20px; }
    .stat { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
      padding: 16px; }
    .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.06em; }
    .stat .value { font-size: 22px; font-weight: 600; margin-top: 4px;
      font-variant-numeric: tabular-nums; }
    .empty { text-align: center; padding: 80px 20px; color: var(--muted); }
    .keyword-search { width: 240px; }
    .totals-row { color: var(--muted); font-size: 12px; margin-top: 8px; }
    .verdict-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .vstat { background: var(--card); border: 1px solid var(--border); border-radius: 8px;
      padding: 14px 16px; display: flex; align-items: center; gap: 12px; }
    .vstat .dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
    .vstat .label { font-size: 11px; color: var(--muted); text-transform: uppercase;
      letter-spacing: 0.06em; }
    .vstat .value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .vstat .right { display: flex; flex-direction: column; }
    .vstat .right .sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
    table.actions { width: 100%; border-collapse: collapse; font-size: 13px;
      font-variant-numeric: tabular-nums; }
    table.actions th, table.actions td { padding: 8px 10px; text-align: left;
      border-bottom: 1px solid var(--border); }
    table.actions th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em;
      color: var(--muted); font-weight: 600; cursor: pointer; user-select: none; }
    table.actions th.num, table.actions td.num { text-align: right; }
    table.actions tr:hover td { background: #fafafa; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px;
      font-weight: 600; color: white; letter-spacing: 0.02em; }
    .legend-note { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <header>
    <h1>Porizo · ASO Spend Dashboard</h1>
    <div class="meta">updated ${escapeHtml(updated)} · ${campaignCount} campaigns · ${keywordCount} keywords</div>
  </header>
  <main>
    ${empty
      ? `<div class="empty"><p>No spend history yet. Run <code>node scripts/aso/spend-history.mjs</code> to populate.</p></div>`
      : `
    <div class="controls">
      <label>Metric
        <select id="metric">
          <option value="spend">Spend ($)</option>
          <option value="impressions">Impressions</option>
          <option value="taps">Taps</option>
          <option value="installs">Installs</option>
          <option value="avg_cpt">Avg CPT ($)</option>
        </select>
      </label>
      <label>Rollup
        <select id="rollup">
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </label>
      <label>Window
        <select id="window">
          <option value="7">Last 7 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </label>
      <label>Keyword filter
        <input id="kwFilter" class="keyword-search" type="search" placeholder="e.g. song for mom">
      </label>
    </div>

    <div class="summary" id="summary"></div>

    <div class="card">
      <h2>Decision view — spend vs cost-per-install</h2>
      <p class="legend-note">Each dot is one keyword. X = window spend. Y = cost per install (lower is better). Bubble size = installs. Color = verdict from the rerank skill's thresholds. Bottom-right = high spend + cheap installs (scale). Top-right = high spend + expensive installs (cut).</p>
      <div class="verdict-summary" id="verdictSummary"></div>
      <div class="chart-wrap"><canvas id="chartScatter"></canvas></div>
    </div>

    <div class="card">
      <h2>Efficiency over time — CPI per campaign</h2>
      <p class="legend-note">Lower line = cheaper installs. Trending down while spend climbs = scaling well. Trending up = paying more for the same installs.</p>
      <div class="chart-wrap"><canvas id="chartTrend"></canvas></div>
    </div>

    <div class="card">
      <h2>Action table — keywords in the window</h2>
      <p class="legend-note">Click a column header to sort. Green = scale. Amber = bid up or volume-capped. Red = cut. Gray = monitor.</p>
      <div id="actionTableWrap"></div>
    </div>

    <div class="card">
      <h2>Spend by campaign</h2>
      <div class="chart-wrap"><canvas id="chartCampaigns"></canvas></div>
      <div class="totals-row" id="campaignsTotals"></div>
    </div>

    <div class="card">
      <h2>Top 20 keywords by total spend</h2>
      <div class="chart-wrap"><canvas id="chartKeywords"></canvas></div>
      <div class="totals-row" id="keywordsTotals"></div>
    </div>
    `}
  </main>

  <script id="store-data" type="application/json">${dataJson}</script>
  <script>
    (function () {
      const node = document.getElementById('store-data');
      if (!node) return;
      const store = JSON.parse(node.textContent);
${VERDICT_FN_SOURCE}
      const fmtMoney = (n) => '$' + (n ?? 0).toFixed(2);
      const fmtInt = (n) => (n ?? 0).toLocaleString();
      const isMoney = (m) => m === 'spend' || m === 'avg_cpt';

      function allDates() {
        const set = new Set();
        for (const c of Object.values(store.campaigns)) Object.keys(c.daily).forEach(d => set.add(d));
        for (const k of Object.values(store.keywords)) Object.keys(k.daily).forEach(d => set.add(d));
        return [...set].sort();
      }

      function rollupWeekly(dates) {
        const out = new Map();
        for (const d of dates) {
          const dt = new Date(d + 'T00:00:00Z');
          const day = dt.getUTCDay() || 7;
          dt.setUTCDate(dt.getUTCDate() - day + 1);
          const wk = dt.toISOString().slice(0, 10);
          if (!out.has(wk)) out.set(wk, []);
          out.get(wk).push(d);
        }
        return out;
      }

      function pickWindow(dates, win) {
        if (win === 'all') return dates;
        const n = parseInt(win, 10);
        return dates.slice(-n);
      }

      function aggregate(daily, dates, metric) {
        let s = 0, c = 0;
        for (const d of dates) {
          const row = daily[d];
          if (!row) continue;
          s += row[metric] ?? 0;
          if (row[metric] != null) c++;
        }
        return metric === 'avg_cpt' && c > 0 ? s / c : s;
      }

      function seriesForGroup(group, dates, metric, rollup) {
        if (rollup === 'daily') {
          return dates.map(d => group.daily[d]?.[metric] ?? 0);
        }
        const weeks = rollupWeekly(dates);
        return [...weeks.keys()].sort().map(wk => aggregate(group.daily, weeks.get(wk), metric));
      }

      function labelsFor(dates, rollup) {
        if (rollup === 'daily') return dates;
        return [...rollupWeekly(dates).keys()].sort();
      }

      function makeStat(label, value) {
        const wrap = document.createElement('div');
        wrap.className = 'stat';
        const l = document.createElement('div');
        l.className = 'label';
        l.textContent = label;
        const v = document.createElement('div');
        v.className = 'value';
        v.textContent = value;
        wrap.appendChild(l);
        wrap.appendChild(v);
        return wrap;
      }

      function replaceChildren(parent, nodes) {
        while (parent.firstChild) parent.removeChild(parent.firstChild);
        for (const n of nodes) parent.appendChild(n);
      }

      const PALETTE = [
        '#c0582a', '#3b82c4', '#5fa861', '#d4325e', '#e8943a',
        '#7d4ec0', '#3aafa9', '#b8860b', '#cd5c5c', '#5f9ea0',
        '#9b3aaf', '#2e7d5e', '#aa6b3a', '#4a6fa5', '#8b5cf6',
        '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6',
      ];

      let campaignsChart = null;
      let keywordsChart = null;
      let scatterChart = null;
      let trendChart = null;
      let actionSort = { key: 'spend', dir: 'desc' };

      function makeBadge(verdict) {
        const b = document.createElement('span');
        b.className = 'badge';
        b.textContent = verdict.label.replace(/_/g, ' ');
        b.style.background = verdict.color;
        b.title = verdict.blurb;
        return b;
      }

      function renderVerdictSummary(rows) {
        const buckets = { scale: 0, bid_up: 0, cut: 0, watch: 0 };
        const bucketSpend = { scale: 0, bid_up: 0, cut: 0, watch: 0 };
        for (const r of rows) {
          buckets[r.verdict.bucket] = (buckets[r.verdict.bucket] || 0) + 1;
          bucketSpend[r.verdict.bucket] = (bucketSpend[r.verdict.bucket] || 0) + r.agg.spend;
        }
        const items = [
          ['Scale', buckets.scale, bucketSpend.scale, VERDICT_COLORS.scale],
          ['Bid up / capped', buckets.bid_up, bucketSpend.bid_up, VERDICT_COLORS.bid_up],
          ['Cut', buckets.cut, bucketSpend.cut, VERDICT_COLORS.cut],
          ['Monitor', buckets.watch, bucketSpend.watch, VERDICT_COLORS.watch],
        ];
        const parent = document.getElementById('verdictSummary');
        while (parent.firstChild) parent.removeChild(parent.firstChild);
        for (const [label, count, spend, color] of items) {
          const wrap = document.createElement('div');
          wrap.className = 'vstat';
          const dot = document.createElement('div');
          dot.className = 'dot';
          dot.style.background = color;
          const right = document.createElement('div');
          right.className = 'right';
          const l = document.createElement('div');
          l.className = 'label';
          l.textContent = label;
          const v = document.createElement('div');
          v.className = 'value';
          v.textContent = count + ' kw · ' + fmtMoney(spend);
          const sub = document.createElement('div');
          sub.className = 'sub';
          sub.textContent = count === 0 ? 'none' : (spend === 0 ? 'no spend yet' : 'window total');
          right.appendChild(l); right.appendChild(v); right.appendChild(sub);
          wrap.appendChild(dot); wrap.appendChild(right);
          parent.appendChild(wrap);
        }
      }

      function renderActionTable(rows) {
        const wrap = document.getElementById('actionTableWrap');
        while (wrap.firstChild) wrap.removeChild(wrap.firstChild);

        const sorted = [...rows].sort((a, b) => {
          const k = actionSort.key;
          const av = a.sortValues[k]; const bv = b.sortValues[k];
          if (av == null && bv == null) return 0;
          if (av == null) return 1; if (bv == null) return -1;
          const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
          return actionSort.dir === 'asc' ? cmp : -cmp;
        });

        const table = document.createElement('table');
        table.className = 'actions';
        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        const cols = [
          { k: 'verdict', label: 'Verdict', num: false },
          { k: 'term', label: 'Keyword', num: false },
          { k: 'match_type', label: 'Match', num: false },
          { k: 'campaign', label: 'Campaign', num: false },
          { k: 'spend', label: 'Spend', num: true },
          { k: 'impressions', label: 'Imp', num: true },
          { k: 'taps', label: 'Taps', num: true },
          { k: 'installs', label: 'Inst', num: true },
          { k: 'install_rate', label: 'Inst rate', num: true },
          { k: 'cpi', label: 'CPI', num: true },
        ];
        for (const c of cols) {
          const th = document.createElement('th');
          th.textContent = c.label + (actionSort.key === c.k ? (actionSort.dir === 'asc' ? ' ▲' : ' ▼') : '');
          if (c.num) th.className = 'num';
          th.addEventListener('click', () => {
            if (actionSort.key === c.k) actionSort.dir = actionSort.dir === 'asc' ? 'desc' : 'asc';
            else { actionSort = { key: c.k, dir: c.num ? 'desc' : 'asc' }; }
            render();
          });
          trh.appendChild(th);
        }
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        for (const r of sorted) {
          const tr = document.createElement('tr');
          const cells = [
            { node: makeBadge(r.verdict) },
            { text: r.kw.term },
            { text: r.kw.match_type },
            { text: r.campaignName },
            { text: fmtMoney(r.agg.spend), num: true },
            { text: fmtInt(r.agg.impressions), num: true },
            { text: fmtInt(r.agg.taps), num: true },
            { text: fmtInt(r.agg.installs), num: true },
            { text: (r.agg.install_rate * 100).toFixed(1) + '%', num: true },
            { text: r.agg.cpi == null ? '—' : fmtMoney(r.agg.cpi), num: true },
          ];
          for (const c of cells) {
            const td = document.createElement('td');
            if (c.num) td.className = 'num';
            if (c.node) td.appendChild(c.node);
            else td.textContent = c.text;
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
      }

      function render() {
        const metric = document.getElementById('metric').value;
        const rollup = document.getElementById('rollup').value;
        const win = document.getElementById('window').value;
        const kwFilter = document.getElementById('kwFilter').value.trim().toLowerCase();

        const dates = pickWindow(allDates(), win);
        const labels = labelsFor(dates, rollup);

        let totalSpend = 0, totalInstalls = 0, totalTaps = 0, totalImps = 0;
        for (const c of Object.values(store.campaigns)) {
          for (const d of dates) {
            const r = c.daily[d];
            if (!r) continue;
            totalSpend += r.spend ?? 0;
            totalInstalls += r.installs ?? 0;
            totalTaps += r.taps ?? 0;
            totalImps += r.impressions ?? 0;
          }
        }
        const cpi = totalInstalls ? totalSpend / totalInstalls : 0;
        replaceChildren(document.getElementById('summary'), [
          makeStat('Spend', fmtMoney(totalSpend)),
          makeStat('Impressions', fmtInt(totalImps)),
          makeStat('Taps', fmtInt(totalTaps)),
          makeStat('Installs · CPI', fmtInt(totalInstalls) + ' · ' + fmtMoney(cpi)),
        ]);

        const keywordRows = Object.values(store.keywords)
          .filter(k => !kwFilter || (k.term ?? '').toLowerCase().includes(kwFilter))
          .map(k => {
            const a = aggregateWindow(k, dates);
            return {
              kw: k,
              agg: a,
              verdict: computeVerdict(a),
              campaignName: store.campaigns[k.campaign_id]?.name ?? k.campaign_id,
              sortValues: {
                verdict: a.spend > 0 ? computeVerdict(a).bucket : 'z',
                term: k.term ?? '',
                match_type: k.match_type ?? '',
                campaign: store.campaigns[k.campaign_id]?.name ?? '',
                spend: a.spend,
                impressions: a.impressions,
                taps: a.taps,
                installs: a.installs,
                install_rate: a.install_rate,
                cpi: a.cpi,
              },
            };
          })
          .filter(r => r.agg.impressions > 0 || r.agg.taps > 0 || r.agg.spend > 0);

        renderVerdictSummary(keywordRows);
        renderActionTable(keywordRows);

        const scatterDatasets = ['scale', 'bid_up', 'cut', 'watch'].map(bucket => ({
          label: bucket === 'bid_up' ? 'Bid up / capped' :
                 bucket === 'scale' ? 'Scale' :
                 bucket === 'cut' ? 'Cut' : 'Monitor',
          backgroundColor: VERDICT_COLORS[bucket] + 'cc',
          borderColor: VERDICT_COLORS[bucket],
          borderWidth: 1.5,
          data: keywordRows
            .filter(r => r.verdict.bucket === bucket)
            .map(r => ({
              x: r.agg.spend,
              y: r.agg.cpi ?? 0,
              r: Math.max(4, Math.min(20, 4 + Math.sqrt(r.agg.installs) * 3)),
              _term: r.kw.term,
              _match: r.kw.match_type,
              _installs: r.agg.installs,
              _verdict: r.verdict.label,
            })),
        }));

        if (scatterChart) scatterChart.destroy();
        scatterChart = new Chart(document.getElementById('chartScatter'), {
          type: 'bubble',
          data: { datasets: scatterDatasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
              x: { title: { display: true, text: 'Window spend ($)' }, beginAtZero: true,
                ticks: { callback: (v) => '$' + v } },
              y: { title: { display: true, text: 'Cost per install ($)' }, beginAtZero: true,
                ticks: { callback: (v) => '$' + v } },
            },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const p = ctx.raw;
                    return [
                      p._term + ' [' + p._match + ']',
                      p._verdict.replace(/_/g, ' '),
                      'spend ' + fmtMoney(p.x) + ' · cpi ' + fmtMoney(p.y) + ' · ' + fmtInt(p._installs) + ' inst',
                    ];
                  }
                }
              }
            }
          }
        });

        const trendDatasets = Object.entries(store.campaigns)
          .map(([, c], i) => {
            const seriesCpi = labels.map((lbl) => {
              const groupDates = rollup === 'daily' ? [lbl] : rollupWeekly(dates).get(lbl) ?? [];
              let s = 0, inst = 0;
              for (const d of groupDates) {
                const row = c.daily[d];
                if (!row) continue;
                s += row.spend ?? 0;
                inst += row.installs ?? 0;
              }
              return inst > 0 ? s / inst : null;
            });
            return {
              label: c.name,
              data: seriesCpi,
              borderColor: PALETTE[i % PALETTE.length],
              backgroundColor: PALETTE[i % PALETTE.length] + '22',
              borderWidth: 2,
              fill: false,
              tension: 0.15,
              pointRadius: 3,
              spanGaps: true,
            };
          });

        if (trendChart) trendChart.destroy();
        trendChart = new Chart(document.getElementById('chartTrend'), {
          type: 'line',
          data: { labels, datasets: trendDatasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y: { title: { display: true, text: 'CPI ($)' }, beginAtZero: true,
                ticks: { callback: (v) => '$' + v } },
              x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
              tooltip: {
                callbacks: {
                  label: (ctx) => ctx.dataset.label + ': ' + (ctx.parsed.y == null ? '— no installs' : fmtMoney(ctx.parsed.y)),
                }
              }
            }
          }
        });

        const campaignDatasets = Object.entries(store.campaigns)
          .map(([, c], i) => ({
            label: c.name,
            data: seriesForGroup(c, dates, metric, rollup),
            backgroundColor: PALETTE[i % PALETTE.length] + 'cc',
            borderColor: PALETTE[i % PALETTE.length],
            borderWidth: 1.5,
            fill: metric === 'spend' || metric === 'impressions' || metric === 'taps',
            tension: 0.15,
          }));

        if (campaignsChart) campaignsChart.destroy();
        campaignsChart = new Chart(document.getElementById('chartCampaigns'), {
          type: 'line',
          data: { labels, datasets: campaignDatasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y: { stacked: metric === 'spend', beginAtZero: true,
                ticks: { callback: (v) => isMoney(metric) ? '$' + v : v } },
              x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
              tooltip: {
                callbacks: {
                  label: (ctx) => ctx.dataset.label + ': ' + (isMoney(metric) ? fmtMoney(ctx.parsed.y) : fmtInt(ctx.parsed.y)),
                }
              }
            }
          }
        });

        const campTotalSpend = Object.values(store.campaigns)
          .map((c) => [c.name, aggregate(c.daily, dates, 'spend')])
          .sort((a, b) => b[1] - a[1])
          .map(([n, s]) => n + ' ' + fmtMoney(s))
          .join(' · ');
        document.getElementById('campaignsTotals').textContent = 'Window totals: ' + campTotalSpend;

        const kwEntries = Object.values(store.keywords)
          .filter(k => !kwFilter || (k.term ?? '').toLowerCase().includes(kwFilter))
          .map(k => ({ k, total: aggregate(k.daily, dates, 'spend') }))
          .filter(x => x.total > 0)
          .sort((a, b) => b.total - a.total)
          .slice(0, 20);

        const kwDatasets = kwEntries.map(({ k }, i) => ({
          label: k.term + ' [' + k.match_type + ']',
          data: seriesForGroup(k, dates, metric, rollup),
          borderColor: PALETTE[i % PALETTE.length],
          backgroundColor: PALETTE[i % PALETTE.length] + '22',
          borderWidth: 1.5,
          fill: false,
          tension: 0.15,
          pointRadius: 2,
        }));

        if (keywordsChart) keywordsChart.destroy();
        keywordsChart = new Chart(document.getElementById('chartKeywords'), {
          type: 'line',
          data: { labels, datasets: kwDatasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            scales: {
              y: { beginAtZero: true,
                ticks: { callback: (v) => isMoney(metric) ? '$' + v : v } },
              x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
            },
            plugins: {
              legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8, font: { size: 11 } } },
              tooltip: {
                callbacks: {
                  label: (ctx) => ctx.dataset.label + ': ' + (isMoney(metric) ? fmtMoney(ctx.parsed.y) : fmtInt(ctx.parsed.y)),
                }
              }
            }
          }
        });

        document.getElementById('keywordsTotals').textContent = kwEntries.length
          ? kwEntries.length + ' keyword' + (kwEntries.length === 1 ? '' : 's') + ' shown · top by window spend'
          : 'No keywords match the current filter';
      }

      ['metric', 'rollup', 'window', 'kwFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', render);
      });
      render();
    })();
  </script>
</body>
</html>
`;
}

export async function writeDashboard(filePath, store) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, renderDashboard(store));
}
