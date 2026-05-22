require("dotenv/config");
process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, beforeEach, describe, test } = require("node:test");

const { getDatabase } = require("../src/database");
const { buildServer } = require("../src/server");

function createStorageStub() {
  return {
    put: async () => {},
    get: async () => null,
    exists: async () => false,
    delete: async () => {},
    getSignedUrl: async (key) => `http://localhost/${key}`,
  };
}

describe("marketing SEO acquisition pages", () => {
  let db;
  let app;

  beforeEach(async () => {
    db = await getDatabase({
      provider: "sqlite",
      dbPath: ":memory:",
      migrationsDir: path.join(process.cwd(), "migrations"),
    });
    app = buildServer({
      db,
      config: { STORAGE_DIR: "/tmp/test-storage" },
      storage: createStorageStub(),
    });
  });

  afterEach(async () => {
    await app.close();
    await db.close?.();
  });

  test("occasion landing pages are routable and link to attributed downloads", async () => {
    const pages = [
      ["/mothers-day-song", "Create a Mother's Day song", "mothers_day_song"],
      ["/birthday-song-maker", "Create a birthday song", "birthday_song"],
      ["/anniversary-song-gift", "Create an anniversary song", "anniversary_song"],
      ["/custom-song-gift", "Create a custom song", "custom_song_gift"],
    ];

    for (const [url, cta, campaign] of pages) {
      const response = await app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 200, `${url} should be routable`);
      assert.match(response.headers["content-type"], /text\/html/);
      assert.match(response.body, new RegExp(cta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(response.body, new RegExp(`utm_campaign=${campaign}`));
      assert.match(response.body, /<link rel="canonical"/);
    }
  });

  test("homepage exposes app-install affordances with attributed organic links", async () => {
    const response = await app.inject({ method: "GET", url: "/" });
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<title>Personalized Song Gift Maker/);
    assert.match(response.body, /name="apple-itunes-app"/);
    assert.match(response.body, /app-id=6758205028/);
    assert.match(response.body, /utm_medium=homepage/);
    assert.match(response.body, /utm_campaign=organic_web/);
  });

  test("programmatic gift collection and pages are routable with crawl-safe structure", async () => {
    const collectionRequests = [
      { url: "/gifts", headers: { accept: "text/html" } },
      { url: "/gifts/" },
    ];

    for (const request of collectionRequests) {
      const response = await app.inject({ method: "GET", ...request });
      const url = request.url;
      assert.equal(response.statusCode, 200, `${url} should be routable`);
      assert.match(response.body, /Personalized Song Gift Ideas/);
      assert.match(response.body, /"@type": "CollectionPage"/);
      assert.match(response.body, /https:\/\/porizo\.co\/gifts\/fathers-day-song-for-dad/);
      assert.match(response.body, /name="apple-itunes-app"/);
      assert.match(response.body, /utm_campaign=gifts_index/);
    }

    const page = await app.inject({
      method: "GET",
      url: "/gifts/fathers-day-song-for-dad",
    });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Father&#39;s Day|Father's Day/);
    assert.match(page.body, /https:\/\/porizo\.co\/gifts\//);
    assert.match(page.body, /name="apple-itunes-app"/);
    assert.match(page.body, /utm_campaign=fathers_day_for_dad/);
  });

  test("sitemap includes occasion acquisition pages", async () => {
    const response = await app.inject({ method: "GET", url: "/sitemap.xml" });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /application\/xml/);
    assert.match(response.body, /https:\/\/porizo\.co\/mothers-day-song/);
    assert.match(response.body, /https:\/\/porizo\.co\/birthday-song-maker/);
    assert.match(response.body, /https:\/\/porizo\.co\/anniversary-song-gift/);
    assert.match(response.body, /https:\/\/porizo\.co\/custom-song-gift/);
    assert.match(response.body, /https:\/\/porizo\.co\/gifts\//);
    assert.match(response.body, /https:\/\/porizo\.co\/gifts\/fathers-day-song-for-dad/);
  });
});
