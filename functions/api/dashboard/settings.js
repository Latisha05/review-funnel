import {
  getMergedEnv, getPublicConfig, getDynamicQrUrl, getReviewPageUrl,
  EDITABLE_SETTINGS, firestoreGet, firestoreList, firestorePatch, parseList,
  json, jsonError,
} from "../../_shared.js";
import { requireSession, resolveTenant } from "../../_auth.js";

export async function onRequestGet(ctx) {
  try {
    const session = await requireSession(ctx);
    if (!session) return jsonError("Authentication required.", 401);
    const { clientId } = resolveTenant(ctx, session);
    const env = await getMergedEnv(ctx.env);
    return json(await buildSettingsResponse(env, ctx.request, clientId));
  } catch (e) {
    return jsonError(e.message);
  }
}

export async function onRequestPost(ctx) {
  try {
    const session = await requireSession(ctx);
    if (!session) return jsonError("Authentication required.", 401);
    const { clientId } = resolveTenant(ctx, session);
    const env = await getMergedEnv(ctx.env);
    const body = await ctx.request.json();
    const updates = body?.settings || {};
    const clean = {};

    for (const [key, value] of Object.entries(updates)) {
      if (!EDITABLE_SETTINGS.has(key)) continue;
      clean[key] = normalizeValue(key, value);
    }

    if (!Object.keys(clean).length) return jsonError("No editable settings provided.", 400);

    await saveTenantSettings(env, clientId, clean);
    const merged = await getMergedEnv(ctx.env);
    return json({ ok: true, savedAt: new Date().toISOString(), ...(await buildSettingsResponse(merged, ctx.request, clientId)) });
  } catch (e) {
    return jsonError(e.message);
  }
}

async function buildSettingsResponse(env, request, clientId) {
  const business = await firestoreGet(env, `businesses/${clientId}`);
  const qrCode = await getDefaultQrCode(env, clientId);
  const config = getPublicConfig(env, qrCode, business);
  const origin = new URL(request.url).origin;
  const hasFirebase = Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);

  const settings = {
    APP_BUSINESS_NAME: config.businessName,
    APP_BASE_URL: env.APP_BASE_URL || origin,
    BUSINESS_ID: config.businessId,
    BRANCH_ID: qrCode?.branchId || config.branchId,
    BRANCH_NAME: qrCode?.branchName || config.branchName,
    QR_CODE_ID: qrCode?.qrCodeId || config.qrCodeId,
    QR_CODE_LABEL: qrCode?.label || config.qrLabel,
    GOOGLE_PLACE_ID: config.googlePlaceId,
    REVIEW_TOPICS: config.reviewTopics.join(","),
    FEEDBACK_TOPICS: config.feedbackTopics.join(","),
    GEMINI_MODEL: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    REVIEW_SYSTEM_PROMPT: config.reviewSystemPrompt,
    AI_TONE: config.aiTone,
    AI_LENGTH: config.aiLength,
  };

  return {
    settings,
    derived: {
      dynamicQrUrl: getDynamicQrUrl(env, config.qrCodeId),
      localDynamicQrUrl: `${origin}/r/${encodeURIComponent(config.qrCodeId)}`,
      reviewPageUrl: `${origin}${getReviewPageUrl(env, config.qrCodeId, qrCode, business)}`,
      hasFirebaseCredentials: hasFirebase,
      firebaseStatus: hasFirebase ? "connected" : "not_configured",
      firebaseError: "",
      logoUrl: config.logoUrl,
    },
  };
}

async function saveTenantSettings(env, clientId, clean) {
  const now = new Date().toISOString();
  const updates = { businessId: clientId, updatedAt: now };
  if ("APP_BUSINESS_NAME" in clean) updates.name = clean.APP_BUSINESS_NAME;
  if ("GOOGLE_PLACE_ID" in clean) updates.googlePlaceId = clean.GOOGLE_PLACE_ID;
  if ("REVIEW_TOPICS" in clean) updates.reviewTopics = clean.REVIEW_TOPICS;
  if ("FEEDBACK_TOPICS" in clean) updates.feedbackTopics = clean.FEEDBACK_TOPICS;
  if ("REVIEW_SYSTEM_PROMPT" in clean) updates.reviewSystemPrompt = clean.REVIEW_SYSTEM_PROMPT;
  if ("AI_TONE" in clean) updates.aiTone = clean.AI_TONE;
  if ("AI_LENGTH" in clean) updates.aiLength = clean.AI_LENGTH;
  await firestorePatch(env, `businesses/${clientId}`, updates);

  const qrCodeId = normalizeSlug(clean.QR_CODE_ID || "");
  if (qrCodeId) {
    await firestorePatch(env, `qrCodes/${qrCodeId}`, {
      businessId: clientId,
      qrCodeId,
      branchId: normalizeSlug(clean.BRANCH_ID || "main"),
      branchName: clean.BRANCH_NAME || "Main",
      label: clean.QR_CODE_LABEL || qrCodeId,
      status: "active",
      updatedAt: now,
      createdAt: now,
    });
  }
}

async function getDefaultQrCode(env, clientId) {
  const qrCodes = await firestoreList(env, "qrCodes");
  return qrCodes.find((qr) => qr.businessId === clientId && qr.status !== "deleted") || null;
}

function normalizeValue(key, value) {
  if (key === "REVIEW_TOPICS" || key === "FEEDBACK_TOPICS") {
    return parseList(value, "").slice(0, 12).join(",");
  }
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeSlug(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
