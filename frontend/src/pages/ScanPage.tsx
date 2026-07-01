import { useState } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/useFetch';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, ConfidenceBadge, Input, Toggle } from '../components/ui';
import type { ScanAction, ScanItem, ScanReport } from '../lib/types';

export default function ScanPage() {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [auto, setAuto] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [acting, setActing] = useState<number | null>(null);

  async function scan() {
    if (!url.trim()) {
      toast.error('Dán link thread cần kiểm tra');
      return;
    }
    setScanning(true);
    setReport(null);
    try {
      const res = await api.scanUrl(url.trim(), auto);
      if (!res.ok) {
        toast.error(res.error || 'Quét thất bại');
        return;
      }
      setReport(res);
      toast.success(
        `Quét xong: ${res.scanned} bài · ${res.violations} vi phạm` +
          (res.auto ? ` · ẩn ${res.hidden} · duyệt ${res.approved}` : ''),
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setScanning(false);
    }
  }

  function patchItem(postId: number, patch: Partial<ScanItem>) {
    setReport((prev) =>
      prev
        ? { ...prev, items: prev.items.map((it) => (it.post_id === postId ? { ...it, ...patch } : it)) }
        : prev,
    );
  }

  async function act(item: ScanItem, action: ScanAction) {
    setActing(item.post_id);
    try {
      await api.scanPostAction(item, action);
      if (action === 'hide') patchItem(item.post_id, { hidden: true });
      else if (action === 'approve') patchItem(item.post_id, { pending: false });
      else if (action === 'restore') patchItem(item.post_id, { hidden: false });
      toast.success(
        action === 'hide' ? 'Đã ẩn bài' : action === 'approve' ? 'Đã duyệt bài' : 'Đã bỏ ẩn',
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setActing(null);
    }
  }

  async function bulk(targets: ScanItem[], action: ScanAction, label: string) {
    if (targets.length === 0) return;
    setScanning(true);
    try {
      for (const it of targets) {
        await api.scanPostAction(it, action);
        if (action === 'hide') patchItem(it.post_id, { hidden: true });
        else if (action === 'approve') patchItem(it.post_id, { pending: false });
      }
      toast.success(`Đã ${label} ${targets.length} bài`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setScanning(false);
    }
  }

  const items = report?.items ?? [];
  const violations = items.filter((it) => it.violation);
  const cleanPending = items.filter((it) => !it.violation && it.pending && !it.skipped && !it.error);
  const cleanLive = items.filter((it) => !it.violation && !it.pending && !it.skipped && !it.error);
  const toHide = violations.filter((it) => !it.hidden && !it.already_hidden);

  return (
    <div>
      <PageHeader
        title="Quét theo link"
        description="Dán link một thread (Flarum hoặc XenForo). AI kiểm tra bài gốc + toàn bộ bình luận: vi phạm thì ẩn, bài hợp lệ đang chờ duyệt thì cho duyệt — thủ công hoặc tự động."
      />

      <Card className="mb-6">
        <div className="space-y-4 p-5">
          <Input
            label="Link thread"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://community.9bricks.com/d/6-... hoặc https://forum/threads/tieu-de.42/"
            hint="Hỗ trợ Flarum (.../d/{id}-...) và XenForo (.../threads/...{id}/)."
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Toggle
              checked={auto}
              onChange={setAuto}
              label="Tự động xử lý (ẩn vi phạm + duyệt bài hợp lệ đang chờ)"
            />
            <Button onClick={scan} loading={scanning}>
              {scanning ? 'Đang quét…' : 'Quét ngay'}
            </Button>
          </div>
          {auto && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              ⚠️ Chế độ tự động: bài vi phạm bị ẩn + cảnh báo ngay; bài hợp lệ đang chờ duyệt sẽ
              được cho hiển thị — không hỏi lại.
            </p>
          )}
        </div>
      </Card>

      {report && (
        <div className="space-y-5">
          {/* Summary */}
          <Card>
            <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge tone="violet">{report.platform}</Badge>
                  <span className="truncate text-sm font-semibold text-slate-50">
                    {report.title || `Thread #${report.thread_id}`}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  {report.total} bài · {report.scanned} đã chấm ·{' '}
                  <span className={report.violations > 0 ? 'text-rose-300' : 'text-emerald-300'}>
                    {report.violations} vi phạm
                  </span>
                  {cleanPending.length > 0 && ` · ${cleanPending.length} chờ duyệt`}
                  {report.auto && ` · đã ẩn ${report.hidden} · đã duyệt ${report.approved}`}
                </p>
              </div>
              <div className="flex flex-none flex-wrap gap-2">
                {toHide.length > 0 && (
                  <Button variant="danger" onClick={() => bulk(toHide, 'hide', 'ẩn')} loading={scanning}>
                    Ẩn tất cả vi phạm ({toHide.length})
                  </Button>
                )}
                {cleanPending.length > 0 && (
                  <Button
                    variant="success"
                    onClick={() => bulk(cleanPending, 'approve', 'duyệt')}
                    loading={scanning}
                  >
                    Duyệt tất cả hợp lệ ({cleanPending.length})
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Violations */}
          {violations.map((it) => {
            const hidden = it.hidden || it.already_hidden;
            return (
              <Card key={it.post_id} className="border-rose-500/30">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone="red">Vi phạm</Badge>
                      {typeof it.confidence === 'number' && <ConfidenceBadge value={it.confidence} />}
                      {it.severity && <Badge tone="amber">{it.severity}</Badge>}
                      <Badge tone="gray">
                        {it.is_first_post ? 'Bài gốc' : 'Bình luận'} · #{it.post_id}
                      </Badge>
                      {it.pending && <Badge tone="amber">Chờ duyệt</Badge>}
                      <span className="text-xs text-slate-400">@{it.author_username || 'ẩn danh'}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{it.excerpt}</p>
                    {it.reason && (
                      <p className="mt-1.5 text-xs text-slate-400">
                        <span className="font-semibold text-slate-300">Lý do:</span> {it.reason}
                      </p>
                    )}
                  </div>
                  <div className="flex-none">
                    {hidden ? (
                      <div className="flex items-center gap-2">
                        <Badge tone="green">Đã ẩn</Badge>
                        {!it.already_hidden && (
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={acting === it.post_id}
                            onClick={() => act(it, 'restore')}
                          >
                            Bỏ ẩn
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button
                        variant="danger"
                        size="sm"
                        loading={acting === it.post_id}
                        onClick={() => act(it, 'hide')}
                      >
                        Ẩn bài
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}

          {/* Clean but pending approval */}
          {cleanPending.map((it) => (
            <Card key={it.post_id} className="border-brand-500/30">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone="green">Hợp lệ</Badge>
                    <Badge tone="amber">Chờ duyệt</Badge>
                    {typeof it.confidence === 'number' && <ConfidenceBadge value={it.confidence} />}
                    <Badge tone="gray">
                      {it.is_first_post ? 'Bài gốc' : 'Bình luận'} · #{it.post_id}
                    </Badge>
                    <span className="text-xs text-slate-400">@{it.author_username || 'ẩn danh'}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-300">{it.excerpt}</p>
                </div>
                <div className="flex-none">
                  <Button
                    variant="success"
                    size="sm"
                    loading={acting === it.post_id}
                    onClick={() => act(it, 'approve')}
                  >
                    Duyệt bài
                  </Button>
                </div>
              </div>
            </Card>
          ))}

          {violations.length === 0 && cleanPending.length === 0 && (
            <Card>
              <div className="p-6 text-center text-sm text-emerald-300">
                ✓ Không có vi phạm và không có bài nào đang chờ duyệt.
              </div>
            </Card>
          )}

          {/* Clean, already live */}
          {cleanLive.length > 0 && (
            <Card>
              <details className="group">
                <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm font-medium text-slate-300 hover:text-slate-100">
                  <span>Bài hợp lệ, đang hiển thị ({cleanLive.length})</span>
                  <span className="text-slate-500 transition group-open:rotate-90">›</span>
                </summary>
                <ul className="divide-y divide-white/5 border-t border-white/10">
                  {cleanLive.map((it) => (
                    <li key={it.post_id} className="flex items-center gap-3 px-5 py-2.5">
                      {typeof it.confidence === 'number' && <ConfidenceBadge value={it.confidence} />}
                      <span className="text-xs text-slate-400">
                        @{it.author_username || 'ẩn danh'} · #{it.post_id}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-slate-400">{it.excerpt}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
