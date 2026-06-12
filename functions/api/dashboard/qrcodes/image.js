import { getMergedEnv, firestoreGet, firestorePatch, json, jsonError } from "../../../_shared.js";
import { requireSession, resolveTenant, assertTenantAccess } from "../../../_auth.js";

// Set or clear the QR image (base64 data URL) for an existing tracker.
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

    const qrImageUrl = normalizeQrImage(body?.qrImageUrl);
    await firestorePatch(env, `qrCodes/${qrCodeId}`, { qrImageUrl, updatedAt: new Date().toISOString() });
    return json({ ok: true, qrImageUrl });
  } catch (e) {
    return jsonError(e.message);
  }
}

function normalizeQrImage(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^data:image\/(png|jpe?g|webp|svg\+xml);base64,/i.test(text)) {
    if (text.length > 5_000_000) throw new Error("Image is too large. Please upload an image under ~3 MB.");
    return text;
  }
  if (/^https?:\/\//i.test(text) || text.startsWith("/")) return text;
  return "";
}
