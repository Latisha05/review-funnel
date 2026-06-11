// Cloudflare Pages Function for the root route.
// Bare root with no review context (?business / ?qr) goes to the login page.
// Real QR review links (?business=...&qr=...) still open the review page (index.html).
export async function onRequestGet(ctx) {
  const url = new URL(ctx.request.url);
  const hasReviewContext = url.searchParams.has("business") || url.searchParams.has("qr");
  if (!hasReviewContext) {
    return Response.redirect(new URL("/login", ctx.request.url).href, 302);
  }
  return ctx.env.ASSETS.fetch(new Request(new URL("/index.html", ctx.request.url), ctx.request));
}
