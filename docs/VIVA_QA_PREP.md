# 2-Minute Q&A — Strict Professor Mode

10 questions a rigorous examiner will actually ask during a 2-minute
individual viva. The weak answer is the default student response that
loses half the marks. The ideal answer shows depth the examiner rewards.
Budget 90-120 seconds per answer; don't exceed.

This doc complements:
- [LIVE_DEMO_WALKTHROUGH.md](LIVE_DEMO_WALKTHROUGH.md) — performance-mode demo script
- [SELF_CRITIQUE.md](SELF_CRITIQUE.md) — the 5 methodological gaps underneath these answers
- [GOVERNANCE_AUDIT.md](GOVERNANCE_AUDIT.md) — enterprise compliance framing for regulated-industry questions

Read the morning of the viva. If the examiner asks any variant of a
question below, use the ideal-answer phrasing — owning the gap is
always stronger than defending a claim that won't hold up.

---

## Q1 — "Why does every LLM call go through one `_make_api_call` function instead of each router talking to the LLM provider directly?"

**🏆 Ideal answer.** Four reasons, in order of importance. One: it's the single choke point where we enforce the six-stage pipeline — input safety scan, budget check + reservation under a lock, retry with exponential backoff, output scan, usage log, and on service-tied calls the sensitivity gate. If any of those lived in each router, they'd drift out of sync. Two: it's the only place that knows how to talk to the LLM provider, so swapping providers is a 50-line change in one file, not a search-and-replace across seven routers. Three: it's the only place `prompt_text` and `response_text` are persisted, so call tracing is automatic for every consumer without discipline. Four: testing — every public function mocks at `_make_api_call`, not at seven router boundaries. This is a cohesion-over-coupling decision. Documented in [ARCHITECTURE.md §4](ARCHITECTURE.md).

**❌ Weak answer.** "To avoid code duplication." True but shallow — doesn't show awareness of the safety/budget/tracing convergence.

**💡 Improvement.** Always name the six stages out loud. That phrase — *"one pipeline, six stages"* — is what the grader writes down.

---

## Q2 — "Walk me through exactly what happens between clicking 'Run evaluation' and seeing a drift alert. Where are the transaction boundaries?"

**🏆 Ideal answer.** POST `/evaluations/run/{service_id}` hits `evaluations.py::run_evaluation`. First, `enforce_sensitivity()` runs — if the service is confidential and no admin override, we 403 before spending a cent. Then we load test cases. Then we loop: each test case calls `run_eval_prompt`, which itself holds `_BUDGET_LOCK` around check + reservation INSERT (one transaction), releases the lock, calls the AI, then finalises the reservation with real tokens (second transaction). Factuality cases also go through `score_factuality` and `detect_hallucination` — two more `_make_api_call` cycles each. After the loop, we compute the aggregate, write one `EvalRun` row plus N `EvalResult` rows plus telemetry rows in a single commit. Drift flag is computed from threshold + split-half trend. If flagged, we INSERT an `Alert` row and write an `alert_created` audit entry — two separate commits so the Alert is visible even if the audit write somehow fails. The NotificationsBell polls `/alerts?active_only=false` every 30 seconds and renders the bell + drawer; the Dashboard page polls its metric/chart endpoints on the same 30-second cadence. **Honest note**: the loop is serial, not parallel — six test cases take 10-15 seconds because we didn't want concurrent LLM calls to complicate budget accounting.

**❌ Weak answer.** "It runs the evals and checks if drift is there." Zero depth on transactions, zero awareness of the async boundaries.

**💡 Improvement.** The grader is testing whether you understand that this is a multi-transaction workflow with several commit points. Name at least three: reservation INSERT, EvalRun+EvalResults batch, Alert+audit.

---

## Q3 — "Why 75% as the drift threshold? Justify that number statistically, or admit it's a heuristic."

**🏆 Ideal answer.** It's a heuristic, not a statistically-derived threshold. Three honest points. One: we never ran a baseline study to measure false-positive / false-negative rates at different thresholds. Two: at our sample size — 2 test cases per service, maybe 10 runs in seed — the variance of quality score per run is so high that *any* threshold is noise-dominated. Three: the value came from the course brief, not from data. In a production deployment we'd do this instead: run the eval suite weekly for 8 weeks on a known-stable service to establish the noise floor, pick a threshold at 2σ below the mean, then validate against a deliberately-regressed service as a positive control. Our `_compute_trend()` with split-half means is likewise a heuristic; a proper implementation would use EWMA or CUSUM and would need power analysis to pick N. All of this is documented in [SELF_CRITIQUE.md §2](SELF_CRITIQUE.md#2-drift-detection-is-statistical-theatre-at-demo-scale).

**❌ Weak answer.** "75% gives us a good balance between sensitivity and false alarms." Pure hand-wave — the examiner will ask "what's the false-alarm rate?" and you have nothing.

**💡 Improvement.** Owning the heuristic + naming what production would look like converts a weakness into a demonstrated understanding. Examiners reward honesty + roadmap.

---

## Q4 — "Your hash chain uses SHA-256 over row content plus the previous hash. What attack does it defend against, and specifically what attack does it NOT defend against?"

**🏆 Ideal answer.** It defends against an in-app adversary — any UPDATE or DELETE through the application layer. The SQLite triggers reject mutation directly, and the chain gives a way to detect mutation that bypassed the triggers. It does NOT defend against a privileged host adversary. Three concrete attacks it can't catch: one, filesystem replacement — `cp old_backup.db aiops.db` replaces the entire chain including the genesis block, and `/verify` returns valid because there's no external anchor. Two, drop-rewrite-restore — an attacker with DB access drops the triggers, rewrites every row with a new consistent chain, restores triggers. Three, the verifier runs inside the same app, so a compromised app means a compromised verify. The production fix is a daily Merkle-root publication to an external log — Sigstore, a GitHub commit, a second cloud DB — so an auditor has something to compare against. Documented in [GOVERNANCE_AUDIT.md §5](GOVERNANCE_AUDIT.md#5-audit-log-integrity) and [SELF_CRITIQUE.md §4](SELF_CRITIQUE.md#4-tamper-evident-audit-log-is-only-tamper-evident-against-the-wrong-attacker).

**❌ Weak answer.** "It makes the audit log tamper-proof." That's the marketing claim. The examiner will immediately ask "against whom?" and you're stuck.

**💡 Improvement.** Always name the attacker model. Security answers without an attacker model are marketing. *"In-app adversary yes, privileged host no."*

---

## Q5 — "SQLite vs Postgres — defend that choice specifically for the compliance features you built."

**🏆 Ideal answer.** SQLite was the right call for an academic prototype; it would be wrong for production. Right because: zero-config, single-file backup, ships with Python, the course grader reproduces the environment in one command. Wrong because the compliance features I built have specific Postgres dependencies that I had to fake. Three examples. One: the audit-log append-only enforcement is SQL triggers rejecting UPDATE/DELETE — on Postgres I'd use a role with REVOKE UPDATE, DELETE on the audit_log role, which is stronger because an app-path privilege escalation still can't mutate. Two: the `threading.Lock` around `log_action` and `_make_api_call` only works single-process; SQLite already serialises writes at the file level, but on Postgres I'd use `SELECT FOR UPDATE` or an advisory lock, which scales to multi-worker deployments. Three: no transparent data encryption on SQLite — `aiops.db` is plaintext on disk. Postgres TDE would close that HIPAA §164.312(a)(2)(iv) gap. The migration path is clear because SQLAlchemy abstracts the dialect; the work is operational (backups, replication, TDE), not code.

**❌ Weak answer.** "SQLite is simpler to set up." True but misses the whole point — the examiner wants you to understand the production delta.

**💡 Improvement.** Every defensible tool choice has a sentence starting with *"In production we'd switch to X because Y."* That sentence shows engineering judgment.

---

## Q6 — "Your LLM-as-judge scores the AI using the AI. Why should I trust a drift signal produced by the model it's meant to evaluate?"

**🏆 Ideal answer.** You shouldn't — not as a sole signal. It's circular: any systematic bias in the AI propagates into the judge and we can't see it. The honest defence has three layers. One: we mitigate the most obvious failure — judges refusing to answer and being misread as a score — with strict `re.fullmatch` parsing; refusals return None and are excluded from the aggregate. Two: we pair it with a deterministic check where possible — the `format_json` category uses `json.loads`, which has no LLM involvement. Three: we treat the LLM-judge signal as a proxy for "something changed," not ground truth. A drift flag is an invitation to investigate, not a certification. The production fix is a second-model judge (Haiku or a different vendor) for cross-validation on 10% of runs, plus a human-labelled calibration set of ~200 examples to measure inter-rater agreement. Our eval dataset of six cases is nowhere near that. Documented as [SELF_CRITIQUE.md §1](SELF_CRITIQUE.md#1-llm-as-judge-is-circular--claude-grading-claude) and [GOVERNANCE_AUDIT.md §3](GOVERNANCE_AUDIT.md#3-model-hallucination-risks).

**❌ Weak answer.** "LLM-as-judge is a standard pattern — Patronus AI does the same thing." Appeal to authority with no awareness of the limitation. The examiner will eat you alive.

**💡 Improvement.** The magic words are *"circular"* and *"calibration set."* Use them proactively.

---

## Q7 — "The budget check and reservation INSERT are under a `threading.Lock`. In a multi-worker uvicorn deployment your lock is process-local. What protects concurrent callers across workers?"

**🏆 Ideal answer.** Nothing, currently. This is an explicit single-process design choice, documented inline in `llm_client.py` and in [GOVERNANCE_AUDIT.md §1](GOVERNANCE_AUDIT.md#1-data-privacy-risks). If you ran uvicorn with `--workers 4`, four separate `_BUDGET_LOCK` instances would exist, and four concurrent callers could again race past the rate limit. The right production fix is Redis — either an `INCR` with a one-minute TTL for rate-limit counters, or a Redis-backed lock with a lease for the reservation. SQLite alone is insufficient because the reservation INSERT needs to be atomic with the count query, and SQLite's table-level locking doesn't compose with SQLAlchemy session boundaries the way `SELECT FOR UPDATE` on Postgres would. I'd ship the Redis version in about four hours of work — the abstraction boundary is already there, `_BUDGET_LOCK` is named specifically so swapping its implementation is one import change. For the course scope, single-process with the threading.Lock is a demonstrable improvement over the pre-hardening state, where no lock existed at all and 20 concurrent calls all bypassed the limit.

**❌ Weak answer.** "The threading lock handles concurrency." Factually wrong — it handles in-process concurrency only.

**💡 Improvement.** Never claim a threading.Lock solves distributed concurrency. Ever. Examiners grade this specifically.

---

## Q8 — "If the LLM provider disappears tomorrow, what changes in your system?"

**🏆 Ideal answer.** The blast radius is contained to `llm_client.py` because of the single-pipeline design — no router imports `anthropic` directly. To swap providers I'd change four things in one file. One: `_get_client()` instantiates `openai.OpenAI` or the Ollama client instead. Two: the seven public functions change their `messages.create` call signature to match the new provider — OpenAI uses `client.chat.completions.create` with a slightly different response shape. Three: the `_PRICING` dict updates to the new provider's per-token cost. Four: retryable errors change (OpenAI raises `openai.RateLimitError` etc). What doesn't change: the 6-stage pipeline, the safety scanner, the budget check, the `AILlmDraft` tables, every router, the frontend. What I'd miss: the provider's specific prompt caching pricing, and the conversational style difference means prompt templates in [PROMPT_CHANGE_LOG.md](PROMPT_CHANGE_LOG.md) would need re-tuning. A calibration pass on the eval set would catch drift from the provider switch. Two or three days of work end-to-end, dominated by the re-eval not the code change. That containment is the reason we centralised the pipeline in the first place.

**❌ Weak answer.** "We'd have to rewrite a lot of code." Wrong — the whole point of the centralised design is that we wouldn't.

**💡 Improvement.** Quantify the blast radius. *"One file, about 50 lines, plus a re-calibration pass."* Specific numbers impress.

---

## Q9 — "Your safety scanner is 15 regex patterns. I can paraphrase around those in 30 seconds. Why isn't that a blocker?"

**🏆 Ideal answer.** It would be a blocker for production — it isn't for this scope because we treat it explicitly as a first-pass tripwire, not a defence. Three things. One: it catches the obvious unskilled attempts, which is most of what happens. Two: the second layer is budget and rate limits, which contain the damage from anything that slips through. Three: for the highest-stakes path — LLM-generated incident summaries that become official record — we don't rely on the scanner alone; we require a human approver to read the draft and write a reviewer note. The regex is a floor, not a ceiling. The honest gap is that paraphrased injections pass the regex and reach the LLM, and if the LLM complies with them, the approver has to catch it — which they may not if they're rubber-stamping. Production defence-in-depth: add an LLM-based injection classifier as stage-two input check (the provider's own small model, ~1¢/call), delimiter-escape user content in prompts with XML tags, request structured JSON output so the `text.split()` parsing isn't injectable. All documented in [SELF_CRITIQUE.md §3](SELF_CRITIQUE.md#3-the-safety-scanner-is-a-bypass-tutorial) and [GOVERNANCE_AUDIT.md §4](GOVERNANCE_AUDIT.md#4-prompt-injection-vulnerabilities).

**❌ Weak answer.** "The regex catches injection patterns." Stops at the claim; doesn't acknowledge the bypass.

**💡 Improvement.** Proactively concede the bypass, then name the three production upgrades. Conceding first is what separates a B from an A answer.

---

## Q10 — "You enforce HITL with a 20-character reviewer note. What stops me from typing 20 meaningless characters and approving anything?"

**🏆 Ideal answer.** Nothing structural. It's a forcing function for deliberation, not an enforcement mechanism. Real HITL requires three things we don't have. One: four-eyes — the drafter and approver must be distinct identities. Our current `approved_by_user_id` can equal `generated_by_user_id` because the code checks role, not identity separation. A one-line fix. Two: semantic validation — the note should reference content in the draft. A small-LLM check could score the note's relevance; below threshold, reject with "note doesn't appear to reference the summary." Three: telemetry — track per-approver time-to-approve distribution, flag approvers whose median is under 10 seconds. None of that is built. What we do have is an audit artifact that the approver actively wrote something, plus a deterrent against the most casual rubber-stamping. A determined admin still bypasses it, which is why [SELF_CRITIQUE.md §5](SELF_CRITIQUE.md#5-hitl-reviewer_note-is-a-paper-trail-not-oversight) calls this a level-1 HITL control, not enforcement. The production path is labelled: level-2 is four-eyes, level-3 is content validation, level-4 is time-on-screen telemetry.

**❌ Weak answer.** "The reviewer has to type a note so they have to think about it." Trivially false — typing and thinking aren't the same thing, and the examiner knows it.

**💡 Improvement.** The phrase *"forcing function for deliberation, not enforcement"* is the single best sentence in this entire Q&A set. Memorise it.

---

## 🎯 Cross-cutting advice

1. **Lead with the honest concession, then the roadmap.** *"It's a heuristic. A production implementation would do X."* This pattern wins every single one of these questions.

2. **Quantify.** *"About 50 lines in one file"*, *"two or three days of work"*, *"our eval set has 6 test cases; a real validation needs 200."* Numbers signal engineering judgment.

3. **Name the attacker model for every security claim.** *"In-app yes, privileged host no."* This alone is the difference between B and A on security questions.

4. **Never claim a feature is more than it is.** "Tamper-evident" becomes "in-app tamper detection." "Safety scanner" becomes "regex tripwire for obvious injections." Examiners reward precision.

5. **Always name the file.** *"Documented in GOVERNANCE_AUDIT §4"* or *"PROMPT_CHANGE_LOG tracks this"*. Shows you know your own docs and gives the examiner somewhere to verify.

6. **2 minutes is the constraint.** Practise each answer at 90 seconds. Rushed ≠ impressive. Calm, precise, concede early is what wins.
