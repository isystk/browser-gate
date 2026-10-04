---
description: Security policy
alwaysApply: true
---

# Security Rules

## General

- Security takes priority over convenience
- When in doubt, choose the safer implementation
- Confirm with the user before any change that carries security risk

## Secrets

- Never write API keys, access tokens, passwords, or private keys into source code
- Load secrets from environment variables or Secret Manager
- Use dummy values in samples
- Store API keys only as hashes; never persist plaintext keys

## Authentication & Authorization

- Never bypass authentication or authorization
- Never skip permission checks (API key → allowed profiles → allowed domains)
- Follow the principle of least privilege

## Input Validation

- Always validate external input (request bodies, URLs, selectors, step definitions)
- Never trust input values
- Never embed input directly into shell commands or HTML
- Accept only allow-listed page operations; never execute arbitrary scripts supplied by clients

## SSRF / Navigation

- Block private, loopback, link-local, and metadata addresses (e.g. `169.254.169.254`) and non-HTTP(S) schemes such as `file://`
- Validate the resolved IP, not just the hostname, and re-validate on redirects and sub-requests
- Treat proxy settings in requests as untrusted input as well

## Session Data

- Browser profiles (cookies / storageState) are equivalent to credentials: always encrypt before storing
- Never return or persist page content beyond what the request asked for

## File Handling

- Prevent path traversal
- Never build file or object paths directly from user input (e.g. profile names must be validated against a strict pattern)

## External Access

- Set timeouts on every navigation and external call
- Retry only where appropriate
- Never trust external responses

## Logging

- Never log personal or secret information (Authorization headers, cookies, proxy credentials, page bodies)
- Log only the minimum necessary information

## Dependencies

- Use trusted libraries only
- Do not add unnecessary dependencies
- Avoid libraries with known vulnerabilities

## Git

Never commit:

- `.env`
- API keys
- Private keys / encryption keys
- Certificates
- Terraform state files

## Safety

- Never disable security features to work around a problem
- Never carry development settings into production
