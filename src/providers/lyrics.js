/**
 * Lyrics generation with LLM integration and singability validation
 */

const MAX_SYLLABLES_PER_LINE = 15;
const MIN_SYLLABLES_PER_LINE = 3;

function buildLyrics({ title, recipient_name, message, style }) {
  const anchor = recipient_name ? recipient_name + ", this one's for you" : "This one's for you";
  return {
    title: title || "Untitled",
    style: style || "pop",
    sections: [
      {
        name: "chorus",
        lines: [anchor, message || "You're the reason I sing today", anchor],
      },
      {
        name: "verse",
        lines: ["We go way back, through every mile", "You light the room, you make me smile"],
      },
    ],
    anchor_line: anchor,
  };
}

function countSyllables(text) {
  if (!text) return 0;
  const word = text.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length <= 3) return 1;
  
  let count = 0;
  const vowels = "aeiouy";
  let prevVowel = false;
  
  for (let i = 0; i < word.length; i++) {
    const isVowel = vowels.includes(word[i]);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }
  
  if (word.endsWith("e") && count > 1) count--;
  if (word.endsWith("le") && word.length > 2 && !vowels.includes(word[word.length - 3])) count++;
  
  return Math.max(1, count);
}

function countLineSyllables(line) {
  if (!line) return 0;
  return line.split(/\s+/).reduce((sum, word) => sum + countSyllables(word), 0);
}

function validateSingability(lyrics) {
  const issues = [];
  
  if (!lyrics || !lyrics.sections || lyrics.sections.length === 0) {
    issues.push("No sections found in lyrics");
    return { valid: false, issues };
  }
  
  for (const section of lyrics.sections) {
    if (!section.lines || section.lines.length === 0) {
      issues.push("Section '" + section.name + "' has no lines");
      continue;
    }
    
    for (let i = 0; i < section.lines.length; i++) {
      const line = section.lines[i];
      const syllables = countLineSyllables(line);
      
      if (syllables > MAX_SYLLABLES_PER_LINE) {
        issues.push("Line " + (i + 1) + " in " + section.name + " has " + syllables + " syllables (max " + MAX_SYLLABLES_PER_LINE + ")");
      }
      if (syllables < MIN_SYLLABLES_PER_LINE && line.trim().length > 0) {
        issues.push("Line " + (i + 1) + " in " + section.name + " has only " + syllables + " syllables (min " + MIN_SYLLABLES_PER_LINE + ")");
      }
    }
  }
  
  return { valid: issues.length === 0, issues };
}

function anchorMessage(lyrics, message) {
  if (!lyrics || !message) return lyrics;
  
  const messageLower = message.toLowerCase();
  const allLines = lyrics.sections.flatMap(s => s.lines);
  const hasMessage = allLines.some(line => 
    line.toLowerCase().includes(messageLower) || 
    messageLower.split(" ").some(word => word.length > 3 && line.toLowerCase().includes(word))
  );
  
  if (hasMessage) return lyrics;
  
  const result = JSON.parse(JSON.stringify(lyrics));
  
  for (const section of result.sections) {
    if (section.name === "chorus" && section.lines.length > 0) {
      const messageWords = message.split(" ").slice(0, 6).join(" ");
      section.lines[0] = messageWords;
      result.anchor_line = messageWords;
      break;
    }
  }
  
  return result;
}

async function generateLyrics({ title, recipient_name, message, style, occasion }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    return buildLyrics({ title, recipient_name, message, style });
  }
  
  const prompt = "Generate song lyrics for a personalized " + (occasion || "celebration") + " song.\n\n" +
    "Details:\n" +
    "- Title: " + (title || "Untitled") + "\n" +
    "- Recipient: " + (recipient_name || "someone special") + "\n" +
    "- Message to include: " + (message || "You are amazing") + "\n" +
    "- Style: " + (style || "pop") + "\n\n" +
    "Requirements:\n" +
    "- Create a chorus and 1-2 verses\n" +
    "- Each line should be 6-12 syllables for singability\n" +
    "- Include the recipient's name naturally\n" +
    "- Weave in the personal message\n" +
    "- Make it emotionally resonant\n\n" +
    "Return ONLY valid JSON in this exact format:\n" +
    '{"title":"...", "style":"...", "sections":[{"name":"chorus","lines":["line1","line2"]},{"name":"verse","lines":["line1","line2"]}], "anchor_line":"..."}';

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error("E201_LYRICS_ERROR: API returned " + response.status + ": " + error);
    }
    
    const data = await response.json();
    const content = data.content?.[0]?.text || "";
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("E201_LYRICS_ERROR: No JSON found in response");
    }
    
    const lyrics = JSON.parse(jsonMatch[0]);
    
    if (!lyrics.sections || !Array.isArray(lyrics.sections)) {
      throw new Error("E201_LYRICS_ERROR: Invalid lyrics structure");
    }
    
    return lyrics;
  } catch (err) {
    if (err.message.includes("E201")) throw err;
    throw new Error("E201_LYRICS_ERROR: " + err.message);
  }
}

module.exports = {
  buildLyrics,
  countSyllables,
  countLineSyllables,
  validateSingability,
  anchorMessage,
  generateLyrics,
};
