#!/usr/bin/env node

const DEFAULT_CONFIG_URL = 'https://api.porizo.co/app/config';

function resolveRelativeUrl(urlString, configUrl) {
  if (!urlString) return null;
  try {
    return new URL(urlString, new URL('/', configUrl)).toString();
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`/app/config returned HTTP ${response.status}`);
  }

  return response.json();
}

async function verifyAudioUrl(url) {
  const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  if (response.ok) return;

  if (response.status === 405) {
    const fallback = await fetch(url, {
      method: 'GET',
      headers: { range: 'bytes=0-0' },
      redirect: 'follow'
    });
    if (fallback.ok || fallback.status === 206) return;
    throw new Error(`sample audio returned HTTP ${fallback.status}`);
  }

  throw new Error(`sample audio returned HTTP ${response.status}`);
}

(async () => {
  const configUrl = process.env.PORIZO_APP_CONFIG_URL || DEFAULT_CONFIG_URL;
  const config = await fetchJson(configUrl);

  const onboarding = config.onboarding;
  if (!onboarding || typeof onboarding !== 'object') {
    throw new Error('missing onboarding config block');
  }

  if (!config.stt || typeof config.stt.primary_provider !== 'string' || !config.stt.primary_provider) {
    throw new Error('missing stt.primary_provider');
  }

  if (typeof onboarding.sample_audio_url !== 'string' || !onboarding.sample_audio_url) {
    throw new Error('missing onboarding.sample_audio_url');
  }

  const resolvedSampleAudioUrl = resolveRelativeUrl(onboarding.sample_audio_url, configUrl);
  if (!resolvedSampleAudioUrl) {
    throw new Error('failed to resolve onboarding.sample_audio_url');
  }

  await verifyAudioUrl(resolvedSampleAudioUrl);

  const resolvedQuestionGraphUrl = resolveRelativeUrl(onboarding.question_graph_url, configUrl);

  console.log('[appconfig:smoke] PASS');
  console.log(`config: ${configUrl}`);
  console.log(`stt.primary_provider: ${config.stt.primary_provider}`);
  console.log(`sample_audio_url: ${resolvedSampleAudioUrl}`);
  if (resolvedQuestionGraphUrl) {
    console.log(`question_graph_url: ${resolvedQuestionGraphUrl}`);
  }
})().catch((error) => {
  console.error(`[appconfig:smoke] FAIL: ${error.message}`);
  process.exitCode = 1;
});
