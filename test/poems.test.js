/**
 * Poems API Test Suite
 *
 * Tests the full CRUD lifecycle for personalized poems:
 * - POST /poems (create)
 * - GET /poems (list)
 * - GET /poems/:id (detail)
 * - PUT /poems/:id (update)
 * - DELETE /poems/:id (soft delete)
 */

require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after, before, describe } = require("node:test");
const { initDb } = require("../src/db");
const { buildServer } = require("../src/server");
const { createStorageProvider } = require("../src/storage");

let storageDir;
let db;
let app;
let config;
let storage;

const TEST_USER_ID = "test-user-poems-001";
const OTHER_USER_ID = "test-user-poems-002";

before(async () => {
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "porizo-poems-"));
  config = {
    PREVIEW_ONLY: false,
    STREAM_BASE_URL: "http://stream.local",
    STORAGE_DIR: storageDir,
    STORAGE_PROVIDER: "local",
    UPLOAD_SIGNING_SECRET: "test-upload-secret",
    UPLOAD_URL_TTL_SEC: 900,
  };
  db = await initDb({ dbPath: ":memory:", migrationsDir: path.join(process.cwd(), "migrations") });
  storage = createStorageProvider(config);
  app = buildServer({ db, config, storage });
});

after(async () => {
  await app.close();
  db.close();
});

describe("Poems API", () => {
  let createdPoemId;

  test("POST /poems - creates a poem successfully", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/poems",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        title: "Birthday Poem",
        recipient_name: "Sarah",
        occasion: "birthday",
        tone: "heartfelt",
        message: "You mean the world to me",
      },
    });

    assert.equal(response.statusCode, 201, `Expected 201, got ${response.statusCode}: ${response.body}`);
    const poem = response.json();

    assert.ok(poem.id, "Should return poem ID");
    assert.equal(poem.title, "Birthday Poem");
    assert.equal(poem.recipient_name, "Sarah");
    assert.equal(poem.occasion, "birthday");
    assert.equal(poem.tone, "heartfelt");
    assert.equal(poem.status, "draft");
    assert.ok(poem.created_at, "Should have created_at timestamp");

    createdPoemId = poem.id;
  });

  test("POST /poems - requires authentication", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/poems",
      payload: {
        title: "Test Poem",
        recipient_name: "Test",
        occasion: "birthday",
      },
    });

    assert.equal(response.statusCode, 401);
  });

  test("POST /poems - validates required fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/poems",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        title: "Test Poem",
        // Missing recipient_name and occasion
      },
    });

    assert.equal(response.statusCode, 400);
  });

  test("GET /poems - lists user's poems", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/poems",
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(response.statusCode, 200);
    const data = response.json();

    assert.ok(Array.isArray(data.poems), "Should return poems array");
    assert.ok(data.poems.length >= 1, "Should have at least one poem");

    const poem = data.poems.find(p => p.id === createdPoemId);
    assert.ok(poem, "Should find the created poem");
  });

  test("GET /poems - only returns current user's poems", async () => {
    // Create a poem for another user
    await app.inject({
      method: "POST",
      url: "/poems",
      headers: { "x-user-id": OTHER_USER_ID },
      payload: {
        title: "Other User's Poem",
        recipient_name: "Other",
        occasion: "anniversary",
      },
    });

    // Get poems for original user
    const response = await app.inject({
      method: "GET",
      url: "/poems",
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(response.statusCode, 200);
    const data = response.json();

    // Verify no poems from other user
    const otherUsersPoems = data.poems.filter(p => p.title === "Other User's Poem");
    assert.equal(otherUsersPoems.length, 0, "Should not see other user's poems");
  });

  test("GET /poems/:id - retrieves specific poem", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/poems/${createdPoemId}`,
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(response.statusCode, 200);
    const data = response.json();

    assert.equal(data.poem.id, createdPoemId);
    assert.equal(data.poem.title, "Birthday Poem");
    assert.equal(data.poem.recipient_name, "Sarah");
  });

  test("GET /poems/:id - returns 404 for non-existent poem", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/poems/non-existent-id",
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(response.statusCode, 404);
  });

  test("GET /poems/:id - cannot access other user's poem", async () => {
    // Create poem as other user
    const createResponse = await app.inject({
      method: "POST",
      url: "/poems",
      headers: { "x-user-id": OTHER_USER_ID },
      payload: {
        title: "Private Poem",
        recipient_name: "Private",
        occasion: "birthday",
      },
    });
    const otherPoemId = createResponse.json().id;

    // Try to access as original user
    const response = await app.inject({
      method: "GET",
      url: `/poems/${otherPoemId}`,
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(response.statusCode, 404, "Should not find other user's poem");
  });

  test("PUT /poems/:id - updates poem", async () => {
    const response = await app.inject({
      method: "PUT",
      url: `/poems/${createdPoemId}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        title: "Updated Birthday Poem",
        tone: "funny",
      },
    });

    assert.equal(response.statusCode, 200);
    const data = response.json();

    assert.equal(data.poem.title, "Updated Birthday Poem");
    assert.equal(data.poem.tone, "funny");
    // Should preserve unchanged fields
    assert.equal(data.poem.recipient_name, "Sarah");
  });

  test("PUT /poems/:id - cannot update other user's poem", async () => {
    // Get the other user's poem ID
    const listResponse = await app.inject({
      method: "GET",
      url: "/poems",
      headers: { "x-user-id": OTHER_USER_ID },
    });
    const otherPoemId = listResponse.json().poems[0].id;

    // Try to update as different user
    const response = await app.inject({
      method: "PUT",
      url: `/poems/${otherPoemId}`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { title: "Hacked!" },
    });

    assert.equal(response.statusCode, 404);
  });

  test("DELETE /poems/:id - soft deletes poem", async () => {
    // Create a poem to delete
    const createResponse = await app.inject({
      method: "POST",
      url: "/poems",
      headers: { "x-user-id": TEST_USER_ID },
      payload: {
        title: "Poem to Delete",
        recipient_name: "Delete Me",
        occasion: "birthday",
      },
    });
    const poemToDelete = createResponse.json().id;

    // Delete it
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/poems/${poemToDelete}`,
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(deleteResponse.statusCode, 200);

    // Verify it's not in list
    const listResponse = await app.inject({
      method: "GET",
      url: "/poems",
      headers: { "x-user-id": TEST_USER_ID },
    });
    const deletedPoem = listResponse.json().poems.find(p => p.id === poemToDelete);
    assert.equal(deletedPoem, undefined, "Deleted poem should not appear in list");

    // Verify direct access returns 404
    const getResponse = await app.inject({
      method: "GET",
      url: `/poems/${poemToDelete}`,
      headers: { "x-user-id": TEST_USER_ID },
    });
    assert.equal(getResponse.statusCode, 404);
  });

  test("DELETE /poems/:id - cannot delete other user's poem", async () => {
    const listResponse = await app.inject({
      method: "GET",
      url: "/poems",
      headers: { "x-user-id": OTHER_USER_ID },
    });
    const poems = listResponse.json().poems;
    if (poems.length === 0) {
      // Create one if none exist
      await app.inject({
        method: "POST",
        url: "/poems",
        headers: { "x-user-id": OTHER_USER_ID },
        payload: {
          title: "Other Poem",
          recipient_name: "Other",
          occasion: "birthday",
        },
      });
    }

    const listResponse2 = await app.inject({
      method: "GET",
      url: "/poems",
      headers: { "x-user-id": OTHER_USER_ID },
    });
    const otherPoemId = listResponse2.json().poems[0].id;

    // Try to delete as different user
    const response = await app.inject({
      method: "DELETE",
      url: `/poems/${otherPoemId}`,
      headers: { "x-user-id": TEST_USER_ID },
    });

    assert.equal(response.statusCode, 404);
  });
});
