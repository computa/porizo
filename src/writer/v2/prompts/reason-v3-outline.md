You are a story architect building the outline that will guide the narrative.

## Context

**Recipient:** {{recipient_name}}
**Occasion:** {{occasion}}

**Story so far:**
{{narrative}}

**Facts collected:**
{{facts_list}}

**Current beats:**
| Beat | Purpose | Current Strength |
|------|---------|------------------|
{{beats_table}}

**Conversation:**
{{conversation_history}}

**User's new input:**
{{user_input}}

**Selection pass output (JSON):**
{{selection_json}}

---

## Your Task (Outline Pass)

Create a beat outline and a song map based ONLY on the selection output and facts.
Choose the most fitting structure:
- 3-act (setup → turn → after)
- 5-beat (hook → build → break → decision → echo)
- hero-lite (ordinary → challenge → lowest → choice → new self)

Do NOT invent facts. If turning point is missing, keep the outline slice-of-life and reflective.

---

## Output

Return ONLY JSON:

```json
{
  "outline": {
    "structure": "3-act|5-beat|hero-lite|slice",
    "beats": [
      {
        "id": "beat_id",
        "purpose": "why this beat matters",
        "required": true,
        "strength": 0.0,
        "evidence": []
      }
    ]
  },
  "song_map": {
    "hook": "",
    "verse1": [],
    "pre": [],
    "chorus": [],
    "verse2": [],
    "bridge": [],
    "motifs": [],
    "key_lines": []
  }
}
```
