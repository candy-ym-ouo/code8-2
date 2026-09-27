import { expect, test } from '@playwright/test';

async function registerAndCreateBook(page: import('@playwright/test').Page, title: string): Promise<void> {
  const email = `acceptance-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: true }).fill('acceptance-password');
  await page.getByLabel('确认密码').fill('acceptance-password');
  await page.getByRole('button', { name: '创建账号' }).click();

  await expect(page.getByRole('heading', { name: '我的书' })).toBeVisible();
  await page.getByRole('link', { name: '添加第一本书' }).click();
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('总页数').fill('300');
  await page.getByRole('button', { name: '保存书目' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

async function createDogEar(page: import('@playwright/test').Page, pageNumber: string, reason: string): Promise<void> {
  await page.getByRole('button', { name: '记一次折角' }).click();
  await page.getByLabel('页码').fill(pageNumber);
  await page.getByLabel('折角原因（可选）').fill(reason);
  await page.getByRole('button', { name: '保存痕迹' }).click();
}

test('new user can create a book and keep a dog ear', async ({ page }) => {
  await registerAndCreateBook(page, '验收测试书');
  await createDogEar(page, '42', '这一页与当下有关。');

  await expect(page.getByText('第 42 页', { exact: true })).toBeVisible();
  await expect(page.getByText('这一页与当下有关。')).toBeVisible();
});

test('reader can jump to pages and counts, order and location refresh after delete and restore', async ({ page }) => {
  await registerAndCreateBook(page, '跳页定位验收书');

  await createDogEar(page, '42', '这一页与当下有关。');
  await expect(page.getByRole('tab', { name: '折角 1', exact: true })).toBeVisible();
  await expect(page.getByText('已定位第 42 页')).toBeVisible();

  await createDogEar(page, '100', '之后再读。');
  await expect(page.getByText('已定位第 100 页')).toBeVisible();
  await expect(page.getByRole('tab', { name: '折角 2', exact: true })).toBeVisible();
  await expect(page.getByText('这一页与当下有关。')).toBeHidden();

  await page.getByRole('button', { name: '清除' }).click();
  await expect(page.getByText('第 42 页', { exact: true })).toBeVisible();
  await expect(page.getByText('第 100 页', { exact: true })).toBeVisible();
  expect(await page.getByText(/^第 \d+ 页$/).allTextContents()).toEqual(['第 42 页', '第 100 页']);

  await page.getByLabel('跳到第几页').fill('42');
  await page.getByRole('button', { name: '过滤定位' }).click();
  await expect(page.getByText('已定位第 42 页')).toBeVisible();
  await expect(page.getByText('第 100 页', { exact: true })).toBeHidden();
  await expect(page.getByText('这一页与当下有关。')).toBeVisible();

  page.on('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('tab', { name: '折角 1', exact: true })).toBeVisible();
  await expect(page.getByText('没有符合当前过滤的痕迹')).toBeVisible();
  await expect(page.getByText('第 42 页', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: /撤销删除/ }).click();
  await expect(page.getByRole('tab', { name: '折角 2', exact: true })).toBeVisible();
  await expect(page.getByText('已定位第 42 页')).toBeVisible();
  await expect(page.getByText('这一页与当下有关。')).toBeVisible();
});
