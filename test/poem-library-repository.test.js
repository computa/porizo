process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { afterEach, beforeEach, describe, test } = require("node:test");

const {
  createPoemLibraryRepository,
} = require("../src/database/poem-library-repository");
const { createSqliteAdapter } = require("../src/database/sqlite");

let db;
let repository;

function createSchema(database) {
  database.exec(`
    CREATE TABLE poems (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      recipient_name TEXT,
      occasion TEXT,
      tone TEXT,
      verses TEXT,
      message TEXT,
      status TEXT,
      funding_source TEXT,
      og_variant TEXT,
      audio_generated_at TEXT,
      deleted_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE poem_library_entries (
      user_id TEXT NOT NULL,
      poem_id TEXT NOT NULL,
      origin TEXT NOT NULL CHECK(origin IN ('created', 'received')),
      share_token_id TEXT,
      added_at TEXT NOT NULL,
      removed_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, poem_id)
    );
    CREATE TABLE entitlements (
      user_id TEXT PRIMARY KEY,
      poems_remaining INTEGER
    );
    CREATE TABLE gift_orders (
      id TEXT PRIMARY KEY,
      content_snapshot_json TEXT
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY
    );
  `);
}

async function seedPoem({
  id,
  userId,
  title,
  fundingSource = "standard",
  deletedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO poems (
        id,
        user_id,
        title,
        recipient_name,
        occasion,
        tone,
        verses,
        message,
        status,
        funding_source,
        og_variant,
        audio_generated_at,
        deleted_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      title,
      "Maya",
      "birthday",
      "heartfelt",
      JSON.stringify(["Line one"]),
      null,
      "generated",
      fundingSource,
      null,
      null,
      deletedAt,
      "2026-06-28T04:00:00.000Z",
      "2026-06-28T04:00:00.000Z",
    );
}

async function seedLibraryEntry({
  userId,
  poemId,
  origin,
  shareTokenId = null,
  addedAt,
  removedAt = null,
}) {
  await db
    .prepare(
      `INSERT INTO poem_library_entries (
        user_id,
        poem_id,
        origin,
        share_token_id,
        added_at,
        removed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, poemId, origin, shareTokenId, addedAt, removedAt, addedAt);
}

describe("PoemLibraryRepository", () => {
  beforeEach(() => {
    db = createSqliteAdapter({ dbPath: ":memory:" });
    createSchema(db);
    repository = createPoemLibraryRepository(db);
  });

  afterEach(async () => {
    await db.close?.();
  });

  test("listPoemsForUser returns active library rows ordered by added_at", async () => {
    await seedPoem({
      id: "poem_old",
      userId: "user_repo",
      title: "Old Poem",
    });
    await seedPoem({
      id: "poem_new",
      userId: "user_repo",
      title: "New Poem",
    });
    await seedPoem({
      id: "poem_other_user",
      userId: "other_user",
      title: "Other User Poem",
    });
    await seedPoem({
      id: "poem_deleted",
      userId: "user_repo",
      title: "Deleted Poem",
      deletedAt: "2026-06-28T04:30:00.000Z",
    });
    await seedPoem({
      id: "poem_gift_created",
      userId: "user_repo",
      title: "Gift Created Poem",
      fundingSource: "gift_token",
    });

    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_old",
      origin: "created",
      addedAt: "2026-06-28T04:01:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_new",
      origin: "created",
      addedAt: "2026-06-28T04:02:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_other_user",
      origin: "received",
      shareTokenId: "poem_share_repo",
      addedAt: "2026-06-28T04:03:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_deleted",
      origin: "created",
      addedAt: "2026-06-28T04:04:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_gift_created",
      origin: "created",
      addedAt: "2026-06-28T04:05:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_removed",
      origin: "created",
      addedAt: "2026-06-28T04:06:00.000Z",
      removedAt: "2026-06-28T04:07:00.000Z",
    });

    const rows = await repository.listPoemsForUser("user_repo");

    assert.deepEqual(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        library_origin: row.library_origin,
        library_share_token_id: row.library_share_token_id,
        can_edit: row.can_edit,
        can_share: row.can_share,
        can_delete: row.can_delete,
      })),
      [
        {
          id: "poem_other_user",
          title: "Other User Poem",
          library_origin: "received",
          library_share_token_id: "poem_share_repo",
          can_edit: 0,
          can_share: 0,
          can_delete: 1,
        },
        {
          id: "poem_new",
          title: "New Poem",
          library_origin: "created",
          library_share_token_id: null,
          can_edit: 1,
          can_share: 1,
          can_delete: 1,
        },
        {
          id: "poem_old",
          title: "Old Poem",
          library_origin: "created",
          library_share_token_id: null,
          can_edit: 1,
          can_share: 1,
          can_delete: 1,
        },
      ],
    );
  });

  test("getPoemForLibrary returns the same library row shape for one poem", async () => {
    await seedPoem({
      id: "poem_detail",
      userId: "other_user",
      title: "Shared Detail",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_detail",
      origin: "received",
      shareTokenId: "poem_share_detail",
      addedAt: "2026-06-28T04:10:00.000Z",
    });

    const row = await repository.getPoemForLibrary({
      userId: "user_repo",
      poemId: "poem_detail",
    });

    assert.deepEqual(
      {
        id: row.id,
        title: row.title,
        library_origin: row.library_origin,
        library_share_token_id: row.library_share_token_id,
        can_edit: row.can_edit,
        can_share: row.can_share,
        can_delete: row.can_delete,
      },
      {
        id: "poem_detail",
        title: "Shared Detail",
        library_origin: "received",
        library_share_token_id: "poem_share_detail",
        can_edit: 0,
        can_share: 0,
        can_delete: 1,
      },
    );
  });

  test("upsertPoemLibraryEntry restores removed entries without downgrading created ownership", async () => {
    await repository.upsertPoemLibraryEntry({
      userId: "user_repo",
      poemId: "poem_upsert",
      origin: "created",
      shareTokenId: null,
      addedAt: "2026-06-28T04:20:00.000Z",
    });
    await repository.removePoemFromLibrary({
      userId: "user_repo",
      poemId: "poem_upsert",
      removedAt: "2026-06-28T04:21:00.000Z",
    });
    await repository.upsertPoemLibraryEntry({
      userId: "user_repo",
      poemId: "poem_upsert",
      origin: "received",
      shareTokenId: "poem_share_upsert",
      addedAt: "2026-06-28T04:22:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT user_id, poem_id, origin, share_token_id, added_at, removed_at FROM poem_library_entries WHERE user_id = ? AND poem_id = ?",
      )
      .get("user_repo", "poem_upsert");

    assert.deepEqual(row, {
      user_id: "user_repo",
      poem_id: "poem_upsert",
      origin: "created",
      share_token_id: "poem_share_upsert",
      added_at: "2026-06-28T04:22:00.000Z",
      removed_at: null,
    });
  });

  test("createPoem and updatePoem persist route-owned poem fields", async () => {
    await repository.createPoem({
      id: "poem_created_repo",
      userId: "user_repo",
      title: "Draft Title",
      recipientName: "Maya",
      occasion: "birthday",
      tone: "heartfelt",
      versesJson: "[]",
      message: "Draft message",
      status: "draft",
      createdAt: "2026-06-28T07:00:00.000Z",
      updatedAt: "2026-06-28T07:00:00.000Z",
    });

    let row = await repository.getPoemById("poem_created_repo");
    assert.equal(row.title, "Draft Title");
    assert.equal(row.message, "Draft message");
    assert.equal(row.status, "draft");

    await repository.updatePoem({
      poemId: "poem_created_repo",
      title: "Updated Title",
      recipientName: "Ada",
      occasion: "anniversary",
      tone: "funny",
      message: "Updated message",
      versesJson: JSON.stringify(["Updated line"]),
      status: "published",
      updatedAt: "2026-06-28T07:01:00.000Z",
    });

    row = await repository.getLivePoemById("poem_created_repo");
    assert.equal(row.title, "Updated Title");
    assert.equal(row.recipient_name, "Ada");
    assert.equal(row.occasion, "anniversary");
    assert.equal(row.tone, "funny");
    assert.equal(row.message, "Updated message");
    assert.equal(row.verses, JSON.stringify(["Updated line"]));
    assert.equal(row.status, "published");
    assert.equal(row.updated_at, "2026-06-28T07:01:00.000Z");
  });

  test("generation, OG variant, and audio timestamp helpers update poem state", async () => {
    await seedPoem({
      id: "poem_generation_repo",
      userId: "user_repo",
      title: "Generation Poem",
    });

    await repository.markPoemGenerated({
      poemId: "poem_generation_repo",
      versesJson: JSON.stringify(["Generated line"]),
      updatedAt: "2026-06-28T08:00:00.000Z",
    });
    await repository.updatePoemOgVariant({
      poemId: "poem_generation_repo",
      variant: "whisper",
      updatedAt: "2026-06-28T08:01:00.000Z",
    });
    await repository.markPoemAudioGenerated({
      poemId: "poem_generation_repo",
      generatedAt: "2026-06-28T08:02:00.000Z",
    });

    let row = await repository.getPoemById("poem_generation_repo");
    assert.equal(row.status, "generated");
    assert.equal(row.verses, JSON.stringify(["Generated line"]));
    assert.equal(row.og_variant, "whisper");
    assert.equal(row.audio_generated_at, "2026-06-28T08:02:00.000Z");
    assert.equal(row.updated_at, "2026-06-28T08:02:00.000Z");

    await repository.markPoemGenerationFailed("poem_generation_repo");
    row = await repository.getPoemById("poem_generation_repo");
    assert.equal(row.status, "generation_failed");
  });

  test("lookup helpers return gift snapshots, credits, and user presence", async () => {
    await db
      .prepare(
        "INSERT INTO gift_orders (id, content_snapshot_json) VALUES (?, ?)",
      )
      .run("gift_repo", JSON.stringify({ title: "Gift Snapshot" }));
    await db
      .prepare(
        "INSERT INTO entitlements (user_id, poems_remaining) VALUES (?, ?)",
      )
      .run("user_repo", 3);
    await db.prepare("INSERT INTO users (id) VALUES (?)").run("user_repo");

    assert.deepEqual(
      await repository.getGiftOrderContentSnapshot("gift_repo"),
      {
        content_snapshot_json: JSON.stringify({ title: "Gift Snapshot" }),
      },
    );
    assert.deepEqual(await repository.getPoemCreditBalance("user_repo"), {
      poems_remaining: 3,
    });
    assert.deepEqual(await repository.getUserPresence("user_repo"), {
      id: "user_repo",
    });
  });

  test("removePoemFromLibrary marks only active entries removed", async () => {
    await seedPoem({
      id: "poem_remove",
      userId: "user_repo",
      title: "Remove Me",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_remove",
      origin: "created",
      addedAt: "2026-06-28T05:00:00.000Z",
    });

    await repository.removePoemFromLibrary({
      userId: "user_repo",
      poemId: "poem_remove",
      removedAt: "2026-06-28T05:01:00.000Z",
    });
    await repository.removePoemFromLibrary({
      userId: "user_repo",
      poemId: "poem_remove",
      removedAt: "2026-06-28T05:02:00.000Z",
    });

    const row = await db
      .prepare(
        "SELECT removed_at, updated_at FROM poem_library_entries WHERE user_id = ? AND poem_id = ?",
      )
      .get("user_repo", "poem_remove");

    assert.deepEqual(row, {
      removed_at: "2026-06-28T05:01:00.000Z",
      updated_at: "2026-06-28T05:01:00.000Z",
    });
  });

  test("getActivePoemLibraryEntry ignores removed entries", async () => {
    await seedPoem({
      id: "poem_active",
      userId: "user_repo",
      title: "Active Poem",
    });
    await seedPoem({
      id: "poem_removed",
      userId: "user_repo",
      title: "Removed Poem",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_active",
      origin: "created",
      addedAt: "2026-06-28T06:00:00.000Z",
    });
    await seedLibraryEntry({
      userId: "user_repo",
      poemId: "poem_removed",
      origin: "created",
      addedAt: "2026-06-28T06:00:00.000Z",
      removedAt: "2026-06-28T06:01:00.000Z",
    });

    assert.ok(
      await repository.getActivePoemLibraryEntry({
        userId: "user_repo",
        poemId: "poem_active",
      }),
    );
    assert.equal(
      await repository.getActivePoemLibraryEntry({
        userId: "user_repo",
        poemId: "poem_removed",
      }),
      undefined,
    );
  });
});
