"use strict";

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n");
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^@\[(youtube|audio)(?:\s+[^\]]+)?\]\([^)]+\)$/gim, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(value) {
  return stripMarkdown(value).split(/\s+/).filter(Boolean).length;
}

function slugifyFragment(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isStructuredBlock(block) {
  return (
    /^@\[(youtube|audio)(?:\s+[^\]]+)?\]\([^)]+\)$/i.test(block) ||
    /^#{1,6}\s+/.test(block) ||
    /^>\s?/.test(block) ||
    /^[-*]\s+/.test(block) ||
    /^\d+\.\s+/.test(block) ||
    /^!\[/.test(block) ||
    /^\|/.test(block) ||
    /^-{3,}$/.test(block) ||
    /^```/.test(block)
  );
}

function splitIntoBlocks(markdown) {
  const lines = normalizeWhitespace(markdown).split("\n");
  const blocks = [];
  let current = [];
  let inCodeFence = false;

  function pushCurrent() {
    if (current.length === 0) return;
    blocks.push(current.join("\n").trim());
    current = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      current.push(line);
      inCodeFence = !inCodeFence;
      continue;
    }

    if (!inCodeFence && trimmed === "") {
      pushCurrent();
      continue;
    }

    current.push(line);
  }

  pushCurrent();
  return blocks.filter(Boolean);
}

function splitSentenceFragments(sentence) {
  const fragments = sentence
    .split(/(?<=[;:])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return fragments.length > 1 ? fragments : [sentence.trim()];
}

function splitParagraphIntoReadableChunks(paragraph, { targetWords = 42, maxWords = 55 } = {}) {
  const normalized = paragraph.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  if (countWords(normalized) <= maxWords) return [normalized];

  const sentences = normalized
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .flatMap((sentence) => (countWords(sentence) > maxWords ? splitSentenceFragments(sentence) : [sentence]));

  const chunks = [];
  let current = "";
  let currentWords = 0;

  for (const sentence of sentences) {
    const sentenceWords = countWords(sentence);
    if (!current) {
      current = sentence;
      currentWords = sentenceWords;
      continue;
    }

    if (currentWords + sentenceWords > maxWords && currentWords >= Math.max(20, Math.floor(targetWords * 0.7))) {
      chunks.push(current);
      current = sentence;
      currentWords = sentenceWords;
      continue;
    }

    current = `${current} ${sentence}`;
    currentWords += sentenceWords;
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [normalized];
}

function autoFormatArticleMarkdown(markdown) {
  const blocks = splitIntoBlocks(markdown);
  const formattedBlocks = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const firstLine = lines[0]?.trim() || "";
    if (/^#{1,6}\s+/.test(firstLine) && lines.length > 1) {
      formattedBlocks.push(firstLine);
      const remainder = lines
        .slice(1)
        .join("\n")
        .trim();
      if (remainder) {
        if (isStructuredBlock(remainder)) {
          formattedBlocks.push(remainder);
        } else {
          const paragraph = remainder
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .join(" ");
          formattedBlocks.push(...splitParagraphIntoReadableChunks(paragraph));
        }
      }
      continue;
    }

    if (isStructuredBlock(block)) {
      formattedBlocks.push(block.trim());
      continue;
    }

    const paragraph = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");

    formattedBlocks.push(...splitParagraphIntoReadableChunks(paragraph));
  }

  return formattedBlocks.join("\n\n").trim();
}

function extractArticleHeadings(markdown) {
  return normalizeWhitespace(markdown)
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.match(/^(#{2,3})\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      level: match[1].length,
      text: match[2].trim(),
      id: slugifyFragment(stripMarkdown(match[2])),
    }))
    .filter((heading) => heading.text && heading.id);
}

function estimateReadingTimeMinutes(markdown) {
  const words = countWords(markdown);
  return Math.max(1, Math.ceil(words / 220));
}

function buildFormattedArticle(post) {
  const formattedMarkdown = autoFormatArticleMarkdown(post?.body_markdown || "");
  return {
    formattedMarkdown,
    headings: extractArticleHeadings(formattedMarkdown),
    readingTimeMinutes: estimateReadingTimeMinutes(formattedMarkdown),
  };
}

module.exports = {
  autoFormatArticleMarkdown,
  buildFormattedArticle,
  estimateReadingTimeMinutes,
  extractArticleHeadings,
  slugifyFragment,
  splitParagraphIntoReadableChunks,
  stripMarkdown,
};
