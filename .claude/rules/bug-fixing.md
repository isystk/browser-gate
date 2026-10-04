---
description: Bug fixing policy
alwaysApply: true
---

# Bug Fixing Rules

## Root Cause

- Identify and fix the root cause, not the symptom
- Analyze the cause before fixing and consider recurrence prevention
- If anything is unclear, ask the user instead of guessing

## Similar Patterns

- After fixing a bug, check whether the same implementation pattern exists elsewhere
- Investigate places that could fail for the same reason
- List all places that need the same fix and fix them together when appropriate

## Scope

- Define the fix scope clearly
- Check the impact on related code
- Prioritize not breaking existing features

## Regression

- Check for side effects of the fix
- Add or update related tests as needed
- Consider tests that prevent the same class of bug

## Quality

- Prefer maintainable fixes over temporary workarounds
- If the same fix is needed in several places, consider extracting shared logic
