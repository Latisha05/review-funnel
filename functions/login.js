import { requireSession } from "./_auth.js";

export async function onRequestGet(ctx) {
  const session = await requireSession(ctx);
  if (session) {
    return Response.redirect(new URL("/dashboard", ctx.request.url).href, 302);
  }
  return ctx.env.ASSETS.fetch(new Request(new URL("/login.html", ctx.request.url), ctx.request));
}
