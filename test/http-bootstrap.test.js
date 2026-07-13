process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const { afterEach, test } = require("node:test");

const {
  createFastifyApp,
  registerFormUrlEncodedParser,
  registerStaticAndSecurityBootstrap,
} = require("../src/plugins/http-bootstrap");

let app = null;

afterEach(async () => {
  await app?.close();
  app = null;
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
    assert.equal(response.headers["access-control-allow-origin"], "https://app.porizo.co");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["cross-origin-resource-policy"], "cross-origin");
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
      () => registerStaticAndSecurityBootstrap(app, { enableDebugRoutes: false }),
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
