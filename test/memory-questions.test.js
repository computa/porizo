/**
 * Memory Questions Service Tests
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  generateMemoryQuestions,
  parseQuestionsResponse,
  getDefaultQuestions,
} = require("../src/services/memory-questions");

describe("memory-questions", () => {
  describe("getDefaultQuestions", () => {
    it("returns 3 default questions with correct structure", () => {
      const questions = getDefaultQuestions();

      assert.equal(questions.length, 3);
      questions.forEach((q, index) => {
        assert.equal(q.id, `q${index + 1}`);
        assert.ok(typeof q.question === "string" && q.question.length > 0);
        assert.ok(typeof q.placeholder === "string");
      });
    });

    it("includes emotion, sensory, and resolution questions", () => {
      const questions = getDefaultQuestions();

      // First question should be about feelings/emotion
      assert.ok(questions[0].question.toLowerCase().includes("feeling"));

      // Second about sensory/vivid details
      assert.ok(
        questions[1].question.toLowerCase().includes("remember") ||
          questions[1].question.toLowerCase().includes("detail")
      );

      // Third about resolution/ending
      assert.ok(
        questions[2].question.toLowerCase().includes("end") ||
          questions[2].question.toLowerCase().includes("moment")
      );
    });
  });

  describe("parseQuestionsResponse", () => {
    it("parses valid JSON response", () => {
      const text = JSON.stringify({
        questions: [
          { id: "q1", question: "What were you feeling?", placeholder: "e.g., happy" },
          { id: "q2", question: "What did you see?", placeholder: "e.g., sunset" },
        ],
      });

      const result = parseQuestionsResponse(text);

      assert.equal(result.questions.length, 2);
      assert.equal(result.questions[0].question, "What were you feeling?");
      assert.equal(result.questions[1].placeholder, "e.g., sunset");
    });

    it("extracts JSON from mixed text", () => {
      const text = `Here are some questions:\n{"questions": [{"id": "q1", "question": "How did it feel?", "placeholder": "..."}]}\nThat should help.`;

      const result = parseQuestionsResponse(text);

      assert.equal(result.questions.length, 1);
      assert.equal(result.questions[0].question, "How did it feel?");
    });

    it("returns defaults for empty input", () => {
      const result = parseQuestionsResponse("");
      const defaults = getDefaultQuestions();

      assert.equal(result.questions.length, defaults.length);
    });

    it("returns defaults for null input", () => {
      const result = parseQuestionsResponse(null);
      const defaults = getDefaultQuestions();

      assert.equal(result.questions.length, defaults.length);
    });

    it("returns defaults for invalid JSON", () => {
      const result = parseQuestionsResponse("not valid json at all");
      const defaults = getDefaultQuestions();

      assert.equal(result.questions.length, defaults.length);
    });

    it("returns defaults for empty questions array", () => {
      const text = JSON.stringify({ questions: [] });

      const result = parseQuestionsResponse(text);
      const defaults = getDefaultQuestions();

      assert.equal(result.questions.length, defaults.length);
    });

    it("limits to 3 questions max", () => {
      const text = JSON.stringify({
        questions: [
          { id: "q1", question: "Q1?" },
          { id: "q2", question: "Q2?" },
          { id: "q3", question: "Q3?" },
          { id: "q4", question: "Q4?" },
          { id: "q5", question: "Q5?" },
        ],
      });

      const result = parseQuestionsResponse(text);

      assert.equal(result.questions.length, 3);
    });

    it("filters out invalid questions", () => {
      const text = JSON.stringify({
        questions: [
          { id: "q1", question: "Valid question?" },
          { id: "q2" }, // missing question
          { id: "q3", question: "" }, // empty question
          { id: "q4", question: "Another valid one?" },
        ],
      });

      const result = parseQuestionsResponse(text);

      assert.equal(result.questions.length, 2);
      assert.equal(result.questions[0].question, "Valid question?");
      assert.equal(result.questions[1].question, "Another valid one?");
    });

    it("generates missing IDs", () => {
      const text = JSON.stringify({
        questions: [
          { question: "No ID question 1?" },
          { question: "No ID question 2?" },
        ],
      });

      const result = parseQuestionsResponse(text);

      assert.equal(result.questions[0].id, "q1");
      assert.equal(result.questions[1].id, "q2");
    });

    it("handles missing placeholder", () => {
      const text = JSON.stringify({
        questions: [{ id: "q1", question: "No placeholder?" }],
      });

      const result = parseQuestionsResponse(text);

      assert.equal(result.questions[0].placeholder, "");
    });
  });

  describe("generateMemoryQuestions", () => {
    it("throws for memory shorter than 5 characters", async () => {
      await assert.rejects(
        async () => {
          await generateMemoryQuestions({
            memory: "hi",
            occasion: "birthday",
            recipientName: "Mom",
          });
        },
        { message: /at least 5 characters/ }
      );
    });

    it("throws for empty memory", async () => {
      await assert.rejects(
        async () => {
          await generateMemoryQuestions({
            memory: "",
            occasion: "birthday",
            recipientName: "Mom",
          });
        },
        { message: /at least 5 characters/ }
      );
    });

    it("throws for null memory", async () => {
      await assert.rejects(
        async () => {
          await generateMemoryQuestions({
            memory: null,
            occasion: "birthday",
            recipientName: "Mom",
          });
        },
        { message: /at least 5 characters/ }
      );
    });

    // Integration test - requires API keys
    it("generates questions for valid memory (integration)", async function () {
      // Skip if no API key configured
      if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
        console.log("Skipping integration test - no API keys configured");
        return;
      }

      const result = await generateMemoryQuestions({
        memory: "The night we danced in the rain in Paris",
        occasion: "anniversary",
        recipientName: "Sarah",
      });

      assert.ok(Array.isArray(result.questions));
      assert.ok(result.questions.length >= 2);
      assert.ok(result.questions.length <= 3);

      result.questions.forEach((q) => {
        assert.ok(typeof q.id === "string");
        assert.ok(typeof q.question === "string");
        assert.ok(q.question.endsWith("?"));
      });

      assert.ok(result.meta);
      assert.ok(result.meta.provider);
    });

    it("handles optional parameters gracefully (integration)", async function () {
      if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
        console.log("Skipping integration test - no API keys configured");
        return;
      }

      // Test with minimal parameters
      const result = await generateMemoryQuestions({
        memory: "When she held my hand at the hospital",
      });

      assert.ok(Array.isArray(result.questions));
      assert.ok(result.questions.length >= 2);
    });
  });
});
