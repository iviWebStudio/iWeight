'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useOnline } from '@/lib/hooks';
import { useGuard } from '@/lib/session';
import { Icon, type IconName } from './Icon';

const NAV: Array<[string, IconName, string]> = [
  ['/', 'home', 'Главная'],
  ['/add', 'add', 'Записать'],
  ['/history', 'history', 'История'],
  ['/chat', 'chat', 'Чат'],
  ['/settings', 'settings', 'Настройки'],
];

export function Shell({ children }: { children: ReactNode }) {
  const s = useGuard('app');
  const path = usePathname();
  const online = useOnline();
  if (s.status === 'error') {
    return (
      <div className="center">
        <div className="state card" style={{ maxWidth: 420 }}>
          <h2>Сервер недоступен</h2>
          <p className="muted">
            Не удалось загрузить профиль. Проверьте подключение и попробуйте ещё раз.
          </p>
          <button className="btn primary" onClick={() => void s.reloadMe()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }
  if (s.status !== 'ready' || !s.me?.onboardedAt) {
    return (
      <div className="center" aria-busy="true">
        <span className="muted">Загрузка…</span>
      </div>
    );
  }
  const nav = NAV.map(([href, icon, label]) => (
    <Link
      key={href}
      href={href}
      className="nav-btn"
      aria-current={path === href ? 'page' : undefined}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </Link>
  ));
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">W</div>
          <div className="brand-name">Weight AI</div>
        </div>
        {nav}
        <div className="side-foot small muted">{s.me.displayName ?? 'Профиль'}</div>
      </aside>
      <main className="main">
        {!online && (
          <div className="alert warn" style={{ maxWidth: 1040, margin: '0 auto 14px' }}>
            Нет сети. Новые записи не сохранятся, пока связь не вернётся.
          </div>
        )}
        {children}
      </main>
      <nav className="tabbar" aria-label="Разделы">
        {nav}
      </nav>
    </div>
  );
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="state" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 15}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ text, retry }: { text: string; retry: () => void }) {
  return (
    <div className="alert" role="alert">
      <span>{text}</span>
      <button className="btn sm" onClick={retry}>
        Повторить
      </button>
    </div>
  );
}
