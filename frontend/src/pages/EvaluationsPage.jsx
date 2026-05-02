import { useState, useEffect } from 'react';
import { Plus, Play, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import Modal from '../components/common/Modal';
import ConfirmModal from '../components/common/ConfirmModal';
import Toast from '../components/common/Toast';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import DriftAnalysis from '../components/evaluations/DriftAnalysis';
import TestCasesSection from '../components/evaluations/TestCasesSection';
import EvalRunsSection from '../components/evaluations/EvalRunsSection';

const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text placeholder-text-subtle transition-standard focus:border-accent focus:bg-surface';
const LABEL_CLS = 'block text-[11px] font-medium text-text-muted tracking-tight mb-1.5';

export default function EvaluationsPage() {
  const { canEdit } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [evalRuns, setEvalRuns] = useState([]);
  const [services, setServices] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [runningService, setRunningService] = useState(null);
  const [selectedDriftService, setSelectedDriftService] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [activeEnv, setActiveEnv] = useState('all');

  const [form, setForm] = useState({ service_id: '', prompt: '', expected_output: '', category: 'factuality' });
  // Eval-run confirmation. Holds the service + cost preview + confidential
  // flag between the "Run" click and the confirm action. Null when closed.
  const [runConfirm, setRunConfirm] = useState(null);
  // Key that changes to force sub-components (like DriftAnalysis) to
  // refresh their internal data fetching even if the selected ID hasn't
  // changed (e.g. running an eval for the already-selected service).
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  const fetchData = async () => {
    setError(null);
    try {
      const envParam = activeEnv !== 'all' ? { environment: activeEnv } : {};
      const [tcRes, runsRes, srvRes] = await Promise.all([
        api.get('/evaluations/test-cases', { params: envParam }),
        api.get('/evaluations/runs', { params: envParam }),
        api.get('/services'),
      ]);
      setTestCases(tcRes.data);
      setEvalRuns(runsRes.data);
      setServices(srvRes.data);
      const svcWithCases = [...new Set(tcRes.data.map(tc => tc.service_id))];
      if (svcWithCases.length > 0 && !selectedDriftService) setSelectedDriftService(svcWithCases[0]);
    } catch { setError('Failed to load evaluation data.'); } finally { setLoading(false); }
  };

  // Auto-refresh intentionally disabled on this page to avoid reloads
  // interrupting demos. Data refreshes on env change and after mutations.
  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [activeEnv]);

  const handleCreateTestCase = async (e) => {
    e.preventDefault();
    try {
      await api.post('/evaluations/test-cases', { ...form, service_id: parseInt(form.service_id) });
      setShowCreateModal(false);
      setForm({ service_id: '', prompt: '', expected_output: '', category: 'factuality' });
      showToast('Test case created', 'success');
      fetchData();
    } catch (err) { showToast(err.response?.data?.detail || 'Failed to create', 'error'); }
  };

  const handleRunEval = async (serviceId) => {
    const service = services.find((s) => s.id === serviceId);
    if (!service) return;

    // Fetch cost preview up-front so the confirm modal can show it. If
    // this fails we bail before opening the modal.
    let preview;
    try {
      const res = await api.get(`/evaluations/cost-preview/${serviceId}`);
      preview = res.data;
    } catch {
      showToast('Failed to get cost preview', 'error');
      return;
    }

    setRunConfirm({ service, preview });
  };

  const confirmRunEval = async () => {
    if (!runConfirm) return;
    const { service, preview } = runConfirm;
    const isConfidential = service.sensitivity_label === 'confidential';
    const qs = isConfidential ? '?allow_confidential=true' : '';

    setRunConfirm(null);
    setRunningService(service.id);
    try {
      const res = await api.post(`/evaluations/run/${service.id}${qs}`);
      const r = res.data;
      showToast(
        `Quality: ${r.quality_score}% ${r.drift_flagged ? '— drift detected' : ''}`,
        r.drift_flagged ? 'error' : 'success',
      );
      await fetchData();
      setSelectedDriftService(service.id);
      setRefreshTrigger(prev => prev + 1);
    } catch (err) {
      showToast(err.response?.data?.detail || 'Evaluation failed', 'error');
    } finally {
      setRunningService(null);
    }
  };

  if (loading) return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-5 w-40 bg-surface-elevated rounded-md animate-pulse" />
      <LoadingSkeleton type="table" />
    </div>
  );

  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); fetchData(); }} />;

  const serviceIds = [...new Set(testCases.map(tc => tc.service_id))];

  return (
    <div className="space-y-5">
      {toast.visible && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, visible: false })} />}

      <PageHeader title="Evaluations" description="Test cases, evaluation runs, and drift detection.">
        <div className="flex items-center gap-3">
          {/* Env tabs */}
          <div className="flex items-center bg-[var(--material-thick)] rounded-pill p-0.5" role="tablist" aria-label="Environment filter">
            {['all', 'dev', 'staging', 'production'].map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeEnv === tab}
                onClick={() => setActiveEnv(tab)}
                className={`px-3.5 py-1.5 text-[13px] font-medium rounded-pill capitalize transition-standard ${
                  activeEnv === tab
                    ? 'bg-surface-elevated text-text shadow-xs'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {canEdit && (
            <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-pill text-[13px] font-medium hover:bg-accent-hover transition-standard">
              <Plus size={15} strokeWidth={1.75} /> Add test case
            </button>
          )}
        </div>
      </PageHeader>

      {/* Run buttons */}
      {canEdit && serviceIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {serviceIds.map(svcId => {
            const svc = services.find(s => s.id === svcId);
            const count = testCases.filter(tc => tc.service_id === svcId).length;
            return (
              <button
                key={svcId}
                onClick={() => handleRunEval(svcId)}
                disabled={runningService !== null}
                className="flex items-center gap-1.5 px-4 py-2 bg-status-healthy text-white rounded-pill text-[13px] font-medium hover:opacity-90 transition-standard disabled:opacity-50"
              >
                {runningService === svcId ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" /> : <Play size={14} strokeWidth={1.75} />}
                {svc?.name || `#${svcId}`} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Drift analysis */}
      {services.length > 0 && (
        <DriftAnalysis
          services={services}
          selectedId={selectedDriftService}
          onSelect={setSelectedDriftService}
          refreshTrigger={refreshTrigger}
        />
      )}

      <TestCasesSection testCases={testCases} services={services} />
      <EvalRunsSection evalRuns={evalRuns} />

      {/* Create modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add test case" footer={
        <>
          <button onClick={() => setShowCreateModal(false)} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard">Cancel</button>
          <button onClick={handleCreateTestCase} disabled={!form.service_id || !form.prompt || !form.expected_output} className="px-4 py-1.5 bg-accent text-white text-[12px] font-medium rounded-pill hover:bg-accent-hover disabled:opacity-50 transition-standard">Create</button>
        </>
      }>
        <form className="space-y-3" onSubmit={handleCreateTestCase}>
          <div>
            <label className={LABEL_CLS}>Service</label>
            <select className={INPUT_CLS} value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })} required>
              <option value="">Select...</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Category</label>
            <select className={INPUT_CLS} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              <option value="factuality">Factuality</option>
              <option value="format_json">Format (JSON)</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Test Prompt</label>
            <textarea rows="3" className={`${INPUT_CLS} resize-none`} placeholder="Prompt to send..." value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} required />
          </div>
          <div>
            <label className={LABEL_CLS}>Expected Output</label>
            <textarea rows="3" className={`${INPUT_CLS} resize-none`} placeholder="Expected response..." value={form.expected_output} onChange={e => setForm({ ...form, expected_output: e.target.value })} required />
          </div>
        </form>
      </Modal>

      {/* Run-eval confirmation — shows cost preview + confidential warning
          in a single modal so the user isn't chained through two native
          prompts. */}
      <ConfirmModal
        isOpen={!!runConfirm}
        onClose={() => setRunConfirm(null)}
        onConfirm={confirmRunEval}
        title={
          runConfirm?.service?.sensitivity_label === 'confidential'
            ? 'Run evaluation — confidential service override'
            : 'Run evaluation — cost preview'
        }
        variant={runConfirm?.service?.sensitivity_label === 'confidential' ? 'warning' : 'default'}
        confirmLabel={
          runConfirm?.service?.sensitivity_label === 'confidential'
            ? 'Run with override'
            : 'Run evaluation'
        }
        description={
          runConfirm?.service?.sensitivity_label === 'confidential'
            ? `"${runConfirm.service.name}" is labelled confidential. The run will send prompts to an external LLM and the override will be recorded in the audit log.`
            : `Running ${runConfirm?.preview?.test_cases ?? 0} test cases against "${runConfirm?.service?.name ?? ''}".`
        }
        details={
          runConfirm?.preview && (
            <div className="rounded-lg bg-surface-elevated border border-hairline p-3 text-[12px] space-y-1">
              <div className="flex justify-between">
                <span className="text-text-muted">Test cases</span>
                <span className="font-mono tabular-nums text-text">{runConfirm.preview.test_cases}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">API calls</span>
                <span className="font-mono tabular-nums text-text">{runConfirm.preview.api_calls}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Estimated cost</span>
                <span className="font-mono tabular-nums text-text">
                  ${runConfirm.preview.estimated_cost_usd.toFixed(4)}
                  <span className="text-text-subtle"> (~{(runConfirm.preview.estimated_cost_usd * 100).toFixed(2)}¢)</span>
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-hairline mt-1">
                <span className="text-text-muted">Daily budget</span>
                <span className="font-mono tabular-nums text-text-subtle">${runConfirm.preview.daily_budget_usd.toFixed(2)}</span>
              </div>
            </div>
          )
        }
      />
    </div>
  );
}
