import type { Editor } from "grapesjs";

/** Fixed components with editable text and CSS; no executable scripts or HTML import. */
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
  ] as const;
  for (const [id, label, content] of blocks) editor.Blocks.add(id, { label, category: "原型组件", content,
    onClick: (block, current) => {
      const content = block.get("content");
      if (typeof content === "string") current.getWrapper()?.append(content);
    } });
}
