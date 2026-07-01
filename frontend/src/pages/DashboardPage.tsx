import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useFetch, errMsg } from '../lib/useFetch';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  ErrorBlock,
  LoadingBlock,
  Spinner,
  Toggle,
} from '../components/ui';
import { Tabs } from '../components/Tabs';
import type { FullScanState, LogsResponse, Stats } from '../lib/types';

function StatCard({
  label,
  value,
  tone = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'violet';
  icon?: ReactNode;
}) {
  const tones = {
    default: { text: 'text-slate-50', glow: 'from-brand-500/25' },
    green: { text: 'text-emerald-300', glow: 'from-emerald-500/25' },
    amber: { text: 'text-amber-300', glow: 'from-amber-500/25' },
    red: { text: 'text-rose-300', glow: 'from-rose-500/25' },
    violet: { text: 'text-brand-300', glow: 'from-brand-500/25' },
  };
  const t = tones[tone];
  return (
    <Card className="relative overflow-hidden p-4">
      <div
        className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${t.glow} to-transparent blur-2xl`}
      />
      <div className="relative flex items-center justify-between">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        {icon}
      </div>
      <p className={`relative mt-2 text-3xl font-bold ${t.text}`}>{value}</p>
    </Card>
  );
}

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2.5 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium text-slate-100">{children}</span>
    </div>
  );
}

export default function DashboardPage() {
  const toast = useToast();
  const [platform, setPlatform] = useState<'' | 'flarum' | 'xenforo'>('');
  const statsFetch = useFetch<Stats>(useCallback(() => api.getStats(platform), [platform]));
  const recentFetch = useFetch<LogsResponse>(
    useCallback(() => api.getLogs({ violation: true, limit: 5 }), []),
  );

  const [savingToggle, setSavingToggle] = useState(false);

  const [fullScan, setFullScan] = useState<FullScanState | null>(null);
  const [fullBusy, setFullBusy] = useState(false);

  const stats = statsFetch.data;

  const pollFull = useCallback(async () => {
    try {
      const st = await api.scanFullStatus();
      setFullScan(st);
      return st;
    } catch {
      return null;
    }
  }, []);

  // Poll full-scan progress: fast while running, slow when idle.
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const loop = async () => {
      if (!active) return;
      const st = await pollFull();
      timer = window.setTimeout(loop, st?.running ? 2000 : 10000);
    };
    void loop();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [pollFull]);

  async function startFull() {
    setFullBusy(true);
    try {
      const res = await api.scanFullStart();
      if (!res.ok) {
        toast.error(res.error || 'Không khởi động được');
        return;
      }
      toast.success('Đã bắt đầu quét toàn bộ');
      await pollFull();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setFullBusy(false);
    }
  }

  async function stopFull() {
    setFullBusy(true);
    try {
      await api.scanFullStop();
      toast.success('Đang dừng quét…');
      await pollFull();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setFullBusy(false);
    }
  }

  async function toggleModeration(next: boolean) {
    setSavingToggle(true);
    try {
      await api.updateSettings({ moderation_enabled: next });
      toast.success(next ? 'Đã bật kiểm duyệt' : 'Đã tắt kiểm duyệt');
      statsFetch.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSavingToggle(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Tổng quan"
        description="Trạng thái hệ thống kiểm duyệt và các số liệu quan trọng."
        action={
          <Button variant="secondary" size="sm" onClick={statsFetch.reload}>
            Làm mới
          </Button>
        }
      />

      {statsFetch.loading && !stats ? (
        <LoadingBlock />
      ) : statsFetch.error ? (
        <ErrorBlock message={statsFetch.error} onRetry={statsFetch.reload} />
      ) : stats ? (
        <div className="space-y-6">
          {/* Master toggle */}
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-11 w-11 flex-none items-center justify-center rounded-xl ${
                    stats.status.enabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/10 text-slate-400'
                  }`}
                >
                  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="text-base font-semibold text-slate-50">Bật/Tắt kiểm duyệt</p>
                  <p className="text-sm text-slate-400">
                    {stats.status.enabled
                      ? 'Bot đang theo dõi và xử lý nội dung vi phạm.'
                      : 'Bot hiện đang tắt — không có nội dung nào được xử lý.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {savingToggle && <Spinner className="h-4 w-4" />}
                <Toggle
                  size="lg"
                  checked={stats.status.enabled}
                  disabled={savingToggle}
                  onChange={toggleModeration}
                />
                <Badge tone={stats.status.enabled ? 'green' : 'gray'}>
                  {stats.status.enabled ? 'Đang bật' : 'Đang tắt'}
                </Badge>
              </div>
            </div>
          </Card>

          {/* Full-forum scan */}
          <Card>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Quét toàn bộ diễn đàn</h3>
              <p className="mt-0.5 text-sm text-slate-400">
                Duyệt <strong>mọi thread + bình luận</strong> y hệt "Quét theo link", cho mọi nền
                tảng <strong>đã kết nối</strong> (Flarum và/hoặc XenForo). Chạy ngầm — rời trang vẫn
                tiếp tục, dừng được bất cứ lúc nào.
              </p>
            </div>
            <div className="space-y-4 p-5">
              {fullScan?.running ? (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    <Spinner className="h-4 w-4" />
                    <span className="font-medium text-brand-300">
                      Đang quét {fullScan.platform || '…'}
                    </span>
                  </div>
                  {fullScan.current_thread && (
                    <p className="truncate text-xs text-slate-400">
                      Thread: {fullScan.current_thread}
                    </p>
                  )}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full w-1/3 animate-[loading_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-brand-500 to-violet-500" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="violet">Thread: {fmtNumber(fullScan.threads)}</Badge>
                    <Badge tone="gray">Đã chấm: {fmtNumber(fullScan.scanned)}</Badge>
                    <Badge tone="red">Vi phạm: {fmtNumber(fullScan.violations)}</Badge>
                    <Badge tone="amber">Đã ẩn: {fmtNumber(fullScan.hidden)}</Badge>
                    {fullScan.approved > 0 && (
                      <Badge tone="green">Đã duyệt: {fmtNumber(fullScan.approved)}</Badge>
                    )}
                  </div>
                  {fullScan.last_error && (
                    <p className="text-xs text-rose-300">Lỗi gần nhất: {fullScan.last_error}</p>
                  )}
                  <Button variant="danger" onClick={stopFull} loading={fullBusy}>
                    Dừng quét
                  </Button>
                </>
              ) : (
                <>
                  {fullScan?.done && (
                    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                      {fullScan.stopped ? 'Đã dừng' : 'Hoàn tất'} · {fmtNumber(fullScan.threads)}{' '}
                      thread · chấm {fmtNumber(fullScan.scanned)} bài ·{' '}
                      {fmtNumber(fullScan.violations)} vi phạm · ẩn {fmtNumber(fullScan.hidden)}
                      {fullScan.approved > 0 && ` · duyệt ${fmtNumber(fullScan.approved)}`}
                    </div>
                  )}
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    ⚠️ Mỗi bài tốn 1 lượt gọi AI (tốn phí). Forum lớn → chạy lâu &amp; tốn nhiều
                    token. Vi phạm bị ẩn, bài hợp lệ đang chờ được duyệt (nếu bật "Tự động ẩn").
                  </p>
                  <Button onClick={startFull} loading={fullBusy} disabled={!stats.status.ai_configured}>
                    Bắt đầu quét toàn bộ
                  </Button>
                  {!stats.status.ai_configured && (
                    <p className="text-xs text-slate-400">
                      Cần cấu hình AI + kết nối ít nhất 1 forum (Flarum hoặc XenForo) trước.
                    </p>
                  )}
                </>
              )}
            </div>
          </Card>

          {/* Forum selector — báo cáo theo diễn đàn */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-400">Báo cáo theo:</span>
            <Tabs<'' | 'flarum' | 'xenforo'>
              value={platform}
              onChange={setPlatform}
              items={[
                { value: '', label: 'Tất cả' },
                { value: 'flarum', label: 'Flarum' },
                { value: 'xenforo', label: 'XenForo' },
              ]}
            />
            {statsFetch.loading && <Spinner className="h-4 w-4" />}
          </div>

          {/* Number stats */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Tổng đã quét" value={fmtNumber(stats.stats.total_checked)} tone="violet" />
            <StatCard label="Tổng vi phạm" value={fmtNumber(stats.stats.total_violations)} tone="amber" />
            <StatCard label="Tổng đã ẩn" value={fmtNumber(stats.stats.total_hidden)} tone="red" />
            <StatCard label="User bị gắn cờ" value={fmtNumber(stats.stats.flagged_users)} tone="red" />
          </div>

          {/* System status */}
          <Card>
              <div className="border-b border-white/10 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-50">Trạng thái hệ thống</h3>
              </div>
              <div className="px-5 py-2">
                <StatusRow label="Trạng thái bot">
                  <Badge tone={stats.status.enabled ? 'green' : 'gray'}>
                    {stats.status.enabled ? 'Đang bật' : 'Đang tắt'}
                  </Badge>
                </StatusRow>
                <StatusRow label="Worker">
                  <Badge tone={stats.worker.running ? 'green' : 'gray'}>
                    {stats.worker.running ? 'Đang chạy' : 'Dừng'}
                  </Badge>
                </StatusRow>
                <StatusRow label="Diễn đàn">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Badge tone={stats.status.flarum_connected ? 'green' : 'gray'}>
                      Flarum {stats.status.flarum_connected ? '✓' : '✕'}
                    </Badge>
                    <Badge tone={stats.status.xenforo_connected ? 'green' : 'gray'}>
                      XenForo {stats.status.xenforo_connected ? '✓' : '✕'}
                    </Badge>
                  </div>
                </StatusRow>
                <StatusRow label="AI đã cấu hình">
                  {stats.status.ai_configured ? (
                    <Badge tone="blue">
                      {stats.status.provider} · {stats.status.model}
                    </Badge>
                  ) : (
                    <Badge tone="red">Chưa cấu hình</Badge>
                  )}
                </StatusRow>
                <StatusRow label="Ngưỡng vi phạm">{stats.status.threshold}%</StatusRow>
                <StatusRow label="Chu kỳ quét">{stats.status.poll_interval}s</StatusRow>
                <StatusRow label="Lần quét gần nhất">{fmtDateTime(stats.stats.last_poll_at)}</StatusRow>
                <StatusRow label="Lỗi gần nhất">
                  {stats.stats.last_error || stats.worker.last_error ? (
                    <span className="text-rose-300">
                      {stats.stats.last_error || stats.worker.last_error}
                    </span>
                  ) : (
                    <span className="text-emerald-300">Không có</span>
                  )}
                </StatusRow>
              </div>
          </Card>

          {/* Recent violations */}
          <Card>
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Vi phạm gần đây</h3>
              <Link to="/logs" className="text-sm font-medium text-brand-300 hover:underline">
                Xem tất cả →
              </Link>
            </div>
            {recentFetch.loading ? (
              <LoadingBlock />
            ) : recentFetch.error ? (
              <div className="p-5">
                <ErrorBlock message={recentFetch.error} onRetry={recentFetch.reload} />
              </div>
            ) : recentFetch.data && recentFetch.data.items.length > 0 ? (
              <ul className="divide-y divide-white/5">
                {recentFetch.data.items.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                    <ConfidenceBadge value={log.confidence} threshold={stats.status.threshold} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">
                        {log.author_username || 'Ẩn danh'}{' '}
                        <span className="font-normal text-slate-400">· {log.post_type}</span>
                      </p>
                      <p className="truncate text-sm text-slate-400">{log.reason || log.content_excerpt}</p>
                    </div>
                    <span className="flex-none text-xs text-slate-400">{fmtDateTime(log.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-5 py-10 text-center text-sm text-slate-400">
                Chưa có vi phạm nào được ghi nhận.
              </div>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
