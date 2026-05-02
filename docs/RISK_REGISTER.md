# Risk Register

> Last updated: 2026-04-18 · current as of commit `3396e21`
>
> Canonical source for risks and mitigations. For operational response procedures, see [MAINTENANCE_RUNBOOK.md](MAINTENANCE_RUNBOOK.md).

| ID | Risk | Likelihood | Impact | Status |
|----|------|-----------|--------|--------|
| R1  | PII Leakage | Medium | High | Implemented |
| R2  | Model Drift | High | High | Implemented |
| R3  | Hallucination | High | Medium | Implemented |
| R4  | Evaluation Bias | Medium | Medium | Implemented |
| R5  | Service Outage | Medium | Medium | Implemented |
| R6  | Cost Overrun | Medium | High | Implemented |
| R7  | Brute-Force | Medium | High | Implemented |
| R8  | Prompt Injection | High | High | Implemented |
| R9  | Audit Log Tampering | Low | Critical | Implemented |
| R10 | Confidential Data Leakage via LLM | Medium | Critical | Implemented |
| R11 | Unapproved LLM Output Treated as Official | Medium | High | Implemented |
| R12 | Privileged Data Read by Viewer Role | Medium | High | Implemented |
| R13 | SSRF via Service endpoint_url | Medium | Critical | Implemented |
| R14 | Budget / Rate Limit Bypass via Concurrency | Medium | High | Implemented |
| R15 | Compliance Evidence Silently Incomplete | Medium | Critical | Implemented |
| R16 | LLM Judge Refusal Misread as Score | Medium | Medium | Implemented |
| R17 | Rubber-Stamp Approval of LLM Drafts | Medium | High | Implemented |
| R18 | Unredacted prompt/response text in APIUsageLog | Medium | High | Partial |
| R19 | Default / placeholder SECRET_KEY accepted silently at startup | High | Critical | Deferred |

---

### R1: PII Leakage

Sensitive data sent to or returned from the cloud LLM.

- `scan_input()` in `safety.py` detects email, phone, SSN, and credit card via compiled regex before any prompt reaches the AI
- `scan_output()` in `safety.py` flags PII in responses; blocks those containing SSN or credit card (`safe` returns false)
- All outbound API calls routed through `llm_client.py` -- no route handler touches the the LLM provider SDK
- `sanitize_text()` in `safety.py` strips control characters and HTML-encodes angle brackets

Residual: PII in formats not matching the four regex patterns will pass through undetected.

---

### R2: Model Drift

the LLM provider updates the AI and response quality degrades silently.

- Eval harness produces quality scores (0-100); drift threshold at 75% triggers flag
- Per-test tracking via `EvalResult` model stores score, latency, and response per test case per run
- Drift severity (none/warning/critical) and trend analysis documented in [EVAL_DATASET_CARD.md](EVAL_DATASET_CARD.md)
- APScheduler runs evaluations on a configurable recurring schedule
- Auto-alert creation via the `Alert` model when drift is detected (alert_type, severity, message, service_id); alerts can be acknowledged via `POST /alerts/{id}/acknowledge`

Residual: Small test dataset (2 cases per service) may miss category-specific degradation.

---

### R3: Hallucination

the AI generates plausible but incorrect root causes or summaries.

- LLM output stored in `summary_draft` holding field; requires explicit approval via `approved_by`
- `score_factuality()` in `llm_client.py` rates factual similarity 0-100 during eval runs (see [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md) for prompt template)
- `detect_hallucination()` in `llm_client.py` scores unsupported or fabricated claims 0-100 (0 = no hallucination, 100 = severe); result stored in `EvalRun.hallucination_score` (see [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md) for prompt template)

Residual: Human reviewer may lack domain knowledge to catch subtle inaccuracies.

---

### R4: Evaluation Bias

the AI consistently favors certain root causes or phrases recommendations in biased ways.

- Human review of every LLM suggestion before it enters the incident record
- Per-test-case breakdown in drift-check endpoint shows individual performance and trends
- Eval test cases span multiple categories (factuality, format_json) per [EVAL_DATASET_CARD.md](EVAL_DATASET_CARD.md)

Residual: All test cases are English-only and synthetically generated.

---

### R5: Service Outage

the LLM provider API goes down or rate limits are hit during operations.

- `_make_api_call()` in `llm_client.py` retries with exponential backoff: `2^attempt + random(0, 0.5)` sec, max 2 retries for `RateLimitError`, `APIConnectionError`, `InternalServerError`
- `test_connection()` in `llm_client.py` verifies API availability (max_tokens=50, catches all exceptions)
- Incident workflow (create, triage, checklist) operates fully without the LLM

Residual: Extended the LLM provider outages (>2h) block summary generation and evaluations.

---

### R6: Cost Overrun

Automated evaluations or heavy usage exceeds budget.

- `_check_budget()` in `llm_client.py` enforces daily ($5) and monthly ($25) limits before every call
- Per-call cost estimation using `_estimate_cost()` at Sonnet 4.6 pricing ($3/M input, $15/M output)
- Every call logged to `api_usage_log` with `estimated_cost_usd`; `BudgetExceededError` raised at HTTP 402
- Rate limits: 30 calls/min global, 20 calls/min per-user (enforced inside `_BUDGET_LOCK` with atomic reservation — see R14)

Residual: Token-based estimation is approximate; actual the LLM provider billing may differ.

---

### R7: Brute-Force

Attacker gains access by repeatedly guessing passwords.

- `LoginAttempt` model records every attempt with email, IP, and timestamp
- After 5 failures within 15 minutes for the same email, HTTP 429 blocks further attempts
- Throttle check runs before password verification, preventing timing-based information leakage

Residual: Only email-based throttling; no IP-based rate limiting at the application level.

---

### R8: Prompt Injection

Malicious input manipulates the AI or extracts internal instructions.

- `scan_input()` in `safety.py` checks 15 compiled regex patterns (instruction override, role manipulation, system prompt extraction, known exploits)
- Risk scoring: 40 pts per injection match, 20 per PII type, 15 for length warning (>80% of 10k char max), 100 for length exceeded
- Block threshold: risk >= 80; raises `PromptSafetyError` (HTTP 422); logged as `blocked_safety`
- `scan_output()` detects model refusal patterns in the AI responses

Residual: Regex-based detection cannot catch novel or obfuscated injection techniques.

---

### R9: Audit Log Tampering

An insider or intruder modifies or deletes past audit rows to hide activity.

- Every audit row commits a SHA-256 `content_hash` computed over its content plus the previous row's hash (`middleware/audit.py`) — a modified row breaks the chain and is detectable by replaying it.
- SQLite `BEFORE UPDATE` and `BEFORE DELETE` triggers on `audit_log` reject mutations from the application path (`main.py:_install_audit_log_triggers`).
- `GET /compliance/audit-log/verify` (admin-only) walks the chain and reports `{total, valid, broken_at, reason}`. Surfaced in the Governance UI as "Verify integrity."
- Role-denied attempts on sensitive endpoints are themselves audited (`role_denied` action) so probing is visible to reviewers.

Residual: Production should use Postgres row permissions or a WORM-enforced audit service. The SQLite triggers can be bypassed by a direct DB connection, but the hash chain still detects the resulting tamper on next verify.

---

### R10: Confidential Data Leakage via LLM

A service labelled `confidential` reaches the external LLM without explicit governance sign-off.

- `app/services/sensitivity.py:enforce_sensitivity()` gates every LLM call tied to a service (test-connection, eval run, incident summary).
- `confidential` services are blocked unless the caller passes `allow_confidential=true` AND holds the admin role. Non-admins are rejected even with the flag.
- Every attempt (allowed or denied) writes to the audit log (`confidential_llm_override` / `confidential_llm_blocked`).
- Frontend shows a confirm dialog before admins can override.

Residual: The `public` / `internal` labels do not trigger any additional controls. Misclassification of a confidential service as internal is undetected.

---

### R11: Unapproved LLM Output Treated as Official

LLM-generated content is consumed as authoritative without human review.

- Incident summaries: written to `Incident.summary_draft`. Published as `Incident.summary` only via explicit `POST /incidents/{id}/approve-summary` which records `approved_by`.
- Maintenance plans: `approved` defaults `False`. Flipped by `POST /maintenance/{id}/approve`.
- Dashboard insights + compliance AI reports: persisted as unapproved `AILlmDraft` rows by the shared `draft_service`. Separate approve endpoint flips `approved_by_user_id` and writes `llm_draft_approved` to the audit log.
- Compliance export excludes unapproved incident summaries — drafts never appear in the official record.

Residual: Humans approving without reading the content are still the weak link. Mitigated by presenting the full draft in the UI alongside the Approve button.

---

### R12: Privileged Data Read by Viewer Role

Viewer token can query governance-grade endpoints intended for admins.

- `GET /compliance/audit-log` is `require_role(["admin"])` (as is `/audit-log/verify`, `/users`, `/users/{id}/role`, and the AI compliance report endpoints).
- `require_role` middleware (`middleware/rbac.py`) writes a `role_denied` row to the audit log for every 403 so probing is traceable.
- Frontend conditionally omits the audit-log fetch for non-admins to avoid misleading "failed to load" errors.

Residual: Generic list endpoints (e.g. `/services`, `/incidents`) are authenticated but not role-scoped by design — any logged-in user can read operational state. This is consistent with the spec's Viewer = "read-only" role.

---

### R13: SSRF via Service endpoint_url

A user registers a service with an `endpoint_url` pointing at an internal address (AWS metadata service, loopback, RFC1918, link-local) and exfiltrates data via `Ping` or the scheduled health check's `response_snippet`.

- `app/services/url_validator.py::validate_outbound_url()` rejects non-http(s) schemes and any hostname that resolves to a loopback, RFC1918, link-local (169.254.0.0/16 includes AWS/GCP metadata), carrier-grade NAT, multicast, or reserved range — IPv4 and IPv6.
- Validation runs at service registration (POST /services), on update (PUT /services/{id}), at probe time (POST /services/{id}/test-connection) to close the DNS-rebinding window, and in the APScheduler `scheduled_health_check()` tick.
- DNS resolution checks ALL returned addresses; any blocked address fails the whole URL — defeats records that mix public and private IPs.

Residual: A public hostname that an attacker controls could still be used to exfiltrate information stored in the tenant's service registry (the endpoint_url itself). Lower severity since registration is admin/maintainer-gated.

---

### R14: Budget / Rate Limit Bypass via Concurrency

Concurrent callers race past `_check_budget()` — all observe the count below the limit simultaneously and all proceed, collectively exceeding daily budget and per-minute rate limits.

- `app/services/llm_client.py::_make_api_call()` holds `_BUDGET_LOCK` around the check AND an atomic reservation INSERT into `api_usage_log` with `status="reserved"` and a worst-case cost estimate. Subsequent callers observe the reservation row and back off.
- The actual the LLM provider API call happens OUTSIDE the lock so slow calls don't block other evaluators.
- `_finalize_reservation()` updates the reserved row with real tokens/cost/status (success, error_timeout, error_rate_limit, etc.) when the API call returns.

Residual: Single-process lock only — multi-worker deployments would need Redis INCR+TTL or a DB-native advisory lock. Documented inline in `llm_client.py`.

---

### R15: Compliance Evidence Silently Incomplete

Two failure modes could produce audit-ready exports that looked correct but were missing data — a regulator then audits evidence that misrepresents the compliance window:

1. Malformed date on `/compliance/export` was silently swallowed — a typo in `from_date` returned the entire history.
2. Row cap of 500 per section was invisible — exports from multi-month windows silently dropped older rows.

- `app/routers/export.py::_parse_date_or_400()` raises HTTP 400 on malformed dates; also rejects inverted ranges (`from_date > to_date`). Same guard on `/compliance/audit-log` listing and `/compliance/ai-report`.
- `EXPORT_ROW_LIMIT` raised to 10000 per section.
- Every export returns `audit_total_in_range`, `incidents_total_in_range`, `maintenance_total_in_range`, and a `warnings` array whenever truncation occurred. PDF exports render warnings in red under the header.

Residual: 10000-row cap is still finite. Windows spanning years of high-activity production may hit it; warnings make this explicit and recommend narrowing the range.

---

### R16: LLM Judge Refusal Misread as Score

`score_factuality()` and `detect_hallucination()` used `re.search(r"\d+", text)` which matched any digit anywhere in the response. A the AI refusal like "I cannot rate this. 404 Not Found" parsed as 404 → clamped to 100 → "severe hallucination" alert on a refusal. "I can give you 7 reasons why not" parsed as 7 → factuality 7% → false drift.

- `app/services/llm_client.py::_parse_judge_score()` uses `re.fullmatch` — ONLY a bare integer (optionally whitespace or trailing decimals) counts as a score.
- Both judge functions now return `Optional[float]` — `None` when the judge refuses or returns non-numeric content.
- The eval harness flags such results as `status="judge_refused"` and EXCLUDES them from the aggregate quality score, so a flaky judge cannot spuriously trip drift on an otherwise-healthy service.

Residual: A consistently refusing judge would produce evals where most rows have no score. The aggregate quality stays stable, but the drift detector has less signal. Operators investigating repeated `judge_refused` should check the prompt or the AI's policy updates.

---

### R17: Rubber-Stamp Approval of LLM Drafts

A maintainer with a malicious agenda writes incident symptoms containing a prompt-injection payload. `generate_summary` produces a plausible-looking draft that contains fabricated claims. Admin skims, clicks Approve, and the fabricated content becomes the official incident record.

- `Incident.reviewer_note` column added. Approve endpoint requires a pydantic-validated note of at least 20 non-whitespace chars. Whitespace-only inputs are rejected at the router layer after `.strip()`.
- Double-approval returns HTTP 409 so attribution (`approved_by`, `approved_at`) is never silently overwritten by a racing admin.
- Frontend `IncidentDetailPage.handleApproveSummary` prompts for the note; backend rejects short notes even if the frontend is bypassed.

Residual: A determined admin who writes "looks fine lgtm approved moving on" passes the length check. The note's existence is a deterrent and an audit artifact, not a guarantee of careful review. Four-eyes approval (requires a second admin) would be the next step; tracked as a P2 item.

---

### R18: Unredacted prompt/response text in APIUsageLog

`APIUsageLog.prompt_text` and `APIUsageLog.response_text` store up to 2000 chars of the exact the AI input/output on every call. A user prompt containing PII is persisted verbatim even when `scan_input` flagged `pii_detected`. The same text surfaces in the Settings → Call Trace UI and in DB backups.

- Row is populated by `_finalize_reservation()` in `llm_client.py` on every call (success or error).
- Truncation at `[:2000]` is silent — no column indicates truncation.
- `safety_flags` column records *that* PII was detected but not *where* in the text.
- Mitigated partially by `scan_input`'s pre-call PII detection, which surfaces the flag but does not redact the persisted text.

Residual: Redaction before DB write is a P1 item (Batch B). For demo scope, the local SQLite DB is single-tenant and not shared; in production compliance this is a GDPR blocker and must be redacted at log time using the same regex patterns as `safety.py`. Same patterns could truncate / mask the text before the `_finalize_reservation` write, preserving the flag + risk score without keeping the raw PII.

---

### R19: Default / placeholder SECRET_KEY accepted silently at startup

`backend/app/config.py` defaults `secret_key` to the string `"change-me-in-production"`. `backend/.env.example` ships a placeholder (`change-this-to-a-random-string-at-least-32-chars`) that new developers copy verbatim to `backend/.env`. FastAPI's lifespan does not validate either value — so a forgotten `.env` rotation ships the app with a JWT signing key anyone who read the public repo can forge tokens against. An attacker crafts a JWT with `sub=<admin_id>, role="admin"`, signs it with the known key, and authenticates as admin against every endpoint that trusts `require_role`.

- `create_access_token()` in `middleware/auth.py` uses `settings.secret_key` without inspection.
- No startup assertion refuses empty / known-default / under-32-char values.
- Default credentials in `seed.py` compound the issue on a fresh install — but even rotating those doesn't help if the signing key is still `"change-me-in-production"`.

**Status: Deferred to a later phase.** The planned mitigation was implemented briefly (commit `05c134e` added `_validate_secret_key()` in `main.py` which refused boot on the two known placeholders + any value shorter than 32 chars, with 5 unit tests in `test_startup_secret_key.py` and a test-suite-only `os.environ.setdefault` in `conftest.py` so tests didn't depend on local `.env`). It was reverted in commit `31529c0` to keep the demo boot sequence simple — the validator was strict-by-design and would refuse to start until every developer machine rotated `.env`, which was judged too disruptive for the capstone window.

Residual: **Unmitigated in the shipped build.** The public repo + `.env.example` together hand a working signing key to any reader. For the next phase, restore the validator approach (cherry-pick `05c134e` or re-implement). Additional hardening ideas worth considering at that time:

1. Replace the repo-wide default in `config.py` with a Pydantic field that raises at import if missing (i.e. remove the fallback string entirely — `secret_key: str = Field(...)` — so the app can't start without a real value).
2. Add a `scripts/generate_secret.py` one-liner so onboarding is `python scripts/generate_secret.py >> backend/.env`.
3. In non-debug mode, require a second check: `len(secret_key) >= 43` (the output length of `secrets.token_urlsafe(32)`).
4. Document the rotation step as a required pre-flight in `ONBOARDING.md` and `LIVE_DEMO_WALKTHROUGH.md` so no one finds it mid-demo.

The viva risk is real: a hostile examiner could demonstrate token forgery live if they've inspected the repo. Mitigation before any public / graded deployment should be considered P0.
