import { useCallback, useState } from 'react';
import { api } from '../lib/api';
import { useFetch, errMsg } from '../lib/useFetch';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, ErrorBlock, LoadingBlock } from '../components/ui';
import { IconCopy, IconEye, IconEyeOff, IconRefresh } from '../components/icons';
import type { IntegrationInfo } from '../lib/types';

/** Masked secret display: shows •••• + last 4 chars, with a reveal toggle + copy. */
function SecretField({
  label,
  value,
  onCopy,
  action,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  action?: React.ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const display = !value ? '—' : shown ? value : '••••••••' + value.slice(-4);
  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="label-base">{label}</p>
        {action}
      </div>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-sm text-slate-300">
          {display}
        </code>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShown((s) => !s)}
          className="flex-none"
          title={shown ? 'Ẩn' : 'Hiện'}
        >
          {shown ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCopy} className="flex-none" title="Sao chép">
          <IconCopy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CopyField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div>
      <p className="label-base">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-sm text-slate-300">
          {value || '—'}
        </code>
        <Button variant="secondary" size="sm" onClick={onCopy} className="flex-none">
          <IconCopy className="h-4 w-4" />
          Sao chép
        </Button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
        {n}
      </span>
      <div className="pt-0.5 text-sm leading-relaxed text-slate-300">{children}</div>
    </li>
  );
}

/** Add-on / ingest config block — embedded inside the unified "Kết nối Forum" page. */
export function IntegrationSection() {
  const toast = useToast();
  const integrationFetch = useFetch<IntegrationInfo>(useCallback(() => api.getIntegration(), []));
  const [regenerating, setRegenerating] = useState(false);

  const data = integrationFetch.data;
  const backendBase =
    typeof window !== 'undefined' ? window.location.origin : 'https://voz-check.9bricks.com';

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Đã sao chép ${label}`);
    } catch {
      toast.error('Không thể sao chép — vui lòng copy thủ công.');
    }
  }

  async function regenerate() {
    if (!window.confirm('Tạo key mới sẽ vô hiệu hoá key cũ. Add-on phải được cập nhật key. Tiếp tục?'))
      return;
    setRegenerating(true);
    try {
      const res = await api.regenerateIngestKey();
      toast.success('Đã tạo ingest key mới');
      integrationFetch.setData((prev) =>
        prev ? { ...prev, ingest_api_key: res.ingest_api_key } : prev,
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <>
      {integrationFetch.loading && !data ? (
        <LoadingBlock />
      ) : integrationFetch.error ? (
        <ErrorBlock message={integrationFetch.error} onRetry={integrationFetch.reload} />
      ) : data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-50">Khóa & Endpoint</h3>
                  <p className="mt-0.5 text-sm text-slate-400">
                    Dán các giá trị này vào phần cấu hình của add-on trong XenForo Admin.
                  </p>
                </div>
                <Badge tone={data.xenforo.connected ? 'green' : 'gray'}>
                  {data.xenforo.connected ? 'XenForo đã kết nối' : 'Chưa kết nối'}
                </Badge>
              </div>
              <div className="space-y-4 p-5">
                <CopyField
                  label="Backend URL"
                  value={backendBase}
                  onCopy={() => copy(backendBase, 'Backend URL')}
                />
                <SecretField
                  label="Ingest API Key"
                  value={data.ingest_api_key}
                  onCopy={() => copy(data.ingest_api_key, 'Ingest API Key')}
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={regenerate}
                      loading={regenerating}
                      className="text-brand-300"
                    >
                      <IconRefresh className="h-4 w-4" />
                      Tạo key mới
                    </Button>
                  }
                />
                <CopyField
                  label="Endpoint đăng nhập (ingest login)"
                  value={`${backendBase}${data.ingest_login}`}
                  onCopy={() => copy(`${backendBase}${data.ingest_login}`, 'endpoint login')}
                />
                <CopyField
                  label="Endpoint kiểm duyệt (ingest moderate)"
                  value={`${backendBase}${data.ingest_moderate}`}
                  onCopy={() => copy(`${backendBase}${data.ingest_moderate}`, 'endpoint moderate')}
                />
              </div>
            </Card>

            <Card>
              <div className="border-b border-white/10 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-50">Các bước cài đặt (thực tế)</h3>
                <p className="mt-0.5 text-sm text-slate-400">
                  Có 2 chế độ — chọn 1 hoặc dùng cả hai bổ trợ nhau.
                </p>
              </div>
              <div className="space-y-5 p-5">
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  <strong>Điều kiện tiên quyết:</strong> Vào{' '}
                  <strong>Admin CP → Setup → API keys → Add API key</strong> (loại{' '}
                  <em>Super user key</em>), rồi nhập key + Base URL + Bot User ID ở trang{' '}
                  <strong>Kết nối Forum</strong>. Đây là tài khoản bot dùng để ẩn / duyệt bài.
                </div>

                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-200">
                    Cách A — Real-time (Add-on, khuyến nghị cho forum lớn)
                  </p>
                  <ol className="space-y-4">
                    <Step n={1}>
                      Tải add-on từ thư mục{' '}
                      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-brand-300">
                        xenforo-addon/
                      </code>{' '}
                      trong repo, copy vào{' '}
                      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-brand-300">
                        src/addons/VozCheck/
                      </code>{' '}
                      trên server XenForo.
                    </Step>
                    <Step n={2}>
                      Chạy{' '}
                      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-brand-300">
                        php cmd.php xf-addon:install VozCheck
                      </code>{' '}
                      (hoặc <strong>Admin CP → Add-ons → Install</strong>).
                    </Step>
                    <Step n={3}>
                      Mở <strong>Admin CP → Options → VozCheck</strong>, dán{' '}
                      <strong>Backend URL</strong> và <strong>Ingest API Key</strong> ở trên, lưu lại.
                    </Step>
                    <Step n={4}>
                      Mỗi bài / bình luận mới sẽ được add-on gửi tới{' '}
                      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-brand-300">
                        /api/ingest/moderate
                      </code>{' '}
                      và xử lý ngay (cho phép / ẩn / cảnh báo).
                    </Step>
                  </ol>
                </div>

                <div className="border-t border-white/10 pt-4">
                  <p className="mb-2 text-sm font-semibold text-slate-200">
                    Cách B — Chủ động quét (không cần add-on)
                  </p>
                  <ol className="space-y-4">
                    <Step n={1}>
                      Chỉ cần kết nối XenForo (điều kiện tiên quyết ở trên) — không cần cài add-on.
                    </Step>
                    <Step n={2}>
                      Vào <strong>Quét theo link</strong>, dán link thread XenForo (dạng{' '}
                      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-brand-300">
                        /threads/...
                      </code>{' '}
                      hoặc{' '}
                      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-brand-300">
                        /t/...
                      </code>
                      ) để AI quét cả bài + bình luận và ẩn / duyệt.
                    </Step>
                  </ol>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-slate-400">
                  <strong className="text-slate-300">Khắc phục sự cố:</strong> Lỗi 403 / "thiếu quyền"
                  → Bot User ID chưa có quyền kiểm duyệt box đó. Lỗi 401 → API key sai/hết hạn (tạo
                  lại). Không thấy log → kiểm tra Backend URL có đúng{' '}
                  <code className="rounded bg-white/10 px-1 font-mono">https://...</code> và endpoint
                  truy cập được.
                </div>
              </div>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="p-5">
              <h3 className="mb-2 text-base font-semibold text-slate-50">Cơ chế hoạt động</h3>
              <p className="text-sm leading-relaxed text-slate-300">
                Khác với Flarum (backend chủ động poll), XenForo dùng add-on để <strong>intercept</strong>{' '}
                nội dung ngay khi người dùng đăng. Add-on gửi nội dung tới backend VozCheck, backend gọi
                AI và trả về quyết định <em>cho phép / ẩn / cảnh báo</em>.
              </p>
            </Card>

            <Card className="p-5">
              <h3 className="mb-2 text-base font-semibold text-slate-50">Bảo mật key</h3>
              <ul className="space-y-2 text-sm text-slate-300">
                <li>• Giữ ingest key bí mật, chỉ dùng trong cấu hình add-on.</li>
                <li>• Tạo key mới ngay nếu nghi ngờ bị lộ.</li>
                <li>• Add-on dùng key để lấy token tạm thời, không lưu key trực tiếp trong request kiểm duyệt.</li>
              </ul>
            </Card>

            <div className="rounded-xl border border-brand-500/30 bg-brand-500/15 px-4 py-3 text-sm text-brand-200">
              Add-on nằm tại{' '}
              <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-brand-100">
                xenforo-addon/
              </code>{' '}
              trong repo dự án.
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
