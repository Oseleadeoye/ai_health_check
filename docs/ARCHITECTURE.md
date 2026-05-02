# AI Health Check -- Architecture Document

> Last updated: 2026-04-18 · current as of commit `3396e21`

## 1. System Overview

AI Health Check is a centralized AI operations platform built for the ARTI-409-A course. The frontend is a React 18 SPA (Vite 5 + Tailwind 3.4). The backend is FastAPI with SQLAlchemy ORM over SQLite. All LLM calls use the LLM provider the AI Sonnet 4.6 (`claude-sonnet-4-6`) via the `anthropic>=0.49.0` SDK, routed through a single pipeline in `llm_client.py`. Two APScheduler jobs run in the background: an HTTP health-check probe against every service every 5 min, and an automated eval run against every active non-confidential service with test cases every 60 min.

## 2. Architecture Diagram

```
User (Browser)
    |
    |  HTTP/JSON + JWT bearer token
    v
React SPA (Vite 5 + Tailwind 3.4)
    |
    |  Axios + JWT interceptor
    v
FastAPI Backend (7 routers, 47 endpoints)
    |
    |--- SQLite (SQLAlchemy ORM, 13 models, Alembic migrations)
    |
    |--- the LLM provider API — two-tier:
    |       Sonnet 4.6  (actor: services under test + synthesis tasks)
    |       Haiku 4.5   (merged judge: factuality + hallucination in one call)
    |        ^
    |        |-- [1] Input safety scan
    |        |-- [2] Budget check
    |        |-- [3] Rate limit check
    |        |-- [4] Retry with backoff
    |        |-- [5] Output safety scan
    |        |-- [6] Usage logging
    |
    |--- APScheduler (health checks every 5 min, HTTP probe)
```

## 3. Backend

22 Python files organized into routers, middleware, services, models, and schemas.

### Application Entry Points

| File | Purpose |
|------|---------|
| `main.py` | ASGI middleware (CORS, exception handlers), 7 router groups, APScheduler bootstrap |
| `config.py` | 22 settings via Pydantic `BaseSettings` ([see Configuration Reference](#11-configuration-reference)) |
| `database.py` | SQLAlchemy engine + session factory targeting `sqlite:///./aiops.db` |
| `seed.py` | Creates default users (admin, maintainer, viewer) and sample services |

### Routers (9 routers, all `/api/v1/*`)

Compliance was split into three cohesive files mounted under the same
`/api/v1/compliance` prefix so frontend paths are unchanged.

| Router | Prefix | Responsibility |
|--------|--------|----------------|
| `auth.py` | `/api/v1/auth` | Login (audited to AuditLog), registration, current user info, login throttling + lockout |
| `services.py` | `/api/v1/services` | Service registry CRUD with SSRF-validated endpoint URLs, HTTP + LLM connection testing, confidential sensitivity override |
| `evaluations.py` | `/api/v1/evaluations` | Test case CRUD, eval run execution, cost preview, drift check, drift trend; auto-creates Alerts on drift with audit trail |
| `incidents.py` | `/api/v1/incidents` | Incident CRUD, LLM summary generation, approval with mandatory reviewer_note + idempotency guard |
| `maintenance.py` | `/api/v1/maintenance` | Maintenance plan CRUD, admin approval |
| `dashboard.py` | `/api/v1/dashboard` | Metrics, latency/quality/error trends, drift alerts, AI summary (HITL draft/approve), API usage, performance, safety stats, LLM call traces, cost-by-service, alerts |
| `users.py` | `/api/v1/compliance` | User list + role update (admin only, self-modification blocked) |
| `audit.py` | `/api/v1/compliance` | Audit log queries with strict date validation + hash-chain integrity verify endpoint (admin only) |
| `export.py` | `/api/v1/compliance` | JSON/PDF export with audit + incidents + maintenance, AI compliance report HITL draft/approve |

### Middleware (3 modules)

| Module | Purpose |
|--------|---------|
| `auth.py` | JWT verification (HS256), bcrypt password hashing, login throttling |
| `rbac.py` | Role-based access control via `Depends()`: admin, maintainer, viewer. 403 denials are themselves written to the audit log as `role_denied` events so probing is traceable |
| `audit.py` | Tamper-evident append-only audit trail. Every `log_action()` call computes SHA-256 over row content + previous hash (hash chain). Serialised by a process-wide `threading.Lock` so concurrent writes produce distinct prev_hashes. `verify_audit_chain()` walks the chain |

### Services (5 modules)

| Module | Purpose |
|--------|---------|
| `llm_client.py` | Public the AI functions routed through `_make_api_call`. Atomic budget/rate-limit check + reservation under `_BUDGET_LOCK`; actual API call outside the lock. Judge-score parser (`_parse_judge_score`) uses `re.fullmatch` to reject refusals |
| `safety.py` | Prompt scanner: 15 injection patterns, PII detection, toxicity checks (violence, bias, illegal content), length limits, risk scoring |
| `url_validator.py` | SSRF guard: rejects non-http schemes and hostnames that resolve to loopback / RFC1918 / link-local (including AWS metadata 169.254.169.254) / multicast / reserved. Called at service register, update, probe, and scheduled health check |
| `sensitivity.py` | `enforce_sensitivity()` gates LLM access on services labelled `confidential`. Non-admins blocked; admins require explicit `allow_confidential=true` override. Every attempt (allowed or denied) is audited |
| `draft_service.py` | Shared HITL abstraction: `create_draft()` persists LLM output as unapproved `AILlmDraft`; `approve_draft()` sets `approved_by_user_id`/`approved_at` and audits. Used by dashboard insight and compliance AI report |

### Database engine (`database.py`)

- SQLite connection event listener installs `PRAGMA foreign_keys=ON` on every connection, so `ForeignKey` declarations actually reject dangling references (SQLite defaults to FK off).
- `main.py` startup installs SQLite `BEFORE UPDATE` and `BEFORE DELETE` triggers on `audit_log` so the append-only guarantee is enforced at the DB layer in addition to the hash chain.

## 4. LLM Client Pipeline

All the LLM provider API calls are centralized in `llm_client.py`. Two-tier model architecture:

- **Actor — `settings.llm_model` (Sonnet 4.6 default):** the service under test and every synthesis task (incident summaries, dashboard insights, compliance reports).
- **Judge — `settings.judge_model` (Haiku 4.5 default):** merged `judge_response` — one structured Haiku call per factuality test case returns `{factuality, hallucination}`. Different size/training emphasis from the actor narrows the "model scoring itself" correlation. The earlier split `score_factuality` + `detect_hallucination` pair was merged in commit `0fbddac` to halve judge traffic.
- **Safety:** single-layer regex only (`safety.py::scan_input`). An LLM classifier second layer existed briefly and was removed in commit `73e09b3` — false-positive rate on legitimate prompts didn't justify the cost.

### Flow through `_make_api_call` (5 stages)

```
[1] Input Safety Scan        -> scan_input() from safety.py: 15-pattern regex tripwire + PII
                                detection (email/phone/SSN/credit-card) + length cap. Raises
                                PromptSafetyError (422) if risk_score >= 80.
[2] Atomic check + reserve   -> _check_budget() AND a reservation INSERT into APIUsageLog (status='reserved',
                                worst-case cost per-model) happen under _BUDGET_LOCK so concurrent callers
                                cannot race past the limit. Raises BudgetExceededError (402/429).
[3] API Call with Retry      -> client.messages.create() with exponential backoff. Lock released before
                                the call so slow requests don't block other evaluators. 2 retries.
[4] Output Safety Scan       -> scan_output() checks response for PII leakage and refusal patterns.
[5] Finalize reservation     -> Update the reserved row with real tokens, cost, latency, status. Cost
                                is computed from a per-model `_PRICING` dict so Haiku vs Sonnet rows
                                are priced correctly. Statuses:
                                (success | error_timeout | error_rate_limit | error_server | error_auth |
                                 error_bad_request | error_unknown | blocked_safety).
```

### Per-model `_PRICING`

| Model | Input ($/M tokens) | Output ($/M tokens) | Used for |
|-------|-------------------|---------------------|----------|
| `claude-sonnet-4-6-20250415` | 3.00 | 15.00 | Actor, synthesis |
| `claude-haiku-4-5-20251001`  | 1.00 |  5.00 | Merged judge (factuality + hallucination) |
| unknown model | 3.00 (Sonnet fallback, warns once) | 15.00 | Future model additions |

### LLM Function Signatures

| Function | Caller String | Module | Max Tokens | Purpose |
|----------|--------------|--------|------------|---------|
| `test_connection(prompt, model)` | `test_connection` | M1 | 50 | Verify API connectivity and latency |
| `run_eval_prompt(prompt, system_context)` | `run_eval_prompt` | M2 | 1024 | Execute eval test case, return raw response |
| `judge_response(prompt, expected, actual)` | `judge_response` | M2 | 60 | Merged factuality + hallucination judge. Single Haiku call returns structured JSON `{factuality: float\|None, hallucination: float\|None}`. `None` for a rubric means the judge refused or returned malformed content — callers treat it as `judge_refused` and EXCLUDE from aggregates so a flaky judge cannot spuriously trip drift. Replaces the separate `score_factuality` + `detect_hallucination` pair (commit `0fbddac`) |
| `generate_summary(service_name, severity, symptoms, checklist)` | `generate_summary` | M3 | 1024 | Draft stakeholder update + root causes |
| `generate_dashboard_insight(metrics)` | `generate_dashboard_insight` | M2 | 1024 | Summarize platform health + action items |
| `generate_compliance_summary(audit_data, incidents_data, drift_data)` | `generate_compliance_summary` | M4 | 1024 | Generate governance compliance report |

Full prompt templates are documented in [PROMPT_CHANGE_LOG](PROMPT_CHANGE_LOG.md).

## 5. Database Models (14 models)

This is the canonical model inventory. All models are defined in `backend/app/models/__init__.py`.

| Model | Table | Purpose |
|-------|-------|---------|
| `User` | `users` | Identity, RBAC role enum (admin/maintainer/viewer), bcrypt-hashed password |
| `AIService` | `ai_services` | Service registry: endpoint URLs (SSRF-validated), owner, model tags, environment, sensitivity label |
| `ConnectionLog` | `connection_logs` | Health check history per service: latency, status, response snippet |
| `EvalTestCase` | `eval_test_cases` | Evaluation dataset: input prompts, expected outputs, categories |
| `EvalRun` | `eval_runs` | Evaluation execution records: aggregate scores, drift status, run type, `judge_model` (which model produced the scores — traces each run back to its judge for audit), `run_status` (`complete` \| `incomplete` — UI distinguishes "no measurable signal" from "0% quality" when every case errored or the judge refused) |
| `EvalResult` | `eval_results` | Per-test-case results: individual scores, variance, latency, drift tracking |
| `Incident` | `incidents` | Incident records: severity, status, symptoms, checklist, LLM summary draft/approved, `reviewer_note` (required on approve), `approved_at` timestamp |
| `MaintenancePlan` | `maintenance_plans` | Maintenance actions: rollback plan, validation steps, approval status |
| `AuditLog` | `audit_log` | Append-only tamper-evident compliance trail. Every row carries `content_hash` (SHA-256 over content + `prev_hash`) — any UPDATE/DELETE breaks the chain and is detectable via `/compliance/audit-log/verify`. SQLite triggers reject app-path mutation |
| `Telemetry` | `telemetry` | Service performance telemetry: metric name, value, timestamp |
| `APIUsageLog` | `api_usage_log` | LLM cost tracking: tokens, cost, latency, status (success / reserved / error_timeout / error_rate_limit / error_server / ...), safety flags, risk score. `service_id` FK, `prompt_text`, `response_text` (2000 char max) for call tracing. Used both for billing and for the atomic reservation pattern that prevents budget-race bypass |
| `LoginAttempt` | `login_attempts` | Failed login tracking: email, timestamp, IP address, used for throttling. Success/failure/lockout also mirrored to `audit_log` |
| `Alert` | `alerts` | Alert system: type, severity, message, service_id (FK to AIService), acknowledged flag. Auto-created on drift detection with audit trail |
| `AILlmDraft` | `ai_llm_drafts` | Shared HITL envelope for LLM outputs. Covers `dashboard_insight` and `compliance_report` surfaces (incident summaries use their own columns on the Incident row). Unapproved until `approved_by_user_id` is set |

## 6. Frontend

22 JSX files organized into pages, common components, and evaluation-specific components.

### Pages (9)

| Page | File | Purpose |
|------|------|---------|
| Login | `LoginPage.jsx` | Credential entry and authentication |
| Dashboard | `DashboardPage.jsx` | Fleet-wide metrics, percentiles, LLM-generated insights |
| Services | `ServicesPage.jsx` | Service registry CRUD, connection testing, health status |
| Incidents | `IncidentsPage.jsx` | Incident listing with severity and status filtering |
| Incident Detail | `IncidentDetailPage.jsx` | Deep-dive view with LLM-generated summaries |
| Evaluations | `EvaluationsPage.jsx` | Eval harness execution, results, drift visualization |
| Governance | `GovernancePage.jsx` | Audit log viewer, compliance report generation |
| Data Policy | `DataPolicyPage.jsx` | Data classification and handling policy reference |
| Settings | `SettingsPage.jsx` | API configuration, model settings, budget monitoring |

All pages implement loading, empty, and error states.

### Common Components (13)

| Component | Purpose |
|-----------|---------|
| `CommandPalette` | Cmd+K quick navigation and actions |
| `DataTable` | Sortable/filterable data table |
| `EmptyState` | Placeholder when no data available |
| `ErrorState` | Error display with retry actions |
| `Kbd` | Keyboard shortcut badge |
| `LoadingSkeleton` | Shimmer loading placeholder |
| `MetricCard` | Numeric metric display with trends |
| `Modal` | Accessible dialog with focus trap |
| `PageHeader` | Page title and action bar |
| `Sidebar` | Navigation with active state indicators |
| `StatusBadge` | Color-coded status indicator |
| `ThemeProvider` | Dark/light theme context with CSS variable toggling |
| `Toast` | Notification toast system |

### Evaluation Components (3)

| Component | Purpose |
|-----------|---------|
| `DriftAnalysis` | Drift visualization with severity indicators and trend charts |
| `EvalRunsSection` | Evaluation run history listing |
| `TestCasesSection` | Test case management interface |

### Design System

- CSS variable design tokens for semantic colors, enabling theme switching without class changes
- Dark and light modes via `ThemeProvider`
- Typography: Inter (body), JetBrains Mono (code/metrics)
- WCAG 2.2 AA: ARIA roles, focus traps, keyboard navigation, screen reader support, skip-to-main link

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Open command palette |
| G then D | Dashboard |
| G then S | Services |
| G then I | Incidents |
| G then E | Evaluations |
| ? | Help |
| Escape | Close modal/palette |

## 7. Security

### Authentication

- JWT tokens signed with HS256, expiration configurable via `access_token_expire_minutes` (default: 480)
- Passwords hashed with bcrypt before storage
- Every login success, failure, and lockout is recorded in both `login_attempts` (for throttle math) and `audit_log` (for governance review)

### RBAC

| Role | Access |
|------|--------|
| `admin` | Full read-write on all resources, user management, audit log read + integrity verify, AI compliance report, confidential LLM override |
| `maintainer` | Read-write on services, incidents, evaluations, maintenance; cannot read audit log or user roster |
| `viewer` | Read-only on operational data; cannot read audit log |

Every 403 denial is itself written to `audit_log` as a `role_denied` event with the target role requirement, so probing attempts surface during compliance review.

### Audit log integrity (tamper-evident)

- SHA-256 hash chain: each row commits to its content + the previous row's hash. `/compliance/audit-log/verify` (admin) walks the chain and returns `{total, valid, broken_at, reason}`.
- SQLite `BEFORE UPDATE` and `BEFORE DELETE` triggers on `audit_log` reject application-path mutations.
- A `threading.Lock` in `middleware/audit.py::log_action()` serialises concurrent writes so two callers cannot link to the same `prev_hash`.

### SSRF protection

- `services/url_validator.py` rejects non-http(s) schemes and any hostname that resolves to loopback, RFC1918, link-local (including AWS metadata `169.254.169.254`), multicast, or reserved ranges.
- Validated at register, update, probe, and scheduled health check — closes DNS-rebinding windows.

### Sensitivity label enforcement

- Services labelled `confidential` cannot reach the LLM unless the caller passes `allow_confidential=true` AND is an admin. Every attempt (allowed override or denied block) is audited.

### Login Throttling

- Failed logins recorded in `LoginAttempt` with email, timestamp, IP address.
- 5 failed attempts within 15 minutes triggers temporary account lockout; the lockout event itself is audited.

### Input Validation

- `max_length` constraints on user-supplied text fields.
- All LLM-bound text passes through the safety scanner.
- Pydantic models enforce type constraints and required fields on all endpoints.
- Compliance export dates are parsed strictly — malformed `from_date` / `to_date` returns HTTP 400 instead of silently dropping the filter.

### Human-in-the-loop on LLM output

- Incident summaries: written to `summary_draft`. Published to `summary` only via explicit approval that requires a mandatory `reviewer_note` (≥20 non-whitespace chars). Double-approval returns 409.
- Dashboard insights + compliance AI reports: persisted as `AILlmDraft` rows; separate approve endpoint sets `approved_by_user_id`.
- Compliance export includes only approved summaries — drafts never appear in the official record.

### Budget / rate limit under concurrency

- `_make_api_call()` holds `_BUDGET_LOCK` across the limit check AND a reservation INSERT. Concurrent callers cannot all race past the same pre-reserved count. The actual API call happens outside the lock so slow requests don't block the pool.

### Retry with Exponential Backoff

- 2 retries for transient the LLM provider errors (timeouts, 429, 5xx).
- Backoff formula: `2^attempt + random(0, 0.5)` seconds.
- Non-retryable errors (AuthenticationError, BadRequestError) fail immediately.

## 8. Configuration Reference (27 settings)

This is the canonical settings table. All settings are in `backend/app/config.py`, loaded from `.env` via Pydantic `BaseSettings`.

| Setting | Default | Category |
|---------|---------|----------|
| `anthropic_api_key` | (required) | LLM |
| `llm_model` | `claude-sonnet-4-6-20250415` | LLM — actor / synthesis |
| `judge_model` | `claude-haiku-4-5-20251001` | LLM — merged factuality + hallucination judge |
| `llm_max_tokens` | 1024 | LLM |
| `llm_timeout_seconds` | 30 | LLM |
| `database_url` | `sqlite:///./aiops.db` | Database |
| `secret_key` | `change-me-in-production` | Security |
| `algorithm` | `HS256` | Security |
| `access_token_expire_minutes` | 480 | Security |
| `max_login_attempts` | 5 | Security |
| `login_lockout_minutes` | 15 | Security |
| `max_prompt_length` | 10000 | Safety |
| `drift_threshold` | 75.0 | Evaluation |
| `eval_schedule_minutes` | 60 | Scheduling |
| `health_check_schedule_minutes` | 5 | Scheduling |
| `api_daily_budget` | 5.0 | Budget |
| `api_monthly_budget` | 25.0 | Budget |
| `api_max_calls_per_minute` | 30 | Rate Limiting — sized for demo eval batches (a 10-case factuality run fires ~20 the AI calls: 10 actor + 10 merged judge, plus headroom for concurrent UI activity) |
| `api_max_calls_per_user_per_minute` | 20 | Rate Limiting — per-user portion of the global budget; enforced inside `_BUDGET_LOCK` with atomic reservation (see `llm_client.py::_make_api_call`) |
| `hard_max_cost_per_call_usd` | 0.05 | Hard cap — rejects a the AI call BEFORE the network if its worst-case cost exceeds this ceiling |
| `hard_max_tokens_per_call` | 2000 | Hard cap — ceiling on `max_tokens` regardless of caller; blocks a bug asking for 100 k tokens |
| `hard_max_prompt_chars` | 12000 | Hard cap — ceiling on input length, checked before tokenisation |
| `app_name` | `AI Health Check` | Application |
| `debug` | `true` | Application |
| `cors_origins` | `http://localhost:5173,http://localhost:3000` | Application |
| `log_sql` | `false` | Application |
| `scheduler_enabled` | `true` | Application |

For testing details, see [TESTING_STRATEGY](TESTING_STRATEGY.md). For drift detection algorithm, see [EVAL_DATASET_CARD](EVAL_DATASET_CARD.md). For prompt templates, see [PROMPT_CHANGE_LOG](PROMPT_CHANGE_LOG.md). For onboarding steps, see [ONBOARDING](ONBOARDING.md).
