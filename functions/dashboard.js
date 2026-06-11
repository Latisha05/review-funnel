import { requireSession } from "./_auth.js";

export async function onRequestGet(ctx) {
  const session = await requireSession(ctx);
  if (!session) {
    return Response.redirect(new URL("/login", ctx.request.url).href, 302);
  }
  // Fetch the CLEAN url (/admin or /dashboard), never the *.html path — Cloudflare
  // 308-redirects *.html to the clean URL, which would re-invoke this function and loop.
  const assetPath = session.role === "admin" ? "/admin" : "/dashboard";
  return ctx.env.ASSETS.fetch(new Request(new URL(assetPath, ctx.request.url), ctx.request));
}
