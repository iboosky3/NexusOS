import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.STUDIO_TEST_URL || "http://127.0.0.1:13123";
const profile = await mkdtemp(join(tmpdir(), "nexus-draft-browser-"));
let context;
let page;
const errors = [];
async function api(path, method = "GET", data) {
  const response = await fetch(`${base}/api/studio${path}`, { method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
  assert.ok(response.ok, await response.clone().text());
  return response.json();
}
async function reopen(url) {
  if (context) await context.close();
  context = await chromium.launchPersistentContext(profile, { headless: true });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(url);
}
async function restore(panel) {
  await panel.locator("summary").first().click();
  await panel.getByRole("button", { name: "恢复这份草稿", exact: true }).first().click();
}
try {
  const workspace = await api("", "POST", { title: "持久草稿验收", clientRequestId: crypto.randomUUID() });
  const resource = await api(`/${workspace.id}/resources`, "POST", { resourceType: "nexus.prd", payload: { brief: { title: "恢复测试" }, content: "服务器正文" }, clientRequestId: crypto.randomUUID() });
  const url = `${base}/studio?workspace=${workspace.id}&resource=${resource.id}`;
  await reopen(url);
  let editor = page.getByRole("textbox", { name: "PRD 正文", exact: true });
  await editor.fill("关闭浏览器前的未保存正文");
  await reopen(url); // Actually closes Chromium; reuses only its durable user-data directory.
  editor = page.getByRole("textbox", { name: "PRD 正文", exact: true });
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "服务器正文");
  await restore(page.getByLabel("可恢复的本地草稿", { exact: true }));
  await page.waitForFunction(() => document.querySelector('textarea[aria-label="PRD 正文"]')?.value === "关闭浏览器前的未保存正文");
  assert.equal((await api(`/${workspace.id}/resources/${resource.id}`)).revision, 1);
  await editor.press("Control+s");
  await page.getByRole("status").filter({ hasText: "已保存 r2" }).waitFor();

  // The server commits, but the response is lost. Reopening retries exactly that request.
  await editor.fill("已提交但回包丢失的正文");
  await page.route(`**/api/studio/${workspace.id}/resources/${resource.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch(); assert.ok(response.ok()); await route.abort("failed");
  });
  await editor.press("Control+s");
  await page.getByRole("alert").filter({ hasText: "保存未确认" }).waitFor();
  assert.equal((await api(`/${workspace.id}/resources/${resource.id}`)).revision, 3);
  await reopen(url);
  editor = page.getByRole("textbox", { name: "PRD 正文", exact: true });
  await editor.waitFor();
  await restore(page.getByLabel("可恢复的本地草稿", { exact: true }));
  await page.getByRole("status").filter({ hasText: "已恢复本地草稿" }).waitFor();
  await editor.press("Control+s");
  await page.getByRole("status").filter({ hasText: "已保存 r3" }).waitFor();
  assert.equal((await api(`/${workspace.id}/resources/${resource.id}`)).revision, 3);

  // A corrupted plugin payload must not reach the editor or disappear during recovery.
  await editor.fill("损坏记录的原始文本");
  const corrupted = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((key) => key.startsWith("nexus:drafts:v1:resource"));
    const record = JSON.parse(localStorage.getItem(key)); record.data.payload.brief = null;
    const raw = JSON.stringify(record); localStorage.setItem(key, raw); return { key, raw };
  });
  await page.reload();
  await page.getByRole("alert").filter({ hasText: "部分草稿无法恢复" }).waitFor();
  await editor.waitFor();
  assert.equal(await editor.inputValue(), "已提交但回包丢失的正文");
  const damagedPanel = page.getByLabel("可恢复的本地草稿", { exact: true });
  await damagedPanel.locator("summary").first().click();
  const downloadPromise = page.waitForEvent("download");
  await damagedPanel.getByRole("button", { name: "下载草稿备份", exact: true }).first().click();
  const download = await downloadPromise;
  assert.equal(await readFile(await download.path(), "utf8"), corrupted.raw);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), corrupted.key), corrupted.raw);

  // Quota errors remain visible, while in-memory editing and explicit server saving work.
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("nexus:drafts:v1:")) throw new DOMException("quota", "QuotaExceededError");
      return window.originalStorageSet.call(this, key, value);
    };
  });
  await editor.fill("配额失败但内存仍保留");
  await page.getByRole("alert").filter({ hasText: "浏览器无法保存持久草稿" }).waitFor();
  assert.equal(await editor.inputValue(), "配额失败但内存仍保留");
  await page.evaluate(() => { Storage.prototype.setItem = window.originalStorageSet; });
  await editor.press("Control+s");
  await page.getByRole("status").filter({ hasText: "已保存 r4" }).waitFor();
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), corrupted.key), corrupted.raw);

  // Unapplied, even syntactically incomplete, prototype code is also durable.
  const prototype = await api(`/${workspace.id}/resources`, "POST", { resourceType: "nexus.prototype", payload: {
    title: "代码草稿", description: "", prototype: { confirmed: false, pages: [{ id: "home", title: "首页", description: "", elements: [], screenshot: "", design: { engine: "puck", version: 1, width: 960, content: [] } }] },
  }, clientRequestId: crypto.randomUUID() });
  const prototypeUrl = `${base}/studio?workspace=${workspace.id}&resource=${prototype.id}`;
  await page.goto(prototypeUrl);
  await page.getByRole("button", { name: "代码", exact: true }).click();
  let code = page.getByRole("textbox", { name: "结构化原型 JSON", exact: true });
  await code.fill('{"unfinished":');
  await reopen(prototypeUrl);
  await page.getByRole("button", { name: "代码", exact: true }).click();
  code = page.getByRole("textbox", { name: "结构化原型 JSON", exact: true });
  assert.notEqual(await code.inputValue(), '{"unfinished":');
  await restore(page.getByRole("region", { name: "原型代码编辑器" }).getByLabel("可恢复的本地草稿", { exact: true }));
  assert.equal(await code.inputValue(), '{"unfinished":');
  await page.getByRole("button", { name: "应用代码", exact: true }).click();
  await page.getByRole("region", { name: "原型代码编辑器" }).getByRole("alert").waitFor();
  assert.equal((await api(`/${workspace.id}/resources/${prototype.id}`)).revision, 1);
  assert.deepEqual(errors, []);
  console.log("PASS: actual Chromium restart, explicit durable recovery, lost-save receipt replay, damaged payload backup, quota warning and incomplete prototype-code recovery");
} finally {
  if (context) await context.close();
  await rm(profile, { recursive: true, force: true });
}
