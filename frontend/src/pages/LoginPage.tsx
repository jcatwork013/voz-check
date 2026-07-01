import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { errMsg } from '../lib/useFetch';
import { Button, Input } from '../components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username.trim(), password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/voz-logo.png" alt="VOZ" className="mb-3 h-9 w-auto drop-shadow-[0_0_12px_rgba(99,102,241,0.5)]" />
          <h1 className="text-3xl font-bold text-gradient">VozCheck</h1>
          <p className="mt-1 text-sm text-slate-400">
            Bảng điều khiển kiểm duyệt diễn đàn bằng AI
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-soft backdrop-blur-xl sm:p-8">
          <h2 className="mb-1 text-lg font-semibold text-slate-50">Đăng nhập</h2>
          <p className="mb-5 text-sm text-slate-400">Vui lòng nhập thông tin quản trị viên.</p>

          <form onSubmit={onSubmit} className="space-y-4">
            <Input
              id="username"
              label="Tên đăng nhập"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              autoFocus
            />
            <Input
              id="password"
              label="Mật khẩu"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />

            {error && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full" size="md">
              Đăng nhập
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} VozCheck · Kiểm duyệt diễn đàn tự động
        </p>
      </div>
    </div>
  );
}
