import { getMergedEnv, firestoreGet, firestorePatch, json, jsonError } from "../../../_shared.js";
import { requireSession, resolveTenant, assertTenantAccess } from "../../../_auth.js";

export async function onRequestDelete(ctx) {
  try {
    const session = await requireSession(ctx);
    if (!session) return jsonError("Authentication required.", 401);
    const { clientId } = resolveTenant(ctx, session);
    const env = await getMergedEnv(ctx.env);
    const qrCodeId = ctx.params.id;
    if (!qrCodeId) return jsonError("Missing QR Code ID.", 400);

    const existing = await firestoreGet(env, `qrCodes/${qrCodeId}`);
    const denied = assertTenantAccess(existing, clientId);
    if (denied) return denied;

    await firestorePatch(env, `qrCodes/${qrCodeId}`, {
      status: "deleted",
      deletedAt: new Date().toISOString(),
    });
    return json({ ok: true });
  } catch (e) {
    return jsonError(e.message);
  }
}
