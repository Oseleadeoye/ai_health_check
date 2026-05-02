# AI Health Check Testing Strategy

> Last updated: 2026-04-19 · current as of commit `c990d5a`

188 tests across 22 files. Framework: pytest. All tests run offline with no real API keys.
Coverage floor: 65% (currently ~71%).

## Test Infrastructure

| Tool | Purpose |
|------|---------|
| In-memory SQLite | Fresh database per test session for full isolation |
| FastAPI TestClient | Synchronous HTTP client wrapping the ASGI app |
| Auth fixtures (`conftest.py`) | Pre-built JWT tokens for admin, maintainer, and viewer roles |
| Mocked LLM | All the LLM provider API calls patched; no API key consumption |
| Audit-log triggers | SQLite append-only triggers installed in `setup_db` fixture and dropped in teardown |
| DNS stub | `socket.getaddrinfo` stubbed to a public IP for test hostnames; SSRF tests override with literal IPs |
| FK enforcement | `PRAGMA foreign_keys=ON` set on every SQLite connection via engine event |
| pytest-cov | Coverage report with 65% floor; configured in `pyproject.toml` |

## Test Files

| File | Count | Covers |
|------|-------|--------|
| `test_compliance.py` | 28 | Audit log CRUD, hash-chain integrity, tampering detection, append-only triggers, user management, role updates, RBAC on audit endpoints, JSON + PDF export, strict date parsing (400 on malformed / inverted range), truncation warnings |
| `test_services.py` | 20 | Service CRUD, RBAC (viewer blocked from POST/PUT/DELETE), input validation, connection log persistence, confidential sensitivity enforcement + admin override, SSRF rejection at registration / update / probe (metadata URL, `file://`, private IP rebinding) |
| `test_evaluations.py` | 17 | Test case CRUD, eval run lifecycle, drift severity (none / warning / critical), mocked LLM scoring, budget enforcement (402/429), drift-triggered `Alert` creation and audit, env filter scoping on `/runs`, cascading delete preserving parent `EvalRun`, drift-check per-test-case breakdown query shape |
| `test_model_catalog.py` | 14 | Model inventory endpoints, model catalog routing, selection of actor vs judge models |
| `test_dashboard.py` | 11 | Aggregated metrics, P50/P95/P99 percentiles, latency / quality / error trends, drift alerts, empty-state defaults, env filter scoping on chart endpoints, Error Rate semantic (drift-based, not connection failures) |
| `test_incidents.py` | 10 | Incident summary approval: missing `reviewer_note` (422), short note (422), whitespace-only (400), valid note + attribution persistence, double-approval (409), no-draft (400); maintenance plan cascades |
| `test_url_validator.py` | 10 | SSRF — metadata service, IPv4 loopback, RFC1918, IPv6 loopback, non-http scheme, mixed public / private DNS resolution, unresolvable hostname, public IP allowed, empty URL rejected |
| `test_enforce_call_limits.py` | 9 | Hard caps (prompt chars, max_tokens, per-call cost), single-gatekeeper enforcement, per-model pricing (Haiku vs Sonnet) flowing through the cost cap correctly |
| `test_judge_routing.py` | 9 | Model routing: Haiku for judge vs Sonnet for synthesis, single-call merged judge (`judge_response` makes one call not two), `_parse_judge_json` edge cases (code fences, partial refusal, clamping) |
| `test_user_attribution.py` | 9 | `user_id` propagation through the LLM call stack into `APIUsageLog`, including under error and retry paths |
| `test_trace_endpoints.py` | 8 | Settings → Call Trace read endpoints (recent calls, per-correlation-id grouping, per-user filtering) |
| `test_drafts.py` | 7 | HITL draft / approve flow for dashboard insights and compliance AI report (create unapproved, approve flips fields + audits, viewer cannot approve, admin-only for compliance, double-approve 409, recent filtering) |
| `test_correlation_id.py` | 5 | Per-request correlation ID middleware — threading through `_make_api_call` into `APIUsageLog.correlation_id`, echoed in `X-Correlation-Id` response header |
| `test_draft_service.py` | 5 | Unit tests for the shared draft service abstraction (surface, generator / approver distinction, audit-on-approve) |
| `test_pricing_multi_model.py` | 5 | Sonnet vs Haiku rate math, unknown-model fallback with once-only warning, cost estimation rounding |
| `test_probe_liveness.py` | 5 | Service probe 4xx/5xx semantics (4xx = reachable; 5xx = down), timeout handling, non-HTTP error paths |
| `test_auth.py` | 4 | Login success / failure / lockout mirrored from `LoginAttempt` to `AuditLog` |
| `test_dual_model_settings.py` | 4 | Model config surface (`llm_model`, `judge_model` defaults and overrides via `.env`) |
| `test_integrity.py` | 3 | SQLite FK enforcement (dangling FK rejected), 10 concurrent `log_action` calls produce a walkable chain with distinct `prev_hash`es, chain timestamps monotonic under the lock |
| `test_integration.py` | 2 | Full service lifecycle (register, read, update, audit, delete) + RBAC enforcement across all CRUD operations |
| `test_retry_latency.py` | 2 | Retry backoff wall-clock accounting — retries accumulate into the reported latency, not per-attempt |
| `test_budget_race.py` | 1 | 20 concurrent `_make_api_call` invocations against a rate limit of 5 — at most 5 succeed; the lock + atomic reservation pattern prevents race-condition bypass |
| **Total** | **188** | |

## Running Tests

```bash
cd backend
pytest -v
# or with coverage report
pytest --cov=app --cov-report=term-missing
```

Expected output: `188 passed` with coverage ≥ 65%.

## What's exercised end-to-end

- **Security gates**: every RBAC-protected endpoint is hit with at least one unauthorized role to confirm 403.
- **Audit chain**: happy path (3 rows, chain intact) + active tamper (drop trigger, UPDATE, restore trigger, verify reports broken_at) + concurrent writes (10 threads, 10 distinct prev_hashes).
- **HITL**: incident summary draft → approve with mandatory reviewer_note → export contains it; unapproved draft does NOT appear in export; double approval returns 409.
- **Sensitivity**: confidential service blocked for non-admin, blocked for admin without override, allowed with override (and audited).
- **SSRF**: metadata service URL, file://, private IP rebinding all rejected at both registration and probe time.
- **Budget / rate limit**: mocked to trigger 402 and 429 response paths; 20 concurrent callers with rate_limit=5 yield at most 5 successes.
- **Drift → Alert → Audit**: low score triggers drift flag, Alert row created, creation written to AuditLog.
- **Judge parsing**: refusals like "I cannot rate this" return None rather than being misread as 0 or 100.
- **FK integrity**: dangling service_id rejected by SQLite (with `foreign_keys=ON`).

For architecture and endpoint details, see [ARCHITECTURE](ARCHITECTURE.md).
