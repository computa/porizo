const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("root scripts build the web funnel before integrated development", () => {
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(
    packageJson.scripts["web-funnel:build"],
    "npm --prefix web-funnel run build",
  );
  assert.equal(packageJson.scripts.predev, "npm run web-funnel:build");

  const serverSource = read("src/server.js");
  assert.match(serverSource, /REQUIRE_WEB_FUNNEL_BUILD:\s*true/);
});

test("Docker builds the funnel and keeps only dist in the runtime subtree", () => {
  const dockerfile = read("Dockerfile");
  const dockerignore = read(".dockerignore");

  assert.match(dockerfile, /FROM node:20\.19-slim AS web-funnel-builder/);
  assert.equal(
    dockerfile.match(/FROM node:20\.19-slim/g)?.length,
    2,
    "builder and runtime must use the same Vite-compatible Node release",
  );
  assert.match(dockerfile, /COPY web-funnel\/package\*\.json \.\/web-funnel\//);
  assert.match(dockerfile, /RUN npm ci --prefix web-funnel/);
  assert.match(dockerfile, /COPY public\/styles\/main\.css \.\/public\/styles\/main\.css/);
  assert.match(dockerfile, /RUN npm --prefix web-funnel run build/);
  assert.match(dockerfile, /RUN rm -rf web-funnel/);
  assert.match(
    dockerfile,
    /COPY --from=web-funnel-builder \/app\/web-funnel\/dist \.\/web-funnel\/dist/,
  );
  for (const generatedPath of [
    "web-funnel/*.tsbuildinfo",
    "web-funnel/vite.config.js",
    "web-funnel/vite.config.d.ts",
  ]) {
    assert.ok(
      dockerignore.split(/\r?\n/).includes(generatedPath),
      `${generatedPath} must be excluded from Docker build context`,
    );
  }
});

test("production funnel build does not expose browser source maps", () => {
  const viteConfig = read("web-funnel/vite.config.ts");
  assert.doesNotMatch(viteConfig, /sourcemap:\s*true/);
});
