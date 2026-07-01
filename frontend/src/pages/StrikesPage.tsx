import { useCallback, useState } from 'react';
import { api } from '../lib/api';
import { useFetch, errMsg } from '../lib/useFetch';
import { fmtDateTime } from '../lib/format';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import {
  Badge,
  Button,
  Card,
  EmptyBlock,
  ErrorBlock,
  LoadingBlock,
  Select,
  Textarea,
} from '../components/ui';
import { Table, TBody, TD, TH, THead, TR } from '../components/Table';
import type { StrikeEntry, StrikeStatus } from '../lib/types';

function statusTone(s: StrikeStatus): 'green' | 'amber' | 'red' {
  if (s === 'suspended') return 'red';
  if (s === 'flagged') return 'amber';
  return 'green';
}

function statusLabel(s: StrikeStatus): string {
  if (s === 'suspended') return 'Đình chỉ';
  if (s === 'flagged') return 'Gắn cờ';
  return 'Bình thường';
}

export default function StrikesPage() {
  const toast = useToast();
  const strikesFetch = useFetch<{ items: StrikeEntry[] }>(useCallback(() => api.getStrikes(), []));
  const [editing, setEditing] = useState<StrikeEntry | null>(null);
  const [resettingId, setResettingId] = useState<number | null>(null);

  async function resetStrike(entry: StrikeEntry) {
    if (!window.confirm(`Đặt lại strike cho ${entry.username}?`)) return;
    setResettingId(entry.user_id);
    try {
      await api.resetStrike(entry.user_id);
      toast.success(`Đã đặt lại strike cho ${entry.username}`);
      strikesFetch.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setResettingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Phạt nguội"
        description={
          <>
            "Phạt nguội" là cơ chế tích lũy điểm vi phạm (strike) cho từng user. Khi đủ ngưỡng,
            user sẽ bị <strong>gắn cờ</strong> để admin xem xét, hoặc <strong>đình chỉ</strong>.
          </>
        }
        action={
          <Button variant="secondary" size="sm" onClick={strikesFetch.reload}>
            Làm mới
          </Button>
        }
      />

      <Card>
        {strikesFetch.loading && !strikesFetch.data ? (
          <LoadingBlock />
        ) : strikesFetch.error ? (
          <div className="p-5">
            <ErrorBlock message={strikesFetch.error} onRetry={strikesFetch.reload} />
          </div>
        ) : !strikesFetch.data || strikesFetch.data.items.length === 0 ? (
          <EmptyBlock message="Chưa có user nào tích lũy strike." />
        ) : (
          <Table>
            <THead>
              <TH>Username</TH>
              <TH>User ID</TH>
              <TH>Strikes</TH>
              <TH>Vi phạm gần nhất</TH>
              <TH>Trạng thái</TH>
              <TH>Ghi chú</TH>
              <TH className="text-right">Hành động</TH>
            </THead>
            <TBody>
              {strikesFetch.data.items.map((s) => (
                <TR key={s.user_id}>
                  <TD className="font-medium text-slate-100">{s.username}</TD>
                  <TD className="text-slate-400">#{s.user_id}</TD>
                  <TD>
                    <Badge tone={s.strikes >= 3 ? 'red' : s.strikes >= 1 ? 'amber' : 'gray'}>
                      {s.strikes}
                    </Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-slate-400">
                    {fmtDateTime(s.last_violation_at)}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
                  </TD>
                  <TD className="max-w-[14rem] truncate text-slate-300">{s.note || '—'}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setEditing(s)}>
                        Đổi trạng thái
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={resettingId === s.user_id}
                        onClick={() => resetStrike(s)}
                      >
                        Reset
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {editing && (
        <StatusModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            strikesFetch.reload();
          }}
          onToast={(kind, msg) => (kind === 'success' ? toast.success(msg) : toast.error(msg))}
        />
      )}
    </div>
  );
}

function StatusModal({
  entry,
  onClose,
  onSaved,
  onToast,
}: {
  entry: StrikeEntry;
  onClose: () => void;
  onSaved: () => void;
  onToast: (kind: 'success' | 'error', msg: string) => void;
}) {
  const [status, setStatus] = useState<StrikeStatus>(entry.status);
  const [note, setNote] = useState(entry.note);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.setStrikeStatus(entry.user_id, status, note);
      onToast('success', `Đã cập nhật trạng thái cho ${entry.username}`);
      onSaved();
    } catch (e) {
      onToast('error', errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cập nhật trạng thái — ${entry.username}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Hủy
          </Button>
          <Button onClick={save} loading={saving}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Trạng thái"
          value={status}
          onChange={(e) => setStatus(e.target.value as StrikeStatus)}
        >
          <option value="active">Bình thường (active)</option>
          <option value="flagged">Gắn cờ (flagged)</option>
          <option value="suspended">Đình chỉ (suspended)</option>
        </Select>
        <Textarea
          label="Ghi chú"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder="Lý do hoặc ghi chú nội bộ…"
        />
      </div>
    </Modal>
  );
}
