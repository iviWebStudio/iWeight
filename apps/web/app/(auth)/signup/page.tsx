import { Suspense } from 'react';
import { AuthForm } from '@/components/AuthForm';

export const metadata = { title: 'Регистрация — Weight AI' };
export default function SignupPage() {
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
