# 🎬 Live Demo Walkthrough & Day-Of Checklist — AI Health Check

> Last updated: 2026-04-19 · current as of commit `4a831a8`
>
> Complete demo-day guide: night-before prep → morning-of boot →
> T-15 min checks → 9-step narration → killshot moments → recovery
> procedures → post-demo viva phrasing → one-page printable checklist.
> Assume the examiner is watching every click. Every section is
> tested against the actual code.

---

## Contents

1. [Night before](#1-night-before)
2. [Morning of](#2-morning-of-at-home-60-min-before)
3. [T-15 min pre-flight checklist](#3-t-15-min-pre-flight-at-the-venue)
4. [Demo narration: 9-step walkthrough](#4-demo-narration--9-step-walkthrough)
5. [Narrative script — stories to tell at each step](#5-narrative-script--stories-to-tell-at-each-step)
6. [Three killshot moments](#6-three-killshot-moments-worth-1-2-letter-grades)
7. [Recovery procedures](#7-recovery-procedures--if-it-breaks)
8. [Post-demo Q&A phrasing](#8-post-demo-qa-phrasing)
9. [Q&A bait to prepare for](#9-qa-bait-to-prepare-for)
10. [Realistic timing](#10-realistic-timing)
11. [One-page printable checklist](#11-one-page-printable-checklist)

---

## 1. Night before

### Code + data

> **Why rebuild the DB before the demo?** The running instance has
> hundreds of real api_usage_log rows, a stretched audit hash-chain,
> incidents + maintenance plans you created while exploring, and a 4th
> "Demo service" that isn't in the seed. None of that is broken — but a
> grader clicking around might wander into half-finished test data, see
> a cost total that reflects your debugging rather than the demo flow,
> or notice audit entries from three days of exploration. A fresh seed
> gets you to the **exact narrated starting state** used below: 3
> services, 1 pre-flagged drift alert, clean audit chain, no stray
> incidents, every action from now onward is attributable to the demo
> itself.
>
> **What survives a reset:** nothing database-side. Your code, docs,
> `backend/.env` (including your real `ANTHROPIC_API_KEY`), and git
> history are untouched — only `aiops.db` is removed.
>
> **What gets lost:** all connection logs, api_usage_log rows,
> incidents, maintenance plans, alerts beyond the seeded one, and the
> audit hash chain (it restarts at GENESIS_HASH). Any custom services
> you registered manually are gone.
>
> **Seed is idempotent-guarded**: running `python -m app.seed` against
> a populated DB prints "already has data — skipping" and does
> nothing. To actually reset you MUST `rm aiops.db` first.

```bash
# Pull latest
git checkout main && git pull

# Set demo-mode env flags in backend/.env
echo "SCHEDULER_ENABLED=false" >> backend/.env
echo "LOG_SQL=false" >> backend/.env

# Rebuild the DB with fresh seed (includes the pre-seeded drift scenario)
cd backend
lsof -ti:8000 -sTCP:LISTEN | xargs kill 2>/dev/null
rm -f aiops.db
source venv/bin/activate
python -m app.seed
```

Expected seed output:

```
[Seed] Created 3 default users (admin, maintainer, viewer)
[Seed] Created 3 sample AI services
[Seed] Created 6 eval test cases
[Seed] Created 15 historical eval runs (with 1 pre-flagged drift scenario)
[Seed] Created 1 drift alert for 'Internal Report Generator' (demo-ready)
```

### Smoke test the full stack

```bash
# Terminal 1 — backend
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000

# Terminal 2 — frontend
cd frontend && npm run dev
```

Browser: http://localhost:5173 → login as `admin@aiops.local` (password is whatever you set in `SEED_ADMIN_PASSWORD` in `backend/.env`, or the demo fallback if unset) → Dashboard should show:

- 3 active services
- **Red "Active Alerts" banner** ("Internal Report Generator quality dropped to 42.0%")
- Recent evaluations table with mixed-quality rows
- Charts populated with 7 days of data

If any of the above is missing, re-run the seed.

### Copy-paste snippets (have in a local text file)

- **Reviewer note** (for incident approve):
  > Read full draft — root causes match the checklist findings. Stakeholder update is factual with no fabricated claims.
- **Symptoms** (for incident create):
  > Quality score dropped to 42% on the 14:32 UTC scheduled eval. Factuality failing on 3/6 test cases; no infra changes since yesterday.
- **Rollback plan**:
  > Revert eval prompt to v1.3 (commit a7c8f2). Re-deploy via standard deploy pipeline.
- **Validation steps**:
  > Run full eval suite, confirm quality ≥ 85%, monitor P95 latency for 30 minutes post-deploy.

### Printable references

- This doc — §4 walkthrough, §5 narrative script, §6 killshots, §10 timing (one page)
- [VIVA_QA_PREP](VIVA_QA_PREP.md) — print only the 🏆 ideal-answer paragraphs (10 paragraphs, one page)
- [SELF_CRITIQUE](SELF_CRITIQUE.md) — skim the "honest answer" lines only

### Hardware

- Laptop charged to 100 %, charger in bag
- HDMI / USB-C / Thunderbolt adapter for the venue projector
- Backup: screen-record the full 9-step demo tonight as a fallback (phone on tripod, or `brew install --cask obs` if you don't have OBS)

---

## 2. Morning of (at home, 60 min before)

```bash
# Quick full boot + verify
cd ai-health-check
git status              # should be clean
git log --oneline -1    # should be 4a831a8 or newer

# Backend
cd backend && source venv/bin/activate && uvicorn app.main:app --port 8000
# Expect: "[Startup] Background scheduler DISABLED (SCHEDULER_ENABLED=false)"

# Frontend (new terminal)
cd frontend && npm run dev
```

Open browser, log in, click through each page quickly (Dashboard → Services → Evaluations → Incidents → Governance → Settings → Data Policy). Watch the terminal for any errors. If any page 500s, something drifted overnight — rebuild the DB.

### Browser / desktop prep

- **Zoom level**: 125 % or 150 % so projector viewers can read
- **Full-screen the browser** (not presentation mode — just maximized so the URL bar stays visible)
- **Close all other tabs**
- **Mute notifications**: macOS Focus → Do Not Disturb
- **Close Slack, Messages, email, calendar popups**
- **Projector test**: mirror vs extend; practice both so you know which one the venue is set for

### Terminal layout

Keep ONE terminal visible with backend logs. The examiner may glance at it; you want clean output, not SQL noise. That's what `LOG_SQL=false` is for.

### Warm the LLM

Before the grader arrives, hit Dashboard once and click "Generate insight" (or any action that triggers a the AI call). Establishes the DNS + TLS connection so the demo call isn't cold.

---

## 3. T-15 min pre-flight (at the venue)

```bash
# Kill anything stale, full restart
cd backend && lsof -ti:8000 -sTCP:LISTEN | xargs kill 2>/dev/null
source venv/bin/activate && uvicorn app.main:app --port 8000

# Frontend in new terminal
cd frontend && npm run dev
```

Log in as admin in the browser. **Leave the tab on the Dashboard**. First thing the examiner sees: a real-looking platform with a real-looking alert.

### Last sanity checks

- [ ] Dashboard shows the red Active Alerts banner
- [ ] Clicking into any service page loads without error
- [ ] ⌘K command palette opens (shows your keyboard-shortcut polish)
- [ ] Theme toggle works (dark ↔ light, both look clean)

---

## 4. Demo narration — 9-step walkthrough

Target ~6.5 min, max 12 min. Terminal visible at all times. If you need to show audit-log details, have a second browser tab open to http://localhost:8000/docs (FastAPI OpenAPI page) — it's a credibility boost.

### Step 1 — Register a service

**What they see:** Services page → "Register" button → fill name / owner / environment / model / sensitivity / endpoint → submit. New card appears with the sensitivity badge. Click **Ping** → green healthy dot with latency in ms.

**Where it bites you live:**
- **SSRF validator will reject anything local.** `http://localhost:8000/health` or `http://127.0.0.1` returns HTTP 400 *"Hostname resolves to blocked range"*. Looks like your app is broken. It's not — it's the protection working against you.
- **Confidential sensitivity triggers a modal on Ping.** If you pick "confidential" in the demo service, you'll get an unexpected override dialog the second you click Ping.
- **`example.com` subdomains don't resolve** on some networks. `staging.example.com` will 400. Use a real public URL like `https://httpbin.org/status/200`.

**Demo-day mitigations:**
- Use `https://httpbin.org/status/200` as the endpoint — returns a clean 200 with predictable latency.
- Set sensitivity = **internal** for the demo service. Save confidential for a separate "watch this security feature" moment (Killshot #1 below).
- If asked "what about localhost?" → say it out loud: *"That's deliberately blocked. Let me show you."* Attempt to register `http://169.254.169.254/meta-data/` → grader sees the 400 → **that's a killshot moment for the SSRF guard.**

### Step 2 — Monitoring detects a quality drop

**What they see:** Dashboard loads. Four metric cards with trend arrows. Response-time distribution (Typical/Slow/Worst). Line chart for latency, bar chart for quality per run, area chart for error rate. Recent evaluations table.

**Where it bites you live:**
- **Fresh DB has zero eval runs** → cards show 0 %, charts are empty. The dashboard looks unimpressive. *(Already fixed: seed now pre-populates 15 runs + a drift scenario.)*
- **Scheduler fires mid-demo**. Disabled via `SCHEDULER_ENABLED=false`.
- **The "Generate insight" endpoint creates a draft** (not a direct response). If you click it and nothing appears to change, check the dashboard — it's in the draft table waiting for approval.

**Demo-day mitigations:**
- Hover over a metric card's (i) icon to show the tooltip — demonstrates your UX polish and the tooltips you added.

### Step 3 — Drift flag triggers

**What they see:** Evaluations page → click **Run** next to a service → unified cost-preview + confidential-warning modal (from the Modal refactor) → confirm → progress indicator → results row appears with `drift_flagged = true` and a **critical** severity badge. Dashboard gains a red **Active Alerts** banner.

**Where it bites you live:**
- **The eval takes 5–15 seconds.** Dead air on stage.
- **the AI might score well enough to NOT trigger drift.** You run the demo eval hoping for a failure — and get 85 %.
- **Budget may have been consumed.** 402 response if today's $5 budget is spent.
- **If the service is confidential**, the eval requires admin override — handled by the modal, pass through cleanly.

**Demo-day mitigations:**
- **The pre-seeded drift scenario is already visible.** You don't have to run a live eval to show drift — it's on the Dashboard from the moment you log in.
- **Narrate during any live wait**: *"Each test case is going through our pipeline — input safety scan, budget check under concurrency lock, API call, output scan, usage log."*
- **Show the cost-preview modal** *before* confirming. Demonstrates cost awareness: *"The app estimates the spend before any call is made."*

### Step 4 — Incident is created

**What they see:** Incidents page → "Report" → form with service dropdown, severity, symptoms, 5-checkbox triage list, timeline → submit → list shows new INC-N row with red severity badge.

**Where it bites you live:**
- **Required fields are ambiguous.** Grader may see unclear validation messages if you forget symptoms.
- **No auto-link from alert to incident.** If asked "how does the alert tie to the incident?" — be honest: it's traceable via service_id + timestamp + audit log, not a direct FK.

**Demo-day mitigations:**
- Paste the pre-prepared symptoms (above) and pre-check `Data Issue` and `Prompt Change` — the two checkboxes that match the drift scenario.
- Narrate: *"I'm picking the same service the alert fired on. The drift severity was critical, so I'm picking severity=high."*

### Step 5 — Triage checklist is used

**What they see:** Incident detail page → left column shows the 5 checklist items with Yes/No indicators → Symptoms paragraph → right column is where the summary will land.

**Where it bites you live:**
- **Checklist doesn't "do" anything visually** until you generate the LLM summary. Grader may ask "so what?"

**Demo-day mitigations:**
- Explicitly narrate: *"These five checkboxes feed directly into the LLM prompt for root-cause analysis. Watch."* Then move to Step 6. The LLM output will reference the checked items, closing the loop.

### Step 6 — LLM generates summary (human approves) 🎯

**What they see:** Click **Generate draft** → wait → draft appears with "STAKEHOLDER UPDATE" + "ROOT CAUSES" sections → yellow pending banner → click **Approve** → `ReviewerNoteModal` opens with textarea + live character counter → paste the pre-prepared note → submit enables → green approved attribution block renders with email + timestamp + quoted reviewer note.

**Where it bites you live:**
- **LLM call is 5–10s.** Silence.
- **Short note rejection**: if the note is <20 chars, the submit button is greyed out (UX validation) and the backend also 400s (security validation). Don't try `"lgtm"` for laughs.
- **Double-click the approve button**: second click returns 409 Conflict. If the first click had a transient error and you retry, you'll hit this — the modal's `busy` prop blocks it but be mindful.
- **Budget/rate limit:** if earlier LLM calls exhausted quota, the generate 402/429s.

**Demo-day mitigations:**
- **Say the approval contract out loud BEFORE clicking**: *"Notice: the approve button requires a reviewer note of at least 20 characters. This forces the human in the loop to articulate what they verified — not rubber-stamp. The submit button stays disabled until the threshold is met."*
- Paste the pre-typed note, submit, then **immediately navigate to Governance → Audit Log** and show the `approve_summary` row with the `new_value` containing `reviewer_note_len=64`. This is the moment the grader writes down "HITL works."
- After approval, **go back to the incident detail page** to show the green attribution block — *"Approved by admin@aiops.local at 2026-04-19 14:32"* with the reviewer note in italics below.

### Step 7 — Maintenance plan is created

**What they see:** Same incident detail page → "Add plan" → form with risk level, rollback plan, validation steps, scheduled date, "human_approved" checkbox → submit → plan appears in the timeline view (hairline spine and ringed node dots from the UI redesign). Click **Approve** → green "Approved" state.

**Where it bites you live:**
- **Two-step: create then approve.** If you forget the approve step, the plan sits as pending.
- **Admin-only approval.** If demoing as maintainer, the approve button 403s.

**Demo-day mitigations:**
- Stay as **admin** for the whole demo.
- Show the Approve button change state visibly — the ringed dot on the timeline flips green.
- Narrate the architectural rhyme: *"Same human-in-the-loop pattern as the incident summary. Different domain, same contract."*

### Step 8 — Audit log records actions 🎯

**What they see:** Governance page → audit log table populated with the demo's recent actions (`Login Success`, `Create Service`, `Run Evaluation`, `Alert Created`, `Create Incident`, `Generate Summary Draft`, `Approve Summary`, `Create Maintenance Plan`, `Approve Maintenance Plan`). Actions are title-cased. Each row shows timestamp, user, action, target.

**Where it bites you live:**
- **Viewer-role users see a blank page** (audit log is admin-gated).
- **Audit log can have thousands of rows** from the scheduler or older runs. Noisy.

**Demo-day mitigations:**
- **Click "Verify integrity" live.** Green check + "Chain intact — N entries verified." is a visceral moment.
- Filter the table to `Approve Summary` so the grader sees your end-to-end chain: draft → approve with note → audit.
- **KILLSHOT**: for the tamper demo, see §6 Killshot #2 below. Rehearse only.

### Step 9 — Compliance report is exported 🎯

**What they see:** Governance page → date range picker (set to today) → click **PDF** → file downloads → open → title page, three sections (Audit Log, Incidents, Maintenance Plans) with styled tables. Also show JSON to demonstrate the structured payload.

**Where it bites you live:**
- **Date range mismatch.** Default 7 days back. Set to today only before demo.
- **Row truncation** if seed data is large — the red warning banner shows up but grader may see it as a bug.
- **PDF generation takes ~1 second.**

**Demo-day mitigations:**
- Pre-set date range to **today only**.
- Open the downloaded PDF side-by-side with the Governance page. Point to the three sections.
- Show the JSON in a separate tab and highlight the `warnings: []` array: *"When the export truncates, it says so loudly. No silent compliance evidence holes. Here's the test that proves it..."*

---

## 5. Narrative script — stories to tell at each step

§4 is the *operational* walkthrough — what you click, where it bites you,
mitigations. This section is the *narrative* — the actual words to say. Read
them aloud once tonight; if a line doesn't sit right in your voice, rewrite
it before the demo. The examiner should feel they watched a product pitch,
not a code walk.

### Opening (20s, before you click anything)

> *"Companies run 10+ AI services but have no single place to answer 'is this
> AI working today, is it getting worse, what broke, and can I prove to an
> auditor I'm managing it responsibly?' We built the control room that
> answers all four. Every AI call goes through one safety pipeline; every
> human approval leaves a fingerprint; every action lands in a tamper-evident
> audit log. Let me walk you through a real incident from detection to
> compliance export."*

### Step 1 — Register a service · *The phone book*

**Story:** *"First, we need to know what AI the business is running. This is
the phone book — name, owner, environment, model, and crucially a
**sensitivity label** that controls what's allowed to reach the LLM."*

**Click:** Services → Register → `Demo Chatbot` /
`https://httpbin.org/status/200` / `prod` / `claude-sonnet-4-6` / sensitivity
= **internal** → Save → **Ping** → green dot + latency.

**Punchline:** *"Notice the Ping didn't just succeed — it logged a
connection row. Uptime tracking starts the moment a service is registered."*

**🎯 Optional killshot #1 (30s):** type `http://169.254.169.254/meta-data/`
as a second service → **400** → *"That's the AWS metadata endpoint. If any
user could register it, we'd exfiltrate IAM credentials on every health
check. Our SSRF guard blocks private and link-local ranges before the HTTP
library ever sees the URL."*

### Step 2 — Dashboard: monitoring at a glance · *The control room*

**Story:** *"Here's what an operator sees first thing every morning. Four
health metrics, trend arrows, response-time distribution, quality over 7
days, and — at the top — a red banner. Something needs attention."*

**Click:** Click the Dashboard logo → point to the red Active Alerts banner.

**Punchline:** *"'Internal Report Generator quality dropped to 42%.' The
platform flagged it before a human noticed. That's the entire point."*

### Step 3 — Drift detection · *Not just a threshold*

**Story:** *"The naive question is 'is the score below 75?' The harder
question is 'is it slowly getting worse even while it's still above
threshold?' We answer both."*

**Click:** Evaluations → **Drift Analysis** for Internal Report Generator →
show the chart with the red band and the trend line.

**Punchline:** *"This uses split-half trend analysis — last N scores split in
two, compare the halves. A service scoring 85% but slowly declining still
fires. We document the algorithm in EVAL_DATASET_CARD with the judge-refused
handling. Refused rows are excluded, not counted as zero — refusal is a
different signal from failure."*

### Step 4 — File the incident · *From alert to action*

**Story:** *"An alert without an owner is noise. Filing an incident makes it
a ticket."*

**Click:** Incidents → Report → service = Internal Report Generator,
severity = **high**, paste symptoms, check ✅ **Data Issue** and ✅ **Prompt
Change** → Submit.

**Punchline:** *"The five checkboxes aren't decoration — they feed directly
into the LLM prompt when we generate root-cause analysis. Watch what happens
next."*

### Step 5 — The triage checklist earns its keep · *Bridge to the LLM*

**Story:** *"I've told the system what I suspect. Now I'm asking the LLM to
reason about it — but grounded in my checklist, not just
free-association."*

**Click:** Open the incident → gesture to the checklist → say the line
below.

**Punchline:** *"Without these boxes, the LLM would draft a generic
post-mortem. With them, it reasons against the operator's actual
hypotheses."*

### Step 6 — 🎯 LLM drafts, human approves · *The killshot*

**Story:** *"Here's where most AI ops tools fail the governance review —
they let the model just do things. Ours drafts; a human approves, with a
20-character reviewer note. No rubber-stamping."*

**Click:** Generate draft → wait 5–10s → review the STAKEHOLDER UPDATE +
ROOT CAUSES → **Approve** → paste the pre-prepared reviewer note → watch
the counter go green → Submit → green attribution block appears.

**Punchline (say BEFORE clicking approve):** *"The approve button stays
disabled below 20 characters — enforced in the UI, re-validated in the API,
and the character count ends up in the audit log. Approval is a legal
artifact here, not a convenience."*

**Follow-through:** Immediately navigate to Governance → Audit Log → filter
**Approve Summary** → point to the row showing `reviewer_note_len=64` and
the approver email.

### Step 7 — Maintenance plan · *Same contract, different domain*

**Story:** *"Same HITL pattern for planned work — risk level, rollback
strategy, validation steps, scheduled date, explicit human approval."*

**Click:** Back to the incident → Add plan → risk=**medium**, paste
rollback + validation → schedule today → Submit → Approve.

**Punchline:** *"We extracted this as `AILlmDraft` + `draft_service.py`.
Incident summaries, dashboard insights, compliance reports — they all share
one HITL abstraction. Change the contract in one place, fix it
everywhere."*

### Step 8 — 🎯 Audit log + integrity verify · *The receipt*

**Story:** *"Every action left a fingerprint. Here they are — login,
register, run, alert, incident, generate, approve, plan, plan-approve.
Title-cased, timestamped, actor-attributed."*

**Click:** Governance → Audit Log → scroll → click **Verify Integrity** →
green banner: *"Chain intact — N entries verified."*

**Punchline:** *"Every row hashes its content plus the previous row's hash.
If anyone — even a DBA — tampers with a row after the fact, the chain
breaks here. SQLite triggers reject UPDATE and DELETE at the database
layer; the hash chain catches anyone who went around them. Same pattern Git
uses for commits."*

**🎯 Optional killshot #2 (tamper demo — only if rehearsed):** drop trigger
→ UPDATE one row → click Verify again → red *"Broken at row 3."* → restore
trigger.

### Step 9 — Compliance export · *The auditor's artifact*

**Story:** *"Everything we've just done needs to be defensible to someone
who wasn't in the room. That's this button."*

**Click:** Governance → date range = today → **PDF** → open the download
side-by-side → point to the three sections (Audit Log, Incidents,
Maintenance).

**Punchline:** *"If the export truncates — say the audit log blew past
10,000 rows — it says so loudly in a `warnings: []` array. Silent
compliance-evidence holes are the failure mode regulators get burned by. We
don't ship that failure mode."*

### Closing (20s)

> *"That's the loop: register → monitor → detect → triage → draft → approve
> → plan → audit → export. Four modules, one HITL contract, one audit
> chain, one safety pipeline. The code is 9 routers and 14 models on
> FastAPI; the UI is the Apple-design-inspired React app you just saw; we
> ship with 188 tests, 71% coverage, and a full governance audit in
> `GOVERNANCE_AUDIT.md` that tells you exactly what it would take to run
> this in a regulated industry. Questions?"*

### Three one-line stories to memorise

If you blank on anything else, these three sentences get you 80% of the
grade:

1. *"Same HITL contract, different domain — drafts, 20-char reviewer note,
   audit log, idempotent approvals."*
2. *"Every row is hash-chained to the previous one. Tampering breaks the
   chain. Same pattern Git uses."*
3. *"It's a governance-aware prototype, not a production platform — and
   `GOVERNANCE_AUDIT.md` tells you exactly which gap is which."*

---

## 6. Three killshot moments worth 1-2 letter grades

Pick **at least one** of these. They're the difference between "yes they built it" and "wow, they thought about threats."

1. **SSRF live block.** During Service registration, type `http://169.254.169.254/meta-data/` and hit submit. The backend returns *"Unsafe endpoint URL: hostname resolves to blocked range."* Narrate: *"The AWS metadata service lives at that address. If any user could register it as a 'service' we'd exfiltrate IAM credentials on every health check. Blocked."*

2. **Audit integrity verify live + optional tamper.**
   Click **Verify integrity** → green. Then (rehearsed) tamper a row → click again → red with broken_at. Narrate: *"Every row is chained by SHA-256. We detect after-the-fact tampering. Same pattern as Git."*
   Tamper requires: `sqlite3 backend/aiops.db` direct connection, `DROP TRIGGER audit_log_no_update`, `UPDATE audit_log SET action='tampered' WHERE id=3`, recreate trigger. Rehearse tonight; if it works, keep it; if it's flaky, skip — the green-verify alone is enough.

3. **HITL reviewer note.** Click Approve on an incident summary. Show the `ReviewerNoteModal` — live character counter going red → green as you type. Narrate: *"Approval requires 20+ characters of reviewer note. Enforced by Pydantic at the request layer, re-checked after whitespace strip on the server. No silent rubber-stamping."* Then paste, submit, and go show the audit log row with `reviewer_note_len=N`.

---

## 7. Recovery procedures — if it breaks

### Backend 500s on any page

Check the terminal for the stack trace. Usually one of:

- **DB schema drift** (models changed, DB is old) → nuclear reset below
- **Missing env var** (ANTHROPIC_API_KEY empty) → set and restart
- **Port conflict** → `lsof -ti:8000 | xargs kill`

### Nuclear reset (30 seconds, always works)

```bash
cd backend
lsof -ti:8000 -sTCP:LISTEN | xargs kill 2>/dev/null
rm -f aiops.db
source venv/bin/activate
python -m app.seed
uvicorn app.main:app --port 8000
```

Then reload the browser tab and log in again. You'll lose any state generated during the previous demo attempt, but you're back to the pre-seeded baseline in under a minute.

### the AI API rate-limited or budget exceeded

- Stay calm. Say: *"We've hit today's $5 budget cap — which is a governance feature, not a bug. The app refuses to exceed the cap."*
- Pivot to the pre-seeded drift alert (Dashboard has it already) and narrate the compliance export path instead.
- Don't attempt another eval run — it'll 402 on screen.

### Frontend white-screens

```bash
# Hard refresh
Cmd+Shift+R
# Or restart dev server
cd frontend && npm run dev
```

### Network is down (venue wifi failed)

- Local demo still works — everything runs on localhost except the AI API calls.
- You can still show: Dashboard, Services, Evaluations (no live run), Incidents (no generate-summary), Governance (including audit log verify), compliance export.
- Skip steps 3 and 6 from the walkthrough. Pre-seeded drift covers you.

### Projector disconnects mid-demo

- Pause, unplug + replug, keep narrating. *"Our system handles outages gracefully — let me show you the offline path while that reconnects..."* — then reference the pre-seeded drift.

---

## 8. Post-demo Q&A phrasing

### Magic phrases to reach for

- *"It's a heuristic. A production implementation would do X."*
- *"In-app adversary yes, privileged host no."*
- *"Forcing function for deliberation, not enforcement."*
- *"Documented in X.md §Y."*

### If the examiner asks "could this run in production?"

Don't say yes. Don't say no. Say:

> *"We've mapped it against HIPAA, SOX, and EU AI Act in [GOVERNANCE_AUDIT.md](GOVERNANCE_AUDIT.md). The short version: not without a 6–12 week remediation program on MFA, encryption at rest, a vendor BAA, four-eyes approval, and external audit-log anchoring. We built a governance-aware prototype with real security-hardening work — the compliance wrapper is documented as the gap."*

For deep individual-Q&A practice, read [VIVA_QA_PREP](VIVA_QA_PREP.md) — 10 hardest questions with prepared ideal answers.

---

## 9. Q&A bait to prepare for

**"What happens if two admins approve the same summary?"** → 409 Conflict. Attribution is preserved. We have a test: `test_approve_is_idempotent_409_on_second_call`.

**"How do you know the drift detection isn't just a threshold?"** → Show `_compute_trend()` — it splits the last N scores and compares halves. A slowly declining service still above threshold will still fire. Documented in `EVAL_DATASET_CARD.md`.

**"What stops a maintainer from running evals on confidential services?"** → `enforce_sensitivity()` in `services/sensitivity.py`. They'd need the `allow_confidential=true` flag AND the admin role. Even with the flag, a maintainer gets 403.

**"Can an attacker bypass the rate limit with concurrent calls?"** → No. Budget check + reservation INSERT run under `_BUDGET_LOCK` in `llm_client.py`. We have a test: `test_concurrent_calls_respect_user_rate_limit` — 20 concurrent callers, limit of 5, asserts ≤ 5 succeed.

**"Can the audit log be tampered with?"** → Direct DB write is theoretically possible since we're on SQLite, but the SHA-256 hash chain detects it on next verify. Production should use Postgres with row-level WORM permissions. Documented as R9 residual.

**"What's the biggest remaining risk?"** → Pick one and go deep. Good answer: *"Judge refusals. LLM-as-judge is non-deterministic. If the AI's refusal behaviour shifts globally, a large fraction of our evals could become `judge_refused` and the drift signal weakens. We handle it by excluding refused rows from the aggregate — but the quality signal gets noisier, not wrong. That's why the maintenance runbook has a monthly check on refusal rate."*

---

## 10. Realistic timing

| Step | Target | Max acceptable |
|---|---|---|
| 1. Register | 45s | 90s |
| 2. Dashboard | 30s | 60s |
| 3. Drift trigger | 60s | 120s (LLM latency) |
| 4. Incident create | 30s | 60s |
| 5. Checklist narration | 15s | 30s |
| 6. LLM + approve | 90s | 180s (LLM + note) |
| 7. Maintenance plan | 45s | 90s |
| 8. Audit log + verify | 45s | 90s (with tamper demo: 120s) |
| 9. Export | 30s | 60s |
| **Total** | **~6.5 min** | **~12 min** |

Budget 7–8 minutes for the walkthrough plus 3–5 for Q&A. If you hit the timing, you project command of the system — which is half the grade.

---

## 11. One-page printable checklist

Print this. Keep it on the desk. Cross items off in the 15 min before demo:

- [ ] Laptop at 100 % + charger plugged in
- [ ] `git log --oneline -1` shows `4a831a8` or newer
- [ ] `backend/.env` has `SCHEDULER_ENABLED=false` and `LOG_SQL=false`
- [ ] Backend running on :8000 — terminal shows "scheduler DISABLED"
- [ ] Frontend running on :5173 — no Vite errors in terminal
- [ ] Browser at http://localhost:5173 on the Login page
- [ ] Login works with `admin@aiops.local` and your `SEED_ADMIN_PASSWORD`
- [ ] Dashboard shows the red Active Alerts banner
- [ ] ⌘K command palette opens
- [ ] Notifications muted (Do Not Disturb on)
- [ ] Copy-paste snippets open in a separate text file
- [ ] Backup video recorded from last night's run
- [ ] VIVA_QA_PREP ideal answers printed

Go get the A.
