---
description: CI/CD design rules
paths:
  - ".github/workflows/**/*.yml"
  - ".github/workflows/**/*.yaml"
alwaysApply: false
---

# GitHub Actions Rules

## General

- Respect the existing workflow structure
- Achieve the goal with minimal changes
- Prioritize workflow readability

## Workflow Design

- Split jobs by responsibility
- Give every step a clear name
- Reuse common steps where possible; avoid duplication
- The deploy workflow must support both `push` to `main` and `workflow_dispatch` (used by `make deploy`)

## Actions

- Prefer official or trusted actions
- Pin action versions (major version or SHA); never use `latest`

## Security

- Never print secrets to logs
- Never hardcode secrets
- Authenticate to GCP via Workload Identity Federation only. Do not create or store service account key files
- Apply least privilege; grant only the minimum `permissions` required

## Performance

- Use caching where applicable
- Do not run unnecessary jobs
- Parallelize independent jobs

## Reliability

- Set appropriate timeouts
- Add retries where appropriate
- Distinguish transient errors from permanent ones

## Debugging

- Do not disable CI to work around a problem
- Do not delete tests to make CI pass
- Investigate and fix the root cause

## Quality

- Include formatter, lint, and tests in CI
- Do not change code only to make CI pass
- Follow existing naming and structure
