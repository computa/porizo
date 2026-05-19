const test = require("node:test");
const assert = require("node:assert/strict");
const flux = require("../../../src/services/image-providers/flux-image");

test("flux module exports the expected adapter shape", () => {
  assert.equal(flux.name, "flux");
  assert.equal(flux.model, "black-forest-labs/flux-1.1-pro-ultra");
  assert.equal(typeof flux.generate, "function");
  assert.ok(flux.ModerationRefusalError);
  assert.ok(flux.ImageGenerationError);
});

test("generate() requires a non-empty prompt", async () => {
  await assert.rejects(
    () => flux.generate({ prompt: "", apiKey: "x" }),
    /non-empty prompt/i,
  );
});

test("generate() requires apiKey or REPLICATE_API_TOKEN", async () => {
  const saved = process.env.REPLICATE_API_TOKEN;
  delete process.env.REPLICATE_API_TOKEN;
  await assert.rejects(
    () => flux.generate({ prompt: "real prompt" }),
    /REPLICATE_API_TOKEN/i,
  );
  if (saved) process.env.REPLICATE_API_TOKEN = saved;
});

test("generate() posts correct payload to Replicate predictions endpoint", async () => {
  let capturedRequest = null;
  const fakeFetch = async (url, opts) => {
    if (!capturedRequest) capturedRequest = { url, opts };
    if (url.endsWith("/predictions")) {
      return new Response(
        JSON.stringify({ id: "pred_abc", status: "starting" }),
        { status: 201 },
      );
    }
    if (url.includes("/predictions/pred_abc")) {
      return new Response(
        JSON.stringify({
          id: "pred_abc",
          status: "succeeded",
          output: ["https://replicate.delivery/x/y.jpg"],
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("y.jpg")) {
      return new Response(Buffer.alloc(2048, "x"), { status: 200 });
    }
    throw new Error(`unexpected url: ${url}`);
  };
  const buf = await flux.generate({
    prompt: "a peony, photoreal",
    negativePrompt: "no text",
    apiKey: "test_token",
    fetchFn: fakeFetch,
  });
  assert.ok(Buffer.isBuffer(buf));
  assert.ok(buf.length >= 2048);
  assert.ok(capturedRequest.url.startsWith("https://api.replicate.com"));
  const body = JSON.parse(capturedRequest.opts.body);
  assert.equal(body.input.prompt, "a peony, photoreal");
  assert.equal(body.input.aspect_ratio, "1:1");
  assert.equal(body.input.output_format, "jpg");
});

test("generate() maps Replicate moderation refusal to ModerationRefusalError", async () => {
  const fakeFetch = async (url) => {
    if (url.endsWith("/predictions")) {
      return new Response(
        JSON.stringify({
          id: "pred_x",
          status: "failed",
          error: "NSFW content detected by safety_checker",
        }),
        { status: 201 },
      );
    }
    if (url.includes("/predictions/pred_x")) {
      return new Response(
        JSON.stringify({
          id: "pred_x",
          status: "failed",
          error: "NSFW content detected by safety_checker",
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url: ${url}`);
  };
  await assert.rejects(
    () => flux.generate({ prompt: "x", apiKey: "t", fetchFn: fakeFetch }),
    flux.ModerationRefusalError,
  );
});

test("generate() maps other failures to ImageGenerationError", async () => {
  const fakeFetch = async () => new Response("server error", { status: 500 });
  await assert.rejects(
    () => flux.generate({ prompt: "x", apiKey: "t", fetchFn: fakeFetch }),
    flux.ImageGenerationError,
  );
});

test("generate() raises a timeout ImageGenerationError when prediction never reaches succeeded", async () => {
  // Replicate stays in "processing" forever; the polling loop must exit
  // via the deadline branch and surface "timed out" rather than spin forever.
  process.env.FLUX_TIMEOUT_MS = "5000";
  // Re-require with the lowered env so the module-level DEFAULT_TIMEOUT_MS picks it up.
  delete require.cache[
    require.resolve("../../../src/services/image-providers/flux-image")
  ];
  const fluxFresh = require("../../../src/services/image-providers/flux-image");
  // Virtual clock: advance Date.now via the injected sleepFn so we don't burn 5 real seconds.
  const realDateNow = Date.now;
  let virtualNow = realDateNow();
  Date.now = () => virtualNow;
  const sleepFn = async (ms) => {
    virtualNow += ms;
  };
  const fakeFetch = async (url) => {
    if (url.endsWith("/predictions")) {
      return new Response(
        JSON.stringify({ id: "pred_t", status: "starting" }),
        { status: 201 },
      );
    }
    return new Response(
      JSON.stringify({ id: "pred_t", status: "processing" }),
      { status: 200 },
    );
  };
  try {
    await assert.rejects(
      () =>
        fluxFresh.generate({
          prompt: "x",
          apiKey: "t",
          fetchFn: fakeFetch,
          sleepFn,
        }),
      (err) =>
        err instanceof fluxFresh.ImageGenerationError &&
        /timed out/i.test(err.message),
    );
  } finally {
    Date.now = realDateNow;
    delete process.env.FLUX_TIMEOUT_MS;
    delete require.cache[
      require.resolve("../../../src/services/image-providers/flux-image")
    ];
  }
});
