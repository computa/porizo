/**
 * Lyrics–Audio Alignment Utility
 *
 * Maps Whisper word-level timestamps back to lyrics sections,
 * producing startTime/endTime for each section.
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
 * Align lyrics sections to Whisper word-level timestamps.
 *
 * Strategy: Build a flat list of all lyrics words (preserving section/line membership),
 * then greedily match them to Whisper words scanning forward. This works because
 * both lyrics and audio are sequential.
 *
 * @param {Array<{name: string, lines: string[]}>} sections - Lyrics sections from lyrics_json
 * @param {{segments: Array, words: Array<{word: string, start: number, end: number}>}} whisperResult
 * @returns {Array<{name: string, lines: string[], startTime: number, endTime: number}>}
 */
function alignSectionsToTimestamps(sections, whisperResult) {
  if (!sections || sections.length === 0) {
    return [];
  }

  const whisperWords = whisperResult?.words || [];

  // If Whisper returned no words, fall back to segment-level matching
  if (whisperWords.length === 0) {
    return alignViaSections(sections, whisperResult?.segments || []);
  }

  // Build flat list of expected lyrics words with section indices
  const expectedWords = [];
  for (let si = 0; si < sections.length; si++) {
    const lines = Array.isArray(sections[si].lines) ? sections[si].lines : [];
    for (const line of lines) {
      for (const word of toWords(line)) {
        expectedWords.push({ word, sectionIndex: si });
      }
    }
  }

  if (expectedWords.length === 0) {
    return sections.map(s => ({ ...s, startTime: 0, endTime: 0 }));
  }

  // Greedy forward match: for each expected word, find the best matching
  // Whisper word starting from the current scan position.
  const sectionHits = sections.map(() => ({ starts: [], ends: [] }));
  let whisperPos = 0;
  const LOOKAHEAD = 8; // How many Whisper words ahead to search for a match

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
      // Allow 1-char edit distance for minor Whisper transcription differences
      const dist = editDistance(expected.word, wWord);
      if (dist <= 1 && dist < bestDist) {
        bestIdx = wi;
        bestDist = dist;
      }
    }

    if (bestIdx >= 0) {
      const ww = whisperWords[bestIdx];
      sectionHits[expected.sectionIndex].starts.push(ww.start);
      sectionHits[expected.sectionIndex].ends.push(ww.end);
      whisperPos = bestIdx + 1;
    }
  }

  // Build result: each section gets startTime/endTime from matched words
  const result = sections.map((section, i) => {
    const hits = sectionHits[i];
    if (hits.starts.length > 0) {
      return {
        ...section,
        startTime: Math.min(...hits.starts),
        endTime: Math.max(...hits.ends),
      };
    }
    return { ...section, startTime: null, endTime: null };
  });

  // Interpolate sections with no matches from neighbors
  interpolateMissing(result);

  return result;
}

/**
 * Fallback: align via Whisper segment-level data when word-level is unavailable.
 */
function alignViaSections(sections, segments) {
  if (segments.length === 0) {
    return sections.map(s => ({ ...s, startTime: null, endTime: null }));
  }

  // Match each section to the segment with the highest word overlap
  const result = sections.map(section => {
    const sectionText = normalize((section.lines || []).join(" "));
    const sectionWords = new Set(sectionText.split(" ").filter(Boolean));
    if (sectionWords.size === 0) {
      return { ...section, startTime: null, endTime: null };
    }

    let bestSegIdx = -1;
    let bestOverlap = 0;

    for (let si = 0; si < segments.length; si++) {
      const segWords = new Set(normalize(segments[si].text).split(" ").filter(Boolean));
      let overlap = 0;
      for (const w of sectionWords) {
        if (segWords.has(w)) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSegIdx = si;
      }
    }

    if (bestSegIdx >= 0 && bestOverlap >= Math.min(2, sectionWords.size)) {
      // Find contiguous segment span that covers this section
      const startSeg = segments[bestSegIdx];
      let endSeg = startSeg;

      // Check if following segments also belong to this section
      for (let si = bestSegIdx + 1; si < segments.length; si++) {
        const segWords = new Set(normalize(segments[si].text).split(" ").filter(Boolean));
        let overlap = 0;
        for (const w of sectionWords) {
          if (segWords.has(w)) overlap++;
        }
        if (overlap >= 2) {
          endSeg = segments[si];
        } else {
          break;
        }
      }

      return { ...section, startTime: startSeg.start, endTime: endSeg.end };
    }

    return { ...section, startTime: null, endTime: null };
  });

  interpolateMissing(result);
  return result;
}

/**
 * Fill in missing startTime/endTime by interpolating from neighbors.
 * Mutates the array in place.
 */
function interpolateMissing(sections) {
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].startTime != null) continue;

    // Find previous section with timing
    let prevEnd = 0;
    for (let p = i - 1; p >= 0; p--) {
      if (sections[p].endTime != null) {
        prevEnd = sections[p].endTime;
        break;
      }
    }

    // Find next section with timing
    let nextStart = null;
    for (let n = i + 1; n < sections.length; n++) {
      if (sections[n].startTime != null) {
        nextStart = sections[n].startTime;
        break;
      }
    }

    if (nextStart != null) {
      // Place this section between prev and next
      const gap = nextStart - prevEnd;
      sections[i].startTime = prevEnd + gap * 0.1;
      sections[i].endTime = nextStart - gap * 0.1;
    } else {
      // No next section — give it a small window after previous
      sections[i].startTime = prevEnd + 0.5;
      sections[i].endTime = prevEnd + 4.0;
    }
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
 * @param {Array<{lines: string[]}>} sections
 * @returns {string}
 */
function sectionsToText(sections) {
  return (sections || [])
    .map(s => (s.lines || []).join("\n"))
    .join("\n\n");
}

module.exports = {
  alignSectionsToTimestamps,
  sectionsToText,
};
