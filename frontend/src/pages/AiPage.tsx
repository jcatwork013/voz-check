import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useFetch, errMsg } from '../lib/useFetch';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  ErrorBlock,
  Input,
  LoadingBlock,
  Select,
  Textarea,
  Toggle,
} from '../components/ui';
import type { AiProvider, AiValidateResponse, AiVerdict, Settings } from '../lib/types';

/** Curated, known-good models per provider. "" = the "tự nhập" (custom) escape hatch. */
const MODEL_OPTIONS: Record<AiProvider, string[]> = {
  gemini: [
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
};

const DEFAULT_MODEL: Record<AiProvider, string> = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
};

const CUSTOM = '__custom__';

export default function AiPage() {
  const toast = useToast();
  const settingsFetch = useFetch<Settings>(useCallback(() => api.getSettings(), []));

  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);

  const [threshold, setThreshold] = useState(75);
  const [pollInterval, setPollInterval] = useState(10);
  const [suspendThreshold, setSuspendThreshold] = useState(3);
  const [autoHide, setAutoHide] = useState(true);
  const [notifyUser, setNotifyUser] = useState(true);

  const [saving, setSaving] = useState(false);

  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState<AiValidateResponse | null>(null);

  const [sample, setSample] = useState('');
  const [testing, setTesting] = useState(false);
  const [verdict, setVerdict] = useState<AiVerdict | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testMeta, setTestMeta] = useState<{ provider: string; model: string } | null>(null);

  // The Select shows the model when it's a known one, otherwise "tự nhập" mode.
  const isCustomModel = model !== '' && !MODEL_OPTIONS[provider].includes(model);

  useEffect(() => {
    const d = settingsFetch.data;
    if (!d) return;
    setProvider(d.ai.provider);
    setModel(d.ai.model);
    setHasKey(d.ai.has_key);
    setThreshold(d.moderation.violation_threshold);
    setPollInterval(d.moderation.poll_interval_seconds);
    setSuspendThreshold(d.moderation.strike_suspend_threshold);
    setAutoHide(d.moderation.auto_hide);
    setNotifyUser(d.moderation.notify_user);
  }, [settingsFetch.data]);

  async function save() {
    setSaving(true);
    try {
      await api.updateSettings({
        ai_provider: provider,
        ai_model: model.trim(),
        ...(apiKey.trim() ? { ai_api_key: apiKey.trim() } : {}),
        violation_threshold: threshold,
        poll_interval_seconds: pollInterval,
        strike_suspend_threshold: suspendThreshold,
        auto_hide: autoHide,
        notify_user: notifyUser,
      });
      toast.success('Đã lưu cấu hình AI');
      setApiKey('');
      settingsFetch.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  // Switching provider resets the model to that provider's default so we never
  // leave e.g. a Gemini model selected under OpenAI.
  function changeProvider(next: AiProvider) {
    setProvider(next);
    setModel(DEFAULT_MODEL[next]);
    setValidateResult(null);
  }

  // One-click connect: validate the key, and ONLY if it really works, persist it
  // immediately. This collapses the old "Kiểm tra → (nhớ) Lưu" two-step (which
  // silently left an unsaved key behind) into a single, hard-to-misuse action.
  async function connectAI() {
    if (!apiKey.trim() && !hasKey) {
      toast.error('Hãy nhập API key trước khi kết nối');
      return;
    }
    setValidating(true);
    setValidateResult(null);
    try {
      const res = await api.validateAi({
        provider,
        model: model.trim(),
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
      });
      setValidateResult(res);
      if (!res.ok) {
        toast.error(res.error || 'API không hợp lệ — chưa lưu');
        return;
      }
      // Valid → save provider + model + key in the same click.
      await api.updateSettings({
        ai_provider: provider,
        ai_model: model.trim(),
        ...(apiKey.trim() ? { ai_api_key: apiKey.trim() } : {}),
      });
      toast.success('Đã kết nối AI & lưu ✓');
      setApiKey('');
      settingsFetch.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setValidating(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setVerdict(null);
    setTestError(null);
    try {
      const res = await api.testAi(sample.trim() || undefined);
      if (!res.ok || !res.verdict) {
        const msg = res.error || 'AI test thất bại';
        setTestError(msg);
        toast.error(msg);
        return;
      }
      setVerdict(res.verdict);
      setTestMeta({ provider: res.provider, model: res.model });
      toast.success('Đã chạy thử AI thành công');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Cấu hình AI"
        description="Chọn nhà cung cấp, mô hình và các ngưỡng xử lý cho bot kiểm duyệt."
        action={
          <Button onClick={save} loading={saving} disabled={settingsFetch.loading}>
            Lưu
          </Button>
        }
      />

      {settingsFetch.loading && !settingsFetch.data ? (
        <LoadingBlock />
      ) : settingsFetch.error ? (
        <ErrorBlock message={settingsFetch.error} onRetry={settingsFetch.reload} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Provider config */}
          <Card>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Nhà cung cấp & Mô hình</h3>
            </div>
            <div className="space-y-4 p-5">
              <Select
                label="Nhà cung cấp"
                value={provider}
                onChange={(e) => changeProvider(e.target.value as AiProvider)}
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
              </Select>

              <div>
                <Select
                  label="Mô hình (model)"
                  value={isCustomModel ? CUSTOM : model}
                  onChange={(e) => {
                    const v = e.target.value;
                    setModel(v === CUSTOM ? '' : v);
                    setValidateResult(null);
                  }}
                  hint="Chọn model có sẵn, hoặc 'Tự nhập' để dùng model khác."
                >
                  {MODEL_OPTIONS[provider].map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value={CUSTOM}>Tự nhập…</option>
                </Select>
                {isCustomModel && (
                  <Input
                    className="mt-2"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={provider === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o-mini'}
                    hint="Nhập đúng tên model theo tài liệu của nhà cung cấp."
                  />
                )}
              </div>

              <div>
                <Input
                  label="API Key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setValidateResult(null);
                  }}
                  placeholder={hasKey ? '•••••••••• (để trống nếu giữ key hiện tại)' : 'Nhập API key'}
                  hint="Để trống nếu không muốn thay đổi key đang dùng."
                />
                <div className="mt-2">
                  {hasKey ? (
                    <Badge tone="green">Đã có key</Badge>
                  ) : (
                    <Badge tone="red">Chưa có key</Badge>
                  )}
                </div>
              </div>

              <div className="border-t border-white/10 pt-4">
                <Button onClick={connectAI} loading={validating}>
                  Kết nối AI
                </Button>
                <p className="mt-1.5 text-xs text-slate-400">
                  Một nút: kiểm tra key với nhà cung cấp, và nếu hợp lệ thì <b>lưu luôn</b>. Không
                  cần bấm Lưu riêng cho phần này nữa.
                </p>
                {validateResult && (
                  <div
                    className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                      validateResult.ok
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                    }`}
                  >
                    {validateResult.ok ? (
                      <span>
                        ✓ Đã kết nối — {validateResult.provider} · {validateResult.model}
                        {typeof validateResult.latency_ms === 'number' &&
                          ` · ${validateResult.latency_ms}ms`}
                      </span>
                    ) : (
                      <span className="break-words">✗ {validateResult.error}</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Thresholds */}
          <Card>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Ngưỡng & Hành vi</h3>
            </div>
            <div className="space-y-5 p-5">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-sm font-medium text-slate-300">
                    Ngưỡng % vi phạm để xử lý
                  </label>
                  <span className="text-sm font-semibold text-brand-300">{threshold}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-full accent-brand-600"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Bài có confidence ≥ ngưỡng này sẽ bị xử lý (nếu bật tự động ẩn).
                </p>
              </div>

              <Input
                label="Chu kỳ quét (giây)"
                type="number"
                min={1}
                value={pollInterval}
                onChange={(e) => setPollInterval(Number(e.target.value))}
                hint="Áp dụng cho Flarum (poll). XenForo dùng add-on real-time."
              />

              <Input
                label="Ngưỡng strike để gắn cờ / đình chỉ"
                type="number"
                min={1}
                value={suspendThreshold}
                onChange={(e) => setSuspendThreshold(Number(e.target.value))}
                hint="Số lần vi phạm tích lũy trước khi user bị gắn cờ phạt nguội."
              />

              <div className="space-y-3 border-t border-white/10 pt-4">
                <Toggle
                  checked={autoHide}
                  onChange={setAutoHide}
                  label="Tự động ẩn bài vi phạm"
                />
                <Toggle
                  checked={notifyUser}
                  onChange={setNotifyUser}
                  label="Gửi thông báo @mention cho user"
                />
              </div>
            </div>
          </Card>

          {/* Test AI */}
          <Card className="lg:col-span-2">
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Test AI</h3>
              <p className="mt-0.5 text-sm text-slate-400">
                Chạy thử một đoạn nội dung mẫu để kiểm tra cấu hình và xem AI phản hồi.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
              <div className="space-y-3">
                <Textarea
                  label="Nội dung mẫu (tuỳ chọn)"
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  rows={6}
                  placeholder="Để trống để dùng mẫu mặc định của hệ thống…"
                />
                <Button onClick={runTest} loading={testing}>
                  Chạy thử AI
                </Button>
              </div>

              <div>
                {verdict ? (
                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={verdict.violation ? 'red' : 'green'}>
                        {verdict.violation ? 'Vi phạm' : 'Hợp lệ'}
                      </Badge>
                      <ConfidenceBadge value={verdict.confidence} threshold={threshold} />
                      {verdict.severity && <Badge tone="amber">{verdict.severity}</Badge>}
                      {testMeta && (
                        <Badge tone="violet">
                          {testMeta.provider} · {testMeta.model}
                        </Badge>
                      )}
                    </div>
                    {verdict.categories && (
                      <div className="flex flex-wrap gap-1.5">
                        {/* Coerce defensively: categories may arrive as a string or array. */}
                        {String(verdict.categories)
                          .split(',')
                          .map((c) => c.trim())
                          .filter(Boolean)
                          .map((c) => (
                            <Badge key={c} tone="gray">
                              {c}
                            </Badge>
                          ))}
                      </div>
                    )}
                    {verdict.reason && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Lý do
                        </p>
                        <p className="mt-0.5 text-sm text-slate-300">{verdict.reason}</p>
                      </div>
                    )}
                    {verdict.message_to_user && (
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                          Thông báo cho user
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap rounded-lg border border-brand-500/30 bg-brand-500/15 px-3 py-2 text-sm text-brand-200">
                          {verdict.message_to_user}
                        </p>
                      </div>
                    )}
                  </div>
                ) : testError ? (
                  <div className="flex h-full min-h-[8rem] flex-col items-start justify-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    <span className="font-semibold">Chạy thử thất bại</span>
                    <span className="break-words text-rose-300">{testError}</span>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[8rem] items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/5 px-4 text-center text-sm text-slate-400">
                    Kết quả AI sẽ hiển thị ở đây sau khi chạy thử.
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
