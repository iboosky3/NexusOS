import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:13123";
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => void dialog.accept());

async function openPlugin() {
  await page.getByRole("button", { name: "插件", exact: true }).click();
  const card = page.locator("article").filter({ has: page.getByText("自由原型试验", { exact: true }) });
  assert.equal(await card.count(), 1);
  await card.getByRole("button", { name: "打开" }).click();
  return page.getByRole("region", { name: "自由原型插件" });
}

try {
  await page.goto(`${base}/prd-studio`);
  let panel = await openPlugin();
  await panel.getByRole("button", { name: "新建自由原型" }).click();
  const editor = page.getByRole("region", { name: "自由原型编辑器" });
  await editor.getByLabel("GrapesJS 画布").waitFor({ timeout: 20000 });
  await editor.getByLabel("自由原型名称").fill("工作台入口回归");
  await editor.getByLabel("自由原型说明").fill("从常用工作台创建独立原型。");
  await page.locator(".gjs-block").filter({ hasText: "标题" }).click();
  await page.frameLocator("iframe.gjs-frame").getByText("页面标题").waitFor();
  await editor.getByRole("button", { name: "保存草稿" }).click();
  await panel.getByRole("status").filter({ hasText: "已保存" }).waitFor();
  await page.reload();
  panel = await openPlugin();
  await panel.getByLabel("打开自由原型").selectOption({ label: "工作台入口回归 · r2" });
  await page.frameLocator("iframe.gjs-frame").getByText("页面标题").waitFor({ timeout: 20000 });
  await page.getByRole("region", { name: "自由原型编辑器" }).getByRole("button", { name: "一键清空画布" }).click();
  await page.frameLocator("iframe.gjs-frame").getByText("页面标题").waitFor({ state: "detached" });
  await page.getByRole("region", { name: "自由原型编辑器" }).getByRole("button", { name: "保存草稿" }).click();
  await panel.getByRole("status").filter({ hasText: "已保存 r3" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: PRD Studio plugin panel opens GrapesJS, preserves resources, and clears canvas");
} finally { await browser.close(); }
