# Task Tracking

## Current Task

**Create workflow enforcement system** - Hooks and rules to make CLAUDE.md guidelines mandatory

## Plan

- [x] 1. Create `~/.claude/rules/porizo-workflow.md` - Global rule injected every session
- [x] 2. Create session-start hook - Surfaces lessons.md at session start
- [x] 3. Create pre-edit hook - Checks for active plan before edits
- [x] 4. Test the hooks work correctly
- [x] 5. Document in CLAUDE.md how the enforcement works

## Progress

- 17:36 - Created `~/.claude/rules/porizo-workflow.md`
- 17:45 - Created `porizo-session-start.ts` and `porizo-pre-edit.ts`
- 17:49 - Built hooks, added to settings.json
- 17:55 - Fixed cwd detection, tested both hooks successfully
- 17:58 - Documented enforcement system in CLAUDE.md

## Results

Created a 3-layer enforcement system:

1. **Global Rule** (`~/.claude/rules/porizo-workflow.md`)
   - Injects workflow rules into every Porizo session
   - Covers: plan mode, subagents, self-improvement, verification, autonomous fixing

2. **Session Start Hook** (`porizo-session-start.mjs`)
   - Displays lessons.md content at session start
   - Shows active task from todo.md
   - Only runs in Porizo project directory

3. **Pre-Edit Hook** (`porizo-pre-edit.mjs`)
   - Warns when editing code without an active plan
   - Checks for task + plan items in todo.md
   - Skips trivial edits and non-code files

## Review

Task complete. New sessions in Porizo will:
- See workflow context banner with lessons and active task
- Get warnings when editing code without a plan
- Have workflow rules reinforced in context
