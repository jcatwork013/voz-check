import type { ReactNode } from 'react';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
              active
                ? 'bg-gradient-to-r from-brand-500 to-violet-500 text-white shadow-glow-sm'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
