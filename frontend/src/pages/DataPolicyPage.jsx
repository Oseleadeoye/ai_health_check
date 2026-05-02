import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, Database, Globe, Lock, ArrowRight, Server, ArrowUpRight } from 'lucide-react';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';

const SENSITIVITY_COPY = {
  public:       'Non-sensitive. Full LLM features enabled.',
  internal:     'Business data. LLM features enabled with caution.',
  confidential: 'Highly sensitive. LLM requires explicit approval.',
};

export default function DataPolicyPage() {
  // Everything here is server-sourced so the page reflects the running system
  // instead of hard-coded claims. Failures fall back to null, which the
  // renderers detect and show a neutral label for.
  const [model, setModel] = useState(null);
  const [sensitivityCounts, setSensitivityCounts] = useState(null);
  const [blockedToday, setBlockedToday] = useState(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [settingsRes, servicesRes, safetyRes] = await Promise.allSettled([
          api.get('/dashboard/settings'),
          api.get('/services'),
          api.get('/dashboard/api-safety'),
        ]);

        if (cancelled) return;

        if (settingsRes.status === 'fulfilled') {
          setModel(settingsRes.value.data?.ai_model?.model ?? null);
        }

        if (servicesRes.status === 'fulfilled') {
          const counts = { public: 0, internal: 0, confidential: 0 };
          for (const s of servicesRes.value.data || []) {
            if (counts[s.sensitivity_label] !== undefined) counts[s.sensitivity_label] += 1;
          }
          setSensitivityCounts(counts);
        }

        if (safetyRes.status === 'fulfilled') {
          setBlockedToday(safetyRes.value.data?.blocked_today ?? 0);
        }
      } catch {
        // swallow — every panel has a neutral fallback
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-5 max-w-4xl">
      <PageHeader title="Data Policy" description="How AI Health Check handles data and interacts with external LLM providers." />

      {/* Architecture diagram */}
      <div className="bg-surface rounded-xl border border-hairline p-6 shadow-xs">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-[13px] font-semibold text-text tracking-tight">Data flow</h3>
          {model && (
            <span className="text-[11px] text-text-subtle">
              Live model:&nbsp;
              <span className="font-mono bg-surface-elevated px-1.5 py-0.5 rounded-xs text-text">
                {model}
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 p-5 bg-surface-elevated rounded-xl border border-hairline">
          <FlowNode icon={Globe} label="User" sublabel="Browser" />
          <ArrowRight size={16} strokeWidth={1.5} className="text-text-subtle hidden md:block" />
          <div className="flex flex-col gap-2 w-full md:w-40">
            <FlowBox label="React Frontend" sublabel="Dashboards" />
            <FlowBox label="FastAPI Backend" sublabel="llm_client.py" />
          </div>
          <ArrowRight size={16} strokeWidth={1.5} className="text-text-subtle hidden md:block" />
          <div className="flex flex-col gap-2 w-full md:w-36">
            <FlowNode icon={Database} label="SQLite" sublabel="Local storage" />
            <FlowNode
              icon={Server}
              label="AI Model API"
              sublabel={model ? `Provider · ${model.split('-').slice(0, 3).join('-')}` : 'Cloud inference'}
            />
          </div>
        </div>
      </div>

      {/* Policy sections */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PolicySection icon={Database} title="What is stored locally?">
          All application data is stored in a local SQLite database (aiops.db). This includes: service metadata,
          evaluation results, incident records, audit log, telemetry, and API usage logs. Passwords are stored
          as bcrypt hashes. Prompt safety scan results and risk scores are logged per API call.
        </PolicySection>

        <PolicySection icon={Globe} title="What is sent to the LLM Provider?">
          <p className="mb-2">Data dispatched to the AI API:</p>
          <ul className="space-y-1.5">
            <li className="flex items-start gap-2"><Dot /> Test connection prompts (short "hello" prompt)</li>
            <li className="flex items-start gap-2"><Dot /> Evaluation test case prompts (synthetic data)</li>
            <li className="flex items-start gap-2"><Dot /> Incident details for LLM summary generation</li>
            <li className="flex items-start gap-2"><Dot /> Dashboard and compliance report generation requests</li>
          </ul>
          <p className="mt-2 text-text-subtle">All inputs are scanned by the safety scanner, and supported PII/PHI matches are replaced with placeholders before transmission.</p>
        </PolicySection>

        <PolicySection icon={Lock} title="Are prompts logged?">
          Redacted prompt and response snippets are stored in the local API usage log for traceability,
          truncated to 2,000 characters. The log also records latency, token counts, cost estimate,
          safety flags, and risk score. Per the provider's policy, API inputs/outputs are not used
          for model training.
        </PolicySection>

        <PolicySection icon={Shield} title="Sensitivity label routing">
          <p className="mb-3">
            Every registered service is tagged with a sensitivity label that governs LLM feature access.
            {sensitivityCounts && (
              <>
                {' '}Current fleet:&nbsp;
                <span className="font-mono text-text">
                  {sensitivityCounts.public + sensitivityCounts.internal + sensitivityCounts.confidential}
                </span>
                {' '}services.
              </>
            )}
          </p>
          <div className="space-y-2">
            {['public', 'internal', 'confidential'].map(tier => (
              <SensitivityRow
                key={tier}
                status={tier}
                desc={SENSITIVITY_COPY[tier]}
                count={sensitivityCounts?.[tier]}
              />
            ))}
          </div>
        </PolicySection>
      </div>

      {/* Safety note — pulls live blocked count so the "scanner active"
          claim is backed by today's data, not just a static label. */}
      <div className="flex items-start gap-3 px-4 py-3.5 bg-status-healthy-muted rounded-xl">
        <Shield size={14} strokeWidth={1.75} className="text-status-healthy shrink-0 mt-0.5" />
        <div className="text-[12px] text-text-muted flex-1">
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mb-1">
            <span className="font-medium text-text">Prompt safety scanner active.</span>
            {blockedToday !== null && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono tabular-nums text-status-healthy">
                <span className="w-1 h-1 rounded-full bg-status-healthy" />
                {blockedToday} blocked today
              </span>
            )}
          </div>
          All inputs are checked for injection patterns, PII/PHI, and length limits before reaching the AI model.
          Supported identifiers are redacted to placeholders such as [PATIENT_NAME], [DOB], and [SSN].
          Blocked calls are logged with safety flags and risk scores. Budget enforcement prevents cost overruns.{' '}
          <Link
            to="/settings"
            className="inline-flex items-center gap-0.5 text-accent hover:underline"
          >
            See live scanner stats
            <ArrowUpRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Local sub-components ── */

function PolicySection({ icon: Icon, title, children }) {
  return (
    <section className="bg-surface rounded-xl border border-hairline p-5 shadow-xs">
      <h3 className="text-[13px] font-semibold text-text tracking-tight mb-2 flex items-center gap-2">
        <Icon size={12} strokeWidth={1.5} /> {title}
      </h3>
      <div className="text-sm text-text-muted leading-relaxed">{children}</div>
    </section>
  );
}

function FlowNode({ icon: Icon, label, sublabel }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="w-11 h-11 rounded-xl bg-surface shadow-xs flex items-center justify-center">
        <Icon size={16} strokeWidth={1.75} className="text-text-subtle" />
      </div>
      <span className="text-[11px] font-medium text-text tracking-tight">{label}</span>
      {sublabel && <span className="text-[10px] text-text-subtle text-center">{sublabel}</span>}
    </div>
  );
}

function FlowBox({ label, sublabel }) {
  return (
    <div className="px-3 py-2 bg-surface rounded-lg border border-hairline shadow-xs text-center">
      <p className="text-[12px] font-medium text-text">{label}</p>
      {sublabel && <p className="text-[10px] text-text-subtle">{sublabel}</p>}
    </div>
  );
}

function SensitivityRow({ status, desc, count }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-24 shrink-0"><StatusBadge status={status} /></div>
      <span className="text-xs text-text-muted flex-1">{desc}</span>
      {count !== undefined && (
        <span className="text-[11px] font-mono tabular-nums text-text-subtle shrink-0">
          {count} {count === 1 ? 'service' : 'services'}
        </span>
      )}
    </div>
  );
}

function Dot() {
  return <span className="w-1 h-1 rounded-full bg-text-subtle shrink-0 mt-2" aria-hidden="true" />;
}
