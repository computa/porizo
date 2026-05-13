import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard } from './spend-dashboard.mjs';

const fixtureStore = () => ({
  schema_version: '1.0',
  updated_at: '2026-05-13T12:00:00Z',
  first_observed: '2026-05-12',
  campaigns: {
    '2143835551': {
      name: 'Probe US Painkiller',
      first_seen: '2026-05-12',
      daily: {
        '2026-05-12': { impressions: 1234, taps: 42, installs: 5, spend: 18.4, avg_cpt: 0.44 },
        '2026-05-13': { impressions: 1500, taps: 50, installs: 6, spend: 20.0, avg_cpt: 0.4 },
      },
    },
    '2143835552': {
      name: 'Porizo - Brand US',
      first_seen: '2026-05-12',
      daily: {
        '2026-05-12': { impressions: 500, taps: 20, installs: 3, spend: 10.0, avg_cpt: 0.5 },
      },
    },
  },
  keywords: {
    '2143835551:51234567': {
      campaign_id: '2143835551',
      keyword_id: '51234567',
      term: 'song for mom',
      match_type: 'BROAD',
      first_seen: '2026-05-12',
      daily: {
        '2026-05-12': { impressions: 200, taps: 8, installs: 1, spend: 3.2, avg_cpt: 0.4 },
        '2026-05-13': { impressions: 250, taps: 10, installs: 2, spend: 4.0, avg_cpt: 0.4 },
      },
    },
  },
});

test('renderDashboard returns well-formed HTML', () => {
  const html = renderDashboard(fixtureStore());
  assert.ok(html.startsWith('<!DOCTYPE html>'), 'starts with doctype');
  assert.ok(html.includes('</html>'), 'closes html');
  assert.ok(html.includes('chart.js'), 'pulls in Chart.js');
});

test('renderDashboard embeds the store as JSON data island', () => {
  const html = renderDashboard(fixtureStore());
  // store should be inline so the dashboard is self-contained
  assert.ok(html.includes('id="store-data"'), 'has data island');
  assert.ok(html.includes('Probe US Painkiller'), 'campaign name in payload');
  assert.ok(html.includes('song for mom'), 'keyword in payload');
});

test('renderDashboard escapes </script> in the data island', () => {
  const store = fixtureStore();
  store.keywords['2143835551:51234567'].term = 'song for </script><script>alert(1)</script>';
  const html = renderDashboard(store);
  assert.ok(
    !html.includes('</script><script>alert(1)</script>'),
    'literal </script> must not appear in payload',
  );
});

test('renderDashboard handles empty store gracefully', () => {
  const html = renderDashboard({
    schema_version: '1.0',
    updated_at: '2026-05-13T12:00:00Z',
    campaigns: {},
    keywords: {},
  });
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('No spend history yet'), 'has empty state');
});

test('renderDashboard renders updated_at timestamp visibly', () => {
  const html = renderDashboard(fixtureStore());
  assert.ok(html.includes('2026-05-13'), 'updated_at date visible');
});
