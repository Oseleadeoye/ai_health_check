import { useState, useEffect } from 'react';
import { Plus, Wifi, Trash2, Pencil, LayoutGrid, List as ListIcon, Loader2, Server, Search, AlertCircle, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import Modal from '../components/common/Modal';
import ConfirmModal from '../components/common/ConfirmModal';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import Toast from '../components/common/Toast';

// Error-detail extractor for Services page mutations.
// Handles three shapes FastAPI / axios can return:
//   1. Blob body (responseType:'blob' requests) → read as text + JSON.parse
//   2. Plain { detail: "string" } → return the string
//   3. Pydantic validation { detail: [{loc, msg, type, ...}] } → format each
//      entry as "<field>: <msg>". This was the bug — before this, the toast
//      rendered "[object Object]" on any 422.
async function extractErrorDetail(err, fallback = 'Request failed') {
  const data = err?.response?.data;
  const status = err?.response?.status;

  const formatDetail = (detail) => {
    if (detail == null) return null;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      // Pydantic validation errors: [{loc:[...], msg:"Field required", type:"missing"}, ...]
      const lines = detail.slice(0, 4).map((d) => {
        const field = Array.isArray(d?.loc) ? d.loc.slice(1).join('.') || d.loc.join('.') : 'input';
        const msg = d?.msg || d?.type || 'invalid value';
        return `${field}: ${msg}`;
      });
      const extra = detail.length > 4 ? ` (+${detail.length - 4} more)` : '';
      return `Validation error — ${lines.join('; ')}${extra}`;
    }
    // Object — try to stringify something useful
    if (typeof detail === 'object') return detail.msg || detail.message || JSON.stringify(detail);
    return String(detail);
  };

  // Status-code prefix for the toast so users see "403 · Role 'viewer' not authorized"
  // rather than a context-free error string.
  const prefix = status ? `${status} · ` : '';

  if (!data) {
    // Common case: axios network error (backend down)
    return `${err?.code === 'ERR_NETWORK' ? 'Backend unreachable — ' : ''}${err?.message || fallback}`;
  }
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      try {
        const parsed = JSON.parse(text);
        const detail = formatDetail(parsed.detail);
        return detail ? `${prefix}${detail}` : text || err?.message || fallback;
      } catch {
        return text || err?.message || fallback;
      }
    } catch {
      return err?.message || fallback;
    }
  }
  if (typeof data === 'string') return `${prefix}${data}`;
  const detail = formatDetail(data.detail);
  return detail ? `${prefix}${detail}` : (err?.message || fallback);
}


// Translate a raw Anthropic error snippet (the thing llm_client.test_connection
// stores in response_snippet on failure) into a human-readable message + a
// concrete fix hint. Anthropic returns Python-repr'd dicts, not JSON, so we
// regex-extract rather than JSON.parse.
//
// Example raw input:
//   "Error code: 404 - {'type': 'error', 'error': {'type': 'not_found_error',
//    'message': 'model: claude-sonnet-4-6-20250415'}, 'request_id': 'req_...'}"
//
// Returns: { title, hint, raw }
function humanizeLlmProbeError(rawSnippet, service) {
  const raw = String(rawSnippet || '').trim();
  if (!raw) return { title: 'Ping failed', hint: 'No error detail returned.', raw };

  // If this is an HTTP-mode probe snippet (my liveness fix), it's already readable.
  if (/^HTTP \d+ \(reachable/.test(raw)) {
    return { title: raw, hint: '', raw };
  }

  // Match the Anthropic error structure: type + message
  const typeMatch = raw.match(/'type':\s*'([a-z_]+_error)'/);
  const msgMatch = raw.match(/'message':\s*'([^']+)'/);
  const errorType = typeMatch ? typeMatch[1] : null;
  const message = msgMatch ? msgMatch[1] : '';

  // Status code prefix (e.g. "Error code: 404")
  const statusMatch = raw.match(/Error code:\s*(\d{3})/);
  const status = statusMatch ? statusMatch[1] : null;

  const MAP = {
    not_found_error: {
      title: `Anthropic doesn't recognize the model "${service?.model_name || message.replace(/^model:\s*/, '')}"`,
      hint: 'Edit the service and change the Model field to a valid provider ID (for example, claude-sonnet-4-5-20250929 or claude-haiku-4-5-20251001).',
    },
    authentication_error: {
      title: 'Anthropic rejected the API key',
      hint: 'Check ANTHROPIC_API_KEY in backend/.env and restart the backend.',
    },
    permission_error: {
      title: 'API key does not have permission for this model',
      hint: 'Verify the key has access to the model in the Anthropic console.',
    },
    rate_limit_error: {
      title: 'Rate limited by Anthropic',
      hint: 'Wait a moment and retry. If this persists, lower api_max_calls_per_minute or request a higher rate tier from Anthropic.',
    },
    overloaded_error: {
      title: 'Anthropic is temporarily overloaded',
      hint: 'Retry in a few seconds — this is upstream capacity, nothing to fix on our side.',
    },
    api_error: {
      title: 'Anthropic API error',
      hint: message ? `Detail: ${message}` : 'Retry; if persistent, check https://status.anthropic.com.',
    },
    invalid_request_error: {
      title: 'Anthropic rejected the request',
      hint: message || 'Check the request shape (model, max_tokens, messages).',
    },
  };

  const friendly = errorType && MAP[errorType];
  if (friendly) {
    return {
      title: status ? `${status} · ${friendly.title}` : friendly.title,
      hint: friendly.hint,
      raw,
    };
  }

  // Unknown Anthropic error type — surface what we have without the request_id noise
  const trimmed = raw.replace(/,?\s*'request_id':\s*'[^']+'/, '').slice(0, 220);
  return {
    title: status ? `${status} · LLM probe failed` : 'LLM probe failed',
    hint: trimmed,
    raw,
  };
}

const SENSITIVITY_OPTIONS = ['public', 'internal', 'confidential'];
const ENV_OPTIONS = ['dev', 'staging', 'prod'];
const DEFAULT_FORM = {
  name: '', owner: '', environment: 'dev',
  // Canonical catalog id (undated). Backend normalizes either form, but
  // writing the canonical value here keeps new rows tidy.
  model_name: 'claude-sonnet-4-6',
  sensitivity_label: 'internal', endpoint_url: '',
};

const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text placeholder-text-subtle transition-standard focus:border-accent focus:bg-surface';
const LABEL_CLS = 'block text-[11px] font-medium text-text-muted tracking-tight mb-1.5';

export default function ServicesPage() {
  const { canEdit } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [viewMode, setViewMode] = useState('grid');
  const [search, setSearch] = useState('');

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });
  // formMode: null | 'create' | 'edit'. editingId is set only for 'edit'.
  const [formMode, setFormMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  // Supported-models catalog for the dropdown. Lazy-loaded on first form
  // open. `null` = not loaded yet; `[]` = catalog fetched but empty;
  // object with `error` = fetch failed → UI falls back to free-text.
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Confidential Ping confirmation — holds the service the user clicked
  // on until they either confirm the override or cancel. Null when closed.
  const [confidentialPingTarget, setConfidentialPingTarget] = useState(null);

  const [form, setForm] = useState(DEFAULT_FORM);

  const fetchServices = async () => {
    setError(null);
    try {
      const res = await api.get('/services');
      setServices(res.data);
    } catch (err) {
      setError('Failed to load services.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchServices(); }, []);

  // Lazy-load the supported-models catalog on first form open. Subsequent
  // opens reuse the cached value. On fetch failure we note the error and
  // fall back to a free-text input so a catalog outage doesn't block
  // creating a service.
  const ensureCatalogLoaded = async () => {
    if (catalog !== null) return;
    try {
      const res = await api.get('/settings/models/catalog');
      setCatalog(res.data.models || []);
      setCatalogError(null);
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'catalog fetch failed';
      setCatalog([]);
      setCatalogError(msg);
    }
  };

  const openCreateForm = () => {
    setForm(DEFAULT_FORM);
    setFormError(null);
    setEditingId(null);
    setFormMode('create');
    ensureCatalogLoaded();
  };

  const openEditForm = (service) => {
    setForm({
      name: service.name,
      owner: service.owner,
      environment: service.environment,
      model_name: service.model_name,
      sensitivity_label: service.sensitivity_label,
      endpoint_url: service.endpoint_url || '',
    });
    setFormError(null);
    setEditingId(service.id);
    setFormMode('edit');
    ensureCatalogLoaded();
  };

  const closeForm = () => {
    setFormMode(null);
    setEditingId(null);
    setFormError(null);
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    const verb = formMode === 'edit' ? 'update' : 'create';
    try {
      if (formMode === 'edit' && editingId != null) {
        await api.put(`/services/${editingId}`, form);
      } else {
        await api.post('/services', form);
      }
      closeForm();
      fetchServices();
      showToast(`Service ${verb}d`, 'success');
    } catch (err) {
      const detail = await extractErrorDetail(err, `Failed to ${verb} service`);
      // Keep the inline formError for the dialog AND toast so the user
      // sees it whether the modal stays open or not.
      setFormError(detail);
      showToast(detail, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmId(null);
    setDeleteError(null);
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    setDeleteError(null);
    try {
      await api.delete(`/services/${deleteConfirmId}`);
      closeDeleteConfirm();
      fetchServices();
      showToast('Service deleted', 'success');
    } catch (err) {
      const detail = await extractErrorDetail(err, 'Failed to delete service');
      setDeleteError(detail);
      showToast(detail, 'error');
    }
  };

  const runPing = async (id, qs = '') => {
    // Derive mode from the query string so the footer can render it without
    // a second round-trip. `?mode=llm...` means a real model call — we want
    // to tell the user that explicitly so "Connected 1.8s" stops looking
    // like a slow HTTP probe.
    const mode = qs.includes('mode=llm') ? 'llm' : 'http';
    setTestResults((prev) => ({ ...prev, [id]: { loading: true, mode } }));
    const service = services.find((s) => s.id === id);
    try {
      const res = await api.post(`/services/${id}/test-connection${qs}`);
      setTestResults((prev) => ({
        ...prev,
        [id]: {
          ...res.data,
          mode,
          status: res.data.status === 'success' ? 'healthy' : 'failed',
        },
      }));
      if (res.data.status !== 'success') {
        // Humanize the raw Anthropic / probe error before showing it.
        const { title, hint } = humanizeLlmProbeError(res.data.response_snippet, service);
        const msg = hint ? `${title} — ${hint}` : title;
        showToast(`${service?.name || 'Service'}: ${msg}`, 'error');
      }
    } catch (err) {
      const detail = await extractErrorDetail(err, 'Ping request failed');
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: 'failed', mode, latency_ms: 0, response_snippet: detail },
      }));
      showToast(`${service?.name || 'Service'}: ${detail}`, 'error');
    }
  };

  const handleTestConnection = (id) => {
    const service = services.find((s) => s.id === id);
    if (service?.sensitivity_label === 'confidential') {
      // Defer to confirm modal; override query-string attached on approve.
      setConfidentialPingTarget(service);
      return;
    }
    runPing(id, '?mode=llm');
  };

  const confirmConfidentialPing = async () => {
    if (!confidentialPingTarget) return;
    const id = confidentialPingTarget.id;
    setConfidentialPingTarget(null);
    await runPing(id, '?mode=llm&allow_confidential=true');
  };

  const filtered = services.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.owner.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="h-5 w-36 bg-surface-elevated rounded-md animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); fetchServices(); }} />;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader title="Service Registry" description="Manage and monitor connected AI models and endpoints.">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative w-52">
            <Search size={14} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input
              type="text"
              placeholder="Search services..."
              aria-label="Search services"
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-[var(--material-thick)] rounded-pill text-text placeholder-text-subtle transition-standard"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* View toggle */}
          <div className="flex bg-[var(--material-thick)] rounded-pill p-0.5" role="group" aria-label="View mode">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-pill transition-standard ${viewMode === 'grid' ? 'bg-surface-elevated text-text shadow-xs' : 'text-text-subtle hover:text-text'}`}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <LayoutGrid size={14} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-pill transition-standard ${viewMode === 'list' ? 'bg-surface-elevated text-text shadow-xs' : 'text-text-subtle hover:text-text'}`}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <ListIcon size={14} strokeWidth={1.5} />
            </button>
          </div>

          {canEdit && (
            <button
              onClick={openCreateForm}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent text-white rounded-pill text-[12px] font-medium hover:bg-accent-hover transition-standard"
            >
              <Plus size={14} strokeWidth={1.75} /> Register
            </button>
          )}
        </div>
      </PageHeader>

      {/* Service cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No services found"
          description={search ? 'Try a different search term.' : 'Get started by registering a new AI service.'}
          action={canEdit && !search && (
            <button onClick={openCreateForm} className="px-3.5 py-1.5 text-[12px] font-medium text-accent bg-accent-weak rounded-pill hover:bg-accent-muted transition-standard">
              Register service
            </button>
          )}
        />
      ) : (
        <div className={`grid gap-3 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
          {filtered.map((s) => {
            const test = testResults[s.id];
            const statusLabel = !test ? 'Untested' : test.loading ? 'Testing...' : test.status === 'healthy' ? 'Connected' : 'Failed';
            const statusDot = !test ? 'bg-status-unknown' : test.loading ? 'bg-status-degraded' : test.status === 'healthy' ? 'bg-status-healthy' : 'bg-status-failing';

            return (
              <div key={s.id} className="bg-surface rounded-xl border border-hairline shadow-xs hover:shadow-sm transition-standard flex flex-col group">
                <div className="p-5 flex-1">
                  {/* Top row: name + delete */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold text-text tracking-tight truncate" title={s.name}>{s.name}</h3>
                      <p className="text-[12px] text-text-muted mt-0.5">{s.owner}</p>
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-standard">
                        <button
                          onClick={() => openEditForm(s)}
                          className="p-1.5 text-text-subtle hover:text-accent hover:bg-surface-elevated rounded-pill transition-standard"
                          aria-label={`Edit ${s.name}`}
                        >
                          <Pencil size={14} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(s.id)}
                          className="p-1.5 text-text-subtle hover:text-status-failing hover:bg-status-failing-muted rounded-pill transition-standard"
                          aria-label={`Delete ${s.name}`}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <StatusBadge status={s.environment} />
                    <StatusBadge status={s.sensitivity_label} />
                  </div>

                  {/* Model */}
                  <p className="text-[11px] font-mono text-text-muted bg-surface-elevated px-2 py-1 rounded-md truncate" title={s.model_name}>
                    {s.model_name}
                  </p>
                </div>

                {/* Footer: status + ping */}
                <div className="px-5 py-3 border-t border-hairline flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusDot}`} aria-hidden="true" />
                    <span className="text-[12px] font-medium text-text-muted">{statusLabel}</span>
                    {test && !test.loading && test.latency_ms > 0 && (
                      <>
                        <span className="text-[11px] font-mono tabular-nums text-text-subtle">{test.latency_ms}ms</span>
                        {/* Mode tag: an HTTP probe is a ~100ms reachability
                            check; an LLM ping is a real Claude call that
                            costs money and takes 1–2s. Showing the mode
                            explains long latencies at a glance. */}
                        {test.mode === 'llm' ? (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-pill bg-accent/10 text-accent"
                            title={`Live Claude call using ${s.model_name}. Real API spend; ~1–2s typical.`}
                          >
                            <Zap size={10} strokeWidth={2} /> live
                          </span>
                        ) : (
                          <span
                            className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-subtle"
                            title="HTTP reachability probe — no LLM call, no cost."
                          >
                            http
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => handleTestConnection(s.id)}
                      disabled={test?.loading}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-text-muted hover:text-accent bg-surface-elevated rounded-pill transition-standard disabled:opacity-50"
                      aria-label={`Ping ${s.name}`}
                    >
                      {test?.loading ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : <Wifi size={12} strokeWidth={1.5} />}
                      Ping
                    </button>
                  )}
                </div>
                {/* Persistent inline error strip — stays visible after the toast
                    auto-dismisses. Only renders on failure; success / loading /
                    untested states omit this block. */}
                {test && !test.loading && test.status === 'failed' && (() => {
                  const { title, hint, raw } = humanizeLlmProbeError(test.response_snippet, s);
                  return (
                    <div className="px-5 pb-4">
                      <div className="rounded-md border border-status-failing/20 bg-status-failing-muted/60 px-3 py-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle size={14} strokeWidth={2} className="text-status-failing shrink-0 mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-status-failing leading-snug">{title}</p>
                            {hint && (
                              <p className="text-[11px] text-text-muted mt-1 leading-snug">{hint}</p>
                            )}
                            {raw && raw !== title && (
                              <details className="mt-1.5">
                                <summary className="text-[10.5px] text-text-subtle cursor-pointer hover:text-text-muted">Show raw error</summary>
                                <pre className="mt-1 text-[10px] font-mono text-text-subtle whitespace-pre-wrap break-words max-h-32 overflow-auto">{raw}</pre>
                              </details>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}

      {/* Register / Edit Service Modal */}
      <Modal
        isOpen={formMode !== null}
        onClose={closeForm}
        title={formMode === 'edit' ? 'Edit AI service' : 'Register AI service'}
        footer={
          <>
            <button onClick={closeForm} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !form.name || !form.owner || !form.model_name}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white text-[12px] font-medium rounded-pill hover:bg-accent-hover disabled:opacity-50 transition-standard"
            >
              {isSubmitting ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : (formMode === 'edit' ? 'Save changes' : 'Register')}
            </button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={handleSubmit}>
          {formError && (
            <div role="alert" className="flex items-start gap-2 px-3 py-2 text-[12px] text-status-failing bg-status-failing-muted border border-status-failing/30 rounded-md">
              <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Service Name *</label>
              <input className={INPUT_CLS} placeholder="Content Generator" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Owner Team *</label>
              <input className={INPUT_CLS} placeholder="Marketing" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Environment</label>
              <select className={INPUT_CLS} value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                {ENV_OPTIONS.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Sensitivity</label>
              <select className={INPUT_CLS} value={form.sensitivity_label} onChange={(e) => setForm({ ...form, sensitivity_label: e.target.value })}>
                {SENSITIVITY_OPTIONS.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LABEL_CLS}>Model *</label>
            {catalog === null ? (
              <div className={`${INPUT_CLS} text-text-subtle text-[12px] flex items-center gap-2`}>
                <Loader2 size={12} strokeWidth={1.5} className="animate-spin" />
                Loading supported models…
              </div>
            ) : catalogError ? (
              // Graceful fallback: catalog unreachable → free-text entry so a
              // transient outage doesn't block creating a service. Warning
              // banner tells the user exactly why they're seeing plain text.
              <>
                <input
                  className={`${INPUT_CLS} font-mono`}
                  placeholder="claude-sonnet-4-6"
                  value={form.model_name}
                  onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                  required
                />
                <p className="mt-1.5 text-[11px] text-status-degraded flex items-start gap-1.5">
                  <AlertCircle size={11} strokeWidth={2} className="shrink-0 mt-0.5" />
                  Catalog unreachable ({catalogError}) — entering free text. Double-check spelling; typos fall back to Sonnet pricing.
                </p>
              </>
            ) : (
              <>
                <select
                  className={`${INPUT_CLS} font-mono`}
                  value={form.model_name}
                  onChange={(e) => setForm({ ...form, model_name: e.target.value })}
                  required
                >
                  {/* If editing an existing service with an id that isn't in
                      the current catalog (e.g. legacy dated id from seed
                      data), preserve it as a selectable option so the edit
                      doesn't silently change the model. */}
                  {form.model_name && !catalog.some((m) => m.id === form.model_name) && (
                    <option value={form.model_name}>
                      {form.model_name} (not in catalog)
                    </option>
                  )}
                  {catalog.map((m) => (
                    // Keep the option label clean — just "Sonnet 4.6",
                    // "Haiku 4.5". Pricing + role hint used to be jammed
                    // into the option text, which made the dropdown line
                    // hard to scan; the detail is still one click away on
                    // Settings → Models and in the pricing tooltip below.
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {/* Live hint below the select — reflects the currently
                    selected model's pricing + role. Gives context without
                    cluttering the option list. */}
                {(() => {
                  const selected = catalog.find((m) => m.id === form.model_name);
                  if (!selected) return null;
                  return (
                    <p className="mt-1.5 text-[11px] text-text-subtle">
                      <span className="font-mono">${selected.pricing.input_per_million_usd}</span>/
                      <span className="font-mono">${selected.pricing.output_per_million_usd}</span> per 1M tokens
                      {' · recommended for '}
                      <span className="font-medium text-text-muted">{selected.recommended_for}</span>.
                      {' Supported Anthropic models only (see '}
                      <code className="font-mono">model_catalog.py</code>).
                    </p>
                  );
                })()}
              </>
            )}
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteConfirmId} onClose={closeDeleteConfirm} title="Delete service" maxWidth="max-w-sm" footer={
        <>
          <button onClick={closeDeleteConfirm} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard">
            Cancel
          </button>
          <button onClick={handleDelete} className="px-4 py-1.5 bg-status-failing text-white text-[12px] font-medium rounded-pill hover:opacity-90 transition-standard">
            Delete
          </button>
        </>
      }>
        <p className="text-sm text-text-muted">
          This will permanently remove the service and its connection logs. This action cannot be undone.
        </p>
        {deleteError && (
          <div role="alert" className="mt-3 flex items-start gap-2 px-3 py-2 text-[12px] text-status-failing bg-status-failing-muted border border-status-failing/30 rounded-md">
            <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" />
            <span>{deleteError}</span>
          </div>
        )}
      </Modal>

      {/* Confidential Ping override — admin-only path through the
          sensitivity gate. Backend rejects without this flag. */}
      <ConfirmModal
        isOpen={!!confidentialPingTarget}
        onClose={() => setConfidentialPingTarget(null)}
        onConfirm={confirmConfidentialPing}
        title="Confidential service — live Claude call"
        variant="warning"
        confirmLabel="Run live check"
        description={
          confidentialPingTarget
            ? `"${confidentialPingTarget.name}" is labelled confidential. This runs a LIVE Claude call against ${confidentialPingTarget.model_name} (not a cheap HTTP probe): expect ~1–2 seconds and ~$0.0002 of real API spend. Only admins can override, and every override is recorded in the audit log.`
            : ''
        }
      />

      {toast.visible && (
        <Toast
          message={toast.message}
          type={toast.type}
          // Errors often contain validation detail users need time to read —
          // 10s for errors, 4s for success/info so happy-path isn't sticky.
          duration={toast.type === 'error' ? 10000 : 4000}
          onClose={() => setToast({ visible: false, message: '', type: 'info' })}
        />
      )}
    </div>
  );
}
