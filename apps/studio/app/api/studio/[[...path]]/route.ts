import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  const path = (await context.params).path || [];
  if (path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) return NextResponse.json({ detail: "无效路径" }, { status: 400 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  if (request.method !== "GET" && origin && origin !== request.nextUrl.origin && origin !== `${protocol}://${host}`)
    return NextResponse.json({ detail: "请求来源不匹配" }, { status: 403 });
  try {
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && new TextEncoder().encode(body).length > 1000000) return NextResponse.json({ detail: "内容超过 1 MB" }, { status: 413 });
    const base = (process.env.NEXUS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/v1/studio/workspaces${path.length ? `/${path.join("/")}` : ""}${request.nextUrl.search}`, {
      method: request.method, headers: { "Content-Type": "application/json" }, body, cache: "no-store", signal: AbortSignal.timeout(20000),
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ detail: "无法连接工作区服务；当前草稿仍保留在浏览器中。" }, { status: 502 }); }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
