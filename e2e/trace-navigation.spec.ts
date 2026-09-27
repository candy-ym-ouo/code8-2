import { expect, test } from '@playwright/test';

test('trace summary filters and page jumping stay in sync after delete and restore', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());

  const email = `trace-nav-${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: true }).fill('acceptance-password');
  await page.getByLabel('确认密码').fill('acceptance-password');
  await page.getByRole('button', { name: '创建账号' }).click();

  await expect(page.getByRole('heading', { name: '我的书' })).toBeVisible();
  await page.getByRole('link', { name: '添加第一本书' }).click();
  await page.getByLabel('书名').fill('跳页验收书');
  await page.getByLabel('总页数').fill('300');
  await page.getByRole('button', { name: '保存书目' }).click();

  await expect(page.getByRole('heading', { name: '跳页验收书' })).toBeVisible();
  await page.getByRole('button', { name: '记一次折角' }).click();
  await page.getByLabel('页码').fill('10');
  await page.getByRole('button', { name: '保存痕迹' }).click();
  await expect(page.locator('.page-group.located')).toHaveAttribute('data-page-group', '10');

  await page.getByRole('button', { name: '记一次折角' }).click();
  await page.getByLabel('页码').fill('42');
  await page.getByRole('button', { name: '保存痕迹' }).click();
  await expect(page.locator('.page-group.located')).toHaveAttribute('data-page-group', '42');
  await expect(page.getByRole('button', { name: '全部 2' })).toBeVisible();

  // 跳页定位：精确到页
  await page.getByLabel('目标页码').fill('10');
  await page.getByRole('button', { name: '定位', exact: true }).click();
  await expect(page.locator('.page-group.located')).toHaveAttribute('data-page-group', '10');
  await expect(page.locator('.jump-hint')).toHaveText('已定位到第 10 页');

  // 摘要过滤：切到没有痕迹的分类，再切回全部
  await page.getByRole('button', { name: '批注 0' }).click();
  await expect(page.getByText('还没有批注痕迹，换个分类看看。')).toBeVisible();
  await page.getByRole('button', { name: '全部 2' }).click();
  await expect(page.locator('.page-group')).toHaveCount(2);

  // 删除后计数同步减少，所在的页分组消失
  await page.locator('[data-page-group="42"]').getByRole('button', { name: '删除' }).click();
  await expect(page.getByRole('button', { name: '全部 1' })).toBeVisible();
  await expect(page.locator('[data-page-group="42"]')).toHaveCount(0);

  // 撤销后计数恢复，并重新定位到恢复的页
  await page.getByRole('button', { name: /撤销删除/ }).click();
  await expect(page.getByRole('button', { name: '全部 2' })).toBeVisible();
  await expect(page.locator('.page-group.located')).toHaveAttribute('data-page-group', '42');
  await expect(page.locator('.jump-hint')).toHaveText('已定位到第 42 页');
});
