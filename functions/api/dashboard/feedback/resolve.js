import { getMergedEnv, firestoreGet, firestorePatch, json, jsonError } from "../../../_shared.js";
import { requireSession, resolveTenant, assertTenantAccess } from "../../../_auth.js";

export async function onRequestPost(ctx) {
  try {
    const session = await requireSession(ctx);
    if (!session) return jsonError("Authentication required.", 401);
    const { clientId } = resolveTenant(ctx, session);
    const env = await getMergedEnv(ctx.env);
    const { id, notes } = await ctx.request.json();
    if (!id) return jsonError("Missing feedback ID.", 400);

    const existing = await firestoreGet(env, `feedback/${id}`);
    const denied = assertTenantAccess(existing, clientId);
    if (denied) return denied;

    const updates = {
      status: "resolved",
      resolutionNotes: notes || "",
      resolvedAt: new Date().toISOString(),
    };

    await firestorePatch(env, `feedback/${id}`, updates);
    return json({ ok: true });
  } catch (e) {
    return jsonError(e.message);
  }
}
