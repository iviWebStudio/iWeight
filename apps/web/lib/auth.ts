'use client';
/**
 * Auth adapter. With NEXT_PUBLIC_SUPABASE_URL set the web app signs in with Supabase Auth and
 * sends its access token to the API. Without it (development only) it uses the API's local
 * auth endpoints (AUTH_PROVIDER=local, refused by the API in production).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const AUTH_MODE: 'supabase' | 'local' =
  SUPABASE_URL && SUPABASE_ANON_KEY ? 'supabase' : 'local';

const LOCAL_KEY = 'weight-ai.local-session';
type Listener = (signedIn: boolean) => void;
const listeners = new Set<Listener>();
const emit = (v: boolean) => listeners.forEach((l) => l(v));

let supabase: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    supabase.auth.onAuthStateChange((_e, session) => emit(Boolean(session)));
  }
  return supabase;
}

export class AuthError extends Error {}

interface LocalSession {
  token: string;
  expiresAt: number;
}
function readLocal(): LocalSession | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as LocalSession;
    return s.expiresAt > Date.now() ? s : null;
  } catch {
    return null;
  }
}

async function localCall(path: 'login' | 'signup', email: string, password: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1/auth/local/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new AuthError('Сервер недоступен. Проверьте подключение.');
  }
  const body = (await res.json().catch(() => null)) as {
    accessToken?: string;
    expiresIn?: number;
    error?: { code: string };
  } | null;
  if (!res.ok || !body?.accessToken) {
    const code = body?.error?.code;
    if (code === 'CONFLICT') throw new AuthError('Этот email уже зарегистрирован. Войдите.');
    if (code === 'UNAUTHORIZED') throw new AuthError('Неверный email или пароль.');
    if (code === 'VALIDATION_ERROR')
      throw new AuthError('Проверьте email; пароль — не короче 8 символов.');
    if (code === 'RATE_LIMITED') throw new AuthError('Слишком много попыток. Подождите минуту.');
    throw new AuthError('Не удалось войти. Попробуйте ещё раз.');
  }
  try {
    localStorage.setItem(
      LOCAL_KEY,
      JSON.stringify({
        token: body.accessToken,
        expiresAt: Date.now() + (body.expiresIn ?? 3600) * 1000 - 60_000,
      }),
    );
  } catch {
    /* session lives until reload */
  }
  memoryToken = body.accessToken;
  emit(true);
}
let memoryToken: string | null = null;

export const auth = {
  async signIn(email: string, password: string) {
    if (AUTH_MODE === 'local') return localCall('login', email, password);
    const { error } = await sb().auth.signInWithPassword({ email, password });
    if (error)
      throw new AuthError(
        error.message === 'Invalid login credentials'
          ? 'Неверный email или пароль.'
          : error.message,
      );
  },
  async signUp(email: string, password: string): Promise<{ needsEmailConfirmation: boolean }> {
    if (AUTH_MODE === 'local') {
      await localCall('signup', email, password);
      return { needsEmailConfirmation: false };
    }
    const { data, error } = await sb().auth.signUp({ email, password });
    if (error) throw new AuthError(error.message);
    return { needsEmailConfirmation: !data.session };
  },
  async signOut() {
    memoryToken = null;
    if (AUTH_MODE === 'local') {
      try {
        localStorage.removeItem(LOCAL_KEY);
      } catch {
        /* nothing stored */
      }
      emit(false);
      return;
    }
    await sb().auth.signOut();
  },
  async getToken(): Promise<string | null> {
    if (AUTH_MODE === 'local') return readLocal()?.token ?? memoryToken;
    const { data } = await sb().auth.getSession();
    return data.session?.access_token ?? null;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    if (AUTH_MODE === 'supabase') sb();
    return () => listeners.delete(l);
  },
};
