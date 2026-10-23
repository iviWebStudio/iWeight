import { expect, test } from '@playwright/test';
import { nav, newUser, PASSWORD } from './helpers';

test('logged-out visitors are sent to sign in', async ({ page }) => {
  await page.goto('/history');
  await expect(page).toHaveURL(/\/login\?next=%2Fhistory/);
  await expect(page.getByRole('heading', { name: 'Вход' })).toBeVisible();
});

test('sign up, onboarding, dashboard, add, edit and delete an entry', async ({ page }) => {
  await newUser(page, { weight: '82,4', target: '76' });
  await expect(page.getByTestId('latest-weight')).toHaveText('82,4');
  await expect(page.getByText('Цель · снижение')).toBeVisible();
  await expect(page.getByText('осталось 6,4 кг')).toBeVisible();

  // a second weight today does not replace the morning value
  await page.fill('#quick-weight', '83,1');
  await page.getByRole('button', { name: 'Записать', exact: true }).click();
  await expect(page.getByText('Сохранено: 83,1 кг')).toBeVisible();
  await expect(page.getByText('2 записи за день — учтена первая')).toBeVisible();
  await expect(page.getByTestId('latest-weight')).toHaveText('82,4');

  // full form: yesterday's weight
  await nav(page, 'Записать');
  await page.fill('#add-weight', '82,9');
  const y = new Date(Date.now() - 86400000).toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Moscow',
  });
  await page.fill('#add-date', y);
  await page.fill('#add-time', '07:10');
  await page.fill('#add-note', 'до завтрака');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.hero-row .chip').first()).toHaveText('−0,5 кг к вчера');

  // history: edit then delete with confirmation
  await nav(page, 'История');
  const list = page.getByTestId('history');
  await expect(list.getByText('не утреннее — в расчёт не идёт')).toBeVisible();
  await expect(list.getByText('до завтрака')).toBeVisible();
  const row = list.locator('.entry', { hasText: 'до завтрака' });
  await row.getByRole('button', { name: 'Изменить' }).click();
  await page.fill('#edit-weight', '82,7');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Изменения сохранены')).toBeVisible();
  await expect(list.locator('.entry', { hasText: 'до завтрака' })).toContainText('82,7 кг');
  await list
    .locator('.entry', { hasText: 'до завтрака' })
    .getByRole('button', { name: /Удалить/ })
    .click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByText('Запись удалена')).toBeVisible();
  await expect(list.getByText('до завтрака')).toHaveCount(0);
});

test('form validation keeps bad values out', async ({ page }) => {
  await newUser(page);
  await nav(page, 'Записать');
  await page.fill('#add-weight', '7,84');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('[role=alert]:not(#__next-route-announcer__)')).toContainText(
    'Вес должен быть от 20,0 кг до 400,0 кг',
  );
  await expect(page).toHaveURL(/\/add/);
});

test('chat records a weight through the agent and deletes only after confirmation', async ({
  page,
}) => {
  await newUser(page);
  await nav(page, 'Чат');
  await page.fill('#chat-input', 'сегодня 81,7');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.locator('.msg.bot').last()).toContainText('Записал 81,7 кг');
  await expect(page.locator('.tool.write', { hasText: 'add_weight_entry' })).toBeVisible();

  await page.fill('#chat-input', 'удали последнюю запись');
  await page.getByRole('button', { name: 'Отправить' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Подтверждение удаления' });
  await expect(dialog).toContainText('81,7 кг');
  await dialog.getByRole('button', { name: 'Да, удалить' }).click();
  await expect(page.locator('.msg.bot').last()).toContainText('Удалил 81,7 кг');
  await expect(dialog).toHaveCount(0);

  await nav(page, 'История');
  await expect(page.getByTestId('history')).not.toContainText('81,7 кг');

  // the conversation survives a reload
  await nav(page, 'Чат');
  await expect(page.locator('.msg.user', { hasText: 'сегодня 81,7' })).toBeVisible();
});

test('settings: goal, memory, preferences, then account deletion', async ({ page }) => {
  const email = await newUser(page, { weight: '70' });
  await nav(page, 'Настройки');
  await page.fill('#gl-target', '74');
  await page.getByRole('button', { name: 'Поставить цель' }).click();
  await expect(page.getByText('Цель сохранена')).toBeVisible();

  await page.fill('#mem-add', 'Взвешиваюсь после пробежки');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.locator('.mem', { hasText: 'Взвешиваюсь после пробежки' })).toBeVisible();
  await page
    .locator('.mem', { hasText: 'Взвешиваюсь после пробежки' })
    .getByRole('button', { name: 'Удалить' })
    .click();
  await expect(page.getByText('Память пуста.')).toBeVisible();

  await page.selectOption('#ag-report', 'detailed');
  await page.locator('#agent').getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки помощника сохранены')).toBeVisible();

  await nav(page, 'Главная');
  await expect(page.getByText('Цель · набор')).toBeVisible();

  await nav(page, 'Настройки');
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  await page.fill('#acc-confirm', 'нет');
  await page.getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(page.getByText('Введите слово УДАЛИТЬ')).toBeVisible();
  await page.fill('#acc-confirm', 'УДАЛИТЬ');
  await page.getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('[role=alert]:not(#__next-route-announcer__)')).toHaveText(
    'Неверный email или пароль.',
  );
});

test("users do not see each other's entries", async ({ browser }) => {
  const a = await browser.newPage();
  await newUser(a, { name: 'A', weight: '91,3' });
  const b = await browser.newPage();
  await newUser(b, { name: 'B', weight: '64,2' });
  await nav(b, 'История');
  await expect(b.getByTestId('history')).toContainText('64,2 кг');
  await expect(b.getByTestId('history')).not.toContainText('91,3');
});

test('phone layout: tab bar, no sideways scroll @phone', async ({ page }) => {
  await newUser(page);
  await expect(page.locator('.tabbar')).toBeVisible();
  for (const label of ['История', 'Чат', 'Настройки', 'Главная']) {
    await nav(page, label);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal overflow on ${label}`).toBeLessThanOrEqual(0);
  }
});
