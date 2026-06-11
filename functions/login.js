// Always serve the login page directly. We deliberately do NOT server-redirect an
// already-authenticated visitor to /dashboard here — that, paired with the dashboard's
// "no session -> /login" guard, could form a redirect loop on the custom domain.
// The login page's own script redirects to /dashboard client-side when a session exists.
export async function onRequestGet(ctx) {
  return ctx.env.ASSETS.fetch(new Request(new URL("/login.html", ctx.request.url), ctx.request));
}
