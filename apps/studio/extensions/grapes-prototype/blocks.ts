import type { Editor } from "grapesjs";

/** Safe, local components. Executable scripts and remote embeds are excluded by the resource contract. */
export function installBlocks(editor: Editor) {
  const blocks = [
    ["heading", "标题", '<h1 style="font-size:32px;padding:12px">页面标题</h1>'],
    ["text", "文字", '<p style="padding:12px">在此编辑文字，拖动或设置自由定位。</p>'],
    ["button", "按钮", '<button style="padding:12px 20px;border:0;border-radius:8px;background:#197358;color:white">操作按钮</button>'],
    ["input", "输入框", '<input aria-label="输入框" placeholder="请输入" style="padding:12px;border:1px solid #aac5b5;border-radius:8px"/>'],
    ["card", "卡片", '<div style="padding:20px;border:1px solid #dce6df;border-radius:12px;background:white"><h3>卡片标题</h3><p>卡片说明</p></div>'],
    ["list", "列表", '<ul style="padding:20px 32px"><li>列表项目一</li><li>列表项目二</li></ul>'],
    ["divider", "分隔线", '<hr style="border:0;border-top:1px solid #dce6df"/>'],
    ["columns", "双栏", '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;min-height:100px"><div style="padding:12px;border:1px dashed #bed1c5">左栏</div><div style="padding:12px;border:1px dashed #bed1c5">右栏</div></div>'],
    ["grid", "三列网格", '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;min-height:100px"><div style="padding:12px;border:1px dashed #bed1c5">一</div><div style="padding:12px;border:1px dashed #bed1c5">二</div><div style="padding:12px;border:1px dashed #bed1c5">三</div></div>'],
    ["hero", "首屏", '<section style="padding:50px 30px;background:#eef7f0;border-radius:16px"><h1>产品主张</h1><p>说明用户可以在这里完成什么。</p><button style="padding:12px 20px;background:#197358;color:white;border:0;border-radius:8px">开始使用</button></section>'],
    ["checkbox", "勾选项", '<label style="display:block;padding:12px"><input type="checkbox"/> 勾选此项</label>'],
    ["link", "链接", '<a href="#" style="display:inline-block;padding:12px;color:#176b55">页面链接</a>'],
    ["quote", "引用", '<blockquote style="margin:12px;padding:16px;border-left:4px solid #197358">引用文字</blockquote>'],
    ["image", "图片", '<img alt="图片占位" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pVQmH8AAAAASUVORK5CYII=" style="display:block;width:240px;height:160px;background:#e4eee7;object-fit:cover"/>'],
    ["textarea", "多行输入", '<textarea aria-label="多行输入" placeholder="请输入内容" style="width:100%;min-height:100px;padding:12px;border:1px solid #aac5b5"></textarea>'],
    ["select", "选择框", '<select aria-label="选择框" style="padding:12px;border:1px solid #aac5b5"><option>选项一</option><option>选项二</option></select>'],
    ["form", "表单", '<form style="display:grid;gap:12px;padding:16px;border:1px solid #dce6df"><label>姓名 <input placeholder="姓名"/></label><label>备注 <textarea placeholder="备注"></textarea></label><button type="button">提交</button></form>'],
    ["table", "表格", '<table style="width:100%;border-collapse:collapse"><thead><tr><th>名称</th><th>说明</th></tr></thead><tbody><tr><td>项目 A</td><td>描述内容</td></tr><tr><td>项目 B</td><td>描述内容</td></tr></tbody></table>'],
    ["navigation", "导航栏", '<nav style="display:flex;gap:20px;padding:18px;background:#edf6ef"><strong>品牌</strong><a href="#">首页</a><a href="#">功能</a><a href="#">关于</a></nav>'],
    ["footer", "页脚", '<footer style="padding:24px;text-align:center;background:#edf6ef">页脚说明</footer>'],
  ] as const;
  for (const [id, label, content] of blocks) editor.Blocks.add(id, { label, category: "原型组件", content,
    onClick: (block, current) => {
      const content = block.get("content");
      if (typeof content === "string") current.getWrapper()?.append(content);
    } });
}
