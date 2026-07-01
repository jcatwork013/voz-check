import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useFetch, errMsg } from '../lib/useFetch';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, ErrorBlock, LoadingBlock, Textarea } from '../components/ui';
import type { Settings } from '../lib/types';

export default function RulesPage() {
  const toast = useToast();
  const settingsFetch = useFetch<Settings>(useCallback(() => api.getSettings(), []));

  const [rules, setRules] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [notifyTemplate, setNotifyTemplate] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);

  useEffect(() => {
    if (settingsFetch.data) {
      setRules(settingsFetch.data.rules);
      setSystemPrompt(settingsFetch.data.system_prompt);
      setNotifyTemplate(settingsFetch.data.notify_template);
    }
  }, [settingsFetch.data]);

  async function save() {
    setSaving(true);
    try {
      await api.updateSettings({
        rules,
        system_prompt: systemPrompt,
        notify_template: notifyTemplate,
      });
      toast.success('Đã lưu nội quy & prompt');
      settingsFetch.reload();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  }

  async function restoreDefaults() {
    setLoadingDefaults(true);
    try {
      const def = await api.getDefaults();
      setRules(def.rules);
      setSystemPrompt(def.system_prompt);
      setNotifyTemplate(def.notify_template);
      toast.info('Đã nạp mặc định vào trình soạn — nhấn "Lưu" để áp dụng.');
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoadingDefaults(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Nội quy & Prompt"
        description="Nội quy diễn đàn và prompt hệ thống được gửi kèm cho AI ở mỗi lần kiểm duyệt. Đây là phần quyết định AI đánh giá nội dung như thế nào."
        action={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={restoreDefaults}
              loading={loadingDefaults}
              disabled={settingsFetch.loading}
            >
              Khôi phục mặc định
            </Button>
            <Button onClick={save} loading={saving} disabled={settingsFetch.loading}>
              Lưu
            </Button>
          </div>
        }
      />

      {settingsFetch.loading && !settingsFetch.data ? (
        <LoadingBlock />
      ) : settingsFetch.error ? (
        <ErrorBlock message={settingsFetch.error} onRetry={settingsFetch.reload} />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <div className="border-b border-white/10 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-50">Nội quy diễn đàn</h3>
                <p className="mt-0.5 text-sm text-slate-400">
                  Định dạng Markdown. AI dựa vào đây để biết hành vi nào bị cấm.
                </p>
              </div>
              <div className="p-5">
                <Textarea
                  value={rules}
                  onChange={(e) => setRules(e.target.value)}
                  rows={22}
                  placeholder="# Nội quy diễn đàn&#10;1. Không spam, quảng cáo…"
                />
              </div>
            </Card>

            <Card>
              <div className="border-b border-white/10 px-5 py-4">
                <h3 className="text-base font-semibold text-slate-50">Prompt hệ thống cho AI</h3>
                <p className="mt-0.5 text-sm text-slate-400">
                  Hướng dẫn vai trò & cách AI trả về kết quả (confidence, lý do…).
                </p>
              </div>
              <div className="p-5">
                <Textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={22}
                  placeholder="Bạn là trợ lý kiểm duyệt diễn đàn…"
                />
              </div>
            </Card>
          </div>

          <Card>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Mẫu thông báo cho user</h3>
              <p className="mt-0.5 text-sm text-slate-400">
                Tin nhắn @mention gửi cho người dùng khi bài bị xử lý. Chuỗi{' '}
                <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-brand-300">
                  {'{reason}'}
                </code>{' '}
                sẽ được thay bằng lý do vi phạm cụ thể.
              </p>
            </div>
            <div className="p-5">
              <Textarea
                value={notifyTemplate}
                onChange={(e) => setNotifyTemplate(e.target.value)}
                rows={4}
                placeholder="Bài viết của bạn đã bị ẩn vì: {reason}"
              />
            </div>
          </Card>

          <div className="rounded-xl border border-brand-500/30 bg-brand-500/15 px-4 py-3 text-sm text-brand-200">
            <strong className="font-semibold">Lưu ý:</strong> Ba nội dung trên được ghép lại và gửi
            cho AI (Gemini/OpenAI) mỗi khi quét một bài viết. Viết nội quy rõ ràng và prompt chặt chẽ
            sẽ giúp AI ra quyết định chính xác hơn.
          </div>
        </div>
      )}
    </div>
  );
}
