# Story schema

Use this schema when turning a memory into a Porizo-ready story brief. Do not collapse it down to `topic` and `moment` unless the user explicitly wants something loose and generic.

## Inputs to collect

- `hook`
  The short social line or UGC line that frames the story.
- `recipient`
  The exact person the song is for, for example `Mom`, `Dad`, `My wife`, `My son`.
- `relationship`
  The relationship label that Porizo should understand, for example `mother`, `father`, `partner`, `friend`.
- `occasion`
  The occasion if there is one, for example `birthday`, `mother's day`, `just because`.
- `moment`
  The concrete memory. Prefer one ordinary, real scene.
- `what it felt like then`
  The confusion, tension, annoyance, or feeling from that earlier moment.
- `what it means now`
  The mature meaning now. This is usually gratitude, pride, sacrifice, protection, or devotion.
- `must-include details`
  Small concrete details that make the song feel true.
- optional `genre / vibe`
  A style hint for later generation.

## Output shape

The story file should include four sections in this order.

### Hook

Repeat the hook exactly, unless it is clearly broken.

### Story summary

Write 3 to 6 sentences in plain language about the real memory and why it matters now.

### Porizo Story Input

Write a story brief in natural language that the app can use directly. It should:

- name the recipient
- describe the exact memory
- include the emotional shift from then to now
- include the small concrete details
- stay emotionally specific, not generic

### Story paste block

Write a compact paragraph version the user can paste into Porizo with minimal editing.

## Writing rules

- Prefer specific ordinary details over abstract praise.
- Avoid empty lines like `you mean everything to me`.
- If the memory has tension, keep it. The tension makes the gratitude believable.
- If the hook is contrast-based, keep that contrast visible in the story.
- Do not over-explain the app inside the story. This is story input, not ad copy.
