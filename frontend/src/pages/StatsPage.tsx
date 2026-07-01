import { useCallback } from 'react';
import { api } from '../lib/api';
import { useFetch } from '../lib/useFetch';
import { fmtDateTime, fmtNumber } from '../lib/format';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, Card, EmptyBlock, ErrorBlock, LoadingBlock } from '../components/ui';
import { Table, TBody, TD, TH, THead, TR } from '../components/Table';
import type { TokenStats } from '../lib/types';

function providerTone(p: string): 'green' | 'blue' | 'violet' | 'gray' {
  if (p === 'openai') return 'green';
  if (p === 'gemini') return 'blue';
  return 'gray';
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-sm font-medium text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-50">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export default function StatsPage() {
  const fetchStats = useFetch<TokenStats>(useCallback(() => api.getTokenStats(), []));
  const data = fetchStats.data;

  return (
    <div>
      <PageHeader
        title="Thống kê token"
        description="Lượng token AI đã dùng thực tế (theo báo cáo của nhà cung cấp) và provider/model nào đã chạy."
        action={
          <Button variant="secondary" size="sm" onClick={fetchStats.reload}>
            Làm mới
          </Button>
        }
      />

      {fetchStats.loading && !data ? (
        <LoadingBlock />
      ) : fetchStats.error ? (
        <ErrorBlock message={fetchStats.error} onRetry={fetchStats.reload} />
      ) : data ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Tổng token"
              value={fmtNumber(data.totals.total_tokens)}
              hint="prompt + completion"
            />
            <StatCard label="Token đầu vào (prompt)" value={fmtNumber(data.totals.prompt_tokens)} />
            <StatCard
              label="Token đầu ra (completion)"
              value={fmtNumber(data.totals.completion_tokens)}
            />
            <StatCard label="Số lượt gọi AI" value={fmtNumber(data.totals.calls)} />
          </div>

          <Card>
            <div className="border-b border-white/10 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-50">Chi tiết theo Provider / Model</h3>
            </div>
            {data.items.length === 0 ? (
              <EmptyBlock message="Chưa có lượt gọi AI nào được ghi nhận. Chạy thử AI hoặc quét để bắt đầu đếm." />
            ) : (
              <Table>
                <THead>
                  <TH>Provider</TH>
                  <TH>Model</TH>
                  <TH>Lượt gọi</TH>
                  <TH>Prompt</TH>
                  <TH>Completion</TH>
                  <TH>Tổng token</TH>
                  <TH>Gần nhất</TH>
                </THead>
                <TBody>
                  {data.items.map((u) => (
                    <TR key={`${u.provider}-${u.model}`}>
                      <TD>
                        <Badge tone={providerTone(u.provider)}>{u.provider}</Badge>
                      </TD>
                      <TD className="font-mono text-xs text-slate-300">{u.model}</TD>
                      <TD>{fmtNumber(u.calls)}</TD>
                      <TD className="text-slate-400">{fmtNumber(u.prompt_tokens)}</TD>
                      <TD className="text-slate-400">{fmtNumber(u.completion_tokens)}</TD>
                      <TD className="font-semibold text-slate-100">{fmtNumber(u.total_tokens)}</TD>
                      <TD className="whitespace-nowrap text-slate-400">
                        {u.updated_at ? fmtDateTime(u.updated_at) : '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          <p className="text-xs text-slate-500">
            Lưu ý: số token là <strong>thực tế</strong> do Gemini/OpenAI trả về cho mỗi lần gọi
            (usage). Một số model có thể không trả usage — khi đó token = 0 nhưng vẫn đếm lượt gọi.
          </p>
        </div>
      ) : null}
    </div>
  );
}
