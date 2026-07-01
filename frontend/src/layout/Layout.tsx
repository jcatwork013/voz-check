import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  IconAi,
  IconChart,
  IconDashboard,
  IconForum,
  IconGuide,
  IconLogout,
  IconLogs,
  IconMenu,
  IconRules,
  IconScan,
  IconStrikes,
  IconUsers,
} from '../components/icons';

interface NavItem {
  to: string;
  label: string;
  icon: (props: { className?: string }) => ReactNode;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Tổng quan', icon: IconDashboard },
  { to: '/scan', label: 'Quét theo link', icon: IconScan },
  { to: '/logs', label: 'Nhật ký', icon: IconLogs },
  { to: '/stats', label: 'Thống kê token', icon: IconChart },
  { to: '/rules', label: 'Nội quy & Prompt', icon: IconRules },
  { to: '/ai', label: 'Cấu hình AI', icon: IconAi },
  { to: '/forum', label: 'Kết nối Forum', icon: IconForum },
  { to: '/strikes', label: 'Phạt nguội', icon: IconStrikes },
  { to: '/users', label: 'Tài khoản', icon: IconUsers },
  { to: '/guide', label: 'Hướng dẫn', icon: IconGuide },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 py-5">
        <img src="/voz-logo.png" alt="VOZ" className="h-6 w-auto" />
        <span className="h-6 w-px bg-white/15" />
        <div className="flex flex-col leading-none">
          <span className="text-sm font-bold text-gradient">Check</span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-slate-500">
            Kiểm duyệt AI
          </span>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive
                    ? 'bg-white/[0.06] text-white'
                    : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-brand-400 to-violet-400 shadow-glow-sm" />
                  )}
                  <Icon
                    className={`h-5 w-5 flex-none transition ${
                      isActive ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300'
                    }`}
                  />
                  {item.label}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t border-white/5 px-5 py-4 text-[11px] font-medium uppercase tracking-wider text-slate-600">
        VozCheck Admin · v1.0
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const current = NAV.find((n) =>
    n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to),
  );

  return (
    <div className="min-h-screen bg-transparent">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-white/10 bg-slate-950/70 backdrop-blur-xl lg:block">
        <SidebarContent />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-white/10 bg-slate-950/70 backdrop-blur-xl">
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/10 bg-slate-950/60 px-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 lg:hidden"
              aria-label="Mở menu"
            >
              <IconMenu className="h-5 w-5" />
            </button>
            {current && (
              <span className="hidden h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-brand-300 ring-1 ring-inset ring-white/10 sm:flex">
                <current.icon className="h-[18px] w-[18px]" />
              </span>
            )}
            <h1 className="text-lg font-semibold text-slate-50">{current?.label ?? 'VozCheck'}</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3 ring-1 ring-inset ring-white/10 sm:flex">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-xs font-semibold text-white shadow-glow-sm">
                {(user?.username ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="text-sm font-medium text-slate-200">{user?.username}</span>
            </div>
            <button
              onClick={logout}
              title="Đăng xuất"
              className="group inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300"
            >
              <IconLogout className="h-[18px] w-[18px] transition group-hover:-translate-x-px" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
