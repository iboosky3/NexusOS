/** The host transports opaque input; only this plugin knows component selection shape. */
export function componentInput(selection: unknown): Record<string, unknown> {
  if (!selection || typeof selection !== "object") throw new Error("请先在原型画布中选择组件");
  const value = selection as { pageId?: unknown; block?: { props?: { id?: unknown } } };
  if (typeof value.pageId !== "string" || !value.pageId || typeof value.block?.props?.id !== "string" || !value.block.props.id) {
    throw new Error("当前选择不是可编辑的原型组件，请重新选择");
  }
  return { pageId: value.pageId, componentId: value.block.props.id };
}
