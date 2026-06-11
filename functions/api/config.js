import { getMergedEnv, getPublicConfig, firestoreGet, json, jsonError } from "../_shared.js";

export async function onRequestGet(ctx) {
  try {
    const env = await getMergedEnv(ctx.env);
    const url = new URL(ctx.request.url);
    const qrCodeId = url.searchParams.get("qr") || url.searchParams.get("qrCodeId") || "";
    const requestedBusinessId = url.searchParams.get("business") || "";
    const hasFirestore = Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
    const qrCode = hasFirestore && qrCodeId ? await firestoreGet(env, `qrCodes/${qrCodeId}`) : null;
    const businessId = qrCode?.businessId || requestedBusinessId || env.BUSINESS_ID || "";
    const business = hasFirestore && businessId ? await firestoreGet(env, `businesses/${businessId}`) : null;
    const config = getPublicConfig(env, qrCode, business);
    const branchOverride = url.searchParams.get("branch");
    if (branchOverride && !qrCode) config.branchId = branchOverride;
    return json(config);
  } catch (e) {
    return jsonError(e.message);
  }
}
