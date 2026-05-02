# A Centralized AI Operations Platform

## Technical Documentation — Reference Manual and Presentation Defense Guide

> Last updated: 2026-05-02 · current as of commit `HEAD`
> Project: AI Health Check · ARTI-409-A · AI Systems & Governance

This document is the canonical technical reference for the AI Health Check
platform. It consolidates the codebase, specialised docs, risk register,
and governance audit into one authoritative deliverable suitable for
academic grading, technical evaluation, viva defence, and portfolio use.

Accuracy is prioritised over completeness. Where a claim cannot be
verified directly from the code, it is explicitly marked.

---

## Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Proposed Solution](#3-proposed-solution)
4. [System Architecture](#4-system-architecture)
5. [Module Breakdown](#5-module-breakdown)
6. [End-to-End System Workflow](#6-end-to-end-system-workflow)
7. [AI / LLM Integration Design](#7-ai--llm-integration-design)
8. [Data Pipeline and Storage Design](#8-data-pipeline-and-storage-design)
9. [Testing and Validation Strategy](#9-testing-and-validation-strategy)
10. [Security and Governance Analysis](#10-security-and-governance-analysis)
11. [Limitations and Known Issues](#11-limitations-and-known-issues)
12. [Future Improvements (Roadmap)](#12-future-improvements-roadmap)
13. [Conclusion](#13-conclusion)
14. [Presentation Defence Guide](#14-presentation-defence-guide)

---

## 1. Executive Summary

**What the platform is.** AI Health Check is a centralised AI Operations
Control Room that unifies four capabilities typically scattered across
3–4 separate tools in production:

1. Service registry and health monitoring
2. Model quality evaluation and drift detection
3. Incident triage and LLM-assisted response
4. Governance, audit trail, and compliance export

**Who it is for.** Organisations that operate multiple AI services (model
APIs, fine-tuned endpoints, RAG systems) and must demonstrate to internal
or external reviewers that those services are monitored, that quality is
measured, that incidents are handled with human oversight, and that an
immutable audit trail exists.

**Why it matters.** The AI operations market is fragmented: Arize AI for
drift, LangSmith for evaluation, Datadog for observability, PagerDuty for
incidents, and a separate compliance layer on top. Stitching these
together costs engineering time and creates governance seams where
responsibilities fall between systems. This project demonstrates a
unified approach where evaluation, incidents, and compliance share a
single schema, a single audit chain, and a single human-in-the-loop
(HITL) contract. Built as a university capstone, scoped for clarity
rather than production scale.

database, a two-tier the LLM provider integration (the AI Sonnet 4.6 as actor,
the AI Haiku 4.5 as judge + prompt-injection detector, both via the same
`_make_api_call` pipeline), advanced semantic similarity scoring,
automated PII leakage detection, and 188 automated tests.

---

## 2. Problem Statement

Operating AI services in an organisation raises four questions that
current tooling answers in fragments rather than in one place:

1. **Is the AI working correctly right now?**
   Uptime monitoring exists, but model *behaviour* monitoring (does the
   output still match expected quality?) is a separate discipline with
   separate tools.

2. **Has its quality degraded over time?**
   Model drift is often discovered long after it starts, because nobody
   sets the runtime baseline. Quality metrics decay silently until a
   user complains.

3. **When something breaks, what happened, who diagnosed it, and who
   authorised the fix?**
   Incident response tools (PagerDuty, Opsgenie) are designed for
   infrastructure outages, not AI-quality regressions. The reasoning
   trail — symptoms → root cause hypothesis → stakeholder update —
   typically lives in ad-hoc Slack threads.

4. **Can we prove to auditors that AI use is governed responsibly?**
   Compliance frameworks (HIPAA, SOX, PCI-DSS, EU AI Act) all require
   evidence of controls. Producing that evidence on demand from scattered
   tools requires manual stitching and is itself a source of error.

The real risks when these questions are unanswered:

- **Silent drift** — model quality drops below operational usefulness
  and no alert fires. Users lose trust before the team notices.
- **Hallucination in official records** — an LLM-drafted incident
  summary contains fabricated claims; a human approves it without
  reading carefully; the fabrication is now part of the audit trail.
- **Unauthorised access to sensitive services** — a confidential AI
  tool reaches an external LLM provider without governance sign-off,
  violating data residency or patient-confidentiality obligations.
- **Compliance evidence gaps** — a compliance export silently drops
  rows or filters because of a malformed date, and the submitted
  evidence misrepresents the operational window.

This project addresses all four.

---

## 3. Proposed Solution

**AI Operations Control Room.** A single web application where every
registered AI service, every evaluation run, every incident, every
LLM-drafted artefact, and every governance event shares one schema, one
audit chain, and one HITL contract.

**High-level workflow.**

```
Register service
      │
      ▼
Scheduled health check ─── Eval harness ─── Drift detector
      │                          │                 │
      └──────── fails / degrades ─────────► Active Alert
                                                    │
                                                    ▼
                                           Human creates Incident
                                                    │
                                   ┌────────────────┘
                                   ▼
                     LLM drafts stakeholder summary
                                   │
                                   ▼
           Human approves with mandatory reviewer note (≥ 20 chars)
                                   │
                                   ▼
                        Maintenance plan proposed
                                   │
                                   ▼
                     Admin approves maintenance plan
                                   │
                                   ▼
              Every step audited (SHA-256 hash chain)
                                   │
                                   ▼
                 Compliance export (JSON / PDF) with audit +
                 incidents + maintenance + truncation warnings
```

**Why this shape.** Each transition is a deliberate governance control:

| Transition | Control enforced |
|---|---|
| Service registered | SSRF validation on `endpoint_url`; sensitivity label required |
| Health check / eval | Safety scan, budget, rate limit, retry, output scan, usage log |
| Drift → Alert | Auto-creation with audit entry; admin verify endpoint |
| Incident summary (LLM) | Written to `summary_draft`, never promoted without explicit approval |
| Approval | Mandatory reviewer note ≥ 20 non-whitespace chars; idempotent (409 on double-approve) |
| Maintenance plan | Separate approve endpoint; admin-only |
| Compliance export | Date range strictly validated; truncation warnings surfaced; role-gated |

The platform does not automate decisions. Every consequential action
involves a human who signs off.

---

## 4. System Architecture

### 4.1 Stack overview

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React 18, Vite 5, Tailwind CSS 3.4, Recharts 2.12 | Single-file build, tree-shakable, fast dev feedback |
| Backend | FastAPI, Pydantic, SQLAlchemy 2.0, Alembic (scaffolded) | Typed request validation, auto-OpenAPI docs, dialect-portable ORM |
| Database | SQLite (file-based) | Zero-config for demo scope; migration path to Postgres documented |
| LLM (actor) | the LLM provider the AI Sonnet 4.6 via `anthropic>=0.49.0` SDK | Service-under-test model + synthesis tasks (incident summaries, dashboard insights, compliance reports) |
| LLM (judge) | the LLM provider the AI Haiku 4.5 via the same SDK | Merged factuality + hallucination judge — one structured call per factuality test case. Different size/training emphasis from the actor partially breaks the "model scoring itself" correlation. |
| Semantic Metric | Pure-Python TF-IDF + Cosine Similarity | objective vocabulary-overlap scoring without LLM calls |
| Security Metric | Regex-based PII Scanner | Automated detection of sensitive data (email, SSN, etc.) in LLM output |
| Auth | JWT (HS256), bcrypt password hashing | Stateless token, industry-standard hashing |
| Background jobs | APScheduler | Lightweight, in-process, toggleable for demos |
| Testing | pytest, pytest-asyncio, pytest-cov | 188 tests across 22 files, 71 % coverage, 65 % floor |
| Reporting | reportlab | PDF compliance export |

### 4.2 Layered architecture

```
┌───────────────────────────────────────────────┐
│              React SPA (Vite, Tailwind)       │   UI layer
│   9 pages · 13 common components · 3 eval     │
│         Theme tokens · ⌘K palette              │
└───────────────────┬───────────────────────────┘
                    │ HTTPS / JWT bearer
┌───────────────────▼───────────────────────────┐
│              FastAPI Backend                  │   API layer
│   9 routers · 3 middleware · 5 services       │
│   Global exception handlers · CORS            │
└───────────────────┬───────────────────────────┘
                    │ SQLAlchemy ORM
┌───────────────────▼───────────────────────────┐
│              SQLite Database                  │   Persistence layer
│   14 models · FK enforcement on each          │
│   connection · Append-only triggers on        │
│   audit_log                                   │
└───────────────────┬───────────────────────────┘
                    │
┌───────────────────▼───────────────────────────┐
│         External Dependencies                 │
│  the LLM provider API — two-tier:                    │
│    Sonnet 4.6 (actor + synthesis)             │
│    Haiku 4.5  (judges + injection detector)   │
│  APScheduler job loop                         │
└───────────────────────────────────────────────┘
```

### 4.3 Component responsibilities

**Frontend routers (9 pages):** Login, Dashboard, Services,
Incidents + IncidentDetail, Evaluations, Governance, Data Policy,
Settings. Shared state via React Context (auth, theme, header slot
portal).

**Backend routers (9 routers, all under `/api/v1/*`):**

| Router | Prefix | Responsibility |
|---|---|---|
| `auth.py` | `/auth` | Login, register (admin-gated), `/me`, login throttling, audit mirror |
| `services.py` | `/services` | CRUD, test-connection (HTTP + LLM modes), SSRF validation, confidential override |
| `evaluations.py` | `/evaluations` | Test case CRUD, eval run, cost preview, drift-check, drift-trend |
| `incidents.py` | `/incidents` | Incident CRUD, generate-summary, approve-summary |
| `maintenance.py` | `/maintenance` | Plan CRUD, approval |
| `dashboard.py` | `/dashboard` | Metrics, percentiles, trends, insights draft/approve, alerts, API usage, performance, safety, LLM traces, cost-by-service |
| `users.py` | `/compliance` | User list, role update (admin-only) |
| `audit.py` | `/compliance` | Audit log list + hash-chain verify (admin-only) |
| `export.py` | `/compliance` | JSON/PDF export, AI report draft/approve |

Compliance surface was originally one router; it was split into three
cohesive files mounted under the same prefix so the frontend API paths
remain unchanged.

**Middleware (3 modules):**

| Module | Purpose |
|---|---|
| `auth.py` | JWT verify, bcrypt verify/hash, login throttling |
| `rbac.py` | `require_role(...)` decorator-dependency; 403 denials written to audit as `role_denied` |
| `audit.py` | `log_action()` with SHA-256 hash chain; `verify_audit_chain()`; serialised via `threading.Lock` |

**Services (5 modules):**

| Module | Purpose |
|---|---|
| `llm_client.py` | Single LLM pipeline; 7 public functions via `_make_api_call`; budget lock + reservation |
| `safety.py` | Regex-based input/output scanner (injection, PII, length, toxicity) |
| `url_validator.py` | SSRF guard against loopback, RFC1918, link-local, non-http schemes |
| `sensitivity.py` | `enforce_sensitivity()` blocks LLM for confidential services without admin override |
| `draft_service.py` | Shared HITL abstraction (`create_draft`, `approve_draft`) for dashboard insights and compliance reports |

### 4.4 Request data flow (step-by-step)

For a typical state-changing request (example: approve incident summary):

```
 1. Browser               → POST /api/v1/incidents/{id}/approve-summary
                            Header: Authorization: Bearer <JWT>
                            Body:   { "reviewer_note": "..." }
 2. FastAPI receives       → JSON parsed against ApproveSummaryRequest (Pydantic)
                            Min-length 20 enforced at request layer
 3. require_role(...)      → JWT decoded; user loaded from DB; role checked
                            If denied → audit "role_denied" → 403
 4. Handler runs           → Load incident; idempotency check (409 if already approved)
                            Strip note; re-check length (400 if whitespace-only)
                            Apply state changes
 5. log_action(...)        → SHA-256 over payload + prev_hash; under _AUDIT_LOCK
                            INSERT audit_log row
 6. Response               → 200 with approved_by / approved_at
 7. Frontend               → Refetches incident; renders attribution block
```

For an LLM call (example: generate incident summary):

```
 1. Frontend button click  → POST /api/v1/incidents/{id}/generate-summary
 2. Handler loads incident + linked service
 3. enforce_sensitivity()  → If service.confidential and no override → 403
 4. generate_summary() in llm_client.py:
    a. scan_input()         (regex: injection, PII, length; raise 422 if risk ≥ 80)
    b. _BUDGET_LOCK acquired:
         - _check_budget() counts api_usage_log rows
         - INSERT api_usage_log (status='reserved', worst-case cost)
       Lock released
    c. client.messages.create(...)   (actual LLM call, outside lock)
    d. scan_output()        (regex: PII leak, refusal, and PII Safe score calculation)
    e. _finalize_reservation() updates the reserved row with real tokens, cost, status
 5. Handler persists        → incident.summary_draft = result
                            → log_action("generate_summary_draft")
 6. Response                → 200 with draft text
```

### 4.5 Background processes

Two non-request flows:

- **Scheduled health check (APScheduler).** Every N minutes, iterate
  over active services with an `endpoint_url` and `httpx.get(url)` the
  endpoint. Writes `ConnectionLog` + `Telemetry` rows. Respects the SSRF
  validator. Can be disabled for demos via `SCHEDULER_ENABLED=false`.
- **Audit log triggers.** SQLite `BEFORE UPDATE` and `BEFORE DELETE`
  triggers on `audit_log` reject mutation from the application path,
  installed in the app lifespan hook.

---

## 5. Module Breakdown

### Module 1 — AI Service Registry (M1)

**Owner:** Jack.

**Purpose.** Catalogue every AI service the organisation operates with
the metadata required for governance and monitoring: name, owner,
environment, model name, sensitivity classification, and endpoint URL.

**Features.**

- Full CRUD endpoints (`services.py`).
- Environment enum (`dev` / `staging` / `prod`) and sensitivity label
  enum (`public` / `internal` / `confidential`).
- Two connection-test modes:
  - `mode=http` — probes the `endpoint_url` with `httpx.get`, captures
    latency and a 200-character response snippet, writes a
    `ConnectionLog` row.
  - `mode=llm` — invokes `llm_client.test_connection()` which sends a
    minimal prompt and measures round-trip latency.
- **SSRF guard** (`services/url_validator.py`): every URL is validated
  against a block-list of loopback, RFC1918, link-local (including the
  AWS metadata range `169.254.169.254`), carrier-grade NAT, multicast,
  reserved IPv4 and IPv6 ranges. Non-http schemes (`file://`,
  `gopher://`, etc.) are rejected. DNS resolution checks all returned
  addresses — any blocked IP in the resolution set fails the whole URL.
  Applied at: registration, update, test-connection probe, AND each
  scheduled health-check tick (closes the DNS-rebinding window).
- **Sensitivity enforcement** (`services/sensitivity.py`): services
  labelled `confidential` cannot reach the LLM unless an admin passes
  `allow_confidential=true`. Every attempt — allowed override or denied
  block — is audited (`confidential_llm_override` or
  `confidential_llm_blocked`).

**Security handling.**

- Endpoint URLs are SSRF-validated before any request is made.
- API keys are never stored on `AIService`; the the LLM provider key lives in
  `backend/.env` (git-ignored) and is loaded via `config.py`.
- Deletion of a service cascades or restricts based on FK declarations
  (SQLite `PRAGMA foreign_keys=ON` installed on every connection).

### Module 2 — Monitoring & Evaluation Dashboard (M2)

**Owner:** Sakir.

**Purpose.** Surface fleet-wide metrics and run a reproducible
evaluation harness that detects model-quality regressions.

**Metrics.** The dashboard aggregates five metric families:

| Metric | Source | Window |
|---|---|---|
| Active Services count | `ai_services` where `is_active = true` | current |
| Avg Quality | mean `quality_score` across `eval_runs` | most recent 10 runs |
| Error Rate | `eval_runs` where `drift_flagged = true` / total — QUALITY drift, not infra failures. Server can be 100% up and this can still spike. | last 7 days |
| Avg Latency | mean `latency_ms` from `connection_logs` | last 24 hours |
| P50 / P95 / P99 Latency | percentile of `connection_logs.latency_ms` | last 24 hours |

Plus trend charts (latency, quality, error rate) and a "Response time
distribution" panel showing the three percentiles with plain-English
labels ("Typical / Slow / Worst Response").

**Evaluation harness.** Triggered from UI via `POST
/evaluations/run/{service_id}`. For each `EvalTestCase` linked to the
service, the harness:

1. Calls `run_eval_prompt()` with the test case prompt.
2. If `category == "factuality"`, calls `score_factuality()` (LLM judge)
   AND `detect_hallucination()` (LLM judge).
3. If `category == "format_json"`, attempts `json.loads()` on the
   response; 100 on success, 0 on failure (deterministic).
4. For all successful calls, computes **TF-IDF Semantic Similarity**
   against expected output.
5. For all successful calls, runs **PII Leakage Detection** to ensure
   no sensitive data was exposed.
6. Persists an `EvalRun` row (aggregate scores) plus one `EvalResult`
   row per test case.

**Judge parser.** `_parse_judge_score()` uses `re.fullmatch` — only a
bare numeric response is accepted. Refusals like *"I cannot rate this.
404 Not Found"* return `None` (previously, `re.search(r"\d+", text)`
would have misread this as 404 clamped to 100). `None` maps to
`status="judge_refused"` and is **excluded** from aggregates so a flaky
judge doesn't spuriously trigger drift.

**Drift detection logic.**

```
drift_flagged = quality_score < drift_threshold          # default 75.0
                OR
                (quality_score < drift_threshold + 10
                 AND trend_direction == "declining"
                 AND at least 3 prior runs exist)
```

Severity levels:

| Severity | Condition |
|---|---|
| `none` | score ≥ threshold + 10 AND trend not declining |
| `warning` | score within 10 pts of threshold OR trend declining |
| `critical` | score < threshold OR sudden drop > 15 pts from historical average |

Trend: `_compute_trend()` splits the most recent N scores in half and
compares the means. Difference > 3 pts → "improving"; < -3 pts →
"declining"; else "stable". Variance: population variance of recent
scores.

When drift is flagged, an `Alert` row is auto-created with severity
`critical` (score < threshold) or `warning` (trend-based flag above
threshold), and an `alert_created` audit entry is written.

**Dataset.** 6 synthetic test cases (2 per service × 3 services).
Factuality test: *"What is the capital of France?"* expecting *"The
capital of France is Paris."* Format test: *"Return a JSON object with
keys 'name' and 'status'..."* expecting `{"name": "test", "status":
"healthy"}`. All documented in `EVAL_DATASET_CARD.md`. **Not verifiable
from code:** inter-rater agreement or ground-truth validation — this is
a known methodological limitation (see §11 and `SELF_CRITIQUE.md §1`).

**Data storage.** Every eval produces persistent rows:
`EvalRun` (aggregate), `EvalResult` (per test case), `Telemetry`
(latency and quality samples for the dashboard chart), `APIUsageLog`
(LLM call trace).

### Module 3 — Incident Triage & Maintenance (M3)

**Owner:** Osele.

**Purpose.** Manage the lifecycle of quality or operational incidents
with LLM-assisted summary drafting and strict human approval.

**Incident lifecycle.**

```
 open ──► investigating ──► resolved ──► closed
   │           │               │
   ▼           ▼               ▼
 checklist   LLM draft      human approve
 completed   generated      with reviewer_note
```

**Incident fields.** Severity (`critical`/`high`/`medium`/`low`),
symptoms (free text), timeline (optional datetime), five-box
troubleshooting checklist (data issue, prompt change, model update,
infrastructure, safety / policy), status, LLM `summary_draft`,
published `summary`, `root_causes`, `approved_by` (user_id),
`approved_at` (timestamp), `reviewer_note` (persisted).

**LLM-assisted summary generation.** `POST
/incidents/{id}/generate-summary` invokes `generate_summary()` with
service name, severity, symptoms, and checklist booleans. The response
is split on `ROOT CAUSES:` to extract two sections. Both are written to
`summary_draft` and `root_causes` — never to the published `summary`
field.

**Human approval workflow (HITL).**

1. Draft generated → `summary_draft` populated; `summary = ""`.
2. Admin clicks Approve in the UI → a `ReviewerNoteModal` opens with a
   textarea, live character count, and inline validation.
3. User types a note of ≥ 20 non-whitespace characters and submits.
4. Backend validates: request-layer Pydantic min_length enforces 20;
   handler re-strips whitespace and re-checks (400 if insufficient).
5. Idempotency: if `incident.summary` is already populated and
   `approved_by` is set, respond 409 Conflict with the original
   approver and timestamp. Prevents a racing second click from
   silently overwriting attribution.
6. On success: `incident.summary = summary_draft`, `summary_draft = ""`,
   `approved_by = current_user.id`, `approved_at = now()`,
   `reviewer_note = note`. Audit entry written with `reviewer_note_len`.
7. Frontend refetches and renders an attribution block: "Approved by
   admin@aiops.local at 2026-04-18 14:32" with the reviewer note
   quoted below.

**Maintenance planning.** `MaintenancePlan` rows linked to an incident
with: `risk_level`, `rollback_plan`, `validation_steps`,
`scheduled_date`, `approved` (boolean, defaults false). Admin-only
`POST /maintenance/{id}/approve` flips the flag and audits. The UI
renders plans as a timeline with ringed status dots (green = approved,
amber = pending).

**Not verifiable from code:** four-eyes enforcement (distinct drafter
and approver identities). The model stores `approved_by` but does not
check it differs from any "generated_by" equivalent. See `SELF_CRITIQUE.md §5`.

### Module 4 — Governance, Security & Compliance (M4)

**Owner:** Jeewanjot.

**Purpose.** Provide end-to-end traceability and compliance-grade
evidence export.

**RBAC design.** Three roles (`UserRole` enum in `models/__init__.py`):

| Role | Allowed actions |
|---|---|
| `admin` | Full read/write; user management; audit log read + verify; AI compliance report; confidential LLM override |
| `maintainer` | Read/write on services, incidents, evaluations, maintenance; cannot read audit log or manage users |
| `viewer` | Read-only on operational data; cannot read audit log |

Enforcement at the route level via `Depends(require_role([...]))`. Every
403 writes a `role_denied` entry to the audit log so probing attempts
surface during compliance review.

**Audit logging system.**

- `log_action(db, user_id, action, target_table, target_id, old_value,
  new_value)` is called after every state-changing endpoint.
- Actions logged: service CRUD (4), incident create + approve-summary +
  generate-summary-draft (3), maintenance create + approve (2),
  evaluation run + test-case create (2), alert created (1), user role
  update (1), login success / failed / lockout (3), role_denied (1),
  confidential_llm_override / _blocked (2), llm_draft_created /
  _approved (2), register_user (1). **16+ distinct action types.**
- Tamper-evidence: SHA-256 `content_hash` over row content + previous
  row's `prev_hash`. Any UPDATE or DELETE on a past row breaks the
  chain and is detectable by `verify_audit_chain()`.
- SQLite `BEFORE UPDATE` and `BEFORE DELETE` triggers reject mutation
  from the application path (defence in depth).
- `threading.Lock` around the read-compute-insert sequence so two
  concurrent callers don't link to the same `prev_hash`.
- `/compliance/audit-log/verify` (admin-only) walks the chain and
  returns `{total, valid, broken_at, reason}`.
- Login events (success, failure, lockout) mirrored from
  `LoginAttempt` (for throttle math) into `AuditLog` (for governance
  trail). Both tables populated on every auth event.

**Data handling policy.** `DataPolicyPage.jsx` describes: what is stored
locally (SQLite DB, including service metadata, eval prompts, incident
symptoms, audit trail, usage logs, bcrypt password hashes), what is
sent to the LLM provider (eval test prompts, incident-summary prompts,
dashboard-insight prompts, compliance-report prompts), prompt retention
(metadata only by default, but `APIUsageLog.prompt_text` stores the
prompt up to 2000 characters for tracing — **this is a gap; see §11**),
and sensitivity-label routing (public, internal, confidential tiers
with confidential requiring admin override).

**Compliance export.** `POST /compliance/export` with `format` (`json`
or `pdf`) and optional `from_date` / `to_date`.

- Strict date parsing: malformed dates → HTTP 400. Inverted date ranges
  (`from > to`) → 400.
- Row cap: 10000 per section (audit, incidents, maintenance). Exceeding
  the cap surfaces an explicit warning in the response payload AND
  (for PDF) as a red-text notice in the header.
- Includes: audit records (user, action, target, old_value, new_value,
  timestamp), incidents (with only approved summaries — drafts
  excluded), maintenance plans.
- PDF uses ReportLab with three labelled sections (Audit Log, Incidents,
  Maintenance Plans) rendered as styled tables.
- JSON includes `warnings[]`, per-section totals, `row_limit_per_section`.

**AI compliance report.** `POST /compliance/ai-report` (admin-only)
calls `generate_compliance_summary()` and persists the result as an
unapproved `AILlmDraft`. A separate `POST /ai-report/{id}/approve`
endpoint flips `approved_by_user_id`. Same HITL abstraction as dashboard
insights.

---

## 6. End-to-End System Workflow

Reference scenario: *a regression in "Internal Report Generator"
triggers an alert, leads to an incident, results in a maintenance plan,
and is captured in a compliance report*.

```
Step 1 — Service registered (M1)
POST /services
  payload:  name, owner, environment, model_name,
            sensitivity_label, endpoint_url
  SSRF validator passes; AIService row created; audit "create_service"

Step 2 — Monitoring runs (M2)
APScheduler tick every 5 min:
  For each active service with endpoint_url:
    url_validator.validate_outbound_url()
    httpx.get(endpoint_url)
    ConnectionLog row with latency + status
    Telemetry row with latency sample

Step 3 — Evaluation executed (M2)
POST /evaluations/run/{service_id}
  enforce_sensitivity(); if confidential → 403 without override
  For each EvalTestCase:
    run_eval_prompt  → _make_api_call (6-stage pipeline)
    category factuality: score_factuality + detect_hallucination
    category format_json: json.loads → 0 or 100
  Aggregate scores; write EvalRun + N EvalResult rows

Step 4 — Drift detected (M2)
drift_flagged = quality < 75 OR (declining AND quality < 85)
If drift:
  severity = critical if quality < 75 else warning
  INSERT Alert row
  audit "alert_created"
Dashboard polls /alerts every 15s → renders red banner

Step 5 — Incident created (M3)
User clicks "Create incident" with pre-filled severity
POST /incidents with service_id, severity, symptoms, 5-box checklist
Incident row created; audit "create_incident"

Step 6 — LLM generates summary (M3)
POST /incidents/{id}/generate-summary
  enforce_sensitivity (admin override flag if confidential)
  generate_summary(service_name, severity, symptoms, checklist)
  → The AI returns stakeholder update + root causes
  Write to incident.summary_draft (never to summary)
  audit "generate_summary_draft"

Step 7 — Human approval required (M3)
User clicks Approve → ReviewerNoteModal opens
User types ≥ 20-char reviewer note; submit enabled only when valid
POST /incidents/{id}/approve-summary  { reviewer_note }
  Pydantic min_length check
  Re-strip whitespace; 400 if still < 20
  Idempotency: 409 if already approved
  Promote summary_draft → summary
  Set approved_by, approved_at, reviewer_note
  audit "approve_summary" with reviewer_note_len
Frontend renders attribution block with approver email + timestamp +
quoted reviewer note

Step 8 — Maintenance plan created (M3)
POST /maintenance
  risk_level, rollback_plan, validation_steps, scheduled_date
  approved=false (default)
  audit "create_maintenance_plan"
Later: PUT /maintenance/{id}/approve (admin-only) → approved=true
  audit "approve_maintenance_plan"

Step 9 — Audit log updated (M4)
Every step above called log_action, which:
  read prev_row.content_hash under _AUDIT_LOCK
  compute SHA-256 over row + prev_hash
  INSERT with content_hash + prev_hash filled
SQLite triggers block any UPDATE/DELETE on audit_log

Step 10 — Compliance report exported (M4)
POST /compliance/export  { format: "pdf", from_date, to_date }
  Strict date validation; 400 on malformed
  Query audit_log, incidents, maintenance_plans in range
  Row cap 10000 per section; warnings if exceeded
  PDF: three labelled sections with ReportLab tables
  JSON: structured payload with warnings[], totals, row_limit

Optional: GET /compliance/audit-log/verify (admin)
  Walk hash chain; report {total, valid, broken_at, reason}
```

Every step writes an audit entry. The complete timeline from "service
registered" to "compliance report exported" is reconstructable from
`audit_log` alone.

---

## 7. AI / LLM Integration Design

### 7.1 Where the LLM is used

Seven functions in `llm_client.py`, all routed through `_make_api_call`:

| Function | Module | Purpose | Max tokens |
|---|---|---|---|
| `test_connection` | M1 | Verify the AI reachability | 50 |
| `run_eval_prompt` | M2 | Execute a test case prompt | 1024 |
| `score_factuality` | M2 | Rate factual similarity 0–100 (judge) | 10 |
| `detect_hallucination` | M2 | Rate fabrication 0–100 (judge) | 10 |
| `generate_summary` | M3 | Draft incident summary + root causes | 1024 |
| `generate_dashboard_insight` | M2 | Platform-health summary | 1024 |
| `generate_compliance_summary` | M4 | Governance compliance report | 1024 |

No router handler imports the `anthropic` SDK directly. The single
pipeline is the only integration point.

### 7.2 What the LLM is allowed to do

- **Produce draft text.** All generative outputs land in `_draft`
  fields (`incident.summary_draft`, `AILlmDraft.content`) — never
  directly in the "official" fields.
- **Return numeric scores.** Factuality and hallucination judges return
  integers 0–100 or `None` on refusal.

The LLM is explicitly **not** permitted to:

- Publish content as official record without human approval
- Approve its own output
- Modify the audit log
- Initiate state changes beyond the draft that was requested

### 7.3 Human-in-the-loop enforcement

| Surface | Draft field | Approval endpoint | Reviewer note | Idempotency |
|---|---|---|---|---|
| Incident summary | `incident.summary_draft` | `POST /incidents/{id}/approve-summary` | Required, ≥ 20 chars | 409 on re-approve |
| Maintenance plan | `approved` boolean (defaults false) | `PUT /maintenance/{id}/approve` | Not required | Idempotent (no error on duplicate) |
| Dashboard insight | `AILlmDraft` | `POST /dashboard/ai-summary/{id}/approve` | Not required | 409 via `draft_service` |
| Compliance AI report | `AILlmDraft` | `POST /compliance/ai-report/{id}/approve` | Not required | 409 via `draft_service` |

**Critical note on HITL rigour.** The reviewer note on incident approval
is a forcing function for deliberation, not an enforcement mechanism. A
determined admin can type 20 meaningless characters. See `SELF_CRITIQUE.md §5`.
This is acknowledged as a Level-1 HITL control; Level-2 (distinct
drafter/approver) and Level-3 (content validation) are documented as
future work.

### 7.4 Safety guardrails

The 6-stage `_make_api_call` pipeline:

```
[1] Input safety scan     → safety.scan_input()
                            15 injection regex patterns
                            PII (email, phone, SSN, credit card)
                            Length ≤ 10,000 characters
                            Risk scoring 0–100; ≥ 80 blocks (422)

[2] Atomic check + reserve → _BUDGET_LOCK:
                             _check_budget() counts api_usage_log rows
                             INSERT api_usage_log (status='reserved',
                                                   worst-case cost)

[3] API call with retry    → client.messages.create() outside lock
                             2 retries on transient failures
                             exponential backoff: 2^n + rand(0, 0.5)

[4] Output safety scan     → safety.scan_output()
                             PII leak detection (blocks SSN/CC)
                             Refusal pattern detection
                             Toxicity (violence, hate, illegal)

[5] Finalize reservation   → UPDATE api_usage_log with real tokens,
                             cost, latency, status, safety flags

Sensitivity gate runs BEFORE stage 1 when tied to a service:
enforce_sensitivity() blocks confidential without admin override.
```

Budget enforcement:

- Daily cap: `$5.00` (configurable)
- Monthly cap: `$25.00`
- Global rate: 30 calls/min
- Per-user rate: 20 calls/min
- Budget exceeded → `BudgetExceededError`, mapped to HTTP 402
- Rate limit exceeded → HTTP 429

**Concurrency safety.** Without the lock, N concurrent callers could
all observe count < limit and all proceed. The lock + reservation
pattern serialises the check-and-reserve sequence. **Limitation:** the
lock is process-local; multi-worker deployments would need Redis INCR
or Postgres `SELECT FOR UPDATE`. Documented inline in `llm_client.py`.

### 7.5 Prompt design philosophy

1. **Fixed, auditable templates** (in `llm_client.py`). No dynamic
   prompt construction from user input beyond parameterised substitution
   — documented in `PROMPT_CHANGE_LOG.md`.
2. **Explicit format requirements.** Judge prompts demand "ONLY a
   single integer 0–100, no other text." Parsed with `re.fullmatch` —
   anything else is a refusal.
3. **Structured separation of concerns.** The stakeholder update and
   root-cause analysis are split by a known sentinel
   (`ROOT CAUSES:`), so we can render the two independently.
4. **Minimal trust in free-form output.** The output scanner applies
   PII and refusal checks; the harness treats errors gracefully rather
   than propagating raw LLM text as official state.

**Known prompt-injection gap.** Incident symptoms are fed into
`generate_summary()` without delimiter escaping. A crafted symptom
could theoretically coerce the draft. The regex safety scanner catches
the obvious "ignore previous instructions" patterns but paraphrases slip
through. Mitigated by requiring human approval with a mandatory note;
fully fixable with an LLM-based injection classifier + XML delimiter
wrapping (future work, `GOVERNANCE_AUDIT.md §4`).

---

## 8. Data Pipeline and Storage Design

### 8.1 Database schema (14 models)

| Model | Table | Purpose |
|---|---|---|
| `User` | `users` | Identity, bcrypt password hash, role |
| `AIService` | `ai_services` | Registered service metadata |
| `ConnectionLog` | `connection_logs` | Health check history |
| `EvalTestCase` | `eval_test_cases` | Evaluation dataset |
| `EvalRun` | `eval_runs` | Eval execution records (aggregate) |
| `EvalResult` | `eval_results` | Per-test-case scores |
| `Incident` | `incidents` | Incident records + checklist + HITL fields |
| `MaintenancePlan` | `maintenance_plans` | Rollback plans with approval state |
| `AuditLog` | `audit_log` | Append-only hash-chained audit trail |
| `Telemetry` | `telemetry` | Metric samples for dashboard charts |
| `APIUsageLog` | `api_usage_log` | LLM call traces with tokens + cost |
| `LoginAttempt` | `login_attempts` | Failed login tracking for throttling |
| `Alert` | `alerts` | Drift alerts with acknowledge workflow |
| `AILlmDraft` | `ai_llm_drafts` | Shared HITL envelope for dashboard + compliance LLM output |

**FK enforcement.** `PRAGMA foreign_keys=ON` installed on every SQLite
connection via a SQLAlchemy engine event listener. Without this,
`ForeignKey` declarations would be decorative; with it, deleting a
service with dependent incidents is rejected (or cascaded where
declared).

**Append-only.** `audit_log` carries two additional columns:
`content_hash` (SHA-256 of row content + prev hash) and `prev_hash`
(link to previous row). Combined with SQLite BEFORE UPDATE/DELETE
triggers and the `threading.Lock` around write, mutation is both
detectable (chain break) and blocked (trigger abort).

### 8.2 Data generation

Three generation paths:

1. **User-driven state changes.** Every POST/PUT/DELETE from the UI
   calls a router handler that persists a row and calls `log_action`.
2. **Scheduled background jobs.** APScheduler writes `ConnectionLog`
   and `Telemetry` rows on each tick.
3. **Seed script.** `python -m app.seed` creates 3 users, 3 services,
   6 test cases, 15 historical eval runs (with a deliberate drift
   scenario), 30 eval results, 38 connection logs, 42 telemetry
   entries, and 1 critical drift Alert with matching audit entry —
   yielding a demo-ready dashboard on fresh install.

### 8.3 Data retrieval and visualisation

Dashboard endpoints (`dashboard.py`) aggregate raw rows into
visualisation-ready shapes:

- `/metrics` — scalar counts and averages plus P50/P95/P99
- `/latency-trend` — 24-hour latency bucketed for line chart
- `/quality-trend` — last 6 eval runs for bar chart
- `/error-trend` — 7-day error rate for area chart
- `/recent-evals` — last 10 eval runs for table
- `/drift-alerts` — drift-flagged runs from last 7 days

Frontend uses Recharts for rendering with a shared chart-style module
(`chartStyle.js`) so colours, grid dashes, tooltip style, and axis
fonts stay consistent.

### 8.4 Reproducibility of evaluation

- Test cases live in the database, not in source. Evaluators can add,
  delete, or modify them without a code deploy (admin-gated).
- Every evaluation persists the prompt, expected output, model
  response, score, latency, and status. The full reasoning trail is
  reconstructable from `eval_results` joined with `eval_runs` and
  `api_usage_log`.
- LLM-as-judge is non-deterministic by design. `status="judge_refused"`
  makes refusals visible rather than silent. The eval harness excludes
  refused rows from the aggregate so drift isn't falsely triggered by
  a misbehaving judge.

---

## 9. Testing and Validation Strategy

### 9.1 Coverage summary

**188 tests** across **22 test files**, 71 % code coverage, 65 % floor
enforced in `pyproject.toml`.

| File | Count | Focus |
|---|---|---|
| `test_compliance.py` | 28 | Audit CRUD, hash-chain integrity, tampering detection, append-only triggers, user management, export JSON + PDF, strict date parsing, truncation warnings |
| `test_services.py` | 20 | CRUD, RBAC (viewer blocked), SSRF at register / update / probe, sensitivity + admin override, connection log |
| `test_evaluations.py` | 17 | Test case CRUD, eval lifecycle, drift severity, budget 402/429, drift-triggered Alert, env filter on `/runs`, cascading delete |
| `test_model_catalog.py` | 14 | Model inventory endpoints, actor vs judge routing |
| `test_dashboard.py` | 11 | Metrics, percentiles, latency / quality / error trends, drift alerts, env-filter scoping |
| `test_incidents.py` | 10 | Reviewer-note validation (422/400), idempotent approval (409), maintenance plan cascades |
| `test_url_validator.py` | 10 | SSRF — metadata, loopback, RFC1918, IPv6, non-http scheme, mixed DNS |
| `test_enforce_call_limits.py` | 9 | Hard caps, single-gatekeeper, per-model pricing flow |
| `test_judge_routing.py` | 9 | Haiku for judge vs Sonnet for synthesis, single-call merged judge, JSON parser edge cases |
| `test_user_attribution.py` | 9 | `user_id` propagation through LLM call stack into `APIUsageLog` |
| `test_trace_endpoints.py` | 8 | Settings → Call Trace read endpoints |
| `test_drafts.py` | 7 | HITL draft / approve for dashboard + compliance AI |
| `test_correlation_id.py` | 5 | Per-request correlation ID into `APIUsageLog`, echoed in response header |
| `test_draft_service.py` | 5 | Unit tests for shared draft service |
| `test_pricing_multi_model.py` | 5 | Sonnet vs Haiku rate math, unknown-model fallback |
| `test_probe_liveness.py` | 5 | Probe 4xx/5xx semantics (4xx = reachable, 5xx = down) |
| `test_auth.py` | 4 | Login events mirrored to audit log |
| `test_dual_model_settings.py` | 4 | Model config surface (`llm_model` / `judge_model` overrides) |
| `test_integrity.py` | 3 | FK enforcement, concurrent `log_action` walkable chain, monotonic timestamps |
| `test_integration.py` | 2 | Full service lifecycle + RBAC across CRUD |
| `test_retry_latency.py` | 2 | Retry backoff wall-clock accounting |
| `test_budget_race.py` | 1 | 20 concurrent callers respect per-user rate limit |

### 9.2 Unit vs integration split

- **Unit**: `test_judge_parser`, `test_url_validator`, `test_draft_service`
  exercise single functions with no HTTP client.
- **Integration**: all other files use `TestClient` from FastAPI to hit
  real endpoints with an in-memory SQLite DB, mocking only the
  the LLM provider API.

### 9.3 Test infrastructure

- In-memory SQLite per session (via `setup_db` fixture).
- JWT tokens for admin, maintainer, viewer (via fixtures).
- DNS stub in conftest resolves test hostnames to a public IP; SSRF
  tests patch getaddrinfo directly for private-IP paths.
- Mocked LLM — every `anthropic` call is patched; no API key
  consumption.
- Append-only triggers installed in `setup_db` to match production
  behaviour.

### 9.4 Evaluation correctness testing

- `test_evaluations.py::test_drift_critical_creates_alert` drops score
  to 30 and verifies Alert row + audit trail.
- `test_evaluations.py::test_healthy_score_creates_no_alert` verifies
  the negative case.
- `test_evaluations.py::test_drift_alert_creation_audited` verifies
  the alert itself writes an audit entry.
- `test_judge_parser.py` tests every refusal phrasing we could think
  of, plus edge cases (fractional scores, over-range clamp, whitespace
  tolerance).

### 9.5 Error handling strategy

- FastAPI exception handlers for `BudgetExceededError` (402 or 429) and
  `PromptSafetyError` (422) in `main.py`.
- All user-visible error responses carry a `detail` field with a
  specific message, which the frontend surfaces verbatim in the alert.
- LLM pipeline errors (timeout, rate limit, internal server, auth, bad
  request, unknown) are categorised and logged with distinct status
  values in `api_usage_log`.
- The frontend never rethrows raw exceptions — every handler catches
  and shows an actionable message.

### 9.6 Edge cases covered

- Malformed dates on compliance export → 400 with clear message.
- Inverted date range (`from > to`) → 400.
- Double-approval of incident summary → 409 with original approver.
- Short reviewer note (≥ 20 chars after strip) → 400.
- Judge refuses to score → `status="judge_refused"`, excluded from
  aggregate.
- Concurrent budget check — race test asserts rate limit still holds.
- Concurrent audit writes — 10 threads produce a walkable chain.
- Dangling foreign key — rejected by SQLite PRAGMA.

---

## 10. Security and Governance Analysis

### 10.1 Authentication

- JWT (HS256) with `access_token_expire_minutes` default 480 minutes.
- Passwords hashed with bcrypt (`passlib` with `CryptContext`).
- Login throttle: 5 failed attempts in 15 minutes triggers lockout per
  email. Lockout event itself audited.
- **Not verifiable / absent**: MFA, JWT revocation on logout, session
  management dashboard. Documented as governance gaps
  (`GOVERNANCE_AUDIT.md §6`).

### 10.2 RBAC enforcement

- Decorator-dependency pattern: `Depends(require_role([...]))` at the
  route level.
- Role check re-fetches the User from DB on each request — role
  changes take effect immediately without JWT rotation.
- Every 403 writes `role_denied` with old_value=role,
  new_value=required_roles.
- **Coarse-grained**: no per-resource permissions, no team scoping, no
  ownership-based access. Acknowledged as a scale limitation.

### 10.3 Audit trail integrity

- SHA-256 hash chain with genesis = 64 zeros.
- Compute-before-insert so the row is immutable from the moment it
  lands (no post-insert UPDATE needed).
- SQLite triggers block UPDATE/DELETE from the application path.
- `/audit-log/verify` walks the chain and reports first broken_at.
- **Attacker model** the chain defends against: in-app adversary who
  bypasses the triggers. **Does NOT defend against**: filesystem-level
  DB replacement, full chain rewrite with triggers dropped, compromised
  app-process spoofing verify output. Production defence requires an
  external anchor (Merkle root published periodically to an independent
  log) — documented as residual risk in `RISK_REGISTER.md R9`.

### 10.4 Secrets management

- `ANTHROPIC_API_KEY` in `backend/.env` (git-ignored), loaded via
  Pydantic `BaseSettings`.
- `SECRET_KEY` for JWT signing likewise in `.env`.
- Frontend has zero secrets. Every LLM call goes through the backend.
- **Not verifiable from code**: key rotation policy, secret-manager
  integration (AWS Secrets Manager, HashiCorp Vault). Environment-file
  only.

### 10.5 PII handling

- Regex-based input scanner: email, phone, SSN, credit card.
- Output scanner: same patterns; blocks SSN/credit card responses;
  flags email/phone but does not block.
- **Known gaps**: no NER/named-entity detection (patient names, DOBs
  in prose); `APIUsageLog.prompt_text` and `response_text` stored up
  to 2000 chars unredacted indefinitely. These are deliberate trade-offs
  documented in `GOVERNANCE_AUDIT.md §2` and `RISK_REGISTER.md R1`.

### 10.6 Prompt injection exposure

- 15 regex patterns in `safety.py` catch obvious `ignore previous`
  style injections.
- Paraphrased or encoded injections pass the regex.
- Incident `symptoms` embedded directly into `generate_summary()`
  without delimiter escaping — potential coercion vector.
- Primary mitigation: human approval with mandatory reviewer note.
- Full fix requires LLM-based input classifier + structured output with
  JSON schema parsing + audit-log value HTML-encoding at display.
  Documented in `GOVERNANCE_AUDIT.md §4`.

### 10.7 SSRF protection

- Every `endpoint_url` validated against loopback, RFC1918, link-local,
  carrier-grade NAT, multicast, reserved IPv4/IPv6 ranges.
- Non-http schemes rejected.
- Mixed public-and-private DNS resolution fails the whole URL.
- Applied at register, update, probe, and scheduled health-check tick
  — closes the DNS-rebinding window.

### 10.8 Confidential sensitivity enforcement

- Services labelled `confidential` cannot reach the LLM unless the
  caller is an admin AND passes `allow_confidential=true`.
- Non-admins with the flag are rejected (flag alone is insufficient).
- Every attempt audited — blocked or allowed.
- **Gap**: single-admin override. A compromised admin account has full
  confidential access. Future work: two-admin grant flow with a
  time-bound override token.

---

## 11. Limitations and Known Issues

Honest inventory. Each item is either already documented in
`SELF_CRITIQUE.md`, `RISK_REGISTER.md`, or `GOVERNANCE_AUDIT.md`, or
explicitly flagged here.

### 11.1 Methodological

- **LLM-as-judge circularity** — the AI scores the AI. No second-model
  validation, no human-annotated calibration set.
  (`SELF_CRITIQUE.md §1`)
- **Drift detection at demo N** — 2 test cases per service, split-half
  trend on N=3 is mathematically uninformative. Thresholds are
  heuristic, not empirically validated. (`SELF_CRITIQUE.md §2`)
- **Safety scanner is regex-only** — trivially bypassed by paraphrase.
  Marketed as a floor, not a ceiling. (`SELF_CRITIQUE.md §3`)

### 11.2 Governance

- **Audit tamper-evidence scope** — defends against in-app mutation,
  not filesystem replacement or full-chain rewrite. No external anchor.
  (`SELF_CRITIQUE.md §4`)
- **HITL reviewer note is a deterrent, not enforcement** — no four-eyes,
  no semantic validation, no time-on-screen telemetry. A determined
  admin bypasses with `"lgtm approved 20 characters done"`.
  (`SELF_CRITIQUE.md §5`)
- **No MFA, no JWT revocation, no session management** — single
  password compromise = full admin access until token expiry.
  (`GOVERNANCE_AUDIT.md §6`)

### 11.3 Scale

- **Single-process lock** — `_BUDGET_LOCK` and `_AUDIT_LOCK` are
  `threading.Lock`. Multi-worker uvicorn would have separate lock
  instances; the concurrency guarantees don't hold.
- **SQLite** — single-writer, single-file, no replication. Migration
  path to Postgres is direct (SQLAlchemy abstracts the dialect) but
  not implemented.
- **No retention policy** — `audit_log`, `api_usage_log`, `login_attempts`,
  `telemetry` all grow indefinitely. (`GOVERNANCE_AUDIT.md §7`)
- **No tenant isolation** — single database, all users share the same
  data space.

### 11.4 What is simulated vs real

- **LLM calls**: real (live the LLM provider API), but demo budget is capped
  at $5/day.
- **Evaluation test cases**: synthetic. 6 cases total.
- **Historical eval runs**: seeded with randomised scores for the
  dashboard charts (see `seed.py`). One deliberate drift scenario on
  the second service for demo reliability.
- **Audit log**: real and live. Every action during a demo is
  audited.
- **Health checks**: real HTTP probes with SSRF validation.

### 11.5 Missing production-grade features

| Feature | Status |
|---|---|
| Encryption at rest | Not implemented |
| Encryption in transit enforcement | Not configured (no HTTPS gateway) |
| BAA with the LLM provider | Not documented |
| DPIA | Not documented |
| MFA | Not implemented |
| Password policy | No min-length / complexity |
| External audit-log anchor | Not implemented |
| Retention sweeper | Not implemented |
| Multi-tenancy | Not implemented |
| Second-model judge | Not implemented |
| RAG / grounding check | Not implemented |

Full compliance posture summary: **would not pass HIPAA, SOX, or
PCI-DSS review in current state**. 6-12 week remediation roadmap in
`GOVERNANCE_AUDIT.md`.

---

## 12. Future Improvements (Roadmap)

Prioritised by user impact per unit effort.

### 12.1 Near-term (weeks)

1. **LLM-based injection classifier** as second-stage input check.
   the LLM provider Haiku, ~1¢/call. Catches paraphrased injections the
   regex misses.
2. **Second-model judge** (Haiku or different vendor) for 10 % of eval
   runs. Log agreement rate; flag disagreements for human review.
3. **Grounding check on incident summaries** — run
   `detect_hallucination(symptoms, summary_draft)` before showing to
   approver. Block approval if score > 70.
4. **Four-eyes enforcement on approvals** — add constraint
   `approved_by != generated_by`. One-line change plus tests.
5. **Retention sweeper** — prune `LoginAttempt`, `ConnectionLog`,
   `Telemetry`, `APIUsageLog.prompt_text` per documented schedule.

### 12.2 Medium-term (months)

6. **External audit-log anchor** — publish daily Merkle root to an
   external log (Sigstore, public GitHub commit, or sibling DB).
7. **Postgres migration** — move from SQLite to Postgres; enable TDE;
   add row-level tenant isolation.
8. **Redis for distributed budget/rate-limit** — replace in-process
   lock with `INCR` + TTL, or a Redis-backed lock with lease.
9. **MFA (TOTP)** — required for admin role, optional for maintainer/
   viewer.
10. **JWT revocation** — `User.token_version` field; invalidate tokens
    on logout / password change / force-logout.

### 12.3 Long-term (compliance-grade)

11. **Multi-vendor LLM routing** — abstract provider behind a shared
    interface; support OpenAI, Azure OpenAI, Ollama.
12. **Per-service drift thresholds** — critical services alert at
    higher scores, low-stakes services at lower.
13. **Human-labelled calibration set** — ~200 factuality examples with
    inter-rater agreement ≥ 0.8 to validate the LLM judge.
14. **Real-time alerting integrations** — webhook delivery of Alert
    rows to Slack / email / PagerDuty.
15. **SOC 2 control mapping** — map every security control to a CSF
    category and generate evidence artefacts on demand.
16. **EU AI Act conformity assessment** — if the platform is classified
    as high-risk under Annex III, comply with Art 9–15 requirements.

---

## 13. Conclusion

**System value.** AI Health Check demonstrates that a centralised,
governance-aware AI operations platform is feasible without enterprise
tooling budgets. The four capabilities — service registry, evaluation
with drift detection, incident management with LLM assistance, and
compliance export — are unified under one schema, one audit chain, and
one HITL contract.

**Governance impact.** The platform enforces four distinct governance
controls programmatically:

1. **Tamper-evident audit trail** via SHA-256 hash chain + SQLite
   append-only triggers.
2. **Human-in-the-loop for all LLM-generated official records** via
   draft/approve pattern on incidents, dashboard insights, and
   compliance AI reports; with a mandatory reviewer note on incident
   approval.
3. **Sensitivity-aware LLM gating** via the confidential-label
   enforcement — data classification has operational teeth, not
   documentation teeth.
4. **SSRF + concurrency-safe budget + strict date parsing** — a
   defence-in-depth layer that catches cost bypass, data exfiltration,
   and silent compliance evidence gaps.

**Practical applications.** The design generalises. Any organisation
that operates multiple AI services and must answer "is it working,
has quality changed, who handled the incident, can we prove it to an
auditor" would recognise the shape here. Deploying it in a regulated
industry (hospital, bank, public sector) would require the 6-12 week
remediation programme documented in `GOVERNANCE_AUDIT.md` — not a
rebuild, but a compliance wrapper (MFA, encryption at rest, vendor DPA,
external audit anchor, retention policy).

**What the project proves.** That a small team, inside a university
course, can build a system whose *governance story* is defensible
against a security audit, a self-critique, and a strict viva — by
treating every control as something the code must enforce, not
something the documentation claims. The gap between feature-list and
guarantee is where most AI systems fail; this project closes that gap
deliberately, documents where it remains, and proposes the path to
production.

---

## 14. Presentation Defence Guide

20-minute presentation plan, 4 speakers × 5 minutes. Suggested team
assignment follows module ownership; adjust based on individual comfort
with each topic.

### Speaker 1 — Problem, System Overview, Architecture (5 min)

**Suggested:** any team member comfortable with the high-level framing.
Because M2 owner Sakir has the broadest cross-module knowledge, he is a
strong default.

**Slide deck skeleton:**

1. **Title slide (15 sec).** Project name, team, course.
2. **The four unanswered questions (45 sec).** Is the AI working? Has
   its quality degraded? Who handled the incident? Can we prove it to
   auditors? — each currently answered by a separate tool in industry.
3. **Problem → solution framing (45 sec).** Fragmented tooling creates
   governance seams. Our thesis: unify on one schema, one audit chain,
   one HITL contract.
4. **Architecture diagram (90 sec).** Four layers (UI, API, DB, LLM);
   9 routers; 14 models; 5 services; one LLM pipeline. Stress: no
   router imports the the LLM provider SDK directly.
5. **Tech stack justification (45 sec).** React/Vite for fast dev
   feedback; FastAPI for typed validation; SQLite for zero-config
   (migration path to Postgres documented); the LLM provider two-tier
   (Sonnet 4.6 actor + Haiku 4.5 judges / injection detector) via a
   single pipeline so vendor-swap is one file.
6. **Demo data readiness (30 sec).** Fresh seed includes 15 eval runs
   with a deliberate drift scenario visible on first login — today's
   dashboard proves itself before we touch anything.

**Talking points per slide:**
- *"The four questions aren't technical; they're governance questions.
  Our insight is that answering them requires a shared data layer, not
  integration middleware between four tools."*
- *"The audit log is the spine of the architecture. Every transition
  writes to it, and the hash chain means we can prove it hasn't moved."*

**Likely professor questions:**
- **"Why SQLite not Postgres?"**
  *"SQLite was right for an academic prototype — zero-config, one file
  for the grader to reproduce. It's wrong for production. We've
  documented three specific Postgres dependencies we had to simulate:
  the append-only triggers (we'd use role-based REVOKE), the threading
  locks (we'd use SELECT FOR UPDATE), and TDE for HIPAA §164.312(a)(2)(iv)."*
- **"Why one LLM pipeline?"**
  *"Cohesion over coupling. The safety scanner, budget check, retry
  logic, output scanner, and call tracing all converge in one place.
  Vendor swap is one file. Testing mocks at one boundary."*

### Speaker 2 — Service Registry (M1) & Monitoring + Evaluation (M2) (5 min)

**Suggested:** a team member covering both — or smooth handoff between
Jack (M1) and Sakir (M2) within this segment.

**Slide deck skeleton:**

1. **M1: Service registry (60 sec).** CRUD with environment +
   sensitivity classification. SSRF validator blocks metadata service,
   private IPs, non-http schemes — applied at register, update, probe,
   and every scheduled tick. Live demo: attempt to register
   `http://169.254.169.254/` → backend returns 400 with clear message.
2. **M1: Connection testing (45 sec).** Two modes (HTTP probe vs LLM
   probe). LLM mode enforces sensitivity gate — confidential services
   require admin override, every override audited.
3. **M2: Dashboard metrics (60 sec).** Five metric families: services,
   quality, error rate, latency, percentiles. Plain-English labels on
   the percentile tiles ("Typical / Slow / Worst Response"). Shared
   chart-style module so visuals stay consistent.
4. **M2: Evaluation harness (75 sec).** Test cases per service →
   run_eval_prompt → factuality (LLM judge) / format (JSON parse) /
   hallucination (LLM judge) → EvalRun + EvalResult rows. Strict judge
   parser rejects refusals — *"I cannot rate this. 404"* returns None,
   not 404-clamped-to-100.
5. **M2: Drift detection (45 sec).** Threshold + trend + variance +
   severity levels. Drift auto-creates an Alert row with an audit
   entry. *"We detect drift above the threshold too — a slowly
   declining service still above 75% but trending down still fires a
   warning alert."*
6. **Live demo: drift alert on Dashboard (30 sec).** Pre-seeded
   scenario on "Internal Report Generator" quality at 42 %.

**Talking points:**
- *"The regex in the safety scanner is a floor, not a ceiling. For
  prompt-injection defence we rely on human approval of the final
  output."*
- *"Judge refusals used to be misread as scores — we fixed that in the
  hardening pass. Refusals now return None and are excluded from the
  aggregate."*

**Likely professor questions:**
- **"Why 75% as the drift threshold?"**
  *"It's a heuristic, not a statistically derived threshold. We have
  N=6 test cases and ~15 seed runs — there's no statistical validity
  at that scale. In production we'd run the eval suite for 8 weeks
  against a known-stable service to establish the noise floor, pick a
  threshold at 2σ below the mean, and validate against a deliberately
  regressed service. Documented in SELF_CRITIQUE §2."*
- **"What's the false-positive rate of your drift detector?"**
  *"Not measured. That's a deliberate limitation we've flagged.
  Production would need a baseline study before the threshold is
  defensible."*

### Speaker 3 — Incident Triage (M3) & LLM Integration Design (5 min)

**Suggested:** Osele (M3 owner).

**Slide deck skeleton:**

1. **M3: Incident lifecycle (45 sec).** Open → investigating →
   resolved → closed. Five-box checklist (data, prompt, model,
   infrastructure, safety). Fields persisted with full audit trail.
2. **LLM integration design (75 sec).** Seven functions in
   `llm_client.py`, all via `_make_api_call`. Six-stage pipeline:
   safety scan → atomic budget check + reservation under lock → API
   call (outside lock) → output scan → finalise reservation. Sensitivity
   gate runs before stage 1 for service-tied calls.
3. **HITL enforcement (90 sec).** Every LLM output lands in a `_draft`
   field, never in official fields. Approval requires:
   - ≥20 non-whitespace character reviewer note (mandatory)
   - Idempotency (409 on double-approve)
   - Audit entry with `reviewer_note_len`
   Backend re-strips whitespace so "20 spaces" is rejected.
4. **Live demo: generate + approve summary (90 sec).** Click Generate
   → wait for the AI (~5-10s, narrate the pipeline during wait) →
   draft appears in yellow banner → click Approve → ReviewerNoteModal
   opens → paste prepared note → submit. Navigate to Governance → show
   audit entry with `reviewer_note_len=64`.
5. **Cross-refer to SELF_CRITIQUE (30 sec).** *"The reviewer note is a
   forcing function for deliberation, not enforcement. Real four-eyes
   requires distinct drafter and approver identities — we don't enforce
   that yet. It's Level-1 HITL, documented as Level-2+ future work."*

**Talking points:**
- *"Notice the approve button doesn't just fire. It requires 20
  characters of articulated reviewer note. That's the difference
  between 'human saw the draft' and 'human confirmed what they
  verified.' Pydantic enforces length at the request layer; the
  handler re-checks after whitespace strip."*

**Likely professor questions:**
- **"What stops an admin from typing 20 meaningless characters?"**
  *"Nothing structural — it's a forcing function, not enforcement. Real
  HITL requires four-eyes (distinct drafter/approver), semantic
  validation of the note against the draft, and time-on-screen
  telemetry. We built Level-1; Level-2+ is roadmap. See SELF_CRITIQUE §5."*
- **"What happens if the LLM provider returns garbage for the judge prompt?"**
  *"The parser uses re.fullmatch — only a bare integer is accepted.
  Refusals like 'I cannot rate this' return None. The eval harness
  marks those as status=judge_refused and excludes them from the
  aggregate, so a misbehaving judge doesn't spuriously trip drift.
  Thirteen regression tests cover the refusal phrasings."*

### Speaker 4 — Governance (M4), Compliance Export, Future Work (5 min)

**Suggested:** Jeewanjot (M4 owner).

**Slide deck skeleton:**

1. **M4: RBAC (45 sec).** Three roles enforced at route level via
   `Depends(require_role([...]))`. Every 403 writes `role_denied` to
   audit — probing attempts surface on review. Role re-checked from DB
   on every request; token role claim is ignored.
2. **M4: Audit trail integrity (75 sec).** SHA-256 hash chain.
   Compute-before-insert so the row is immutable from landing. SQLite
   BEFORE UPDATE/DELETE triggers block app-path mutation. Live demo:
   click Verify on Governance page → green "Chain intact — 47 entries
   verified." State the attacker model: *"In-app adversary yes.
   Privileged host no. Production would need an external anchor."*
3. **M4: Compliance export (60 sec).** JSON + PDF. Three sections
   (audit, incidents, maintenance plans). Strict date parsing — typo'd
   from_date returns 400, not silently drops the filter. Row cap
   10000 per section with explicit truncation warnings in the payload
   and red PDF banner.
4. **Cross-refer: GOVERNANCE_AUDIT (60 sec).** *"We've mapped the
   system against HIPAA, SOX, PCI-DSS, and EU AI Act. The short
   version: would not pass any of them without the 6-12 week
   remediation roadmap documented in GOVERNANCE_AUDIT. Specifically
   blocked by missing MFA, missing encryption at rest, no BAA with
   the LLM provider, absent four-eyes, no external audit anchor."*
5. **Future work (30 sec).** Three near-term: LLM-based injection
   classifier, second-model judge, grounding check on summaries.
   Three medium-term: external audit anchor, Postgres + TDE, Redis
   for distributed budget. Listed by user impact per effort in §12.
6. **Closing frame (30 sec).** *"We built a prototype whose governance
   story is defensible because every control is enforced in code. The
   gap between marketing claim and actual guarantee is where AI
   systems fail; we closed that gap deliberately and documented where
   it remains."*

**Talking points:**
- *"Integrity verify is not just a feature — it's a falsifiable claim.
  Watch."* Click button. *"Green. 47 entries. SHA-256 linked."*
- *"The export warnings are explicit. When more rows exist than the
  cap, the JSON response includes a warnings array and the PDF prints
  it in red. Silent compliance evidence is how audits fail."*

**Likely professor questions:**
- **"Can the audit log be tampered with?"**
  *"The chain defends against in-app mutation. The SQLite triggers
  reject UPDATE and DELETE from the app. Against a privileged host
  adversary who drops the triggers at the filesystem level — no, our
  chain genesis is a hardcoded zero with no external anchor. Production
  defence needs daily Merkle-root publication to Sigstore, a sibling
  DB, or a WORM-enforced audit service. Documented as R9 residual."*
- **"If deployed in a hospital, would this pass HIPAA review?"**
  *"No — not without remediation. Blocking findings: no BAA with
  the LLM provider documented, no encryption at rest, no MFA on admin, no
  segregation of duties. We've mapped every Security Rule control
  individually in GOVERNANCE_AUDIT.md. It's a 6-12 week programme,
  not a rebuild. We know exactly what's missing."*

### Cross-cutting Q&A preparation

If any question lands outside the speaker's lane, defer to the owner:

| Topic | Defer to |
|---|---|
| Architecture / data flow | Speaker 1 |
| Service registry / connection test / SSRF | Speaker 2 |
| Dashboard metrics / drift / eval harness | Speaker 2 |
| Incident lifecycle / LLM integration / HITL | Speaker 3 |
| RBAC / audit / compliance / EU AI Act | Speaker 4 |

Universal recovery phrasing for any question beyond prepared content:

> *"That's documented in [SELF_CRITIQUE / GOVERNANCE_AUDIT / RISK_REGISTER §X]
> as a known limitation. The mitigation we've built is Y; production
> would require Z."*

This pattern consistently wins marks because it demonstrates awareness
of the gap rather than defence of an overclaim.

### Final closing line

*"We built a centralised AI operations platform with real
security-hardening rigour and an honest understanding of its
limitations. Four modules, 14 database models, 9 routers, 188 tests,
71 % coverage, 15 maintained documents. Not production-ready, but
demonstrably designed for production. Thank you."*

---

## Appendix A — Documentation Index

| Document | Purpose |
|---|---|
| `docs/README.md` | Reading guide by audience |
| `docs/ARCHITECTURE.md` | System design reference |
| `docs/MODULE_GUIDE.md` | Module-by-module breakdown |
| `docs/ONBOARDING.md` | Setup + first-run walkthrough |
| `docs/TESTING_STRATEGY.md` | Test inventory and coverage |
| `docs/EVAL_DATASET_CARD.md` | Evaluation methodology |
| `docs/PROMPT_CHANGE_LOG.md` | LLM prompt templates + model history |
| `docs/MAINTENANCE_RUNBOOK.md` | 15 operational scenarios |
| `docs/RISK_REGISTER.md` | 17 risks with mitigations + residuals |
| `docs/SELF_CRITIQUE.md` | 5 methodological gaps |
| `docs/GOVERNANCE_AUDIT.md` | HIPAA / SOX / EU AI Act posture |
| `docs/LIVE_DEMO_WALKTHROUGH.md` | Consolidated demo guide: prep, 9-step script, killshots, recovery, one-page checklist |
| `docs/VIVA_QA_PREP.md` | 10 hardest Q&A questions + ideal answers |
| `docs/TECHNICAL_REFERENCE.md` | This document |

## Appendix B — Key Numbers

- 14 database models
- 9 routers mounted under `/api/v1/*`
- 5 service modules (llm_client, safety, url_validator, sensitivity, draft_service)
- 3 middleware modules (auth, rbac, audit)
- 7 centralised LLM functions via one `_make_api_call` pipeline
- 6-stage LLM pipeline (safety in, budget+reserve under lock, API call outside lock, output scan, finalise, log)
- 17 formally tracked risks with mitigations and residuals
- 15 operational scenarios in the maintenance runbook
- 15 UI pages + components in the React frontend
- 188 automated tests across 22 files
- 71 % test coverage (65 % enforced floor)
- 3 user roles (admin, maintainer, viewer)
- 3 sensitivity labels (public, internal, confidential)
- 1 hash-chain audit trail with SQLite append-only triggers
- 1 single the LLM provider API integration swappable in one file

---

*End of document.*
