process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const {
  createFastifyApp,
  registerFormUrlEncodedParser,
  registerStaticAndSecurityBootstrap,
} = require("../src/plugins/http-bootstrap");

let app = null;
const temporaryDirectories = [];

afterEach(async () => {
  await app?.close();
  app = null;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function restoreEnv(name, previous) {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}

function buildBootstrappedApp(options = {}) {
  app = createFastifyApp();
  registerFormUrlEncodedParser(app);
  registerStaticAndSecurityBootstrap(app, {
    enableDebugRoutes: false,
    ...options,
  });
  return app;
}

function createWebFunnelFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-web-funnel-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, "assets"));
  fs.mkdirSync(path.join(root, "fonts"));
  fs.mkdirSync(path.join(root, "audio"));
  fs.writeFileSync(
    path.join(root, "index.html"),
    "<!doctype html><html><body><main>Who\u2019s this song for?</main></body></html>",
  );
  fs.writeFileSync(
    path.join(root, "assets", "app-a1b2c3d4.js"),
    "window.PORIZO = true;",
  );
  fs.writeFileSync(
    path.join(root, "fonts", "brand.woff2"),
    Buffer.from("font-fixture"),
  );
  fs.writeFileSync(
    path.join(root, "audio", "preview.mp3"),
    Buffer.from("audio-fixture"),
  );
  return root;
}

async function assertWebFunnelContract({ enableDebugRoutes }) {
  const webFunnelRoot = createWebFunnelFixture();
  buildBootstrappedApp({
    enableDebugRoutes,
    webFunnelRoot,
    requireWebFunnelBuild: true,
  });
  if (enableDebugRoutes) {
    // Landing/legal routes own non-debug files in public/. Registering one
    // here reproduces the route ownership used by the complete server.
    app.get("/apple-touch-icon.png", async (_request, reply) =>
      reply.type("image/png").send(Buffer.from("icon-fixture")),
    );
  }

  for (const url of [
    "/create",
    "/create/",
    "/create?occasion=Birthday",
    "/create/success?session_id=a.b",
    "/create/success/",
    // The Etsy fulfilment landing shares the funnel SPA shell.
    "/etsy",
    "/etsy/",
    "/etsy?code=PZ-ABCD-2345",
  ]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200, url);
    assert.match(response.headers["content-type"], /text\/html/, url);
    assert.match(response.body, /Who\u2019s this song for\?/, url);
    assert.equal(
      response.headers["cache-control"],
      "public, max-age=0, must-revalidate",
      url,
    );
  }

  const script = await app.inject({
    method: "GET",
    url: "/create/assets/app-a1b2c3d4.js?cache=1",
  });
  assert.equal(script.statusCode, 200);
  assert.match(script.headers["content-type"], /javascript/);
  assert.equal(script.body, "window.PORIZO = true;");
  assert.equal(
    script.headers["cache-control"],
    "public, max-age=31536000, immutable",
  );

  for (const [url, type] of [
    ["/create/fonts/brand.woff2", /font\/woff2/],
    ["/create/audio/preview.mp3?cache=1", /audio\/mpeg/],
  ]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 200, url);
    assert.match(response.headers["content-type"], type, url);
    assert.equal(
      response.headers["cache-control"],
      "public, max-age=300, must-revalidate",
      url,
    );
  }

  for (const url of [
    "/create/assets/missing",
    "/create/assets/missing.js",
    "/create/fonts/missing",
    "/create/audio/missing",
    "/create/unknown",
  ]) {
    const response = await app.inject({ method: "GET", url });
    assert.equal(response.statusCode, 404, url);
    assert.doesNotMatch(response.body, /Who\u2019s this song for\?/, url);
  }

  const post = await app.inject({ method: "POST", url: "/create/success" });
  assert.equal(post.statusCode, 404);

  for (const url of ["/create", "/create/assets/app-a1b2c3d4.js"]) {
    const response = await app.inject({ method: "HEAD", url });
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.body, "", url);
  }

  const player = await app.inject({
    method: "GET",
    url: "/web-player/index.html",
  });
  assert.equal(player.statusCode, 200);
  if (enableDebugRoutes) {
    const debug = await app.inject({ method: "GET", url: "/debug-og.html" });
    assert.equal(debug.statusCode, 200);
    const icon = await app.inject({
      method: "GET",
      url: "/apple-touch-icon.png",
    });
    assert.equal(icon.statusCode, 200);
    assert.equal(icon.body, "icon-fixture");
  }
}

test("HTTP bootstrap serves the web funnel from the main origin", async () => {
  await assertWebFunnelContract({ enableDebugRoutes: false });
});

test("debug static routes do not shadow the web funnel", async () => {
  await assertWebFunnelContract({ enableDebugRoutes: true });
});

test("web funnel serving is independent of process cwd", async () => {
  const webFunnelRoot = createWebFunnelFixture();
  const previousCwd = process.cwd();
  process.chdir(os.tmpdir());
  try {
    buildBootstrappedApp({ webFunnelRoot, requireWebFunnelBuild: true });
    const response = await app.inject({ method: "GET", url: "/create/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /Who\u2019s this song for\?/);
  } finally {
    process.chdir(previousCwd);
  }
});

test("required web funnel build fails startup with a recovery command", () => {
  const missingRoot = path.join(os.tmpdir(), "porizo-missing-web-funnel");
  app = createFastifyApp();
  assert.throws(
    () =>
      registerStaticAndSecurityBootstrap(app, {
        enableDebugRoutes: false,
        webFunnelRoot: missingRoot,
        requireWebFunnelBuild: true,
      }),
    /npm run web-funnel:build/,
  );
});

test("HTTP bootstrap serves static assets independent of process cwd", async () => {
  const previousCwd = process.cwd();
  process.chdir(os.tmpdir());
  try {
    buildBootstrappedApp();

    const response = await app.inject({
      method: "GET",
      url: "/web-player/index.html",
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /text\/html/);
    assert.match(response.body, /html/i);
  } finally {
    process.chdir(previousCwd);
  }
});

test("HTTP bootstrap serves Apple App Site Association as JSON", async () => {
  buildBootstrappedApp();

  const response = await app.inject({
    method: "GET",
    url: "/.well-known/apple-app-site-association",
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.equal(
    response.json().applinks.details[0].appID,
    "5VCH6937XM.porizo.ios.app.PorizoApp",
  );
  assert.deepEqual(response.json().applinks.details[0].paths, [
    "/play/*",
    "/s/*",
    "/poem/*",
    "/create*",
    "/verify-email*",
    "/auth/magic/ios*",
  ]);
  assert.deepEqual(response.json().appclips.apps, [
    "5VCH6937XM.porizo.ios.app.PorizoApp.Clip",
  ]);
  assert.deepEqual(
    response.json(),
    JSON.parse(
      fs.readFileSync("public/.well-known/apple-app-site-association", "utf8"),
    ),
  );
});

test("HTTP bootstrap applies CORS and Helmet headers", async () => {
  const previousCorsOrigin = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = "https://app.porizo.co";
  try {
    buildBootstrappedApp();
    app.get("/bootstrap-ok", async () => ({ ok: true }));

    const response = await app.inject({
      method: "GET",
      url: "/bootstrap-ok",
      headers: { origin: "https://app.porizo.co" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["access-control-allow-origin"],
      "https://app.porizo.co",
    );
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(
      response.headers["cross-origin-resource-policy"],
      "cross-origin",
    );
  } finally {
    restoreEnv("CORS_ORIGIN", previousCorsOrigin);
  }
});

test("HTTP bootstrap fails production startup when CORS_ORIGIN is missing", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCorsOrigin = process.env.CORS_ORIGIN;
  process.env.NODE_ENV = "production";
  delete process.env.CORS_ORIGIN;
  try {
    app = createFastifyApp();
    assert.throws(
      () =>
        registerStaticAndSecurityBootstrap(app, { enableDebugRoutes: false }),
      /CORS_ORIGIN must be set in production/,
    );
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    restoreEnv("CORS_ORIGIN", previousCorsOrigin);
  }
});

test("HTTP bootstrap parses form-url-encoded bodies", async () => {
  buildBootstrappedApp();
  app.post("/form-test", async (request) => request.body);

  const response = await app.inject({
    method: "POST",
    url: "/form-test",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "first=Ana&message=hello+world",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    first: "Ana",
    message: "hello world",
  });
});

test("HTTP bootstrap accepts audio/wav request bodies as buffers", async () => {
  buildBootstrappedApp();
  app.post("/audio-test", async (request) => ({
    isBuffer: Buffer.isBuffer(request.body),
    length: request.body.length,
  }));

  const payload = Buffer.from("RIFFtestWAVE");
  const response = await app.inject({
    method: "POST",
    url: "/audio-test",
    headers: { "content-type": "audio/wav" },
    payload,
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    isBuffer: true,
    length: payload.length,
  });
});

test("HTTP bootstrap rejects JSON bodies over the 1MB app limit", async () => {
  buildBootstrappedApp();
  app.post("/json-test", async (request) => request.body);

  const response = await app.inject({
    method: "POST",
    url: "/json-test",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ value: "x".repeat(1024 * 1024) }),
  });

  assert.equal(response.statusCode, 413);
});

test("HTTP bootstrap multipart file uploads are not capped by the JSON body limit", async () => {
  buildBootstrappedApp();
  app.post("/multipart-test", async (request) => {
    const part = await request.file();
    const chunks = [];
    for await (const chunk of part.file) {
      chunks.push(chunk);
    }
    return { size: Buffer.concat(chunks).length };
  });

  const boundary = "----porizo-http-bootstrap-test";
  const file = Buffer.alloc(2 * 1024 * 1024, 0x61);
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ),
    file,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const response = await app.inject({
    method: "POST",
    url: "/multipart-test",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().size, file.length);
});
