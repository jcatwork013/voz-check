import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Badge, Card } from '../components/ui';

function FlowBox({
  title,
  desc,
  tone = 'default',
}: {
  title: string;
  desc: string;
  tone?: 'default' | 'brand' | 'amber' | 'red' | 'green';
}) {
  const tones: Record<string, string> = {
    default: 'border-white/10 bg-white/5',
    brand: 'border-brand-500/30 bg-brand-500/15',
    amber: 'border-amber-500/30 bg-amber-500/10',
    red: 'border-rose-500/30 bg-rose-500/10',
    green: 'border-emerald-500/30 bg-emerald-500/10',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-center shadow-card ${tones[tone]}`}>
      <p className="text-sm font-semibold text-slate-50">{title}</p>
      <p className="mt-1 text-xs leading-snug text-slate-400">{desc}</p>
    </div>
  );
}

function Arrow({ vertical }: { vertical?: boolean }) {
  return (
    <div className="flex items-center justify-center text-brand-400">
      {vertical ? (
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M6 13l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

function PipelineStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
        {n}
      </span>
      <div className="pt-0.5">
        <p className="font-semibold text-slate-50">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-300">{children}</p>
      </div>
    </li>
  );
}

export default function GuidePage() {
  return (
    <div>
      <PageHeader
        title="Hướng dẫn & Quy trình vận hành"
        description="Cách bot AI VozCheck hoạt động và quy trình vận hành end-to-end."
      />

      <div className="space-y-6">
        {/* Quick start */}
        <Card>
          <div className="border-b border-white/10 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-50">Bắt đầu nhanh</h3>
            <p className="mt-0.5 text-sm text-slate-400">4 bước để đưa hệ thống vào hoạt động.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { n: 1, t: 'Kết nối forum', d: 'Flarum hoặc XenForo', to: '/forum' },
              { n: 2, t: 'Nhập API key AI', d: 'Gemini hoặc OpenAI', to: '/ai' },
              { n: 3, t: 'Chỉnh nội quy/prompt', d: 'Định nghĩa luật chơi', to: '/rules' },
              { n: 4, t: 'Bật kiểm duyệt', d: 'Bật công tắc chính', to: '/' },
            ].map((s) => (
              <Link
                key={s.n}
                to={s.to}
                className="group flex items-start gap-3 rounded-xl border border-white/10 p-3 transition hover:border-brand-300 hover:bg-brand-500/10"
              >
                <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-500/20 text-sm font-bold text-brand-300">
                  {s.n}
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-100 group-hover:text-brand-300">
                    {s.t}
                  </p>
                  <p className="text-xs text-slate-400">{s.d}</p>
                </div>
              </Link>
            ))}
          </div>
        </Card>

        {/* Flow diagram */}
        <Card>
          <div className="border-b border-white/10 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-50">Luồng xử lý của bot</h3>
            <p className="mt-0.5 text-sm text-slate-400">
              Từ lúc người dùng đăng bài cho tới khi nội dung được xử lý.
            </p>
          </div>
          <div className="p-5">
            <div className="mx-auto max-w-md space-y-1">
              <FlowBox
                title="1. User đăng bài / comment"
                desc="Nội dung mới xuất hiện trên diễn đàn"
              />
              <Arrow vertical />
              <div className="grid grid-cols-2 gap-3">
                <FlowBox
                  title="2a. Flarum"
                  desc="Backend poll mỗi ~10s để lấy bài mới"
                  tone="brand"
                />
                <FlowBox
                  title="2b. XenForo"
                  desc="Add-on intercept nội dung real-time"
                  tone="brand"
                />
              </div>
              <Arrow vertical />
              <FlowBox
                title="3. Gửi cho AI"
                desc="Nội dung + nội quy + prompt → Gemini / OpenAI"
                tone="brand"
              />
              <Arrow vertical />
              <FlowBox
                title="4. AI trả confidence"
                desc="Điểm vi phạm 0–100 kèm lý do & phân loại"
              />
              <Arrow vertical />
              <FlowBox
                title="5. So với ngưỡng (mặc định 75%)"
                desc="Nếu ≥ ngưỡng và bật auto-hide → ẨN bài + REPLY @mention cảnh báo user"
                tone="red"
              />
              <Arrow vertical />
              <FlowBox
                title="6. Cộng strike cho user"
                desc="Đủ ngưỡng → gắn cờ 'phạt nguội'"
                tone="amber"
              />
              <Arrow vertical />
              <FlowBox
                title="7. Admin xử lý"
                desc="Xem nhật ký, quét lại bài cũ (backfill), xử lý user bị gắn cờ"
                tone="green"
              />
            </div>
          </div>
        </Card>

        {/* Detailed pipeline */}
        <Card>
          <div className="border-b border-white/10 px-5 py-4">
            <h3 className="text-base font-semibold text-slate-50">Quy trình chi tiết</h3>
          </div>
          <div className="p-5">
            <ol className="space-y-5">
              <PipelineStep n={1} title="Người dùng đăng nội dung">
                Một bài viết (thread) hoặc bình luận (comment) mới được tạo trên diễn đàn.
              </PipelineStep>
              <PipelineStep n={2} title="Thu thập nội dung">
                <strong>Flarum:</strong> backend chủ động <em>poll</em> theo chu kỳ (mặc định ~10
                giây) để phát hiện bài mới.{' '}
                <strong>XenForo:</strong> add-on <em>intercept</em> ngay tại thời điểm đăng (real-time)
                và gửi nội dung về backend.
              </PipelineStep>
              <PipelineStep n={3} title="Gửi cho AI đánh giá">
                Backend ghép <em>nội dung</em> + <em>nội quy diễn đàn</em> + <em>prompt hệ thống</em>{' '}
                và gửi tới nhà cung cấp AI đã cấu hình (Gemini hoặc OpenAI).
              </PipelineStep>
              <PipelineStep n={4} title="AI trả kết quả">
                AI trả về <Badge tone="violet">confidence 0–100</Badge> cùng mức độ (severity), phân
                loại vi phạm, lý do và thông báo gợi ý cho người dùng.
              </PipelineStep>
              <PipelineStep n={5} title="Áp dụng quyết định">
                Nếu confidence ≥ <strong>ngưỡng</strong> (mặc định 75%) và bật{' '}
                <strong>tự động ẩn</strong>: hệ thống <strong>ẩn bài</strong> và{' '}
                <strong>reply @mention</strong> cảnh báo user (nếu bật thông báo). Mẫu thông báo lấy từ{' '}
                <em>notify_template</em>, với <code className="rounded bg-white/10 px-1 text-xs">{'{reason}'}</code>{' '}
                được thay bằng lý do thật.
              </PipelineStep>
              <PipelineStep n={6} title="Tích lũy strike (phạt nguội)">
                Mỗi vi phạm cộng một strike cho user. Khi đạt ngưỡng cấu hình, user bị{' '}
                <strong>gắn cờ</strong> để admin xem xét, hoặc <strong>đình chỉ</strong>.
              </PipelineStep>
              <PipelineStep n={7} title="Admin giám sát & xử lý">
                Admin theo dõi qua{' '}
                <Link to="/logs" className="font-medium text-brand-300 hover:underline">
                  Nhật ký
                </Link>
                , chạy <strong>quét lại bài cũ</strong> (backfill) từ trang Tổng quan, và xử lý các user
                bị gắn cờ ở mục{' '}
                <Link to="/strikes" className="font-medium text-brand-300 hover:underline">
                  Phạt nguội
                </Link>
                .
              </PipelineStep>
            </ol>
          </div>
        </Card>

        <div className="rounded-xl border border-brand-500/30 bg-brand-500/15 px-5 py-4 text-sm text-brand-200">
          <strong className="font-semibold">Mẹo:</strong> Bắt đầu với ngưỡng cao (ví dụ 80–85%) và{' '}
          tắt tự động ẩn để quan sát kết quả trong Nhật ký trước. Khi đã tin tưởng độ chính xác của AI,
          hãy hạ ngưỡng và bật tự động ẩn để hệ thống vận hành đầy đủ.
        </div>
      </div>
    </div>
  );
}
