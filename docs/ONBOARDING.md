# AI Health Check Onboarding Guide

> Last updated: 2026-04-18 · current as of commit `3396e21`

New developer setup and platform workflow.

## Prerequisites

- Python 3.11+
- Node.js 18+
- the LLM provider API key (set as `ANTHROPIC_API_KEY` environment variable)

## Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API runs at `http://localhost:8000`. Interactive docs at `/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

UI runs at `http://localhost:5173`.

## Default Credentials

The seed script creates three users:

| Email | Role |
|-------|------|
| admin@aiops.local | admin |
| maintainer@aiops.local | maintainer |
| viewer@aiops.local | viewer |

Set their passwords in `backend/.env` via `SEED_ADMIN_PASSWORD`,
`SEED_MAINTAINER_PASSWORD`, and `SEED_VIEWER_PASSWORD` **before** running
`python -m app.seed`. If those env vars are unset, seed falls back to
demo-weak defaults (printed as a warning) so the initial run still
works — override them for anything non-local.

(The previous `admin@test.local` credential documented here was the
in-memory test-fixture email, which never existed in the running app
— doc drift from an earlier version. The seed's real email domain is
`@aiops.local`.)

## Platform Lifecycle

1. **Register a service** -- Add an AI service with model ID, owner, and sensitivity label (ServicesPage).
2. **Run evaluation** -- Execute synthetic test cases against the service and receive scored results (EvaluationsPage).
3. **Monitor dashboard** -- View aggregated latency, quality, throughput, and error metrics with P50/P95/P99 percentiles (DashboardPage).
4. **Detect drift** -- Review drift severity (none/warning/critical) and trend direction in the drift panel (EvaluationsPage).
5. **Create incident** -- File an incident ticket when drift, latency spikes, or safety anomalies occur (IncidentsPage).
6. **Generate AI summary and approve** -- The AI drafts an incident summary or post-mortem; engineer approves or rejects before it takes effect (IncidentDetailPage).
7. **Plan maintenance** -- Schedule rollbacks or fixes through the maintenance planner (IncidentDetailPage).
8. **Export compliance evidence** -- Filter and export audit logs as JSON for compliance review (GovernancePage).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Open command palette |
| G then D | Jump to Dashboard |
| G then S | Jump to Services |
| G then E | Jump to Evaluations |
| G then I | Jump to Incidents |
| G then G | Jump to Governance |

## Further Reading

| Topic | Link |
|-------|------|
| System architecture | [ARCHITECTURE](ARCHITECTURE.md) |
| Module breakdown | [MODULE_GUIDE](MODULE_GUIDE.md) |
| Test coverage | [TESTING_STRATEGY](TESTING_STRATEGY.md) |
| Drift detection methodology | [EVAL_DATASET_CARD](EVAL_DATASET_CARD.md) |
| Incident response procedures | [MAINTENANCE_RUNBOOK](MAINTENANCE_RUNBOOK.md) |
| Risk assessment | [RISK_REGISTER](RISK_REGISTER.md) |
| Prompt versioning | [PROMPT_CHANGE_LOG](PROMPT_CHANGE_LOG.md) |
