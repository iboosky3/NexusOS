import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const suffix = path.join("/");
  if (!/^(configuration|documents(?:\/[a-f0-9]{32}(?:\/(versions|jobs))?)?|jobs\/[a-f0-9]{32}(?:\/cancel)?)$/.test(suffix)) {
    return NextResponse.json({ detail: "接口不存在" }, { status: 404 });
  }
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
      return NextResponse.json({ detail: "请求来源不匹配" }, { status: 403 });
    }
  }
  try {
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && body.length > 1000000) {
      return NextResponse.json({ detail: "提交内容过大，请精简材料" }, { status: 413 });
    }
    const base = (process.env.NEXUS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/v1/prd/${suffix}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ detail: "无法连接文档服务，请检查 API 是否已启动。当前编辑仍保留在浏览器中。" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
