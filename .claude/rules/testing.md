---
description: Testing policy
paths:
  - "**/tests/**/*.ts"
  - "**/*.test.ts"
  - "**/*.spec.ts"
alwaysApply: false
---

# Testing Rules

## General

- Add or update tests for new features and behavior changes
- Tests exist to guarantee the specification
- Test behavior, not implementation details

## Test Design

- One test verifies one behavior
- Test names should make the expected result clear
- Follow Arrange / Act / Assert
- Tests must not depend on each other
- When every test in a suite builds the same subject without variation, build it once in `beforeEach`. Override only in the tests that need a different setup

## Assertions

- Use the minimum necessary assertions
- Avoid vague assertions
- Verify side effects (e.g. stored profiles, lock release, notifications) where relevant, not just return values

## Test Data

- Keep test data independent per test
- Avoid magic numbers and hardcoded strings
- Use factories, fixtures, or builders

## Mocking

- Keep mocks to a minimum
- Mock only non-deterministic or external elements (GCS, Secret Manager, Slack, time, external sites)
- Avoid mocks that depend on implementation details

## Quality

- Cover error cases, not just the happy path
- Consider boundary values
- Security-relevant paths (SSRF blocking, API key / profile / domain authorization) must have tests
- Prioritize test readability
- Avoid duplicated test code

## Maintenance

- Remove tests that are no longer needed
- Update tests together with implementation changes
- Never disable tests to work around a problem
- Prefer running only the affected tests over the full suite when possible to save time
