import { getMergedEnv, getDynamicQrUrl, getReviewPageUrl, firestoreList, json, jsonError } from "../../_shared.js";
import { requireSession, resolveTenant } from "../../_auth.js";

export async function onRequestGet(ctx) {
  try {
    const session = await requireSession(ctx);
    if (!session) return jsonError("Authentication required.", 401);
    const { clientId, allTenants } = resolveTenant(ctx, session, { allowAll: true });
    const env = await getMergedEnv(ctx.env);

    if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) {
      return json({ ratings: [], feedback: [], reviewEvents: [], postedReviews: [], scans: [], qrCodes: [], businesses: [], branches: [] });
    }

    const [ratings, feedback, reviewEvents, postedReviews, scans, qrCodes, businesses, branches] = await Promise.all([
      firestoreList(env, "ratings"),
      firestoreList(env, "feedback"),
      firestoreList(env, "reviewEvents"),
      firestoreList(env, "postedReviews"),
      firestoreList(env, "scans"),
      firestoreList(env, "qrCodes"),
      firestoreList(env, "businesses"),
      firestoreList(env, "branches"),
    ]);

    const scoped = filterDashboardData(
      { ratings, feedback, reviewEvents, postedReviews, scans, qrCodes, businesses, branches },
      allTenants ? "" : clientId,
    );

    const scanCounts = scoped.scans.reduce((acc, s) => {
      if (s.qrCodeId) acc[s.qrCodeId] = (acc[s.qrCodeId] || 0) + 1;
      return acc;
    }, {});

    const enrichedQrCodes = scoped.qrCodes.map(qr => ({
      ...qr,
      scanCount: scanCounts[qr.qrCodeId] || Number(qr.scanCount || 0),
      dynamicUrl: qr.dynamicUrl || getDynamicQrUrl(env, qr.qrCodeId),
      targetPath: qr.redirectUrl || qr.targetPath || getReviewPageUrl(env, qr.qrCodeId, qr),
    }));

    return json({
      ratings: scoped.ratings,
      feedback: scoped.feedback,
      reviewEvents: scoped.reviewEvents,
      postedReviews: scoped.postedReviews,
      scans: scoped.scans,
      qrCodes: enrichedQrCodes,
      businesses: scoped.businesses,
      branches: scoped.branches,
    });
  } catch (e) {
    return jsonError(e.message);
  }
}

function filterDashboardData(data, clientId) {
  if (!clientId) return data;
  const matchesBusiness = (item) => item.businessId === clientId;
  return {
    businesses: (data.businesses || []).filter(matchesBusiness),
    branches: (data.branches || []).filter(matchesBusiness),
    ratings: (data.ratings || []).filter(matchesBusiness),
    feedback: (data.feedback || []).filter(matchesBusiness),
    reviewEvents: (data.reviewEvents || []).filter(matchesBusiness),
    postedReviews: (data.postedReviews || []).filter(matchesBusiness),
    scans: (data.scans || []).filter(matchesBusiness),
    qrCodes: (data.qrCodes || []).filter(matchesBusiness),
  };
}
