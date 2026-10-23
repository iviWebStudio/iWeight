import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const PASSWORD = 'password-123';

/** Signs up a fresh user and completes onboarding; returns the email. */
export async function newUser(
  page: Page,
  opts: { name?: string; weight?: string; target?: string } = {},
): Promise<string> {
  const email = `e2e-${randomUUID()}@test.local`;
  await page.goto('/signup');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.fill('#name', opts.name ?? 'Анна');
  await page.getByRole('button', { name: 'Далее' }).click();
  await page.fill('#weight', opts.weight ?? '82,4');
  if (opts.target) await page.fill('#target', opts.target);
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page).toHaveURL(/\/$/);
  return email;
}

export async function nav(page: Page, label: string) {
  const vp = page.viewportSize();
  const scope = vp && vp.width <= 760 ? page.locator('.tabbar') : page.locator('.side');
  await scope.getByRole('link', { name: label }).click();
}
