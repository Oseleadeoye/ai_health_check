# AI Health Check

A centralized AI operations platform to monitor, evaluate, triage, and govern an organization's AI services.

ARTI-409-A | AI Systems & Governance | Group Project

"We built a simplified but complete version of what companies like Arize AI, LangSmith, and Datadog LLM Monitoring
 do separately. In production, organizations typically need 3-4 different tools stitched together to monitor AI
 health, detect drift, manage incidents, and prove compliance. Our app does all four in one place, with
 human-in-the-loop governance built in from the start."

## The Problem

Companies use AI tools (chatbots, report generators, assistants) but have no single place to answer:
- Is the AI working correctly right now?
- Has its quality gotten worse over time?
- When something breaks, what happened and who fixed it?
- Can we prove to auditors that we're managing our AI responsibly?

AI Health Check is an **AI Operations Control Room** that answers all four questions in one place.

## How It Works

**1. Register your AI services** -- Tell the system about each AI tool: name, owner, environment (dev/staging/prod), model, and data sensitivity level. A phone book for your AI fleet.

**2. Test connections** -- Click "Ping" on any service. The system sends a test message, measures latency, and logs the result for uptime tracking.

**3. Run evaluations** -- Create test cases with known answers. The system sends them to the AI, scores the responses for factuality (did it get facts right?) and format (valid JSON?), and stores each score with a timestamp.

**4. Detect drift** -- If quality drops below 75%, the system flags it. It also watches trends: slowly declining scores trigger a warning before things go critical.

**5. Create an incident** -- When something breaks, log it with symptoms, severity, and a troubleshooting checklist (data issue? prompt change? infrastructure problem?).

**6. Get AI help (with human approval)** -- Click "Generate Summary" and the AI drafts a stakeholder update with likely root causes. But it's just a draft -- a human must review and click "Approve" before anything is saved. The AI assists, it never decides.

**7. Plan maintenance** -- Create a plan with risk level, rollback strategy, validation steps, schedule, and a human approval checkbox.

**8. Prove compliance** -- Export a PDF or JSON report with evaluations, incidents, maintenance actions, and the full audit log for any time period.

## The Safety Net

Every time the app talks to the AI model, it goes through this pipeline:

1. **Scan the input (single-layer regex)** -- 15 injection patterns, PII detection (email, phone, SSN, credit card), and a length limit (hard cap 12 000 chars). Risk score ≥ 80 blocks the call with HTTP 422. An LLM classifier second layer was trialled and removed in commit `73e09b3` — the false-positive rate didn't justify the cost at demo scale.
2. **Check the budget** -- Block the call if daily ($5) or monthly ($25) spend limits are reached
3. **Check rate limits** -- Throttle if the user exceeds 20 calls/minute or the system exceeds 30/minute (sized for demo eval batches — a 10-case factuality run fires ~20 the AI calls: 10 actor + 10 merged judge). Exceeding returns HTTP 429.
4. **Call the model** -- Sonnet for actor + synthesis tasks; Haiku for the judges that score factuality and hallucination. If it fails, retry up to 2 times with backoff
5. **Scan the output** -- Check the AI's response for personal information before showing it to the user
6. **Log everything** -- Record tokens, cost, latency, model used, and any safety flags (per-model cost accounting keeps Haiku vs Sonnet rows priced correctly)

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite 5, Tailwind CSS 3.4, Recharts |
| Backend | FastAPI, Python 3.11+, SQLAlchemy |
| Database | SQLite |
| LLM (actor) | the LLM provider the AI Sonnet 4.6 (`claude-sonnet-4-6-20250415`) — services under test + synthesis tasks |
| LLM (judge) | the LLM provider the AI Haiku 4.5 (`claude-haiku-4-5-20251001`) — merged factuality + hallucination judge (one structured call per factuality test case) |
| Testing | Pytest (188 tests across 22 files, ~71% coverage) |

## Quick Start

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env          # add your ANTHROPIC_API_KEY
python -m app.seed
uvicorn app.main:app --reload --port 8000

# Frontend (new terminal)
cd frontend && npm install && npm run dev
```

Open http://localhost:5173 in your browser.

## Default Credentials

The seed script (`python -m app.seed`) creates three users with these emails:

| Role | Email |
|------|-------|
| Admin | admin@aiops.local |
| Maintainer | maintainer@aiops.local |
| Viewer | viewer@aiops.local |

**Passwords are set via `SEED_ADMIN_PASSWORD`, `SEED_MAINTAINER_PASSWORD`, and
`SEED_VIEWER_PASSWORD` in your local `backend/.env`** — see
[backend/.env.example](backend/.env.example) for the section and the
documented fallback behaviour. If those env vars are unset, seed falls
back to weak demo defaults and prints a warning; those defaults are
intentionally not published here so that cloning the public repo
doesn't hand anyone working credentials.

## Team & Modules

| Member | Module | What they own |
|--------|--------|--------------|
| Jack | M1: Service Registry | Registering and testing AI services, connection logging |
| Sakir | M2: Monitoring & Eval | Dashboard metrics, evaluation harness, drift detection |
| Osele | M3: Incident Triage | Incident lifecycle, AI summaries, maintenance planning |
| Jeewanjot | M4: Governance | Roles, audit log, compliance export, data policy |

For a detailed module-by-module breakdown with files, endpoints, and demo flow, see [MODULE_GUIDE](docs/MODULE_GUIDE.md).

## Project Structure

```
ai-health-check/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app entry point + append-only audit-log triggers
│   │   ├── config.py            # 22 settings via .env
│   │   ├── database.py          # SQLAlchemy engine + SQLite FK enforcement
│   │   ├── models/              # 14 database models (incl. AILlmDraft for HITL)
│   │   ├── routers/             # 9 routers (auth, services, evaluations, incidents,
│   │   │                        #             maintenance, dashboard, users, audit, export)
│   │   ├── services/            # llm_client, safety, url_validator, sensitivity, draft_service
│   │   └── middleware/          # auth, rbac (audits denials), audit (hash-chain)
│   └── tests/                   # 188 tests across 22 files
├── frontend/src/
│   ├── pages/                   # 9 pages
│   ├── components/              # 13 shared + 3 eval components
│   └── styles/                  # CSS variable design tokens
└── docs/                        # 9 documentation files
```

## Key Features Beyond Requirements

### Safety & guardrails
- Prompt safety scanner with 15 injection patterns, PII detection, toxicity checks, length limits
- Automated PII Leakage Detection integrated directly into the evaluation harness metrics
- LLM-as-judge hallucination detection (0-100), strict parser rejects judge refusals (no more "404 Not Found" → 100)
- Sensitivity labels have teeth: confidential services require admin override + audit trail to reach the LLM
- SSRF guard on every outbound URL (register, update, probe, scheduled tick) blocks metadata services and private IPs
- Retry with exponential backoff for transient API failures

### Cost & rate controls
- API budget enforcement with daily/monthly caps and per-call cost tracking
- Per-user and global rate limiting with **concurrency-safe reservation** (lock + atomic INSERT — no race bypass)
- Cost analytics by service

### Human-in-the-loop
- Incident summaries + maintenance plans require explicit human approval
- Mandatory `reviewer_note` (≥20 chars) on incident approval — no silent rubber-stamping
- Dashboard insights + compliance AI reports use shared draft/approve abstraction (`AILlmDraft`)
- Idempotent approvals (double-approve returns 409, attribution preserved)

### Audit & compliance
- **Tamper-evident audit log**: SHA-256 hash chain + SQLite append-only triggers + admin-only integrity verify
- Every RBAC 403 denial is itself audited as `role_denied` for forensic review
- Login success/failure/lockout mirrored from `login_attempts` to `audit_log`
- Compliance export includes audit + incidents + maintenance plans (JSON + PDF)
- Strict date parsing — malformed `from_date` returns 400 instead of silently dropping the filter
- Truncation warnings surfaced when exports exceed row cap (10,000 per section)

### Monitoring
- Advanced drift detection with severity levels, trend analysis, per-test tracking
- Pure-Python Advanced Evaluation Metrics: TF-IDF Cosine Semantic Similarity scoring alongside LLM Factuality
- Auto-populating evaluation test suites for newly registered services (including DAN jailbreaks, PII traps, and complex format constraints)
- Login throttling (lockout after 5 failed attempts)
- LLM call tracing with prompt/response storage
- Alert system with acknowledge workflow
- Command palette (Cmd+K) with keyboard navigation
- Dark/light theme with accessible design tokens (WCAG 2.2 AA)

## Documentation

**New here? Start with [docs/README.md](docs/README.md)** — the reading guide
that routes you through the docs based on whether you're grading, setting up,
reviewing compliance, or rehearsing a demo.

| Document | What's in it |
|----------|-------------|
| [docs/README](docs/README.md) | Reading guide by audience (grader / developer / compliance / viva) |
| [TECHNICAL_REFERENCE](docs/TECHNICAL_REFERENCE.md) | Consolidated reference manual — 14 sections + 20-min presentation defence guide with per-speaker scripts |
| [MODULE_GUIDE](docs/MODULE_GUIDE.md) | Module-by-module breakdown with files, endpoints, and end-to-end demo flow |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | System design, database models, API endpoints, configuration reference |
| [ONBOARDING](docs/ONBOARDING.md) | Setup steps and platform lifecycle walkthrough |
| [TESTING_STRATEGY](docs/TESTING_STRATEGY.md) | 188 tests across 22 files with coverage floor, what they cover, how to run |
| [EVAL_DATASET_CARD](docs/EVAL_DATASET_CARD.md) | Test cases (6-case auto-populated suite), scoring methodology (Semantic, PII, Factuality, JSON), drift algorithm |
| [PROMPT_CHANGE_LOG](docs/PROMPT_CHANGE_LOG.md) | All 7 LLM prompt templates, model history, parser changes |
| [RISK_REGISTER](docs/RISK_REGISTER.md) | 17 risks with mitigations and residuals |
| [MAINTENANCE_RUNBOOK](docs/MAINTENANCE_RUNBOOK.md) | 15 operational scenarios (incl. audit integrity, SSRF, confidential override, judge refusals) |
| [LIVE_DEMO_WALKTHROUGH](docs/LIVE_DEMO_WALKTHROUGH.md) | Consolidated demo guide: night-before / morning-of / T-15 pre-flight, 9-step script with failure modes & killshots, recovery, one-page checklist |
| [SELF_CRITIQUE](docs/SELF_CRITIQUE.md) | Top 5 methodological weaknesses a rigorous examiner will probe, with honest-answer phrasing for the viva |
| [GOVERNANCE_AUDIT](docs/GOVERNANCE_AUDIT.md) | Enterprise governance audit: 7 risk categories + HIPAA / SOX / EU AI Act verdict + 12-week remediation roadmap |
| [DOVER_MAPPING](docs/DOVER_MAPPING.md) | Implementation mapping against the DOVER framework (Data / Oversight / Validation / Ethics / Risk) |
| [VIVA_QA_PREP](docs/VIVA_QA_PREP.md) | 10 hardest questions a strict examiner will ask in a 2-minute Q&A, with ideal-answer phrasing and weak-answer traps |

---

Academic project -- ARTI-409-A, AI Systems & Governance, 2026
