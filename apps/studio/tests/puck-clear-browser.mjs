import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:13123";
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("dialog", (dialog) => void dialog.accept());
try {
  await page.goto(`${base}/prd-studio`);
  await page.locator("button").filter({ hasText: "原型设计" }).first().click();
  const designer = page.getByLabel("拖拽原型设计器");
  await designer.waitFor();
  await designer.getByRole("button", { name: "代码", exact: true }).click();
  const source = designer.getByLabel("结构化原型 JSON");
  const design = JSON.parse(await source.inputValue());
  design.content = [{ type: "Heading", props: { id: "clear-test", label: "待清空标题", detail: "", target: "", tone: "green", left: [], right: [] } }];
  await source.fill(JSON.stringify(design));
  await designer.getByRole("button", { name: "应用代码" }).click();
  const clear = designer.getByRole("button", { name: "一键清空画布" });
  assert.equal(await clear.isEnabled(), true);
  await clear.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="拖拽原型设计器"] button')]
    .some((button) => button.textContent?.includes("一键清空画布") && button.hasAttribute("disabled")));
  assert.deepEqual(errors, []);
  console.log("PASS: Puck clear removes current-page components");
} finally { await browser.close(); }
