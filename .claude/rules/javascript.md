---
description: TypeScript (Node.js / Hono / Playwright) coding rules
paths:
  - "**/*.ts"
  - "**/*.mts"
  - "**/*.cts"
  - "**/*.js"
  - "**/*.mjs"
alwaysApply: false
---

# TypeScript Rules

## Language

- Write all new code in TypeScript with explicit types where inference is not enough
- `any` is forbidden. If unavoidable, leave a comment explaining why
- Prefer `unknown` and narrow it before use (especially for request bodies and external responses)
- Rely on type inference; avoid redundant annotations
- Prefer `const`; use `let` only when reassignment is required. Never use `var`

## Style

- Follow the project's ESLint and Prettier configuration

## Async

- Prefer `async/await` over raw Promise chains
- Always handle async errors; no floating promises
- Use `Promise.all()` for independent work when it is safe to parallelize

## Error Handling

- In `catch`, either log meaningfully or rethrow; never swallow
- Map failures to the API's defined error codes instead of leaking raw exceptions to clients

## Playwright

- Always close `Page` / `BrowserContext` / `Browser` in `finally` so a failed request does not leak a browser process
- Set explicit timeouts on navigation and waits; never wait indefinitely

## Performance

- Avoid unnecessary recomputation, loops, and array copies
- Do not over-optimize at the expense of readability

## Imports

- Follow the import order defined in the ESLint config

## Quality

- Prioritize type safety

Language-agnostic design, comment, and exception policies are defined in `coding-style.md`.
