# Changelog

This file captures meaningful change sets merged into `main`. It's not a
per-commit log (use `git log` for that) — it's a grouped, themed record
of what shipped and why, so the design rationale doesn't disappear into
commit messages alone.

## 2026-04-21 / 2026-04-22 — Two-model economy, single gatekeeper, call tracing

A coordinated refactor that reshaped the LLM-facing parts of the system
around three ideas: (1) split the actor model from the judge model with
honest pricing for each, (2) funnel every the AI call through a single
limit-enforcement gatekeeper, (3) give every user action a correlation
ID so the Settings page can show *what one click actually cost*.

### Highlights

- **Two-model architecture, merged-rubric judge.** Sonnet acts, Haiku
  judges factuality + hallucination in one call. A 10-case eval went
  from **~44 the AI calls to ~16** — roughly 64% fewer calls.
- **Single-gatekeeper call limits.** `enforce_call_limits()` is the
  one function every the AI call passes through, checking hard caps
  (per-call cost, max_tokens, prompt length) + soft budgets + rate
  limits. Hard caps are read-only env config surfaced in the UI.
- **Per-request correlation IDs.** A new ASGI middleware stamps every
  HTTP request with a UUID; every the AI call fired inside that
  request shares it. The Settings → Call Trace tab groups calls by
  correlation_id so reviewers see *"Evaluation run · 16 calls ·
  $0.08 · 18s"* as one row.
- **"Honest scoring" run status.** `EvalRun.run_status` tri-state
  distinguishes runs with no measurable signal from runs that
  legitimately scored 0% — fixes the "0% quality / Healthy" UX lie.
- **Service Registry dropdown** replaces free-text model entry,
  backed by a supported-models catalog endpoint.

### Current test count

**207 passing** across 28 test files.

---

## Theme 1 — Two-model foundation

**What.** The system previously ran Sonnet for everything — including
scoring its own output, which is a well-known evaluation anti-pattern.
Split into two roles:

- **Actor** (`LLM_MODEL`, defaults to `claude-sonnet-4-6`) — runs the
  service under test, incident summaries, compliance reports, dashboard
  insights.
- **Judge** (`JUDGE_MODEL`, defaults to `claude-haiku-4-5`) — scores
  factuality + hallucination in one merged-rubric JSON call. Different
  model family from the actor reduces self-scoring correlation; Haiku
  rates (~$1 input / $5 output per 1M tokens) keep the judge cheap.

**Why.** Panel-defensible evaluation story (actor/judge independence) +
3× cheaper per judge call. And `run_status` makes "no measurable signal"
renderable instead of a misleading zero.

**Key files.**
- `backend/app/config.py` — `llm_model` + `judge_model` settings
- `backend/app/services/llm_client.py` — `_estimate_cost` per-model,
  `judge_response()` merged call
- `backend/app/services/eval_runner.py` — short-circuits on actor error
  + exact-match so those cases skip the judge call entirely
- `backend/alembic/versions/001_add_judge_model_to_evalrun.py`
- `backend/alembic/versions/002_add_run_status_to_evalrun.py`
- `frontend/src/components/common/ModelBadge.jsx`
- `frontend/src/components/settings/ModelCard.jsx` — role-coloured
  card for actor (amber) vs judge (sky)

**Commits.** `eb596e9` (schema), `3bdff2d` (pricing/routing),
`e90ba7b` (UI consumption), `0fbddac` (judge merge), `43ff752`
(dual-model config API), `e9845af` (Models section actor+judge).

---

## Theme 2 — Safety simplification

**What.** An earlier iteration had a two-layer input safety scan: regex
tripwire + a Haiku LLM classifier. The LLM classifier was fail-open, so
a classifier outage silently degraded to regex-only — the "best case"
feature. Removed it and strengthened the regex instead.

**Why.** Fewer moving parts, one less silent-failure mode, and ~33%
fewer the AI calls per request (each request was hiding an extra Haiku
scan). Story simplifies from *"we have three models"* to *"we have two
models with clear roles."*

**Key files.**
- `backend/app/services/safety.py` — reverted to single-layer regex;
  added ~6 patterns for common 2026-era paraphrases of injection
  attempts (`forget everything`, `roleplay as`, API-key exfiltration
  verbs, etc.)
- `backend/app/services/llm_client.py` — collapsed `_make_api_call_core`
  back into `_make_api_call` (the split only existed to avoid
  recursion through `detect_injection`, now gone)

**Commits.** `dbe67b9` (two-layer classifier — superseded),
`73e09b3` (drop classifier, collapse `_core`).

---

## Theme 3 — Hard-cap single gatekeeper

**What.** New `enforce_call_limits(model, max_tokens, prompt_text,
user_id)` function. Every the AI call passes through `_make_api_call`,
which calls `enforce_call_limits` *before* reserving a slot or touching
the network. Checks in cheapest-first order:

1. Prompt length ≤ `HARD_MAX_PROMPT_CHARS` (default 12000)
2. `max_tokens` ≤ `HARD_MAX_TOKENS_PER_CALL` (default 2000)
3. Worst-case cost ≤ `HARD_MAX_COST_PER_CALL_USD` (default $0.05)
4. Daily / monthly budget (via `_check_budget`)
5. Global / per-user rate limits (same path)

All five raise a single `CallLimitExceeded` exception with
`{limit_type, current, cap}` fields. `BudgetExceededError` kept as an
alias so existing handlers don't break.

**Why.** Accidentally asking for 100k tokens or submitting a 50KB
prompt should reject before the network call, not burn the daily
budget. One function, one place, testable in isolation.

**Key files.**
- `backend/app/services/llm_client.py` — `CallLimitExceeded`,
  `enforce_call_limits`
- `backend/app/config.py` — three new `HARD_*` settings
- `backend/.env.example` — documented defaults
- `backend/app/routers/settings.py` — `GET /settings/limits`
  exposes hard caps + soft budgets + live usage
- `frontend/src/pages/SettingsPage.jsx` — "Limits" section with
  three read-only panels (hard / soft / live) and progress bars

**Commits.** `f506024` (gatekeeper + endpoint), `4e9c5e3` (UI panel).

---

## Theme 4 — Per-request correlation IDs + Call Trace UI

**What.** ASGI middleware assigns every HTTP request a fresh UUID,
stored in a `contextvars.ContextVar`. Every the AI call fired during
that request reads the contextvar and stamps the UUID onto its
`api_usage_log` row. Two new endpoints consume the data:

- `GET /settings/trace/activities` — paginated list grouped by
  `correlation_id`, with family filter (evaluation / incident_triage /
  dashboard_insight / compliance_report / connection_test) and time
  window. Each row is one user action: icon, service, user, call
  count, total cost, total latency, status.
- `GET /settings/trace/calls/{correlation_id}` — per-call drill-down
  including the full prompt and response text. Admin/maintainer only
  (PII surface).

Schema migration `003_correlation_id` added a nullable indexed column
to `api_usage_log`. Nullable because background scheduler calls have
no HTTP request → no correlation_id, and that's the correct semantic
("not a user action, don't group it").

**Why.** A reviewer asking *"what did that click cost?"* now has a
single row to point at instead of hunting through a flat log.

**Key files.**
- `backend/app/middleware/correlation.py` — the middleware + contextvar
- `backend/alembic/versions/003_add_correlation_id_to_api_usage_log.py`
- `backend/app/services/call_families.py` — caller→family mapping
- `backend/app/routers/settings.py` — the two trace endpoints
- `frontend/src/components/trace/ActivityRow.jsx` — collapsible row
- `frontend/src/components/trace/CallDetailModal.jsx` — prompt/response
  drill-down modal
- `frontend/src/components/trace/FamilyBadge.jsx` — colored pill per
  family

**Commits.** `f456f48` (middleware + schema), `eab7fc4` (UI + endpoints).

---

## Theme 5 — Observability threading + latency accuracy

**What.** Before this work, every row in `api_usage_log` had `user_id
IS NULL` and `service_id IS NULL` — none of the public LLM functions
accepted or forwarded caller identity. Threaded `user_id` and
`service_id` through every public LLM function + every router
call-site. Related fix: `_make_api_call` now measures wall-clock
latency across the retry loop (was per-attempt, which under-reported
real wait time during the LLM provider throttling).

Also tightened `test_connection`'s exception handling to re-raise
`CallLimitExceeded` and `PromptSafetyError` so the global FastAPI
handler maps them to proper 402/413/422/429 responses instead of
swallowing them into a generic "Connection failed" card.

**Why.** Three concrete wins:

1. Per-user rate limits actually fire now (the `if user_id and ...`
   guard in `_check_budget` was dead code — it only activated when
   `user_id` was truthy).
2. Cost-by-user and cost-by-service aggregations become possible.
3. The Settings "Last minute (you)" panel shows real numbers instead
   of always-zero.

**Key files.**
- `backend/app/services/llm_client.py` — all 6 public functions
  accept optional `user_id` + `service_id`
- `backend/app/services/eval_runner.py` — `run_service_evaluation`
  threads `user_id` into both `run_eval_prompt` and `judge_response`
- Routers: `services.py`, `evaluations.py`, `dashboard.py`,
  `incidents.py`, `export.py` — all pass `current_user.id` and
  (where available) `service.id`
- `frontend/src/pages/ServicesPage.jsx` — new live/http mode tag
  next to latency; confirmation modal for confidential Ping
  reworded to name the cost + latency expectation

**Commits.** `e0940c5` (threading + test_connection), `c8a0590`
(wall-time latency + live/http UX).

---

## Theme 6 — Settings page consolidation

**What.** Reduced sidebar sections from 7 to 6:

| Before | After |
|---|---|
| Model & Pricing (Sonnet only) | **Models** (actor + judge side-by-side) |
| Evaluation | Evaluation |
| API Limits (hard + soft + live) | **Limits** (now also includes Cost-by-function) |
| Call Trace | Call Trace (Grouped / Flat toggle) |
| **API Usage** *(removed)* | — |
| Safety | Safety |
| Performance | **Performance** (now also has Volume: today/month call+token totals) |

"Cost by function" from the old API Usage section moved to Limits (so
"what's the cap?" and "what's driving spend?" are next to each other).
"Recent API calls" flat table moved under Call Trace as a Flat-view
toggle. Deep-link fallback: `/settings#usage` → `/settings#limits`.

**Why.** API Limits and API Usage overlapped — both showed daily $,
monthly $, and rate limits with different cards but identical data.
Consolidation removes duplication and gives every widget one logical
home.

**Key files.**
- `frontend/src/pages/SettingsPage.jsx` — SECTIONS array, deep-link
  alias map, one less tab, two reworked panels

**Commits.** `43ff752` (backend dual-model + per-model breakdown),
`e9845af` (Models actor+judge), `7053a49` (collapse API Usage).

---

## Theme 7 — Model catalog + Service Registry dropdown

**What.** New `app.services.model_catalog` module — single source of
truth for "what models does this system support?". `CATALOG` is an
ordered list of `ModelInfo(id, family, tier, label, recommended_for,
input_per_million_usd, output_per_million_usd)`. `pricing_for()` is
the only function cost code should call; it handles both normalization
(strips `-YYYYMMDD` suffixes so dated and undated IDs resolve to the
same entry) and Sonnet-rate fallback for unknown models.

New endpoint `GET /settings/models/catalog` feeds the Service Registry
create/edit dropdown. Catalog options render as *"Sonnet 4.6 — $3/$15
per 1M tok · recommended for actor"* — enough context to pick
intelligently without reading docs. When editing a service whose
`model_name` isn't in the current catalog (e.g. a legacy dated id), the
current value is preserved as a `(not in catalog)` option so edits
don't silently change the model.

**Why.** Free-text entry + date-suffixed keys in `_PRICING` led to
quiet pricing-fallback behavior when someone typed a slightly different
valid ID. The dropdown makes typos impossible; the normalization makes
legacy dated IDs price correctly.

**Key files.**
- `backend/app/services/model_catalog.py` (new)
- `backend/app/services/llm_client.py` — `_PRICING` now derived from
  `CATALOG`; `_estimate_cost` routes through `pricing_for()`
- `backend/app/routers/settings.py` — `/models/catalog` endpoint
- `backend/app/routers/dashboard.py` — `/dashboard/settings` also
  uses `pricing_for()`
- `frontend/src/pages/ServicesPage.jsx` — dropdown with lazy-load,
  catalog-fetch fallback to free-text on outage, pre-select preservation

**Commits.** `c35fb3e` (catalog + normalization), `cc4da4f` (dropdown).

---

## Theme 8 — Data & seed hygiene

**What.** Three housekeeping items:

1. **DB cleanup** (one-shot, no commit — direct SQL after backup):
   - Service #3's `model_name` was `claude-sonnet-4-6-20250415`; the LLM provider
     was 404'ing on that snapshot. Updated to `claude-sonnet-4-6`.
   - 164 smoke-test rows in `api_usage_log` (`caller='test'`,
     `model='m'`) polluting the new Call Trace Flat view — deleted.
   - Backup preserved at `backend/aiops.db.bak.20260422-001605-cleanup`.
2. **Orphan test cleanup.** `test_judge_parser.py` deleted (imported
   removed `_parse_judge_score`). `test_evaluations.py` rewrote 5
   patches from the old `score_factuality` + `detect_hallucination`
   pair to the merged `judge_response` mock shape. `test_services.py`
   widened two fake-signature stubs to accept `**kwargs`.
3. **Seed + env canonical IDs.** All three services in `seed.py` and
   both `LLM_MODEL`/`JUDGE_MODEL` in `.env.example` now use the
   undated canonical form so a re-seed or fresh `.env` copy doesn't
   reintroduce 404-prone snapshots.

**Why.** A clean demo database + green test suite + safe reseed path.

**Key files.**
- `backend/app/seed.py`
- `backend/.env.example`
- `backend/tests/test_evaluations.py`
- `backend/tests/test_services.py`
- (deleted) `backend/tests/test_judge_parser.py`

**Commits.** `5f08d5d` (orphan tests), `75ed46b` (seed + env).

---

## Probe-liveness fix (pre-existing but refined this cycle)

**What.** The HTTP-probe path for reachability treated anything other
than 2xx as `failure`. But most AI API endpoints are POST-only and
return 405 (or 401 without credentials) to anonymous GETs — both mean
*"server is up and answered us."* Only 5xx and network errors count
as the endpoint being down now.

**Why.** Registered the LLM provider/OpenAI-style endpoints were showing
"Failed" at registration even though they were perfectly healthy.

**Key files.**
- `backend/app/routers/services.py` — `_probe_service_endpoint`
- `backend/app/main.py` — scheduled health-check loop (same logic)

**Commit.** `17941ee`.

---

## What's NOT done (deliberate, for future sessions)

- **Service Registry: richer registration flow.** Owner contact field
  (email/Slack), service type enum (chatbot / summarizer / etc.),
  post-create "next steps" panel nudging users to add test cases.
  Scoped in `/Users/sakirsaiyed/.claude/plans/just-explain-me-registering-zesty-nova.md`
  (explanation only; deliberately no implementation).
- **`.env` convergence.** `.env.example` is now canonical, but the
  actual `.env` on the demo machine may still have dated IDs. Not
  worth changing live — the running instance works, and the template
  is what new deploys pick up.
- **Backfill of `correlation_id` / `user_id` / `service_id` on
  historical rows.** Deliberately left NULL — those rows predate the
  columns, and a backfill with fake values would be revisionist.

---

## Verification

```bash
# Backend
cd backend && source venv/bin/activate
PYTHONPATH=. pytest      # 207 passed
PYTHONPATH=. alembic current    # 003_correlation_id (head)

# Frontend
cd frontend && npx vite build   # passes clean

# End-to-end smoke
# 1. Start backend: uvicorn app.main:app --reload --port 8000
# 2. Start frontend: npm run dev
# 3. Browse http://localhost:5173 → log in → Settings → all 6 sections render
# 4. Services page → Register → dropdown shows Sonnet + Haiku with pricing
# 5. Click Ping on any service → latency pill shows ms + live/http tag
# 6. After a ping, Settings → Call Trace → activity appears with drill-down
```
