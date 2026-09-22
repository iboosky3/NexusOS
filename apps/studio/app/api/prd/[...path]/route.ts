import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(":", "");
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  return `${protocol}://${host}`;
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const suffix = path.join("/");
  if (!/^(configuration|capabilities(?:\/skills\/[A-Za-z0-9._-]+)?|assistant|documents(?:\/[a-f0-9]{32}(?:\/(versions|jobs|trace))?)?|jobs\/[a-f0-9]{32}(?:\/(cancel|trace|stream|events))?)$/.test(suffix)) {
    return NextResponse.json({ detail: "接口不存在" }, { status: 404 });
  }
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (origin && origin !== requestOrigin(request) && origin !== request.nextUrl.origin) {
      return NextResponse.json({ detail: "请求来源不匹配" }, { status: 403 });
    }
  }
  try {
    const body = request.method === "GET" ? undefined : await request.text();
    if (body && body.length > 1000000) {
      return NextResponse.json({ detail: "提交内容过大，请精简材料" }, { status: 413 });
    }
    const base = (process.env.NEXUS_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
    const query = new URLSearchParams();
    for (const key of ["after", "before", "limit"]) {
      const value = request.nextUrl.searchParams.get(key);
      if (value !== null) query.set(key, value);
    }
    const streaming = suffix.endsWith("/stream");
    const response = await fetch(`${base}/v1/prd/${suffix}?${query}`, {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        Accept: streaming ? "text/event-stream" : "application/json",
      },
      body,
      cache: "no-store",
      signal: streaming ? request.signal : AbortSignal.timeout(suffix === "assistant" ? 120000 : 15000),
    });
    return new NextResponse(streaming ? response.body : await response.text(), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
        "Cache-Control": streaming ? "no-cache, no-transform" : "no-store",
        ...(streaming ? { "X-Accel-Buffering": "no" } : {}),
      },
    });
  } catch {
    return NextResponse.json({ detail: "无法连接文档服务，请检查 API 是否已启动。当前编辑仍保留在浏览器中。" }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
