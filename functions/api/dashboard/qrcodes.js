import {
  getMergedEnv, getPublicConfig, getDynamicQrUrl, getReviewPageUrl,
  firestoreGet, firestorePatch, json, jsonError,
} from "../../_shared.js";
import { requireSession, resolveTenant, assertTenantAccess } from "../../_auth.js";

export async function onRequestPost(ctx) {
  try {
    const session = await requireSession(ctx);
    if (!session) return jsonError("Authentication required.", 401);
    const { clientId } = resolveTenant(ctx, session);
    const env = await getMergedEnv(ctx.env);
    const body = await ctx.request.json();
    const { label, branchName, staff, source, campaign } = body;
    const qrCodeId = normalizeSlug(body.qrCodeId || label || "");
    if (!qrCodeId) return jsonError("Missing QR Code ID.", 400);

    const finalBranchName = String(branchName || env.BRANCH_NAME || "Main").trim();
    const branchId = normalizeSlug(body.branchId || finalBranchName || env.BRANCH_ID || "main");
    const config = getPublicConfig(env, null, { businessId: clientId });
    const redirectUrl = normalizeOptionalUrl(body.redirectUrl);
    const qrImageUrl = normalizeOptionalUrl(body.qrImageUrl);

    const payload = {
      qrCodeId,
      businessId: config.businessId,
      label: String(label || `QR for ${staff || source || campaign || finalBranchName}`).trim(),
      branchId,
      branchName: finalBranchName,
      source: String(source || staff || "").trim(),
      staff: String(staff || "").trim(),
      campaign: String(campaign || "").trim(),
      scanCount: 0,
      dynamicUrl: getDynamicQrUrl(env, qrCodeId),
      targetPath: redirectUrl || getReviewPageUrl(env, qrCodeId, { qrCodeId, businessId: config.businessId, branchId, branchName: finalBranchName }),
      redirectUrl,
      qrImageUrl,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await firestorePatch(env, `qrCodes/${qrCodeId}`, payload);
    return json({ ok: true, qrCode: payload });
  } catch (e) {
    return jsonError(e.message);
  }
}

export async function onRequestDelete(ctx) {
  try {
    const session = await requireSession(ctx);
    if (!session) return jsonError("Authentication required.", 401);
    const { clientId } = resolveTenant(ctx, session);
    const env = await getMergedEnv(ctx.env);
    const url = new URL(ctx.request.url);
    const qrCodeId = decodeURIComponent(url.pathname.split("/").pop());
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

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeOptionalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || text.startsWith("/")) return text;
  return "";
}
