/**
 * Lyrics–Audio Alignment Utility
 *
 * Maps Whisper word-level timestamps back to lyrics sections and lines,
 * producing startTime/endTime for each section AND each individual line.
 */

/**
 * Normalize text for fuzzy matching: lowercase, strip punctuation, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split normalized text into individual words.
 * @param {string} text
 * @returns {string[]}
 */
function toWords(text) {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

/**
 * Extract plain string from a lyrics line that may be a string or {text: "..."} object.
 * @param {string|{text: string}} line
 * @returns {string}
 */
function lineText(line) {
  if (typeof line === "string") return line;
  if (line && typeof line.text === "string") return line.text;
  return "";
}

/**
 * Align lyrics sections to Whisper word-level timestamps.
 *
 * Produces startTime/endTime on each section AND each individual line
 * within a section, enabling line-by-line karaoke-style highlighting.
 *
 * @param {Array<{name: string, lines: string[]}>} sections
 * @param {{segments: Array, words: Array<{word: string, start: number, end: number}>}} whisperResult
 * @returns {Array<{name: string, lines: Array<{text: string, startTime: number, endTime: number}>, startTime: number, endTime: number}>}
 */
function alignSectionsToTimestamps(sections, whisperResult) {
  if (!sections || sections.length === 0) {
    return [];
  }

  const whisperWords = whisperResult?.words || [];

  if (whisperWords.length === 0) {
    return alignViaSections(sections, whisperResult?.segments || []);
  }

  // Build flat list of expected words with section AND line indices
  const expectedWords = [];
  for (let si = 0; si < sections.length; si++) {
    const lines = Array.isArray(sections[si].lines) ? sections[si].lines : [];
    for (let li = 0; li < lines.length; li++) {
      for (const word of toWords(lineText(lines[li]))) {
        expectedWords.push({ word, sectionIndex: si, lineIndex: li });
      }
    }
  }

  if (expectedWords.length === 0) {
    return sections.map(s => ({
      ...s,
      lines: (s.lines || []).map(l => ({ text: lineText(l), startTime: 0, endTime: 0 })),
      startTime: 0,
      endTime: 0,
    }));
  }

  // Track hits per section AND per line within each section
  const lineCount = sections.map(s => (Array.isArray(s.lines) ? s.lines.length : 0));
  const lineHits = sections.map((_, si) =>
    Array.from({ length: lineCount[si] }, () => ({ starts: [], ends: [] }))
  );

  // Greedy forward match
  let whisperPos = 0;
  const LOOKAHEAD = 8;

  for (const expected of expectedWords) {
    let bestIdx = -1;
    let bestDist = Infinity;

    const searchEnd = Math.min(whisperPos + LOOKAHEAD, whisperWords.length);
    for (let wi = whisperPos; wi < searchEnd; wi++) {
      const wWord = normalize(whisperWords[wi].word);
      if (wWord === expected.word) {
        bestIdx = wi;
        bestDist = 0;
        break;
      }
      const dist = editDistance(expected.word, wWord);
      if (dist <= 1 && dist < bestDist) {
        bestIdx = wi;
        bestDist = dist;
      }
    }

    if (bestIdx >= 0) {
      const ww = whisperWords[bestIdx];
      lineHits[expected.sectionIndex][expected.lineIndex].starts.push(ww.start);
      lineHits[expected.sectionIndex][expected.lineIndex].ends.push(ww.end);
      whisperPos = bestIdx + 1;
    }
  }

  // Build result with per-line and per-section timing
  const result = sections.map((section, si) => {
    const rawLines = Array.isArray(section.lines) ? section.lines : [];
    const timedLines = rawLines.map((raw, li) => {
      const text = lineText(raw);
      const hits = lineHits[si][li];
      if (hits.starts.length > 0) {
        return { text, startTime: Math.min(...hits.starts), endTime: Math.max(...hits.ends) };
      }
      return { text, startTime: null, endTime: null };
    });

    // Section timing = span of all matched lines
    const allStarts = timedLines.filter(l => l.startTime != null).map(l => l.startTime);
    const allEnds = timedLines.filter(l => l.endTime != null).map(l => l.endTime);
    const sectionStart = allStarts.length > 0 ? Math.min(...allStarts) : null;
    const sectionEnd = allEnds.length > 0 ? Math.max(...allEnds) : null;

    return { name: section.name, lines: timedLines, startTime: sectionStart, endTime: sectionEnd };
  });

  // Interpolate missing timing
  interpolateMissingSections(result);
  for (const section of result) {
    interpolateMissingLines(section);
  }

  return result;
}

/**
 * Fallback: align via Whisper segment-level data when word-level is unavailable.
 */
function alignViaSections(sections, segments) {
  if (segments.length === 0) {
    return sections.map(s => ({
      ...s,
      lines: (s.lines || []).map(l => ({ text: lineText(l), startTime: null, endTime: null })),
      startTime: null,
      endTime: null,
    }));
  }

  const result = sections.map(section => {
    const rawLines = Array.isArray(section.lines) ? section.lines : [];
    const sectionText = normalize(rawLines.map(l => lineText(l)).join(" "));
    const sectionWords = new Set(sectionText.split(" ").filter(Boolean));
    if (sectionWords.size === 0) {
      return {
        ...section,
        lines: rawLines.map(l => ({ text: lineText(l), startTime: null, endTime: null })),
        startTime: null,
        endTime: null,
      };
    }

    let bestSegIdx = -1;
    let bestOverlap = 0;
    for (let si = 0; si < segments.length; si++) {
      const segWords = new Set(normalize(segments[si].text).split(" ").filter(Boolean));
      let overlap = 0;
      for (const w of sectionWords) { if (segWords.has(w)) overlap++; }
      if (overlap > bestOverlap) { bestOverlap = overlap; bestSegIdx = si; }
    }

    if (bestSegIdx >= 0 && bestOverlap >= Math.min(2, sectionWords.size)) {
      const startSeg = segments[bestSegIdx];
      let endSeg = startSeg;
      for (let si = bestSegIdx + 1; si < segments.length; si++) {
        const segWords = new Set(normalize(segments[si].text).split(" ").filter(Boolean));
        let overlap = 0;
        for (const w of sectionWords) { if (segWords.has(w)) overlap++; }
        if (overlap >= 2) { endSeg = segments[si]; } else { break; }
      }

      const sStart = startSeg.start;
      const sEnd = endSeg.end;
      // Distribute time evenly across lines
      const lineDur = rawLines.length > 0 ? (sEnd - sStart) / rawLines.length : 0;
      const timedLines = rawLines.map((raw, i) => ({
        text: lineText(raw),
        startTime: sStart + i * lineDur,
        endTime: sStart + (i + 1) * lineDur,
      }));

      return { ...section, lines: timedLines, startTime: sStart, endTime: sEnd };
    }

    return {
      ...section,
      lines: rawLines.map(l => ({ text: lineText(l), startTime: null, endTime: null })),
      startTime: null,
      endTime: null,
    };
  });

  interpolateMissingSections(result);
  for (const section of result) {
    interpolateMissingLines(section);
  }
  return result;
}

/**
 * Fill in missing section timing from neighbors.
 */
function interpolateMissingSections(sections) {
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].startTime != null) continue;

    let prevEnd = 0;
    for (let p = i - 1; p >= 0; p--) {
      if (sections[p].endTime != null) { prevEnd = sections[p].endTime; break; }
    }

    let nextStart = null;
    for (let n = i + 1; n < sections.length; n++) {
      if (sections[n].startTime != null) { nextStart = sections[n].startTime; break; }
    }

    if (nextStart != null) {
      const gap = nextStart - prevEnd;
      sections[i].startTime = prevEnd + gap * 0.1;
      sections[i].endTime = nextStart - gap * 0.1;
    } else {
      sections[i].startTime = prevEnd + 0.5;
      sections[i].endTime = prevEnd + 4.0;
    }
  }
}

/**
 * Fill in missing line timing within a section by distributing evenly.
 */
function interpolateMissingLines(section) {
  const lines = section.lines;
  if (!lines || lines.length === 0) return;

  const hasAnyTiming = lines.some(l => l.startTime != null);
  if (!hasAnyTiming && section.startTime != null) {
    // No line timing at all — distribute section duration evenly
    const dur = (section.endTime - section.startTime) / lines.length;
    for (let i = 0; i < lines.length; i++) {
      lines[i].startTime = section.startTime + i * dur;
      lines[i].endTime = section.startTime + (i + 1) * dur;
    }
    return;
  }

  // Interpolate individual missing lines from neighbors
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startTime != null) continue;

    let prevEnd = section.startTime || 0;
    for (let p = i - 1; p >= 0; p--) {
      if (lines[p].endTime != null) { prevEnd = lines[p].endTime; break; }
    }

    let nextStart = section.endTime || prevEnd + 3;
    for (let n = i + 1; n < lines.length; n++) {
      if (lines[n].startTime != null) { nextStart = lines[n].startTime; break; }
    }

    const gap = nextStart - prevEnd;
    lines[i].startTime = prevEnd + gap * 0.05;
    lines[i].endTime = nextStart - gap * 0.05;
  }
}

/**
 * Simple Levenshtein edit distance for short words.
 */
function editDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= a.length; i++) matrix[i] = [i];
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * Convert sections array to plain text for Whisper prompt.
 * @param {Array<{lines: string[]|Array<{text: string}>}>} sections
 * @returns {string}
 */
function sectionsToText(sections) {
  return (sections || [])
    .map(s => {
      const lines = s.lines || [];
      return lines.map(l => lineText(l)).join("\n");
    })
    .join("\n\n");
}

module.exports = {
  alignSectionsToTimestamps,
  sectionsToText,
};
