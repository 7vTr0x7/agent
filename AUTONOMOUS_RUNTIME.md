# Autonomous runtime

The production runtime is a single long-lived Node process. It already owns discovery, matching, application-queue processing, stale-submission recovery, Gmail sync, interview reminders, follow-ups, recruiter maintenance, and retry-safe task processing. This deployment layer keeps that process alive across container restarts and runs PostgreSQL and Ollama beside it.

## One-time setup

1. Copy `.env.example` to `.env`.
2. Set the candidate profile fields and a strong local `POSTGRES_PASSWORD`.
3. Configure Gmail/Hunter/Snov/Resend/resume settings only if those integrations are actually being used.
4. Start the stack with Docker Compose:

```bash
docker compose up -d --build
```

After that, the stack uses `restart: unless-stopped`. The app runs continuously; there is no need to keep `discover:once` or `matching:once` running manually.

## Ollama

Ollama is a dedicated service with a persistent model volume. The `ollama-model` one-shot service pulls the configured model before the app starts. The app points at `http://ollama:11434`, keeps the model warm for the configured period, requests compact JSON, and bounds generation length.

## Safety defaults

The compose defaults intentionally keep irreversible outbound behavior disabled:

- `APPLICATION_DRY_RUN=true`
- `OUTBOUND_ENABLED=false`
- recruiter outreach disabled and `RECRUITER_OUTREACH_ACTIVATION=disabled`
- Gmail disabled until OAuth configuration exists

Those settings are deliberate. Discovery, matching, learning, and internal queue processing can run autonomously without silently turning on real applications or recruiter email delivery.

## Restart behavior

- PostgreSQL data persists in `postgres_data`.
- Ollama models persist in `ollama_data`.
- Generated resume/browser state persists in named volumes.
- The application container restarts automatically after process/container failure.
- Database migrations run automatically when the application starts.
- Source-level discovery failures are isolated by the existing discovery runtime, so one broken feed does not stop the whole process.

For Windows/WSL, Docker Desktop should be configured to start with Windows if the goal is unattended operation after a reboot. That host-level setting cannot safely be changed by the repository itself.
