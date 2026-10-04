---
description: Git workflow rules
alwaysApply: true
---

# Git Rules

## General

- Do not commit, push, tag, or merge without the user's explicit instruction
- Only propose history-rewriting operations (rebase, `reset --hard`, force push); never run them on your own
- Confirm before any operation that may overwrite others' changes

## Commits

- One logical change per commit
- Do not mix unrelated changes in one commit
- Commit generated files only when necessary
- Do not leave debug code or temporary comments

## Commit Message

- Use Conventional Commits
- Keep the subject concise
- Add the reason for the change in the body when needed

Allowed types:

- feat
- fix
- refactor
- perf
- docs
- test
- chore
- ci
- build

## Before Commit

- Run the formatter
- Run the linter
- Run tests if they exist
- Do not include unnecessary files
- Confirm no secrets are included

## Pull Requests

- Describe the change, purpose, and impact in the PR description
- Attach screenshots when helpful
- Keep PRs small enough to review

## Security

Never commit:

- API keys
- Passwords
- Access tokens
- Private keys / encryption keys
- `.env`
- Terraform state files
- Personal information

## Generated Files

- Update lock files only when dependencies change
- Handle build artifacts according to project rules
