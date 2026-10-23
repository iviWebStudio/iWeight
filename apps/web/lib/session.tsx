'use client';
/** App-wide session: auth state and the signed-in user's profile. */
import type { Me } from '@weight-ai/contracts';
import { localDateInTimeZone } from '@weight-ai/core';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api';
import { auth } from './auth';

interface Session {
  status: 'loading' | 'signed-out' | 'ready' | 'error';
  me: Me | null;
  today: string;
  reloadMe: () => Promise<void>;
  setMe: (me: Me) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Session | null>(null);
export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
/** For screens inside the app shell, where a profile is guaranteed. */
export function useMe(): Me & { today: string } {
  const s = useSession();
  if (!s.me) throw new Error('useMe without a profile');
  return { ...s.me, today: s.today };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Session['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const reloadMe = useCallback(async () => {
    if (!(await auth.getToken())) {
      setMe(null);
      setStatus('signed-out');
      return;
    }
    try {
      setMe(await api.me());
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
        await auth.signOut();
        setMe(null);
        setStatus('signed-out');
      } else setStatus('error');
    }
  }, []);

  useEffect(() => {
    void reloadMe();
    return auth.subscribe(() => void reloadMe());
  }, [reloadMe]);

  const value = useMemo<Session>(
    () => ({
      status,
      me,
      today: me ? localDateInTimeZone(new Date(), me.timezone) : '',
      reloadMe,
      setMe,
      signOut: async () => {
        await auth.signOut();
        setMe(null);
        setStatus('signed-out');
      },
    }),
    [status, me, reloadMe],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Sends the visitor where they belong: sign-in, onboarding or the app. */
export function useGuard(kind: 'app' | 'auth' | 'onboarding'): Session {
  const s = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (s.status === 'signed-out' && kind !== 'auth')
      router.replace(`/login?next=${encodeURIComponent(path)}`);
    if (s.status === 'ready' && s.me) {
      const onboarded = Boolean(s.me.onboardedAt);
      if (kind === 'auth') router.replace(onboarded ? '/' : '/onboarding');
      if (kind === 'app' && !onboarded) router.replace('/onboarding');
      if (kind === 'onboarding' && onboarded) router.replace('/');
    }
  }, [s.status, s.me, kind, router, path]);
  return s;
}
