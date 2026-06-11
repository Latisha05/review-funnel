import { requireSession } from "./_auth.js";

export async function onRequestGet(ctx) {
  const session = await requireSession(ctx);
  if (!session) {
    return Response.redirect(new URL("/login", ctx.request.url).href, 302);
  }
  const assetPath = session.role === "admin" ? "/admin.html" : "/dashboard.html";
  return ctx.env.ASSETS.fetch(new Request(new URL(assetPath, ctx.request.url), ctx.request));
}
