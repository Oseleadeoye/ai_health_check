# AI Health Check -- Module Guide

> Last updated: 2026-05-02 · current as of commit `HEAD`

This document breaks down each module: what was built, who owns it, the key files, and how they connect. Use this to prepare for the individual Q&A.

For system-wide architecture, database models, and configuration, see [ARCHITECTURE](ARCHITECTURE.md).

## Overview

| Module | Owner | Scope |
|--------|-------|-------|
| M1: Service Registry & Connection | Jack | Service catalog, health check scheduling, connection testing |
| M2: Monitoring Dashboard & Evaluation | Sakir | Dashboard metrics, eval harness (Factuality, Semantic, PII), drift detection |
| M3: Incident Triage & Maintenance Planner | Osele | Incident lifecycle, LLM summaries, maintenance planning |
| M4: Governance, Security & Compliance | Jeewanjot | Audit logging, compliance reports, user management |
| Cross-cutting | Shared | Safety scanner, SSRF guard, sensitivity label enforcement, concurrency-safe budget enforcement, tamper-evident audit chain, shared HITL draft service, login throttling, LLM call tracing, alert system, design system |

---

## Module 1: Service Registry & Connection

**Owner:** Jack

### What It Does

- Provides a CRUD catalog of registered AI services (name, owner, endpoint, environment, model, sensitivity label)
- Runs scheduled health checks every 5 minutes via APScheduler using HTTP probes (no LLM API consumption)
- Supports on-demand connection testing in two modes: HTTP endpoint probe or AI model health check
- Records all connection results in `ConnectionLog` for latency tracking and dashboard metrics
- **Auto-provisioning**: Newly registered services are automatically seeded with a 6-test-case evaluation suite (Factuality, JSON, DAN Jailbreak, PII Leakage, Instruction Following)

### Key Files

| File | Purpose |
|------|---------|
| `backend/app/routers/services.py` | 6 endpoints: service CRUD + connection testing |
| `backend/app/main.py` | APScheduler setup, `scheduled_health_check()` function |
| `backend/app/models/__init__.py` | `AIService`, `ConnectionLog`, `Environment`, `SensitivityLabel` models |
| `backend/app/services/llm_client.py` | `test_connection()` -- used for LLM-mode connection testing |
| `backend/app/services/url_validator.py` | SSRF guard: blocks metadata service, RFC1918, link-local, non-http schemes on endpoint_url |
| `backend/app/services/sensitivity.py` | `enforce_sensitivity()` blocks LLM calls for confidential services unless admin overrides |
| `frontend/src/pages/ServicesPage.jsx` | Service registry UI with CRUD forms, test connection button, confidential override confirm dialog |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/services` | List all services |
| GET | `/api/v1/services/{id}` | Get single service |
| POST | `/api/v1/services` | Create service (admin/maintainer) |
| PUT | `/api/v1/services/{id}` | Update service (admin/maintainer) |
| DELETE | `/api/v1/services/{id}` | Delete service (admin/maintainer) |
| POST | `/api/v1/services/{id}/test-connection` | Test connection (mode=http or mode=llm) |

### Database Models

- `AIService` -- service registry with environment enum (prod/staging/dev) and sensitivity label (public/internal/confidential)
- `ConnectionLog` -- stores latency_ms, status, response_snippet per check

### Stretch Goals Achieved

- Dual connection testing modes (HTTP probe + LLM health check)
- Sensitivity label classification on each service **with enforcement** — confidential services require admin override to reach the LLM; every override audited
- Automatic health check scheduling (configurable interval)
- SSRF guard — blocks registration/update/probe/scheduled tick from hitting metadata services, private IPs, or non-http schemes

---

## Module 2: Monitoring Dashboard & Evaluation

**Owner:** Sakir

### What It Does

- Aggregates fleet-wide metrics: active service count, average latency, error rate, average quality score
- Computes P50/P95/P99 latency percentiles from connection logs and API usage data
- Runs evaluation harness: executes test cases against the model, scores responses (Factuality via LLM-as-judge, Semantic Similarity via TF-IDF, PII Safe via regex, and Format via JSON parse), and runs hallucination detection on factuality cases
- Detects model drift with severity classification (none/warning/critical), trend analysis (improving/declining/stable), and confidence scoring
- Provides per-test-case drift breakdown with historical score tracking
- Generates AI-powered dashboard insights summarizing platform health
- Traces LLM calls with full prompt/response storage for auditability
- Aggregates cost-by-service for monthly spend analysis
- Manages alerts auto-created on drift, with acknowledge workflow
- **Safety Scanner Bypass**: Evaluation harness automatically bypasses the input safety scanner for authorized test cases (enabling resilience testing against DAN/Injection)

### Key Files

| File | Purpose |
|------|---------|
| `backend/app/routers/dashboard.py` | 16 endpoints: metrics, trends, drift alerts, AI summary, API usage, performance, safety stats, LLM call traces, cost-by-service, alerts |
| `backend/app/routers/evaluations.py` | 10 endpoints: test case CRUD, eval run execution, cost preview, drift check, drift trend |
| `backend/app/services/llm_client.py` | `run_eval_prompt()`, `score_factuality()`, `generate_dashboard_insight()`, `detect_hallucination()` |
| `backend/app/models/__init__.py` | `EvalTestCase`, `EvalRun`, `EvalResult`, `Telemetry`, `APIUsageLog` models |
| `frontend/src/pages/DashboardPage.jsx` | Dashboard UI with metric cards, trend charts, drift alerts |
| `frontend/src/pages/EvaluationsPage.jsx` | Eval harness UI with test case management and run history |
| `frontend/src/pages/SettingsPage.jsx` | API config, budget monitoring, the AI health check |
| `frontend/src/components/evaluations/DriftAnalysis.jsx` | Drift visualization with severity indicators |
| `frontend/src/components/evaluations/EvalRunsSection.jsx` | Eval run history listing |
| `frontend/src/components/evaluations/TestCasesSection.jsx` | Test case management |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/dashboard/metrics` | Aggregated metrics with percentiles and trends |
| GET | `/api/v1/dashboard/latency-trend` | 24-hour latency trend in 4-hour buckets |
| GET | `/api/v1/dashboard/quality-trend` | Quality score history (last 6 runs) |
| GET | `/api/v1/dashboard/error-trend` | 7-day error rate by day of week |
| GET | `/api/v1/dashboard/recent-evals` | Last 10 evaluation runs |
| GET | `/api/v1/dashboard/drift-alerts` | Drift-flagged runs from last 7 days |
| POST | `/api/v1/dashboard/ai-summary` | LLM-generated platform health summary (admin/maintainer) |
| GET | `/api/v1/dashboard/claude-health` | the AI API connectivity and latency check |
| GET | `/api/v1/dashboard/settings` | Non-sensitive platform configuration |
| GET | `/api/v1/dashboard/api-usage` | Daily/monthly token and cost usage with breakdown |
| GET | `/api/v1/dashboard/performance` | Detailed performance: percentiles, error breakdown, throughput, efficiency |
| GET | `/api/v1/dashboard/api-safety` | Safety metrics: blocked calls, flagged prompts, risk distribution |
| GET | `/api/v1/dashboard/api-calls/{id}` | Full LLM call trace with prompt/response text |
| GET | `/api/v1/dashboard/cost-by-service` | Monthly cost aggregated per AI service |
| GET | `/api/v1/dashboard/alerts` | List active alerts (auto-created on drift) |
| POST | `/api/v1/dashboard/alerts/{id}/acknowledge` | Acknowledge an alert (admin/maintainer) |
| POST | `/api/v1/evaluations/test-cases` | Create eval test case (admin/maintainer) |
| GET | `/api/v1/evaluations/test-cases` | List test cases (optional `service_id` + `environment` filters) |
| GET | `/api/v1/evaluations/test-cases/{id}` | Get single test case |
| DELETE | `/api/v1/evaluations/test-cases/{id}` | Delete test case (admin/maintainer) |
| POST | `/api/v1/evaluations/run/{service_id}` | Execute evaluation run (admin/maintainer) |
| GET | `/api/v1/evaluations/runs` | List eval runs (optional `service_id` + `environment` filters) |
| GET | `/api/v1/evaluations/runs/{id}` | Get single eval run |
| GET | `/api/v1/evaluations/cost-preview/{service_id}` | Preview API calls and estimated cost |
| GET | `/api/v1/evaluations/drift-check/{service_id}` | Enhanced drift check with severity, trend, per-test breakdown |
| GET | `/api/v1/evaluations/drift-trend/{service_id}` | Quality score history for drift charting |

### Database Models

- `EvalTestCase` -- evaluation dataset: prompt, expected output, category (factuality/format_json)
- `EvalRun` -- evaluation execution: aggregate quality/factuality/format scores, drift flag, run type, `hallucination_score` (0-100, from `detect_hallucination()`)
- `EvalResult` -- per-test-case results: individual score, latency, response text, status
- `Telemetry` -- service performance metric samples (latency, quality scores)
- `APIUsageLog` -- LLM cost tracking: tokens, cost, latency, status, safety flags. New columns: `service_id` (FK to AIService for cost-by-service), `prompt_text` and `response_text` (2000 char max, for call tracing)
- `Alert` -- auto-created on drift detection: type, severity, message, `service_id` (FK to AIService), acknowledged flag. See [ARCHITECTURE](ARCHITECTURE.md#5-database-models-13-models) for full schema

### Stretch Goals Achieved

- Per-test-case drift tracking (not just aggregate scores)
- Severity classification with sudden drop detection (>15 point drop = critical)
- Trend analysis using split-half comparison across configurable window (2-20 runs)
- Confidence scoring based on historical data volume
- Cost preview before running evaluations
- AI-generated dashboard insights
- Hallucination detection via LLM-as-judge (score 0-100 on factuality cases)
- Full LLM call tracing with prompt/response storage (2000 char max)
- Cost-by-service aggregation for monthly spend analysis
- Alert system with auto-creation on drift and acknowledge workflow

For drift detection algorithm details, see [EVAL_DATASET_CARD](EVAL_DATASET_CARD.md).

---

## Module 3: Incident Triage & Maintenance Planner

**Owner:** Osele

### What It Does

- Manages the full incident lifecycle: open, investigate, resolved, closed
- Captures troubleshooting checklist (data issue, prompt change, model update, infrastructure, safety/policy)
- Generates AI-assisted stakeholder updates and root cause analysis via the model
- Enforces human-in-the-loop approval: AI drafts go to `summary_draft`, must be explicitly approved before becoming the official `summary`. Approval requires a `reviewer_note` (≥20 non-whitespace chars) so the reviewer cannot silently rubber-stamp a draft. Double-approval returns 409 — attribution is preserved
- Creates maintenance plans linked to incidents with rollback procedures and admin approval

### Key Files

| File | Purpose |
|------|---------|
| `backend/app/routers/incidents.py` | 4 endpoints: incident CRUD, LLM summary generation, approval |
| `backend/app/routers/maintenance.py` | 3 endpoints: maintenance plan CRUD, admin approval |
| `backend/app/services/llm_client.py` | `generate_summary()` -- drafts stakeholder update + root causes |
| `backend/app/models/__init__.py` | `Incident`, `IncidentStatus`, `Severity`, `MaintenancePlan` models |
| `frontend/src/pages/IncidentsPage.jsx` | Incident listing with severity/status filtering |
| `frontend/src/pages/IncidentDetailPage.jsx` | Individual incident deep-dive with summary generation and approval |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/incidents` | List all incidents |
| POST | `/api/v1/incidents` | Create incident (admin/maintainer) |
| POST | `/api/v1/incidents/{id}/generate-summary` | Generate LLM draft summary (admin/maintainer) |
| POST | `/api/v1/incidents/{id}/approve-summary` | Approve draft and publish (admin/maintainer) |
| GET | `/api/v1/maintenance` | List all maintenance plans |
| POST | `/api/v1/maintenance` | Create maintenance plan (admin/maintainer) |
| PUT | `/api/v1/maintenance/{id}/approve` | Approve maintenance plan (admin only) |

### Database Models

- `Incident` -- severity (low/medium/high/critical), status (open/investigating/resolved/closed), symptoms, checklist booleans, summary_draft, summary (approved), root_causes, approved_by, approved_at, reviewer_note (mandatory ≥20 chars)
- `MaintenancePlan` -- linked to incident, risk_level, rollback_plan, validation_steps, scheduled_date, approved flag

### Stretch Goals Achieved

- Full troubleshooting checklist integrated into LLM prompt for better root cause analysis
- Human-in-the-loop approval flow (draft -> review -> publish) with mandatory reviewer note and idempotency guard
- Maintenance plan approval restricted to admin role

---

## Module 4: Governance, Security & Compliance

**Owner:** Jeewanjot

### What It Does

- Automatically logs every state-changing operation (POST/PUT/DELETE) to an immutable audit trail
- Provides filtered audit log queries with date range and action type filters
- Supports compliance data export in JSON and PDF formats
- Generates AI-powered compliance reports from audit logs, incidents, and drift data
- Manages user roles (admin-only user role updates with self-modification prevention)

### Key Files

| File | Purpose |
|------|---------|
| `backend/app/routers/users.py` | User list + role update (admin only) — mounted under `/api/v1/compliance` |
| `backend/app/routers/audit.py` | Audit log queries + hash-chain integrity verify (admin only) |
| `backend/app/routers/export.py` | JSON/PDF export with audit + incidents + maintenance, AI compliance report (HITL draft/approve) |
| `backend/app/services/draft_service.py` | Shared HITL abstraction: `create_draft()` / `approve_draft()` |
| `backend/app/middleware/audit.py` | `log_action()` with SHA-256 hash chain + `verify_audit_chain()`, serialised under `_AUDIT_LOCK` |
| `backend/app/middleware/rbac.py` | `require_role()` -- role-based access enforcement |
| `backend/app/middleware/auth.py` | JWT verification, bcrypt hashing, login throttling |
| `backend/app/services/llm_client.py` | `generate_compliance_summary()` -- AI governance report |
| `backend/app/models/__init__.py` | `AuditLog`, `User`, `UserRole`, `LoginAttempt` models |
| `frontend/src/pages/GovernancePage.jsx` | Audit log viewer, compliance report generation |
| `frontend/src/pages/DataPolicyPage.jsx` | Data classification and handling policy reference |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/compliance/audit-log` | Query audit logs (date range strictly validated, action filter, limit) — admin only |
| GET | `/api/v1/compliance/audit-log/verify` | Walk the hash chain and report integrity — admin only |
| GET | `/api/v1/compliance/users` | List all users (admin only) |
| PUT | `/api/v1/compliance/users/{id}/role` | Update user role (admin only, no self-modification) |
| POST | `/api/v1/compliance/export` | Export compliance data as JSON or PDF (includes incidents + maintenance; truncation warnings) |
| POST | `/api/v1/compliance/ai-report` | Generate AI compliance report draft (admin only) |
| POST | `/api/v1/compliance/ai-report/{id}/approve` | Approve the AI report draft (admin only) |
| GET | `/api/v1/compliance/ai-report/recent` | List approved / all drafts (admin only) |

### Database Models

- `AuditLog` -- append-only tamper-evident log: user_id, action, target_table, target_id, old_value, new_value, timestamp, `content_hash`, `prev_hash`. SQLite BEFORE UPDATE/DELETE triggers reject mutation
- `AILlmDraft` -- shared HITL envelope for dashboard insights + compliance reports: surface, content, generated_by_user_id, approved_by_user_id, approved_at
- `User` -- identity with role enum (admin/maintainer/viewer), bcrypt password hash
- `LoginAttempt` -- email, timestamp, IP address, success boolean. Success/failure/lockout also written to AuditLog
- `Alert` -- governance-relevant alerting: type, severity, message, service_id, acknowledged. Auto-created on drift; managed via dashboard endpoints (see [Module 2](#module-2-monitoring-dashboard--evaluation))

### Stretch Goals Achieved

- PDF export using ReportLab with styled table output AND explicit truncation warnings in red
- JSON/PDF export includes audit + incidents + maintenance plans (not just audit records)
- Strict date parsing on all date-filtered endpoints (400 on malformed, 400 on inverted range) — no silent compliance evidence holes
- AI-generated compliance reports with HITL draft/approve flow
- Tamper-evident audit chain (SHA-256 hash chain) with integrity verify endpoint
- Self-modification prevention on role changes
- Role-denial events (`role_denied`) written to audit log for forensic review

---

## Cross-Cutting Features

These features span multiple modules and are not owned by a single team member.

### Prompt Safety Scanner

| File | Purpose |
|------|---------|
| `backend/app/services/safety.py` | Input and output scanning |

- 15 regex patterns for injection detection (role overrides, delimiter exploitation, system prompt extraction)
- PII detection for email, phone, SSN, credit card
- Toxicity checks via `scan_output()` toxicity_patterns: violence, bias, and illegal content filtering
- Prompt length enforcement (max 10,000 characters)
- Risk scoring 0-100; score >= 80 blocks the prompt
- Output scanning for PII leakage, toxicity, and model refusal patterns
- Raises `PromptSafetyError` (HTTP 422) when thresholds exceeded

### API Budget Enforcement (concurrency-safe)

| File | Purpose |
|------|---------|
| `backend/app/services/llm_client.py` | `_check_budget()` + atomic reservation under `_BUDGET_LOCK` |

- Daily cap: $5.00, monthly cap: $25.00 (tracked via `APIUsageLog`)
- Per-call cost tracking with token usage logging (input + output)
- Global rate limit: 30 calls/min, per-user: 20 calls/min
- Raises `BudgetExceededError` (HTTP 402 for budget, HTTP 429 for rate limits)
- Lock + reservation pattern prevents N concurrent callers from all racing past the limit. Reservation INSERT happens under the lock; actual API call runs outside so slow requests don't block the pool

### Tamper-evident Audit Chain

| File | Purpose |
|------|---------|
| `backend/app/middleware/audit.py` | `log_action()` with SHA-256 hash chain, `verify_audit_chain()`, serialised by `_AUDIT_LOCK` |
| `backend/app/main.py` | Installs SQLite BEFORE UPDATE/DELETE triggers on `audit_log` at startup |
| `backend/app/routers/audit.py` | Admin-only `/audit-log/verify` endpoint walks the chain |

- Every audit row commits SHA-256 over row content + previous row's hash
- Any UPDATE or DELETE on a past row breaks the chain — detectable via verify endpoint
- DB triggers reject app-path mutation as defence in depth
- `threading.Lock` around read-compute-insert so concurrent writes produce distinct prev_hashes

### SSRF Guard

| File | Purpose |
|------|---------|
| `backend/app/services/url_validator.py` | `validate_outbound_url()` |

- Rejects non-http schemes (file://, gopher://, etc.) and hostnames resolving to loopback, RFC1918, link-local (AWS metadata 169.254.169.254), multicast, reserved
- Called at service register, update, probe, and the scheduled health-check tick
- Mixed public/private DNS resolution fails the whole URL (defeats DNS rebinding)

### Shared HITL Draft Service

| File | Purpose |
|------|---------|
| `backend/app/services/draft_service.py` | `create_draft()` + `approve_draft()` |

- Any LLM output meant for governance-grade consumption routes through this service
- Persists as unapproved `AILlmDraft` row; separate approve endpoint sets `approved_by_user_id` + `approved_at`
- Create AND approve are both audited
- Used by dashboard insights and compliance AI reports; incident summaries use their own columns on the Incident row (same pattern)

### Login Throttling

| File | Purpose |
|------|---------|
| `backend/app/routers/auth.py` | `_check_login_throttle()`, `_record_login_attempt()` |

- Records all login attempts with email, IP, timestamp
- 5 failed attempts within 15 minutes triggers lockout
- Lockout returns HTTP 429

### LLM Call Tracing

| File | Purpose |
|------|---------|
| `backend/app/services/llm_client.py` | Stores `prompt_text` and `response_text` (2000 char max) in `APIUsageLog` on every call |
| `backend/app/routers/dashboard.py` | `GET /api-calls/{id}` returns full trace; `GET /cost-by-service` aggregates monthly cost per service |

- Every LLM call records the prompt sent and response received in `APIUsageLog.prompt_text` / `APIUsageLog.response_text`
- `APIUsageLog.service_id` links each call to the originating AI service for per-service cost analysis
- Full trace retrievable via `GET /api/v1/dashboard/api-calls/{id}`
- Inspired by LangSmith/Helicone tracing patterns

### Alert System

| File | Purpose |
|------|---------|
| `backend/app/models/__init__.py` | `Alert` model: type, severity, message, service_id, acknowledged |
| `backend/app/routers/dashboard.py` | `GET /alerts`, `POST /alerts/{id}/acknowledge` |

- Alerts are auto-created when drift detection flags a service
- Each alert has a severity level and links to the affected AI service
- Dashboard displays active alerts with an Acknowledge button
- Acknowledged alerts are retained for audit trail but filtered from active view
- Inspired by Datadog/PagerDuty alerting patterns

### Design System & Accessibility

| File | Purpose |
|------|---------|
| `frontend/src/index.css` | CSS variable design tokens, theme definitions |
| `frontend/src/components/common/ThemeProvider.jsx` | Dark/light mode toggle |
| `frontend/src/components/common/CommandPalette.jsx` | Cmd+K navigation |
| `frontend/src/components/common/Modal.jsx` | Accessible dialog with focus trap |

- WCAG 2.2 AA: ARIA roles, focus traps, screen reader support, skip-to-main link
- Inter (body) + JetBrains Mono (code) font pairing
- Full keyboard navigation: Cmd+K palette, G+D/S/I/E shortcuts, Escape to close

---

## End-to-End Demo Flow

This is the exact path through the application that demonstrates all four modules working together.

| Step | Action | Page | API Call | Module |
|------|--------|------|----------|--------|
| 1 | Log in as admin | LoginPage | `POST /api/v1/auth/login` | Auth |
| 2 | View fleet health metrics | DashboardPage | `GET /api/v1/dashboard/metrics` | M2 |
| 3 | Register a new AI service | ServicesPage | `POST /api/v1/services` | M1 |
| 4 | Test connection to the service | ServicesPage | `POST /api/v1/services/{id}/test-connection` | M1 |
| 5 | Create evaluation test cases | EvaluationsPage | `POST /api/v1/evaluations/test-cases` | M2 |
| 6 | Run evaluation and detect drift | EvaluationsPage | `POST /api/v1/evaluations/run/{id}` | M2 |
| 7 | Check drift severity and trend | EvaluationsPage | `GET /api/v1/evaluations/drift-check/{id}` | M2 |
| 8 | Create incident from drift alert | IncidentsPage | `POST /api/v1/incidents` | M3 |
| 9 | Generate AI summary for incident | IncidentDetailPage | `POST /api/v1/incidents/{id}/generate-summary` | M3 |
| 10 | Review and approve the AI draft (with reviewer_note) | IncidentDetailPage | `POST /api/v1/incidents/{id}/approve-summary` | M3 |
| 11 | Create maintenance plan with rollback | IncidentDetailPage | `POST /api/v1/maintenance` | M3 |
| 12 | Approve the maintenance plan | IncidentDetailPage | `PUT /api/v1/maintenance/{id}/approve` | M3 |
| 13 | View audit trail of all actions | GovernancePage | `GET /api/v1/compliance/audit-log` | M4 |
| 14 | Verify audit log integrity (hash-chain walk) | GovernancePage | `GET /api/v1/compliance/audit-log/verify` | M4 |
| 15 | Generate + approve AI compliance report | GovernancePage | `POST /api/v1/compliance/ai-report` → `POST /ai-report/{id}/approve` | M4 |
| 16 | Export compliance evidence as JSON/PDF | GovernancePage | `POST /api/v1/compliance/export` | M4 |

### Flow Summary

Monitor (M2) -> Detect drift (M2) -> Create incident (M3) -> Generate AI summary (M3) -> Approve draft (M3) -> Plan maintenance (M3) -> Approve plan (M3) -> View audit trail (M4) -> Generate compliance report (M4) -> Export evidence (M4)

Every step is recorded in the audit log automatically. The safety scanner and budget enforcement run on every LLM call (steps 6, 9, 14).
