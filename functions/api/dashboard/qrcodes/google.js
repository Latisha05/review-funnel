import { getMergedEnv, firestoreGet, firestorePatch, json, jsonError } from "../../../_shared.js";
import { requireSession, resolveTenant, assertTenantAccess } from "../../../_auth.js";

// Set the per-branch Google review URL / Place ID on an existing tracker.
export async function onRequestPost(ctx) {
  try {
    const session = await requireSession(ctx);
    if (!session) return jsonError("Authentication required.", 401);
    const { clientId } = resolveTenant(ctx, session);
    const env = await getMergedEnv(ctx.env);
    const body = await ctx.request.json();
    const qrCodeId = String(body?.qrCodeId || "").trim();
    if (!qrCodeId) return jsonError("Missing QR Code ID.", 400);

    const existing = await firestoreGet(env, `qrCodes/${qrCodeId}`);
    const denied = assertTenantAccess(existing, clientId);
    if (denied) return denied;

    const googlePlaceId = String(body?.googlePlaceId || "").replace(/[\r\n]+/g, " ").trim().slice(0, 300);
    await firestorePatch(env, `qrCodes/${qrCodeId}`, { googlePlaceId, updatedAt: new Date().toISOString() });
    return json({ ok: true, googlePlaceId });
  } catch (e) {
    return jsonError(e.message);
  }
}
