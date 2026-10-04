---
description: General layer separation principles
alwaysApply: true
---

# Architecture

- Do not mix layer responsibilities: Route handlers (Hono) ⇔ Services (domain logic) ⇔ Infrastructure (Playwright, GCS, Secret Manager, Slack)
- Route handlers must not call infrastructure modules directly; always go through a service
- Keep business logic (URL validation, authorization, step execution rules, lock handling) independent of Hono and GCP SDKs so it can be unit-tested
- No circular dependencies. Upper layers may depend on lower layers, never the reverse
- Consolidate shared helpers in a utils module; do not duplicate implementations
- Introduce a new abstraction (interface, base class) only when it will actually be used in two or more places
- Do not scatter settings and constants in code; keep them in a config module or constants
- Do not implement for speculative future requirements (YAGNI)
