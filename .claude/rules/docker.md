---
description: Docker / docker-compose operation rules
paths:
  - "**/docker-compose*.yml"
  - "**/compose*.yml"
  - "**/Dockerfile"
  - "**/Makefile"
alwaysApply: false
---

# Docker Rules

## General

- Development assumes Docker. Do not install dependencies on the host; run them inside the container
- Use the project's Docker Compose setup via Makefile targets (`make up` / `make down` / `make logs` etc.)
- The same image is used locally and on Cloud Run. Do not introduce local-only behavior into the image

## Commands

- Run Node.js / npm / Playwright commands inside the container whenever possible
- Use the container and service names defined in the existing compose file

## Images

- Respect the existing Dockerfile; avoid unnecessary changes
- Do not change the base image without the user's instruction
- When an image update is needed, state the reason explicitly

## Volumes

- Never delete persistent volumes
- Confirm with the user before any volume initialization

## Safety

- Do not run `docker compose down -v`
- Do not run `docker system prune`
- Do not run `docker volume rm`
- Do not run `docker image prune`
- Always confirm with the user before any operation that may delete data

## Logs

- Check container logs first when investigating errors
- Prefer root-cause investigation over recreating containers

## Networking

- Prefer container-to-container communication using service names as hostnames; do not depend on `localhost`
- Exception: internal processes inside the same container (e.g. websockify, x11vnc) must listen on `localhost` only and must not be exposed directly

## Quality

- Keep the compose file and Dockerfile readable
- Do not add unnecessary layers or duplicated settings
- Follow the existing structure
