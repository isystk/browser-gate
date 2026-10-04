---
description: Naming and comment policy
alwaysApply: true
---

# Coding Style

## Naming

- Follow TypeScript conventions: camelCase for variables/functions, PascalCase for types/classes
- Replace magic numbers and magic strings with constants or enums/union types
- Name storage write methods by operation (e.g. `upsertXxx`), not by use case (`markXxx` / `setXxx`). Keep paired methods symmetric (e.g. `acquireLock` / `releaseLock`)

## Design

- Prefer early returns
- Keep nesting shallow. Two or more levels of nested `for` / `if` etc. are forbidden; flatten with early returns, guard clauses, or helper extraction
- One function, one responsibility. Consider splitting functions over 50 lines
- Do not duplicate code
- Avoid abusing global state or module-level mutable variables
- Extract shared logic into appropriate modules
- Place private (non-exported) functions below exported ones
- Put preconditions and guard clauses ("do nothing if there is nothing to do") in the caller. The callee may assume it is relevant when called

## Formatting

- Follow the ESLint / Prettier configuration; do not hand-format against it
- Do not leave unused imports or variables
- Do not create circular dependencies
- Do not produce diffs for reasons other than formatting requirements
- Write array literals one value per line (including config and validation arrays)

## Exceptions

- Never swallow exceptions
- Empty `catch` blocks are forbidden
- Handle specific error types whenever possible

## Comments

- Write a one-line TSDoc describing each class's role
- Write a one-line TSDoc summarizing each function
- Comments inside functions are generally unnecessary; do not comment what the code already says
- Express intent through code rather than comments
- Only for non-obvious implementations or tricky workarounds, add an in-function comment explaining why
- If a function's logic is complex, add the processing flow as bullet points in its TSDoc
- For functions returning a boolean, write the doc as "Returns true if ..."
- Do not append supplementary notes in parentheses; write one concise sentence
- Keep comments brief: write only what is necessary
- Do not write change history in comments (e.g. "changed from X to Y"). Describe only the current state; history belongs in git

## Quality

- Readability comes first
- Match the existing code style
- Keep changes small
