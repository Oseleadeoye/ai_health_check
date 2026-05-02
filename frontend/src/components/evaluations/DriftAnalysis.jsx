import { useState, useEffect } from 'react';
import { TrendingDown, TrendingUp, Minus, ShieldCheck, ShieldAlert, ShieldX, Activity, Loader2, Target, Info, Play, Gauge, LineChart, SignalHigh, ListChecks, ArrowRight } from 'lucide-react';
import {
  AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import api from '../../utils/api';
import EmptyState from '../common/EmptyState';
import { InfoTip } from '../common/Tooltip';
import { GRID_STROKE, AXIS_TICK, TOOLTIP_STYLE, CHART_GRID_DASH, CHART_LINE_STROKE } from '../common/chartStyle';

const SEV_CONFIG = {
  critical: { icon: ShieldX, bg: 'bg-status-failing-muted', text: 'text-status-failing', label: 'Critical drift', desc: 'Quality below threshold. Immediate attention required.' },
  warning: { icon: ShieldAlert, bg: 'bg-status-degraded-muted', text: 'text-status-degraded', label: 'Warning', desc: 'Declining quality or approaching threshold.' },
  none: { icon: ShieldCheck, bg: 'bg-status-healthy-muted', text: 'text-status-healthy', label: 'Healthy', desc: 'Quality within acceptable range.' },
};

const scoreColor = (s) => s >= 85 ? 'text-status-healthy' : s >= 75 ? 'text-status-degraded' : 'text-status-failing';
const scoreBg = (s) => s >= 85 ? 'bg-status-healthy' : s >= 75 ? 'bg-status-degraded' : 'bg-status-failing';
const psiColor = (severity) => (
  severity === 'critical' ? 'text-status-failing'
    : severity === 'warning' ? 'text-status-degraded'
      : severity === 'none' ? 'text-status-healthy'
        : 'text-text-subtle'
);

export default function DriftAnalysis({ services, selectedId, onSelect, refreshTrigger }) {
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchDrift = async (id) => {
    setLoading(true);
    try {
      const [checkRes, trendRes] = await Promise.all([
        api.get(`/evaluations/drift-check/${id}`),
        api.get(`/evaluations/drift-trend/${id}?limit=10`),
      ]);
      setData(checkRes.data);
      setTrend(trendRes.data.map((r, i) => ({
        ...r,
        label: r.run_at ? new Date(r.run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `#${i + 1}`,
      })));
    } catch { /* silent */ } finally { setLoading(false); }
  };

  // Re-fetch whenever the parent's selection changes — initial mount (once
  // services load and parent picks a default), tab clicks (handler just
  // calls onSelect; this effect does the fetch), and post-eval updates
  // (confirmRunEval bumps selectedDriftService to the just-evaluated service).
  useEffect(() => {
    if (selectedId) fetchDrift(selectedId);
  }, [selectedId, refreshTrigger]);

  const sev = data ? SEV_CONFIG[data.drift_severity] || SEV_CONFIG.none : null;
  const psi = data?.output_distribution_drift;
  const psiValue = typeof psi?.psi_score === 'number' ? psi.psi_score.toFixed(3) : '--';
  const psiSeverity = psi?.severity || 'insufficient';

  return (
    <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-5 py-3 border-b border-hairline" role="tablist" aria-label="Service drift analysis">
        <span className="text-[12px] font-semibold text-text-subtle tracking-tight mr-3">Drift</span>
        {services.map(svc => (
          <button
            key={svc.id}
            role="tab"
            aria-selected={selectedId === svc.id}
            onClick={() => onSelect(svc.id)}
            className={`px-3.5 py-1.5 text-[13px] font-medium rounded-pill transition-standard ${
              selectedId === svc.id ? 'bg-accent-weak text-text shadow-xs' : 'text-text-muted hover:text-text'
            }`}
          >
            {svc.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-text-subtle" />
        </div>
      ) : data && data.current_score !== null ? (
        <div>
          {/* Severity banner */}
          <div className={`px-5 py-4 ${sev.bg} border-b border-hairline flex items-center justify-between`}>
            <div className="flex items-center gap-2.5">
              <sev.icon size={18} strokeWidth={1.75} className={sev.text} />
              <div>
                <span className={`text-[15px] font-semibold ${sev.text}`}>{sev.label}</span>
                <p className={`text-[12px] ${sev.text} opacity-80`}>{sev.desc}</p>
              </div>
            </div>
            <span className="text-[13px] font-medium text-text-muted">{services.find(s => s.id === selectedId)?.name}</span>
          </div>

          {/* Score row */}
          <div className="grid grid-cols-2 lg:grid-cols-6 border-b border-hairline">
            {/* Current */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-2.5 flex items-center gap-1">
                Current
                <InfoTip content="Latest evaluation quality score for this service (0–100%). Higher is better." size={12} />
              </p>
              <div className="relative w-16 h-16 flex items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--hairline)" strokeWidth="2.5" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={data.current_score >= 85 ? 'var(--status-healthy)' : data.current_score >= 75 ? 'var(--status-degraded)' : 'var(--status-failing)'} strokeWidth="2.5" strokeDasharray={`${data.current_score} ${100 - data.current_score}`} strokeLinecap="round" />
                </svg>
                <span className={`text-[15px] font-semibold font-mono tabular-nums ${scoreColor(data.current_score)}`}>{data.current_score}%</span>
              </div>
            </div>
            {/* Previous */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Previous
                <InfoTip content="Score from the previous run, with the delta below (green = improved, red = regressed)." size={11} />
              </p>
              <p className={`text-lg font-semibold font-mono tabular-nums ${data.previous_score !== null ? scoreColor(data.previous_score) : 'text-text-subtle'}`}>
                {data.previous_score !== null ? `${data.previous_score}%` : '--'}
              </p>
              {data.previous_score !== null && (
                <p className={`text-[11px] font-mono tabular-nums font-medium mt-0.5 ${data.current_score > data.previous_score ? 'text-status-healthy' : data.current_score < data.previous_score ? 'text-status-failing' : 'text-text-subtle'}`}>
                  {data.current_score > data.previous_score ? '+' : ''}{(data.current_score - data.previous_score).toFixed(1)}
                </p>
              )}
            </div>
            {/* Average */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Average
                <InfoTip content="Mean quality score across the last several runs. Used to detect gradual drift." size={11} />
              </p>
              <p className={`text-lg font-semibold font-mono tabular-nums ${data.avg_last_n !== null ? scoreColor(data.avg_last_n) : 'text-text-subtle'}`}>
                {data.avg_last_n !== null ? `${data.avg_last_n}%` : '--'}
              </p>
              <p className="text-[11px] text-text-subtle mt-1">{data.trend_scores?.length || 0} runs</p>
            </div>
            {/* Trend */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Trend
                <InfoTip content="Overall direction of quality change. Declining = slow drift; improving = getting better; stable = no change." size={11} />
              </p>
              <div className={`flex items-center gap-1.5 text-[17px] font-semibold ${
                data.trend_direction === 'declining' ? 'text-status-failing' : data.trend_direction === 'improving' ? 'text-status-healthy' : 'text-text-subtle'
              }`}>
                {data.trend_direction === 'declining' ? <TrendingDown size={16} strokeWidth={1.75} /> : data.trend_direction === 'improving' ? <TrendingUp size={16} strokeWidth={1.75} /> : <Minus size={16} strokeWidth={1.75} />}
                <span className="capitalize">{data.trend_direction}</span>
              </div>
              <p className="text-[11px] text-text-subtle mt-1 capitalize">{data.confidence} conf.</p>
            </div>
            {/* PSI */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                PSI Drift
                <InfoTip content="Population Stability Index over response-length buckets versus previous runs. <0.10 stable, 0.10-0.25 warning, >=0.25 critical." size={11} />
              </p>
              <div className={`flex items-center gap-1.5 text-[17px] font-semibold font-mono tabular-nums ${psiColor(psiSeverity)}`}>
                <SignalHigh size={15} strokeWidth={1.75} />
                <span>{psiValue}</span>
              </div>
              <p className={`text-[11px] mt-1 capitalize ${psiColor(psiSeverity)}`}>{psiSeverity}</p>
            </div>
            {/* Threshold */}
            <div className="p-5 flex flex-col items-center">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Threshold
                <InfoTip content="Quality score below which drift is flagged as a problem. Set via DRIFT_THRESHOLD_PCT in .env (default: 75%)." size={11} />
              </p>
              <div className="flex items-center gap-1">
                <Target size={12} strokeWidth={1.75} className="text-status-failing" />
                <p className="text-xl font-semibold font-mono tabular-nums text-text">{data.threshold}%</p>
              </div>
              {data.score_variance !== null && <p className="text-[11px] text-text-subtle mt-1">Var: {data.score_variance}</p>}
            </div>
          </div>

          {/* Sample-too-small notice — one or two runs produce noisy trends
              (split-half is 1-vs-1), so surface that explicitly instead of
              letting users read a 50% result as a meaningful regression. */}
          {data.trend_scores && data.trend_scores.length < 3 && (
            <div className="px-5 py-3 bg-severity-low-muted/40 border-b border-hairline flex items-center gap-2.5">
              <Info size={15} strokeWidth={1.75} className="text-severity-low shrink-0" />
              <p className="text-[13px] text-text-muted leading-snug">
                Only <span className="font-semibold text-text">{data.trend_scores.length} run{data.trend_scores.length === 1 ? '' : 's'}</span> available — trend and severity are low-confidence until 3+ runs. Quality may appear to swing sharply between runs.
              </p>
            </div>
          )}

          {/* Score composition — breaks down how current_score is built from
              factuality + format. Directly answers "why is quality 50%?" when
              e.g. factuality=100 + format=0 averages to exactly 50. */}
          {trend.length > 0 && (() => {
            const latest = trend[trend.length - 1] || {};
            const parts = [
              { key: 'factuality', label: 'Factuality', value: latest.factuality_score, tip: 'LLM-judged correctness vs. expected answer' },
              { key: 'format', label: 'Format (JSON)', value: latest.format_score, tip: '100 if response parses as valid JSON, else 0' },
            ].filter(p => p.value !== null && p.value !== undefined);
            if (parts.length === 0) return null;
            return (
              <div className="px-5 py-4 border-b border-hairline bg-surface-elevated/30">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-1.5">
                    Score composition
                    <InfoTip content="Quality is the mean of its components. A single failing component can drag the overall score down sharply." size={12} />
                  </p>
                  <p className="text-[12px] text-text-subtle">latest run · mean = <span className="font-mono tabular-nums font-medium text-text">{data.current_score}%</span></p>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  {parts.map(p => (
                    <div key={p.key} className="flex items-center gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[12.5px] text-text-muted truncate" title={p.tip}>{p.label}</span>
                          <span className={`text-[13px] font-mono tabular-nums font-semibold ${scoreColor(p.value)}`}>{p.value}%</span>
                        </div>
                        <div className="h-2 bg-hairline rounded-pill overflow-hidden">
                          <div className={`h-full rounded-pill ${scoreBg(p.value)}`} style={{ width: `${p.value}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Chart */}
          {trend.length > 0 && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-[15px] font-semibold text-text tracking-tight">Quality over time</h4>
                <div className="flex items-center gap-3.5 text-[12px] text-text-muted">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full" style={{ background: 'var(--chart-1)' }} /> Quality</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full" style={{ background: 'var(--chart-2)' }} /> Factuality</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full" style={{ background: 'var(--chart-4)' }} /> Threshold</span>
                </div>
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <defs>
                      <linearGradient id="driftGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray={CHART_GRID_DASH} vertical={false} stroke={GRID_STROKE} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={6} />
                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-6} tickFormatter={v => `${v}%`} />
                    <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [`${v}%`, n]} />
                    <ReferenceLine y={data.threshold} stroke="var(--chart-4)" strokeDasharray="6 3" strokeWidth={1} />
                    <Area type="monotone" dataKey="quality_score" stroke="var(--chart-1)" strokeWidth={CHART_LINE_STROKE} fill="url(#driftGrad)" dot={{ r: 3, strokeWidth: 1.5, fill: 'var(--color-surface)' }} name="Quality" />
                    <Line type="monotone" dataKey="factuality_score" stroke="var(--chart-2)" strokeWidth={1.5} dot={{ r: 2.5, fill: 'var(--color-surface)', strokeWidth: 1 }} strokeDasharray="4 3" name="Factuality" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Per-test breakdown */}
          {data.per_test_case_breakdown?.length > 0 && (
            <div className="px-5 pb-5">
              <h4 className="text-[15px] font-semibold text-text tracking-tight mb-3">Per-test performance</h4>
              <div className="space-y-2">
                {data.per_test_case_breakdown.map(tc => {
                  const delta = tc.current_score - tc.avg_score;
                  return (
                    <div key={tc.test_case_id} className="flex items-center gap-3 px-3.5 py-3 bg-surface-elevated rounded-lg">
                      <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium tracking-tight ${tc.category === 'factuality' ? 'bg-severity-low-muted text-severity-low' : 'bg-status-paused-muted text-status-paused'}`}>
                        {tc.category}
                      </span>
                      <span className="text-[13px] text-text-muted flex-1 truncate">{tc.prompt_snippet}</span>
                      {/* Score bar */}
                      <div className="w-28 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-hairline rounded-pill overflow-hidden">
                          <div className={`h-full rounded-pill ${scoreBg(tc.current_score)}`} style={{ width: `${tc.current_score}%` }} />
                        </div>
                        <span className={`text-[13px] font-mono tabular-nums font-semibold w-11 text-right ${scoreColor(tc.current_score)}`}>{tc.current_score}%</span>
                      </div>
                      <span className={`text-[12px] font-mono tabular-nums w-14 text-right ${delta > 0 ? 'text-status-healthy' : delta < 0 ? 'text-status-failing' : 'text-text-subtle'}`}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                      </span>
                      <div className={`flex items-center gap-1 w-20 justify-end text-[12px] font-medium ${
                        tc.trend === 'declining' ? 'text-status-failing' : tc.trend === 'improving' ? 'text-status-healthy' : 'text-text-subtle'
                      }`}>
                        {tc.trend === 'declining' ? <TrendingDown size={12} strokeWidth={1.5} /> : tc.trend === 'improving' ? <TrendingUp size={12} strokeWidth={1.5} /> : <Minus size={12} strokeWidth={1.5} />}
                        {tc.trend}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Methodology footer — demo-app explainer. Always visible so
              reviewers understand the pipeline and severity rules at a
              glance without reading eval code. Designed to be scannable:
              pipeline flow → severity cards (with triggers) → concept cards. */}
          <div className="px-5 py-5 border-t border-hairline bg-surface-elevated/40 space-y-5">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-accent-weak flex items-center justify-center">
                  <Info size={15} strokeWidth={1.75} className="text-accent" />
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-text tracking-tight leading-tight">How drift detection works</h4>
                  <p className="text-[12px] text-text-subtle leading-tight mt-0.5">The pipeline, the math, and what each severity level means.</p>
                </div>
              </div>
              <span className="text-[11px] font-semibold text-text-subtle tracking-wider uppercase bg-surface px-2.5 py-1 rounded-pill border border-hairline">Demo reference</span>
            </div>

            {/* Pipeline flow — 4 stages with arrows, so the mental model
                (run → score → compare → classify) is visible at a glance. */}
            <div>
              <p className="text-[11px] font-semibold text-text-subtle tracking-wider uppercase mb-2.5">Pipeline</p>
              <div className="flex items-stretch gap-1.5 overflow-x-auto">
                {[
                  { icon: Play, label: 'Run tests', desc: 'Send every prompt to the model' },
                  { icon: Gauge, label: 'Score each', desc: 'Judge factuality · parse JSON · detect hallucination' },
                  { icon: LineChart, label: 'Compare history', desc: 'Split-half trend vs. last runs' },
                  { icon: SignalHigh, label: 'Classify', desc: 'Threshold · trend · PSI' },
                ].map((step, i, arr) => (
                  <div key={step.label} className="flex items-center gap-1.5 flex-1 min-w-0">
                    <div className="flex-1 min-w-0 rounded-lg bg-surface border border-hairline p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className="w-5 h-5 rounded-full bg-accent-weak flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-mono font-semibold text-accent tabular-nums">{i + 1}</span>
                        </div>
                        <step.icon size={13} strokeWidth={1.75} className="text-text-muted shrink-0" />
                        <span className="text-[13px] font-semibold text-text truncate">{step.label}</span>
                      </div>
                      <p className="text-[12px] text-text-muted leading-snug">{step.desc}</p>
                    </div>
                    {i < arr.length - 1 && <ArrowRight size={14} strokeWidth={1.5} className="text-text-subtle shrink-0" />}
                  </div>
                ))}
              </div>
            </div>

            {/* Severity levels — three cards with an explicit "trigger" chip
                so the rule is obvious, not buried in prose. */}
            <div>
              <p className="text-[11px] font-semibold text-text-subtle tracking-wider uppercase mb-2.5">Severity levels</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {[
                  {
                    icon: ShieldCheck, label: 'Healthy', tone: 'healthy',
                    trigger: `score ≥ ${data.threshold + 10}%`,
                    desc: 'Quality sits comfortably above the threshold and trend isn\u2019t declining. No action needed.',
                  },
                  {
                    icon: ShieldAlert, label: 'Warning', tone: 'degraded',
                    trigger: `${data.threshold}\u2013${data.threshold + 10}% · or declining`,
                    desc: 'Within 10 pts of the threshold, or the trend is declining. Investigate before it breaks.',
                  },
                  {
                    icon: ShieldX, label: 'Critical', tone: 'failing',
                    trigger: `score < ${data.threshold}% · or 15+ pt drop`,
                    desc: 'Below the threshold, or a sudden 15+ pt drop vs. the recent average. Page oncall.',
                  },
                ].map(sev => (
                  <div key={sev.label} className={`rounded-lg border border-hairline bg-status-${sev.tone}-muted/30 p-3.5`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <sev.icon size={15} strokeWidth={1.75} className={`text-status-${sev.tone}`} />
                        <span className={`text-[14px] font-semibold text-status-${sev.tone}`}>{sev.label}</span>
                      </div>
                      <span className={`text-[11px] font-mono tabular-nums text-status-${sev.tone} bg-surface border border-hairline rounded-pill px-2 py-0.5`}>
                        {sev.trigger}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-text-muted leading-snug">{sev.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Concept explainers — replaces the paragraph wall with three
                icon-led cards. Easier to scan than prose. */}
            <div>
              <p className="text-[11px] font-semibold text-text-subtle tracking-wider uppercase mb-2.5">Behind the numbers</p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
                <div className="rounded-lg bg-surface border border-hairline p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <Gauge size={14} strokeWidth={1.75} className="text-accent" />
                    <span className="text-[13px] font-semibold text-text">Quality score</span>
                  </div>
                  <p className="text-[12.5px] text-text-muted leading-relaxed">
                    Mean of per-test-case scores in a run. Factuality is LLM-judged; JSON format parses the response. <span className="text-text">One failing case can pull the mean down sharply</span> &mdash; see the composition strip above.
                  </p>
                </div>
                <div className="rounded-lg bg-surface border border-hairline p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <LineChart size={14} strokeWidth={1.75} className="text-accent" />
                    <span className="text-[13px] font-semibold text-text">Trend direction</span>
                  </div>
                  <p className="text-[12.5px] text-text-muted leading-relaxed">
                    Split the last <span className="font-mono tabular-nums">{data.trend_scores?.length || 'N'}</span> runs in half, compare averages. {'>'} 3 pts flips to <span className="text-status-healthy font-medium">improving</span> or <span className="text-status-failing font-medium">declining</span>. Confidence: <span className="text-text-subtle">low</span> ≤ 2 runs · <span className="text-text-muted">medium</span> 3&ndash;4 · <span className="text-text">high</span> 5+.
                  </p>
                </div>
                <div className="rounded-lg bg-surface border border-hairline p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <ListChecks size={14} strokeWidth={1.75} className="text-accent" />
                    <span className="text-[13px] font-semibold text-text">Per-test breakdown</span>
                  </div>
                  <p className="text-[12.5px] text-text-muted leading-relaxed">
                    Aggregates hide which case broke. Each row above shows the case&rsquo;s current score, delta vs. its own recent average, and its own trend &mdash; so you <span className="text-text">pinpoint the regressing prompt</span>, not the service.
                  </p>
                </div>
                <div className="rounded-lg bg-surface border border-hairline p-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <SignalHigh size={14} strokeWidth={1.75} className="text-accent" />
                    <span className="text-[13px] font-semibold text-text">Output distribution (PSI)</span>
                  </div>
                  <p className="text-[12.5px] text-text-muted leading-relaxed">
                    Buckets response text as empty, short, medium, or long, then compares the latest run with previous runs. <span className="text-text">PSI 0.10+</span> signals the model&rsquo;s output shape changed even if quality has not fallen yet.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="py-10">
          <EmptyState icon={Activity} title={data ? 'No evaluation data' : 'Select a service'} description={data ? 'Run an evaluation to see drift analysis.' : 'Choose a service tab above.'} />
        </div>
      )}
    </div>
  );
}
