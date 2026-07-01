const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createArtworkBarrierRepository,
  SQL_CHECK_ARTWORK_READY,
  SQL_NOTIFY_ARTWORK_READY,
  rowIsTrue,
} = require("../src/database/artwork-barrier-repository");

test("ArtworkBarrierRepository reads artwork readiness with normalized booleans", async () => {
  const values = [true, 1, "1", "t", "true"];
  for (const value of values) {
    const calls = [];
    const repository = createArtworkBarrierRepository({
      prepare(sql) {
        calls.push(sql);
        return {
          async get(trackVersionId) {
            assert.equal(trackVersionId, "tv_ready");
            return { artwork_ready: value };
          },
        };
      },
    });

    assert.equal(await repository.isArtworkReady("tv_ready"), true);
    assert.deepEqual(calls, [SQL_CHECK_ARTWORK_READY]);
  }

  assert.equal(rowIsTrue(false), false);
  assert.equal(rowIsTrue(0), false);
  assert.equal(rowIsTrue("false"), false);
});

test("ArtworkBarrierRepository returns false for missing artwork rows", async () => {
  const repository = createArtworkBarrierRepository({
    prepare() {
      return {
        async get() {
          return null;
        },
      };
    },
  });

  assert.equal(await repository.isArtworkReady("tv_missing"), false);
});

test("ArtworkBarrierRepository issues pg_notify with string payload", async () => {
  let captured = null;
  const repository = createArtworkBarrierRepository({
    prepare(sql) {
      return {
        async get(payload) {
          captured = { sql, payload };
          return { notified: 1 };
        },
      };
    },
  });

  await repository.notifyArtworkReady(12345);

  assert.equal(captured.sql, SQL_NOTIFY_ARTWORK_READY);
  assert.equal(captured.payload, "12345");
});
