import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, timeout: 15000 });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors=[];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.STUDIO_TEST_URL || 'http://127.0.0.1:13123'}/`);
  const link=page.getByRole('link', {name: /编写 PRD/});
  assert.equal(await link.getAttribute('href'), '/prd-studio');
  await page.goto(`${process.env.STUDIO_TEST_URL || 'http://127.0.0.1:13123'}/prd-studio`);
  await page.getByRole('heading', {name:'需求简报'}).waitFor();
  await page.getByRole('button', {name:'视图', exact:true}).click();
  await page.getByText('打开文档库', {exact:true}).waitFor();
  await page.getByRole('button', {name:'视图', exact:true}).click();
  await page.getByRole('textbox', {name:/产品名称/}).fill('恢复界面验收');
  await page.getByRole('textbox', {name:/产品构想与使用场景/}).fill('验证保存及后端接口一致。');
  await page.getByRole('button', {name:'文件', exact:true}).click();
  await page.getByText('保存文档 · Ctrl/⌘ S', {exact:true}).click();
  await page.waitForURL(/\?id=[a-f0-9]{32}/);
  await page.reload();
  await page.getByRole('textbox', {name:/产品名称/}).waitFor();
  await page.waitForFunction(() => document.querySelector('#studio-title')?.value === '恢复界面验收');
  assert.equal(await page.getByRole('textbox', {name:/产品名称/}).inputValue(), '恢复界面验收');
  assert.deepEqual(errors, []);
  console.log('PASS: 首页编写 PRD 入口、旧工作台渲染、视图菜单、真实 API 保存与重载、无页面异常');
} finally { await browser.close(); }
