# Maintenance Runbook

> Last updated: 2026-04-18 · current as of commit `3396e21`
>
> Canonical source for operational procedures. For risk definitions, see [RISK_REGISTER.md](RISK_REGISTER.md). For drift algorithm details, see [EVAL_DATASET_CARD.md](EVAL_DATASET_CARD.md).

---

### S1: High Latency

**Trigger:** Average latency > 2000 ms or P95/P99 spike on the Performance page.

**Check:** Test Connection on the affected service | Review `api_usage_log` for `error_timeout` entries | Check the LLM provider status page.

**Fix:** If the LLM provider-wide, wait for recovery (retry logic handles transient failures) | If isolated to one service, verify model name and endpoint config | If >10s, set service to inactive temporarily.

**Prevent:** Monitor dashboard P95/P99 trends; APScheduler health checks run on a recurring interval.

---

### S2: Quality Drop

**Trigger:** drift-check endpoint returns `drift_severity` "warning" or "critical".

**Check:** Per-test-case breakdown on dashboard (identify failing factuality vs format_json tests) | Query drift-check endpoint for severity, trend, variance, confidence | Re-run evaluation to confirm.

**Fix:** Create incident with severity high | Run troubleshooting checklist (data issue, prompt change per [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md), model update, infrastructure, safety/policy) | Review per-test trends to determine if factuality or format scoring degraded.

**Prevent:** Investigate when `trend_direction` is "declining" with "high" confidence, even above threshold. An alert is auto-created in the Alert system when drift is detected; review and acknowledge alerts via `GET /alerts` and `POST /alerts/{id}/acknowledge`.

---

### S3: PII Detected

**Trigger:** Output scanner flags `output_pii_ssn` or `output_pii_credit_card`, or manual review reveals PII.

**Check:** Identify what PII was found and in which response | Check the service's `sensitivity_label` | Review `api_usage_log` for `safety_flags`.

**Fix:** Create incident with severity critical | Reject the LLM summary draft (do NOT approve) | Review prompt content that triggered the PII leak.

**Prevent:** Review prompts for services with confidential sensitivity labels before use.

---

### S4: LLM Down

**Trigger:** Test Connection returns "failure" after exhausting 2 retries.

**Check:** Test connection on multiple services | Check the LLM provider status page | Review `api_usage_log` for `error_timeout`, `error_server`, `error_auth` and retry entries (`retry_0`, `retry_1`).

**Fix:** Use incident workflow without LLM (create incidents, fill checklists, write plans manually) | If outage >2h, create incident documenting impact.

**Prevent:** Application degrades gracefully; no feature crashes when LLM is unavailable.

---

### S5: Unauthorized Access

**Trigger:** Audit log shows a Viewer role attempted an Admin or Maintainer action.

**Check:** Verify RBAC middleware blocked the action (HTTP 403) | Confirm the action was NOT executed.

**Fix:** Check that the route handler has the `require_role()` dependency | Add a regression test case.

**Prevent:** JWT tokens use HS256 with 480-min expiry; RBAC roles enforced at the route level.

---

### S6: Budget Exceeded

**Trigger:** User receives HTTP 402 (`BudgetExceededError`); `budget_pct_used` at 100%.

**Check:** Query api-usage endpoint for daily cost vs $5 limit and monthly vs $25 limit | Review per-function cost breakdown | Check if scheduled evaluations are running too frequently.

**Fix:** Update `API_DAILY_BUDGET` or `API_MONTHLY_BUDGET` in `.env` | Or wait for next period (daily resets at midnight UTC, monthly on the 1st) | Reduce evaluation frequency.

**Prevent:** Use cost-preview endpoint (`/evaluations/cost-preview/{service_id}`) before large batches.

---

### S7: Rate Limited

**Trigger:** User receives HTTP 429 indicating rate limit exceeded.

**Check:** Determine if global (30 calls/min) or per-user (20 calls/min) | Review `api_usage_log` for the past minute.

**Fix:** Advise user to space out operations | Check APScheduler intervals for overlapping jobs | Adjust `API_MAX_CALLS_PER_MINUTE` or `API_MAX_CALLS_PER_USER_PER_MINUTE` in `.env`.

**Prevent:** Rate limit resets automatically after 60 seconds; both successes and errors count.

---

### S8: Injection Detected

**Trigger:** User receives HTTP 422 (`PromptSafetyError`); api-safety endpoint shows `blocked_safety` calls.

**Check:** Review safety_flags and risk_score on blocked calls | Determine true positive vs false positive.

**Fix (true positive):** Identify user via `user_id` in `api_usage_log`; assess if pattern warrants a security incident. **Fix (false positive):** Review the specific regex in `safety.py` `_INJECTION_PATTERNS`; make the pattern more specific without removing it.

**Prevent:** Risk scoring details and thresholds documented in [RISK_REGISTER.md](RISK_REGISTER.md) R8.

---

### S9: Brute-Force

**Trigger:** HTTP 429 with "Too many failed login attempts"; 5+ failures for same email within 15 minutes in `login_attempts`.

**Check:** Query `login_attempts` for affected email: count, IPs, timestamps | Distinguish legitimate user (same IP, slight password variations) from attack (multiple IPs or emails).

**Fix (attack):** Create incident with severity high; document IPs and emails; consider network-level IP blocking. **Fix (legitimate):** Lockout auto-resets after 15 minutes; no admin override available.

**Prevent:** Throttle check runs before password verification to prevent timing attacks.

---

### S10: Audit Log Integrity Failure

**Trigger:** `GET /compliance/audit-log/verify` returns `{"valid": false, "broken_at": <id>, "reason": ...}`, surfaced in the Governance page's "Audit log integrity" card.

**Check:** Note the `broken_at` id and `reason` (`prev_hash mismatch` = a prior row was modified/deleted; `content_hash mismatch` = this row was edited) | Inspect the row via `SELECT * FROM audit_log WHERE id = <broken_at>` | Check for recent direct DB access (file copies, backups restored) | Review server access logs around the timestamp.

**Fix:** Treat as a P0 security incident | Preserve the DB file immediately | Create incident with severity critical documenting `broken_at` and `reason` | Rotate all admin credentials and API keys | Compare `content_hash` and `prev_hash` columns against backups to identify altered rows | Do NOT modify audit_log further until forensics is complete.

**Prevent:** SQLite BEFORE UPDATE/DELETE triggers block app-path mutation; the hash chain detects direct DB-level tamper. Production deploys should use a WORM-enforced audit store (e.g. Postgres with row-level permissions + append-only policy).

---

### S11: SSRF Attempt Detected

**Trigger:** Service create/update returns 400 with detail `Unsafe endpoint URL: ...` | `scheduled_health_check` logs a `blocked: ...` ConnectionLog entry.

**Check:** Review audit log for the user who attempted the registration | Note the URL pattern (metadata service, loopback, RFC1918) | Check whether the user account shows other suspicious activity.

**Fix (true positive):** Create incident with severity critical; treat as attempted data exfiltration | Disable the user account (set `is_active=false` via `/users/{id}/role` after demoting) | Review all services the user previously registered for hidden endpoints | Rotate any credentials accessible at the targeted internal address. **Fix (false positive):** If a legitimate internal service must be reached, document the exception and use a dedicated proxy with allow-list routing rather than weakening the validator.

**Prevent:** `app/services/url_validator.py` enforces the guard at registration, update, probe, and the scheduled tick. Never weaken the validator; add allow-list hostnames if needed.

---

### S12: Confidential LLM Override Granted

**Trigger:** Audit log shows `confidential_llm_override` action | Frequency of overrides rising above expected baseline.

**Check:** Review the `new_value` field for which admin performed the override and on which service | Confirm the service's sensitivity label is correct (a mislabelled `internal` service should not be `confidential`) | Verify the admin had legitimate need.

**Fix (legitimate):** Document the business justification in the Incident or Maintenance plan that required the override | If overrides are becoming routine, reconsider whether the service should be reclassified. **Fix (suspicious):** Create incident with severity high | Review the prompt content + response via `GET /dashboard/api-calls/{id}` | Escalate to data governance.

**Prevent:** Overrides require admin role AND explicit `allow_confidential=true` flag; the frontend shows a confirm dialog. Consider a four-eyes approval flow if override frequency grows.

---

### S13: Budget Race / Concurrent Bypass Attempt

**Trigger:** Daily or monthly cost spikes unexpectedly despite the rate-limit appearing to hold; `api_usage_log` shows >N calls per user in a single minute where N > `api_max_calls_per_user_per_minute`.

**Check:** Query for recent bursts: `SELECT user_id, COUNT(*) FROM api_usage_log WHERE timestamp > datetime('now','-1 hour') GROUP BY user_id, strftime('%Y-%m-%d %H:%M', timestamp) HAVING COUNT(*) > 5` | Verify `_BUDGET_LOCK` is actually held (single-process deployment) | Inspect the reservation rows (`status='reserved'` that never transitioned to success/error) for signs of the lock mechanism misfiring.

**Fix:** If running multi-worker (Gunicorn with >1 worker, uvicorn with --workers >1), the process-local lock is insufficient — migrate to Redis INCR+TTL or Postgres `SELECT FOR UPDATE`. Document this limitation in your deployment runbook | Temporarily lower `api_max_calls_per_minute` while investigating | If the user is an attacker, rotate their credentials and review their past activity.

**Prevent:** Single-process deployments are safe under the `threading.Lock`. Multi-worker requires a shared lock primitive — flagged in `llm_client.py` comments.

---

### S14: Judge Refusal Spike

**Trigger:** `EvalRun.results` shows a growing proportion of `status="judge_refused"` rows, or drift alerts fire less frequently than expected despite visible quality issues.

**Check:** Review the prompt template for `score_factuality` and `detect_hallucination` in [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md) | Check the provider's policy updates (new refusal categories) | Inspect a sample of refused responses via `GET /dashboard/api-calls/{id}` to understand what the AI is refusing.

**Fix:** If the prompts are now mis-categorised by the AI (e.g. a benign test case triggers a safety refusal), rephrase the test case | If the judge prompt itself is being refused (unlikely — it's a rating task), prepend context explaining the evaluation purpose | If the LLM provider has changed behaviour broadly, note the date in `PROMPT_CHANGE_LOG.md` and consider using a different model for the judge.

**Prevent:** `_parse_judge_score()` returns `None` on refusal rather than misreading a number out of a refusal text. The eval harness excludes refused results from the aggregate quality score, so drift is not falsely triggered — but repeated refusals mean the quality signal is weaker.

---

### S15: Export Truncation Warning

**Trigger:** Compliance export JSON includes entries in the `warnings` array, or the PDF renders a red "WARNING" paragraph under the header.

**Check:** Read the warning text — it states which section truncated and the total row count in the date range.

**Fix:** Narrow the date range until `audit_total_in_range` / `incidents_total_in_range` / `maintenance_total_in_range` is at or below `row_limit_per_section` (10000) | Export multiple sub-ranges and archive them together | If the compliance engagement genuinely requires all rows in one export, raise `EXPORT_ROW_LIMIT` in `app/routers/export.py` but be aware of memory / PDF render cost.

**Prevent:** Truncation is always loudly surfaced — never silent. The 500-row silent cap that used to hide this is gone.

---

### S16: Rotate seed user passwords without dropping the DB

**Trigger:** Operator wants to change the password for `admin@aiops.local`, `maintainer@aiops.local`, or `viewer@aiops.local` on a running instance, AND wants to preserve the existing `aiops.db` (incidents, audit log, telemetry, connection logs).

**Check:** Confirm the target user rows exist via `sqlite3 aiops.db "SELECT email FROM users"`. Confirm the desired passwords are set in `backend/.env` as `SEED_ADMIN_PASSWORD` / `SEED_MAINTAINER_PASSWORD` / `SEED_VIEWER_PASSWORD`. Env vars left unset → that role is skipped (password unchanged).

**Fix:** 
```bash
cd backend
python -m scripts.rotate_seed_passwords
```
Script updates only the rows whose env var is set, bcrypt-hashes the new password, and appends one `rotate_password` row to `audit_log` per rotation (with `user_id=None` — system action). Output names the rotated / skipped / missing lists so you know exactly what happened.

**Prevent:** `python -m app.seed` only runs on an EMPTY DB (idempotency guard), so changing `seed.py`'s password policy alone doesn't propagate to a populated demo DB. Use this script whenever you change the SEED_*_PASSWORD env vars on an already-seeded instance, OR reset entirely with `rm aiops.db && python -m app.seed` if you also want to discard the rest of the data. See SELF_CRITIQUE §9 for the broader seeded-data-drift discussion.

---

## Maintenance Schedule

| Frequency | Task |
|-----------|------|
| Configurable (default 60 min) | Automated evaluation harness via APScheduler |
| Recurring via APScheduler | Health check all services (SSRF guard enforced each tick) |
| Daily | Check budget utilization vs limits |
| Weekly | Review audit log, api_usage_log costs, api-safety metrics, and `confidential_llm_override` / `role_denied` events |
| Weekly | Run audit log integrity verify (`/compliance/audit-log/verify`) — expect `valid: true` |
| Monthly | Export compliance evidence (check for truncation warnings) |
| Monthly | Review `judge_refused` rate and update judge prompts if the provider's refusal behaviour has shifted |
