import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { errMsg } from '../lib/useFetch';
import { fmtDateTime } from '../lib/format';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  ConfidenceBadge,
  EmptyBlock,
  ErrorBlock,
  Input,
  LoadingBlock,
  Spinner,
  Toggle,
} from '../components/ui';
import { Table, TBody, TD, TH, THead, TR } from '../components/Table';
import type { LogEntry } from '../lib/types';

const PAGE_SIZE = 20;

function severityTone(s: string): 'gray' | 'amber' | 'red' | 'blue' {
  const v = s.toLowerCase();
  if (v === 'high' || v === 'cao') return 'red';
  if (v === 'medium' || v === 'trung bình' || v === 'trung binh') return 'amber';
  if (v === 'low' || v === 'thấp' || v === 'thap') return 'blue';
  return 'gray';
}

type Tone = 'gray' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

// Friendly label + colour for the moderation source.
function sourceLabel(s: string): { label: string; tone: Tone } {
  switch (s) {
    case 'live':
      return { label: 'Tự động · Flarum', tone: 'blue' };
    case 'backfill':
      return { label: 'Quét lại', tone: 'violet' };
    case 'full-scan':
      return { label: 'Quét toàn bộ', tone: 'violet' };
    case 'scan-url':
      return { label: 'Quét theo link', tone: 'violet' };
    case 'xenforo-ingest':
      return { label: 'XenForo Add-on', tone: 'amber' };
    default:
      return { label: s || '—', tone: 'gray' };
  }
}

// Each action_taken is a "+"-joined list of atoms; map them to clear labels so a
// permission failure (hide_failed / approve_failed) is obvious in the log.
const ACTION_PARTS: Record<string, { label: string; tone: Tone }> = {
  hidden: { label: 'Đã ẩn', tone: 'amber' },
  hide_failed: { label: 'Ẩn lỗi (thiếu quyền?)', tone: 'red' },
  notified: { label: 'Đã cảnh báo', tone: 'blue' },
  notify_failed: { label: 'Cảnh báo lỗi (quyền?)', tone: 'red' },
  flagged_only: { label: 'Gắn cờ', tone: 'gray' },
  manual_hide: { label: 'Ẩn thủ công', tone: 'amber' },
  manual_unhide: { label: 'Bỏ ẩn', tone: 'gray' },
  approved: { label: 'Đã duyệt', tone: 'green' },
  auto_approved: { label: 'Tự duyệt', tone: 'green' },
  approve_failed: { label: 'Duyệt lỗi (quyền?)', tone: 'red' },
  restored: { label: 'Khôi phục', tone: 'gray' },
  none: { label: 'Ghi nhận', tone: 'gray' },
};

function actionParts(a: string): { label: string; tone: Tone }[] {
  if (!a) return [{ label: '—', tone: 'gray' }];
  return a.split('+').map((p) => ACTION_PARTS[p.trim()] ?? { label: p.trim(), tone: 'gray' });
}

function ActionBadges({ action }: { action: string }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {actionParts(action).map((p, i) => (
        <Badge key={i} tone={p.tone}>
          {p.label}
        </Badge>
      ))}
    </div>
  );
}

function SourceBadge({ source }: { source: string }) {
  const s = sourceLabel(source);
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export default function LogsPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [violationOnly, setViolationOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  const [items, setItems] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<LogEntry | null>(null);

  const load = useCallback(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getLogs({ limit: PAGE_SIZE, offset, violation: violationOnly, q: search })
      .then((res) => {
        if (!active) return;
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((e: unknown) => {
        if (active) setError(errMsg(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [offset, violationOnly, search]);

  useEffect(() => load(), [load]);

  function applySearch() {
    setOffset(0);
    setSearch(q.trim());
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Nhật ký kiểm duyệt"
        description="Lịch sử các nội dung đã được AI quét và xử lý."
      />

      <Card className="mb-4">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative flex-1 sm:max-w-md">
              <Input
                placeholder="Tìm theo tác giả, nội dung, lý do…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applySearch();
                }}
              />
            </div>
            <Button variant="secondary" onClick={applySearch}>
              Tìm
            </Button>
          </div>
          <Toggle
            checked={violationOnly}
            onChange={(v) => {
              setOffset(0);
              setViolationOnly(v);
            }}
            label="Chỉ vi phạm"
          />
        </div>
      </Card>

      <Card>
        {loading && items.length === 0 ? (
          <LoadingBlock />
        ) : error ? (
          <div className="p-5">
            <ErrorBlock message={error} onRetry={load} />
          </div>
        ) : items.length === 0 ? (
          <EmptyBlock message="Không có bản ghi nào khớp với bộ lọc." />
        ) : (
          <>
            <Table>
              <THead>
                <TH>Thời gian</TH>
                <TH>Tác giả</TH>
                <TH>Loại</TH>
                <TH>Confidence</TH>
                <TH>Mức độ</TH>
                <TH>Hành động</TH>
                <TH>Nguồn</TH>
              </THead>
              <TBody>
                {items.map((log) => (
                  <TR key={log.id} onClick={() => setSelected(log)}>
                    <TD className="whitespace-nowrap text-slate-400">{fmtDateTime(log.created_at)}</TD>
                    <TD className="font-medium text-slate-100">{log.author_username || 'Ẩn danh'}</TD>
                    <TD>
                      <Badge tone="gray">{log.post_type || '—'}</Badge>
                    </TD>
                    <TD>
                      <ConfidenceBadge value={log.confidence} />
                    </TD>
                    <TD>
                      {log.severity ? (
                        <Badge tone={severityTone(log.severity)}>{log.severity}</Badge>
                      ) : (
                        '—'
                      )}
                    </TD>
                    <TD>
                      <ActionBadges action={log.action_taken} />
                    </TD>
                    <TD>
                      <SourceBadge source={log.source} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            <div className="flex items-center justify-between border-t border-white/10 px-4 py-3 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                {loading && <Spinner className="h-4 w-4" />}
                <span>
                  Tổng {total.toLocaleString('vi-VN')} bản ghi · Trang {page}/{totalPages}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                >
                  ← Trước
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={offset + PAGE_SIZE >= total || loading}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                >
                  Sau →
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {selected && (
        <LogDetailModal
          logId={selected.id}
          onClose={() => setSelected(null)}
          onChanged={() => {
            load();
          }}
          onToast={(kind, msg) => (kind === 'success' ? toast.success(msg) : toast.error(msg))}
        />
      )}
    </div>
  );
}

function LogDetailModal({
  logId,
  onClose,
  onChanged,
  onToast,
}: {
  logId: number;
  onClose: () => void;
  onChanged: () => void;
  onToast: (kind: 'success' | 'error', msg: string) => void;
}) {
  const [log, setLog] = useState<LogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getLog(logId)
      .then((res) => {
        if (active) setLog(res);
      })
      .catch((e: unknown) => {
        if (active) setError(errMsg(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [logId]);

  async function doHide(hide: boolean) {
    setBusy(true);
    try {
      if (hide) await api.hideLog(logId);
      else await api.unhideLog(logId);
      onToast('success', hide ? 'Đã ẩn bài viết' : 'Đã bỏ ẩn bài viết');
      onChanged();
      // refresh local
      const fresh = await api.getLog(logId);
      setLog(fresh);
    } catch (e) {
      onToast('error', errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const categories = log?.categories
    ? log.categories.split(',').map((c) => c.trim()).filter(Boolean)
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      title="Chi tiết bản ghi"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button variant="success" loading={busy} onClick={() => doHide(false)}>
            Bỏ ẩn
          </Button>
          <Button variant="danger" loading={busy} onClick={() => doHide(true)}>
            Ẩn bài
          </Button>
        </>
      }
    >
      {loading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={error} />
      ) : log ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <ConfidenceBadge value={log.confidence} />
            {log.severity && <Badge tone={severityTone(log.severity)}>{log.severity}</Badge>}
            <Badge tone={log.violation ? 'red' : 'green'}>
              {log.violation ? 'Vi phạm' : 'Hợp lệ'}
            </Badge>
            {log.action_taken && <ActionBadges action={log.action_taken} />}
            <SourceBadge source={log.source} />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <Field label="Tác giả" value={log.author_username || 'Ẩn danh'} />
            <Field label="User ID" value={String(log.author_user_id)} />
            <Field label="Loại" value={log.post_type || '—'} />
            <Field label="Thời gian" value={fmtDateTime(log.created_at)} />
            <Field label="Mô hình AI" value={`${log.ai_provider} · ${log.ai_model}`} />
            <Field label="Post ID" value={String(log.post_id)} />
          </dl>

          {log.discussion_title && (
            <Field label="Chủ đề" value={log.discussion_title} block />
          )}

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Nội dung trích
            </p>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
              {log.content_excerpt || '—'}
            </div>
          </div>

          {log.reason && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Lý do</p>
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {log.reason}
              </p>
            </div>
          )}

          {categories.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Phân loại
              </p>
              <div className="flex flex-wrap gap-1.5">
                {categories.map((c) => (
                  <Badge key={c} tone="red">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {log.message_to_user && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Thông báo cho user
              </p>
              <p className="whitespace-pre-wrap rounded-lg border border-brand-500/30 bg-brand-500/15 px-3 py-2 text-sm text-brand-200">
                {log.message_to_user}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function Field({ label, value, block }: { label: string; value: string; block?: boolean }) {
  return (
    <div className={block ? 'col-span-full' : ''}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-300">{value}</dd>
    </div>
  );
}
