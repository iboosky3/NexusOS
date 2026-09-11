import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const suffix = path.join("/");
  if (!/^(configuration|plans(?:\/[a-f0-9]{32}(?:\/(run|revision|confirmation))?)?)$/.test(suffix))
    return NextResponse.json({ detail: "接口不存在" }, { status: 404 });
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
    if (origin && origin !== request.nextUrl.origin && origin !== `${protocol}://${host}`)
      return NextResponse.json({ detail: "请求来源不匹配" }, { status: 403 });
  }
  try {
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && body.length > 200000)
      return NextResponse.json({ detail: "请求过长" }, { status: 413 });
    const base = (process.env.NEXUS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const response = await fetch(`${base}/v1/planning/${suffix}`, {
      method: request.method, body, headers: { "Content-Type": "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(260000),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ detail: "无法连接规划服务，请检查 API" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
