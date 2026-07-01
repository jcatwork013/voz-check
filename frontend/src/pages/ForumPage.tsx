import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useFetch, errMsg } from '../lib/useFetch';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Tabs } from '../components/Tabs';
import { Badge, Button, Card, ErrorBlock, Input, LoadingBlock } from '../components/ui';
import { IntegrationSection } from './IntegrationPage';
import type { ForumType, Settings } from '../lib/types';

export default function ForumPage() {
  const toast = useToast();
  const settingsFetch = useFetch<Settings>(useCallback(() => api.getSettings(), []));

  const [tab, setTab] = useState<ForumType>('flarum');
  const [tabSaving, setTabSaving] = useState(false);

  // Flarum form
  const [fBaseUrl, setFBaseUrl] = useState('');
  const [fUsername, setFUsername] = useState('');
  const [fPassword, setFPassword] = useState('');
  const [fConnecting, setFConnecting] = useState(false);

  // XenForo form
  const [xBaseUrl, setXBaseUrl] = useState('');
  const [xApiKey, setXApiKey] = useState('');
  const [xBotId, setXBotId] = useState(1);
  const [xConnecting, setXConnecting] = useState(false);

  useEffect(() => {
    const d = settingsFetch.data;
    if (!d) return;
    setTab(d.forum_type);
    setFBaseUrl(d.flarum.base_url);
    setXBaseUrl(d.xenforo.base_url);
    setXBotId(d.xenforo.bot_user_id || 1);
  }, [settingsFetch.data]);

  async function switchForumType(next: ForumType) {
    setTab(next);
    setTabSaving(true);
    try {
      await api.updateSettings({ forum_type: next });
      toast.success(`Đã chọn nền tảng: ${next === 'flarum' ? 'Flarum' : 'XenForo'}`);
      settingsFetch.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setTabSaving(false);
    }
  }

  async function connectFlarum() {
    setFConnecting(true);
    try {
      const res = await api.connectFlarum(fBaseUrl.trim(), fUsername.trim(), fPassword);
      toast.success(`Đã kết nối Flarum (bot user #${res.bot_user_id})`);
      setFPassword('');
      settingsFetch.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setFConnecting(false);
    }
  }

  async function connectXenforo() {
    setXConnecting(true);
    try {
      const res = await api.connectXenforo(xBaseUrl.trim(), xApiKey.trim(), xBotId);
      toast.success(`Đã kết nối XenForo (user #${res.me_user_id})`);
      setXApiKey('');
      settingsFetch.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setXConnecting(false);
    }
  }

  const flarum = settingsFetch.data?.flarum;
  const xenforo = settingsFetch.data?.xenforo;

  return (
    <div>
      <PageHeader
        title="Kết nối Forum"
        description="Chọn nền tảng diễn đàn và cung cấp thông tin để bot có thể truy cập, ẩn bài và phản hồi."
      />

      {settingsFetch.loading && !settingsFetch.data ? (
        <LoadingBlock />
      ) : settingsFetch.error ? (
        <ErrorBlock message={settingsFetch.error} onRetry={settingsFetch.reload} />
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Tabs<ForumType>
              value={tab}
              onChange={switchForumType}
              items={[
                { value: 'flarum', label: 'Flarum' },
                { value: 'xenforo', label: 'XenForo' },
              ]}
            />
            {tabSaving && <span className="text-sm text-slate-400">Đang lưu…</span>}
          </div>

          {tab === 'flarum' ? (
            <Card className="max-w-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-50">Flarum</h3>
                <Badge tone={flarum?.connected ? 'green' : 'gray'}>
                  {flarum?.connected ? `Đã kết nối · bot #${flarum.bot_user_id}` : 'Chưa kết nối'}
                </Badge>
              </div>
              <div className="space-y-4 p-5">
                <Input
                  label="Base URL"
                  value={fBaseUrl}
                  onChange={(e) => setFBaseUrl(e.target.value)}
                  placeholder="https://forum.example.com"
                />
                <Input
                  label="Tên đăng nhập bot"
                  value={fUsername}
                  onChange={(e) => setFUsername(e.target.value)}
                  placeholder="vozcheck-bot"
                  autoComplete="off"
                />
                <Input
                  label="Mật khẩu bot"
                  type="password"
                  value={fPassword}
                  onChange={(e) => setFPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                <div className="pt-1">
                  <Button onClick={connectFlarum} loading={fConnecting}>
                    Kết nối Flarum
                  </Button>
                </div>
                <p className="text-xs text-slate-400">
                  Bot dùng tài khoản này để đăng nhập, quét bài định kỳ, ẩn bài và phản hồi
                  @mention. Tài khoản nên có quyền kiểm duyệt.
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-5">
            <Card className="max-w-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-50">XenForo</h3>
                <Badge tone={xenforo?.connected ? 'green' : 'gray'}>
                  {xenforo?.connected ? `Đã kết nối · user #${xenforo.bot_user_id}` : 'Chưa kết nối'}
                </Badge>
              </div>
              <div className="space-y-4 p-5">
                <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-brand-200">
                  XenForo xác thực qua <span className="font-semibold">REST API Key</span>. Bot hành
                  động dưới quyền tài khoản ở ô <span className="font-medium">Bot User ID</span> — hãy
                  chọn một tài khoản có quyền kiểm duyệt để ẩn / duyệt bài. Hỗ trợ đầy đủ: chặn nội
                  dung thời gian thực bằng Add-on (tab <span className="font-medium">Tích hợp</span>),
                  và quét chủ động cả bài + bình luận bằng{' '}
                  <span className="font-medium">Quét theo link</span>.
                </div>
                <Input
                  label="Base URL"
                  value={xBaseUrl}
                  onChange={(e) => setXBaseUrl(e.target.value)}
                  placeholder="https://forum.example.com"
                  hint="Trỏ tới gốc API, ví dụ https://forum.example.com/api"
                />
                <Input
                  label="API Key"
                  type="password"
                  value={xApiKey}
                  onChange={(e) => setXApiKey(e.target.value)}
                  placeholder="XenForo super-user API key"
                  autoComplete="off"
                  hint="Tạo ở Admin CP → Setup → API keys (loại Super user key)."
                />
                <Input
                  label="Bot User ID"
                  type="number"
                  min={1}
                  value={xBotId}
                  onChange={(e) => setXBotId(Number(e.target.value))}
                  hint="ID tài khoản quản trị/kiểm duyệt mà bot sẽ hành động thay mặt."
                />
                <div className="pt-1">
                  <Button onClick={connectXenforo} loading={xConnecting}>
                    Kết nối XenForo
                  </Button>
                </div>
                <p className="text-xs text-slate-400">
                  Bot dùng API key + tài khoản này để ẩn / duyệt bài, quét thread và phản hồi
                  @mention. Tài khoản cần có quyền kiểm duyệt trên các box tương ứng.
                </p>
              </div>
            </Card>

              <div className="border-t border-white/10 pt-2">
                <h3 className="mb-1 text-base font-semibold text-slate-50">
                  Tích hợp Add-on (real-time)
                </h3>
                <p className="mb-4 text-sm text-slate-400">
                  Tùy chọn: cài add-on để chặn nội dung ngay khi đăng. Khóa &amp; hướng dẫn bên dưới.
                </p>
                <IntegrationSection />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
