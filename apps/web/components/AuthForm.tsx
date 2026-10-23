'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { auth, AuthError, AUTH_MODE } from '@/lib/auth';
import { useGuard } from '@/lib/session';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  useGuard('auth');
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Введите email.');
    if (password.length < 8) return setError('Пароль — не короче 8 символов.');
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await auth.signIn(email, password);
        router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
      } else {
        const r = await auth.signUp(email, password);
        if (r.needsEmailConfirmation)
          setInfo('Мы отправили письмо для подтверждения. Откройте ссылку из письма и войдите.');
        else router.replace('/onboarding');
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'Не удалось выполнить запрос.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="card form" onSubmit={submit} noValidate>
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand-mark">W</div>
          <div className="brand-name">Weight AI</div>
        </div>
        <div>
          <h1>{mode === 'login' ? 'Вход' : 'Регистрация'}</h1>
          <p className="muted">Дневник веса с графиками, прогнозом и AI-помощником.</p>
        </div>
        <label className="field">
          <span>Email</span>
          <input
            className="input"
            type="email"
            id="email"
            name="email"
            autoComplete="email"
            required
          />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input
            className="input"
            type="password"
            id="password"
            name="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={8}
            required
          />
          {mode === 'signup' && <small>Не короче 8 символов.</small>}
        </label>
        {error && (
          <p className="err-text" role="alert">
            {error}
          </p>
        )}
        {info && <p className="alert info">{info}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
        </button>
        <p className="small muted">
          {mode === 'login' ? (
            <>
              Нет аккаунта?{' '}
              <Link className="link" href="/signup">
                Зарегистрироваться
              </Link>
            </>
          ) : (
            <>
              Уже есть аккаунт?{' '}
              <Link className="link" href="/login">
                Войти
              </Link>
            </>
          )}
        </p>
        {AUTH_MODE === 'local' && (
          <p className="small muted">Режим разработки: локальный вход через API (без Supabase).</p>
        )}
      </form>
    </div>
  );
}
