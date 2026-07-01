process.env.NODE_ENV = "test";

const assert = require("node:assert/strict");
const { describe, test } = require("node:test");

const { createBlogRepository } = require("../src/database/blog-repository");

describe("BlogRepository", () => {
  test("transaction-scoped repository uses the transaction query adapter", async () => {
    const calls = [];
    const post = {
      id: "post_txn",
      slug: "transaction-post",
      title: "Transaction post",
      excerpt: "Transaction post excerpt.",
      answer_summary: "Transaction post summary.",
      target_query: "transaction post",
      target_intent: "informational",
      primary_keyword: "transaction post",
      hero_image_url: null,
      body_markdown: "Transaction body.",
      tags_json: "[]",
      author_name: "Porizo",
      status: "draft",
      review_status: "approved",
      review_report_json: null,
    };

    const db = {
      isPostgres: true,
      transaction: async (callback) => callback(async (sql, params = []) => {
        calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
        if (/FOR UPDATE/.test(sql)) {
          return { rows: [post], rowCount: 1 };
        }
        if (/MAX\(revision_number\)/.test(sql)) {
          return { rows: [{ max_revision: 2 }], rowCount: 1 };
        }
        if (/blog_review_runs/.test(sql)) {
          return { rows: [], rowCount: 1 };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
      prepare: () => {
        throw new Error("outer prepare should not be used inside transaction");
      },
    };

    const repository = createBlogRepository(db);
    const result = await repository.transaction(async (transactionRepository) => {
      const locked = await transactionRepository.findRawPostByIdForUpdate("post_txn");
      const revisionNumber = await transactionRepository.getNextRevisionNumber("post_txn");
      await transactionRepository.createReviewRun({
        id: "review_run_txn",
        postId: "post_txn",
        revisionNumber: 2,
        report: {
          decision: "approved",
          overallScore: 99,
          seoScore: 98,
          geoScore: 97,
          aeoScore: 96,
        },
        reportJson: "{}",
        createdBy: "reviewer",
        now: "2026-06-26T00:00:00.000Z",
      });
      return { locked, revisionNumber };
    });

    assert.equal(result.locked.id, "post_txn");
    assert.equal(result.revisionNumber, 3);
    assert.equal(calls.length, 3);
    assert.match(calls[0].sql, /FOR UPDATE$/);
    assert.deepEqual(calls[0].params, ["post_txn"]);
    assert.deepEqual(calls[1].params, ["post_txn"]);
    assert.deepEqual(calls[2].params.slice(0, 3), [
      "review_run_txn",
      "post_txn",
      2,
    ]);
  });
});
