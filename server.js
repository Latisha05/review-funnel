const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const net = require("node:net");
const tls = require("node:tls");

const rootDir = __dirname;
const localDbPath = path.join(rootDir, "data_store.json");
const authStorePath = path.join(rootDir, "auth_store.json");
const sessionCookieName = "rf_session";
const env = { ...loadEnv(path.join(rootDir, ".env")), ...getNonEmptyProcessEnv() };
const port = Number(env.PORT || 5500);
const allowedCollections = new Set(["ratings", "feedback", "reviewEvents", "postedReviews"]);
const editableSettings = new Set([
  "APP_BUSINESS_NAME",
  "APP_BASE_URL",
  "BUSINESS_ID",
  "BRANCH_ID",
  "BRANCH_NAME",
  "QR_CODE_ID",
  "QR_CODE_LABEL",
  "GOOGLE_PLACE_ID",
  "REVIEW_TOPICS",
  "FEEDBACK_TOPICS",
  "GEMINI_MODEL",
  "REVIEW_SYSTEM_PROMPT",
  "AI_TONE",
  "AI_LENGTH",
]);

let accessTokenCache = {
  token: "",
  expiresAt: 0,
};

let firebaseDiagnostics = {
  status: "not_configured",
  error: "",
};

if (process.argv.includes("--bootstrap")) {
  bootstrapFirestore()
    .then(() => console.log("Firestore bootstrap complete."))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
} else {
  bootstrapLocalDbIfEmpty();
  bootstrapPersistentStorage().catch((error) => {
    console.warn("Storage bootstrap warning:", error.message);
  });
  bootstrapAuthStorage().catch((error) => {
    console.warn("Auth bootstrap warning:", error.message);
  });

  http
    .createServer(async (request, response) => {
      try {
        const routeUrl = new URL(request.url, "http://localhost");
        const pathname = routeUrl.pathname;

        if (request.method === "GET" && pathname === "/login") {
          const session = await getActiveSession(request);
          if (session) {
            sendRedirect(response, "/dashboard");
            return;
          }
          serveFile(response, "login.html");
          return;
        }

        if (request.method === "GET" && pathname === "/dashboard") {
          const session = await getActiveSession(request);
          if (!session) {
            sendRedirect(response, "/login");
            return;
          }
          serveFile(response, session.role === "admin" ? "admin.html" : "dashboard.html");
          return;
        }

        if (request.method === "GET" && pathname === "/api/auth/session") {
          sendJson(response, 200, await getAuthSessionResponse(request));
          return;
        }

        if (request.method === "POST" && pathname === "/api/auth/login") {
          const body = await readJson(request);
          await handleLogin(body, request, response);
          return;
        }

        if (request.method === "POST" && pathname === "/api/auth/logout") {
          await handleLogout(request, response);
          return;
        }

        if (request.method === "POST" && pathname === "/api/auth/forgot-password") {
          const body = await readJson(request);
          sendJson(response, 200, await handleForgotPassword(body, request));
          return;
        }

        if (request.method === "POST" && pathname === "/api/auth/reset-password") {
          const body = await readJson(request);
          sendJson(response, 200, await handleResetPassword(body));
          return;
        }

        if (request.method === "GET" && pathname === "/api/config") {
          sendJson(response, 200, await getPublicConfigFromRequest(request));
          return;
        }

        if (request.method === "GET" && pathname === "/api/dashboard/settings") {
          const session = await requireClientSession(request);
          sendJson(response, 200, await getDashboardSettings(request, session));
          return;
        }

        if (request.method === "GET" && pathname === "/api/dashboard/data") {
          const session = await requireClientSession(request);
          sendJson(response, 200, await getDashboardData(request, session));
          return;
        }

        if (request.method === "GET" && pathname.startsWith("/r/")) {
          await handleDynamicQrRedirect(request, response);
          return;
        }

        if (request.method === "POST" && pathname === "/api/dashboard/settings") {
          const session = await requireClientSession(request);
          const body = await readJson(request);
          sendJson(response, 200, await updateDashboardSettings(body, request, session));
          return;
        }

        if (request.method === "POST" && pathname === "/api/events") {
          const body = await readJson(request);
          sendJson(response, 200, await handleEvent(body));
          return;
        }

        if (request.method === "POST" && pathname === "/api/review/generate") {
          const body = await readJson(request);
          sendJson(response, 200, await handleReviewGenerate(body, request));
          return;
        }

        if (request.method === "POST" && pathname === "/api/dashboard/feedback/resolve") {
          const session = await requireClientSession(request);
          const body = await readJson(request);
          sendJson(response, 200, await resolveFeedback(body, request, session));
          return;
        }

        if (request.method === "POST" && pathname === "/api/dashboard/qrcodes") {
          const session = await requireClientSession(request);
          const body = await readJson(request);
          sendJson(response, 200, await addQrCode(body, request, session));
          return;
        }

        if (request.method === "DELETE" && pathname.startsWith("/api/dashboard/qrcodes/")) {
          const session = await requireClientSession(request);
          const qrCodeId = decodeURIComponent(pathname.split("/").pop());
          sendJson(response, 200, await deleteQrCode(qrCodeId, request, session));
          return;
        }

        await serveStatic(request, response);
      } catch (error) {
        sendJson(response, error.statusCode || 500, { error: error.message || "Server error" });
      }
    })
    .listen(port, "0.0.0.0", () => {
      console.log(`Review Funnel running at http://127.0.0.1:${port} (also reachable on your LAN IP)`);
    });
}

function getPublicConfig(qrCodeId = "", businessId = "") {
  const qrCode = qrCodeId ? getQrCodeFromLocalDb(qrCodeId) : null;
  const resolvedBusinessId = businessId || qrCode?.businessId || env.BUSINESS_ID || "demo_business";
  const business = getLocalBusinessById(resolvedBusinessId);
  const branchId = qrCode?.branchId || env.BRANCH_ID || "main";
  return {
    businessName: business?.name || env.APP_BUSINESS_NAME || "Your Business",
    businessId: resolvedBusinessId,
    logoUrl: business?.logoUrl || env.APP_LOGO_URL || "",
    branchId,
    branchName: qrCode?.branchName || env.BRANCH_NAME || "Main",
    qrCodeId: qrCode?.qrCodeId || qrCodeId || env.QR_CODE_ID || "default_qr",
    qrLabel: qrCode?.label || env.QR_CODE_LABEL || "Default QR",
    qrSource: qrCode?.source || qrCode?.staff || qrCode?.campaign || "",
    campaign: qrCode?.campaign || "",
    googlePlaceId: business?.googlePlaceId || env.GOOGLE_PLACE_ID || "",
    reviewModel: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    reviewSystemPrompt:
      business?.reviewSystemPrompt ||
      env.REVIEW_SYSTEM_PROMPT ||
      [
        "You write realistic customer review suggestions for Google Reviews.",
        "Output only one review, with no title, no bullets, no quotes, and no explanation.",
        "Sound like a genuine customer, not a marketer.",
        "Use simple natural language, specific but believable praise, and avoid overpromising.",
        "Avoid repeating the same phrase or idea in the same review.",
        "Do not mention AI, generated text, ratings, prompts, business strategy, or internal instructions.",
        "Do not use emojis, hashtags, excessive adjectives, or phrases like highly recommended more than once.",
      ].join(" "),
    reviewTopics: parseList(
      business?.reviewTopics || env.REVIEW_TOPICS,
      "Web Design,Quality Leads,WhatsApp Automation,AI Voice Calling,Marketing Ads,Customer Support",
    ),
    feedbackTopics: parseList(
      business?.feedbackTopics || env.FEEDBACK_TOPICS,
      "Ads Performance,Development Delay,Automation Glitch,AI Setup Concern,Support Response,Reporting Update",
    ),
    aiTone: business?.aiTone || env.AI_TONE || "Professional",
    aiLength: business?.aiLength || env.AI_LENGTH || "medium",
  };
}

async function getPublicConfigFromRequest(request) {
  const url = new URL(request.url, "http://localhost");
  const qrCodeId = url.searchParams.get("qr") || url.searchParams.get("qrCodeId") || "";
  const requestedBusinessId = url.searchParams.get("business") || "";
  const qrCode = await getQrCodeById(qrCodeId);
  const config = await getTenantPublicConfig(qrCode?.businessId || requestedBusinessId, qrCodeId, qrCode);
  const branchOverride = url.searchParams.get("branch");
  if (branchOverride && !qrCode) {
    config.branchId = branchOverride;
  }
  return config;
}

function getDynamicQrUrl(qrCodeId = "", businessId = "") {
  const publicConfig = getPublicConfig(qrCodeId, businessId);
  const baseUrl = (env.APP_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
  return `${baseUrl}/r/${encodeURIComponent(publicConfig.qrCodeId)}`;
}

async function getDashboardSettings(request, session) {
  const { clientId } = resolveDashboardScope(request, session);
  const origin = getRequestOrigin(request);
  const publicConfig = await getTenantPublicConfig(clientId);
  const settings = await getTenantSettings(clientId, publicConfig);
  return {
    settings,
    derived: {
      dynamicQrUrl: getDynamicQrUrl(publicConfig.qrCodeId, clientId),
      localDynamicQrUrl: `${origin}/r/${encodeURIComponent(publicConfig.qrCodeId)}`,
      reviewPageUrl: `${origin}${getReviewPageUrl(publicConfig.qrCodeId, clientId)}`,
      hasFirebaseCredentials: Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY),
      firebaseStatus: firebaseDiagnostics.status,
      firebaseError: firebaseDiagnostics.error,
      clientMode: session?.role !== "admin",
      logoUrl: publicConfig.logoUrl,
    },
  };
}

async function updateDashboardSettings(body, request, session) {
  if (session?.role !== "admin") {
    const error = new Error("Settings can only be changed by an administrator.");
    error.statusCode = 403;
    throw error;
  }
  const { clientId } = resolveDashboardScope(request, session);
  const updates = body?.settings || {};
  const cleanUpdates = {};

  for (const [key, value] of Object.entries(updates)) {
    if (!editableSettings.has(key)) {
      continue;
    }
    cleanUpdates[key] = normalizeSettingValue(key, value);
  }

  if (!Object.keys(cleanUpdates).length) {
    throw new Error("No editable settings were provided.");
  }

  await saveTenantSettings(clientId, cleanUpdates);

  const dashboardSettings = await getDashboardSettings(request, session);
  return {
    ok: true,
    savedAt: new Date().toISOString(),
    settings: dashboardSettings.settings,
    derived: dashboardSettings.derived,
  };
}

function getEditableFallback(key) {
  const fallbacks = {
    APP_BUSINESS_NAME: "EESWEB",
    APP_BASE_URL: `http://127.0.0.1:${port}`,
    BUSINESS_ID: "eesweb",
    BRANCH_ID: "main",
    BRANCH_NAME: "Main",
    QR_CODE_ID: "eesweb-test",
    QR_CODE_LABEL: "EESWEB Test QR",
    GOOGLE_PLACE_ID: "",
    REVIEW_TOPICS: "Web Design,Quality Leads,WhatsApp Automation,AI Voice Calling,Marketing Ads,Customer Support",
    FEEDBACK_TOPICS: "Ads Performance,Development Delay,Automation Glitch,AI Setup Concern,Support Response,Reporting Update",
    GEMINI_MODEL: "gemini-3.5-flash-lite",
    REVIEW_SYSTEM_PROMPT: getPublicConfig().reviewSystemPrompt,
    AI_TONE: "Professional",
    AI_LENGTH: "medium",
  };
  return fallbacks[key] || "";
}

function normalizeSettingValue(key, value) {
  if (key === "REVIEW_TOPICS" || key === "FEEDBACK_TOPICS") {
    return parseList(value, "")
      .slice(0, 12)
      .join(",");
  }

  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function updateEnvFile(filePath, updates) {
  const currentContents = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const rawJsonIndex = currentContents.search(/^\s*\{/m);
  const envContents = rawJsonIndex >= 0 ? currentContents.slice(0, rawJsonIndex) : currentContents;
  const rawJsonSuffix = rawJsonIndex >= 0 ? currentContents.slice(rawJsonIndex).trimEnd() : "";
  const seenKeys = new Set();
  const updatedLines = envContents.split(/\r?\n/).map((line) => {
    const match = line.match(/^(\s*([A-Z0-9_]+)\s*=)(.*)$/);
    if (!match || !(match[2] in updates)) {
      return line;
    }

    seenKeys.add(match[2]);
    return `${match[2]}=${formatEnvValue(updates[match[2]])}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seenKeys.has(key)) {
      updatedLines.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  const compactEnv = `${updatedLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
  const nextContents = rawJsonSuffix ? `${compactEnv}\n${rawJsonSuffix}\n` : compactEnv;
  fs.writeFileSync(filePath, nextContents, "utf8");
}

function formatEnvValue(value) {
  return JSON.stringify(String(value || ""));
}

function getRequestOrigin(request) {
  const host = request.headers?.host || `127.0.0.1:${port}`;
  return `http://${host}`;
}

function getReviewPageUrl(qrCodeId, businessId = "") {
  const publicConfig = getPublicConfig(qrCodeId, businessId);
  const params = new URLSearchParams({
    business: publicConfig.businessId,
    branch: publicConfig.branchId,
    qr: qrCodeId || publicConfig.qrCodeId,
  });
  if (publicConfig.qrSource) {
    params.set("source", publicConfig.qrSource);
  }
  if (publicConfig.campaign) {
    params.set("campaign", publicConfig.campaign);
  }
  return `/?${params}`;
}

async function handleDynamicQrRedirect(request, response) {
  const qrCodeId = decodeURIComponent(new URL(request.url, "http://localhost").pathname.replace(/^\/r\//, ""));
  try {
    trackQrScan(qrCodeId, request);
  } catch (error) {
    console.warn("Scan tracking error:", error.message);
  }
  const qrCode = await getQrCodeById(qrCodeId);
  const publicConfig = await getTenantPublicConfig(qrCode?.businessId, qrCodeId, qrCode);
  response.writeHead(302, {
    Location: qrCode?.redirectUrl || getReviewPageUrlForContext({
      businessId: publicConfig.businessId,
      branchId: publicConfig.branchId,
      qrCodeId: publicConfig.qrCodeId,
      source: publicConfig.qrSource,
      campaign: publicConfig.campaign,
    }),
    "Cache-Control": "no-store",
  });
  response.end();
}

async function handleEvent(body) {
  if (!body || !allowedCollections.has(body.collection)) {
    throw new Error("Invalid collection.");
  }

  const requestedQrCodeId = body.payload?.qrCodeId || "";
  const qrCode = await getQrCodeById(requestedQrCodeId);
  const publicConfig = await getTenantPublicConfig(qrCode?.businessId || body.payload?.businessId, requestedQrCodeId, qrCode);
  const payload = {
    ...body.payload,
    type: body.type,
    businessId: body.payload?.businessId || publicConfig.businessId,
    branchId: body.payload?.branchId || qrCode?.branchId || publicConfig.branchId,
    branchName: body.payload?.branchName || qrCode?.branchName || publicConfig.branchName,
    qrCodeId: requestedQrCodeId || publicConfig.qrCodeId,
    qrLabel: body.payload?.qrLabel || qrCode?.label || publicConfig.qrLabel,
    source: body.payload?.source || qrCode?.source || qrCode?.staff || publicConfig.qrSource || "",
    campaign: body.payload?.campaign || qrCode?.campaign || publicConfig.campaign || "",
    status: body.collection === "feedback" ? body.payload?.status || "pending" : body.payload?.status,
    userAgent: body.userAgent || "",
    createdAt: new Date().toISOString(),
  };

  let documentPath = "";
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      const document = await createFirestoreDocument(body.collection, payload);
      documentPath = document.name;
    } catch (error) {
      console.warn("Firestore event save failed, using local fallback:", error.message);
    }
  }

  const localPath = saveToLocalJson(body.collection, payload);
  documentPath = documentPath || localPath;
  return { ok: true, path: documentPath };
}

async function handleReviewGenerate(body, request) {
  const apiKey = String(env.GEMINI_API_KEY || "").trim();
  if (!apiKey || apiKey.startsWith("PASTE_") || apiKey === "your_gemini_api_key") {
    throw new Error("Gemini API key is not configured.");
  }

  const qrCodeId = String(body?.qrCodeId || "").trim();
  const qrCode = await getQrCodeById(qrCodeId);
  const publicConfig = await getTenantPublicConfig(qrCode?.businessId || body?.businessId, qrCodeId, qrCode);
  const mode = normalizeReviewMode(body?.mode);
  const topics = parseList(body?.topics || "", "").slice(0, 4);
  const staff = String(body?.staff || "").replace(/[^\p{L}\s.'-]/gu, "").trim().slice(0, 40);
  const vehicle = String(body?.vehicle || "").trim().slice(0, 40);
  const note = String(body?.note || "").replace(/[\r\n]+/g, " ").trim().slice(0, 160);
  const recentReviews = Array.isArray(body?.recentReviews)
    ? body.recentReviews.map((review) => String(review || "").trim()).filter(Boolean).slice(0, 6)
    : [];

  // Admins can pass an overridePrompt to test a draft prompt WITHOUT saving it.
  // This is honoured only for an authenticated admin session, never for the public review page.
  let systemPrompt = publicConfig.reviewSystemPrompt;
  const overridePrompt = String(body?.overridePrompt || "").trim();
  if (overridePrompt) {
    const session = request ? await getActiveSession(request) : null;
    if (session?.role === "admin") {
      systemPrompt = overridePrompt;
    }
  }

  const { systemInstruction, userPrompt } = buildReviewPrompt({
    mode,
    topics,
    staff,
    vehicle,
    note,
    recentReviews,
    systemPrompt,
  });

  const model = encodeURIComponent(env.GEMINI_MODEL || "gemini-3.5-flash");
  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
    generationConfig: {
      temperature: mode === "short" ? 0.6 : 0.7,
      topP: 0.9,
      maxOutputTokens: mode === "long" ? 600 : mode === "medium" ? 400 : 250,
      // gemini-3.5-flash spends ~400+ tokens on internal reasoning before writing, which truncates
      // short reviews. We don't need reasoning for a one-paragraph review, so disable it.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  // gemini-3.5-flash only. On a transient overload (503), retry the SAME model once with a short backoff.
  // Note: the free tier caps this model at ~20 requests/minute, so we keep retries minimal to avoid burning quota.
  const maxAttempts = 2;
  let lastError = "Gemini request failed.";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      const review = String(data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "")
        .replace(/\s*—\s*/g, ". ").replace(/\s*--\s*/g, ". ").replace(/\s+/g, " ").trim();
      if (review) return { review };
      lastError = "Gemini returned an empty review.";
      continue;
    }

    lastError = data?.error?.message || "Gemini request failed.";
    // Only retry transient overloads (503). Quota/rate-limit (429) won't clear on an immediate retry, so fail fast.
    if (response.status !== 503) {
      throw new Error(lastError);
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  throw new Error(lastError);
}

function buildReviewPrompt({ mode, topics, staff, vehicle, note, recentReviews, systemPrompt }) {
  const lengthHints = {
    short: "Keep it to one natural sentence, roughly 12 to 22 words.",
    medium: "Keep it to two short sentences, roughly 25 to 40 words.",
    long: "Keep it to two or three short sentences, roughly 40 to 60 words.",
  };

  // "Others" is a placeholder chip backed by a free-text note - drop it from the appreciated list.
  const displayedTopics = (topics || []).filter((t) => t.toLowerCase() !== "others");

  // The user turn carries ONLY what the admin actually selected. All behaviour
  // (tone, SEO, no-topic handling, formatting) is governed by the system prompt.
  const topicLine = displayedTopics.length
    ? `The customer specifically appreciated: ${displayedTopics.join(", ")}.`
    : "";

  const staffLine = staff ? `Staff member who helped: ${staff}.` : "";
  const vehicleLine = vehicle ? `Vehicle model: ${vehicle}.` : "";
  const noteLine = note
    ? `In their own words, the customer said: "${note}". Turn this into a natural part of the review without copying it word-for-word, and do not add anything they did not say.`
    : "";

  const recentLine = recentReviews.length
    ? `For variety, do not repeat the wording or opening of these recent reviews:\n${recentReviews.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join("\n")}`
    : "";

  const userPrompt = [
    "Write one Google review for Shelar TVS based on the details below.",
    lengthHints[mode] || lengthHints.medium,
    topicLine,
    noteLine,
    staffLine,
    vehicleLine,
    recentLine,
  ].filter(Boolean).join("\n");

  return { systemInstruction: systemPrompt, userPrompt };
}

function normalizeReviewMode(mode) {
  return ["short", "medium", "long"].includes(mode) ? mode : "medium";
}



async function bootstrapFirestore() {
  const publicConfig = getPublicConfig();
  await setFirestoreDocument(`businesses/${publicConfig.businessId}`, {
    businessId: publicConfig.businessId,
    name: publicConfig.businessName,
    googlePlaceId: publicConfig.googlePlaceId,
    reviewTopics: publicConfig.reviewTopics.join(","),
    feedbackTopics: publicConfig.feedbackTopics.join(","),
    reviewSystemPrompt: publicConfig.reviewSystemPrompt,
    aiTone: publicConfig.aiTone,
    aiLength: publicConfig.aiLength,
    status: "active",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  await setFirestoreDocument(`branches/${publicConfig.branchId}`, {
    businessId: publicConfig.businessId,
    name: env.BRANCH_NAME || "Main",
    status: "active",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
  await setFirestoreDocument(`qrCodes/${publicConfig.qrCodeId}`, {
    businessId: publicConfig.businessId,
    branchId: publicConfig.branchId,
    label: env.QR_CODE_LABEL || "Default QR",
    dynamicUrl: getDynamicQrUrl(),
    targetPath: getReviewPageUrl(publicConfig.qrCodeId),
    status: "active",
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });
}

async function bootstrapPersistentStorage() {
  ensureLocalBaseDocuments();
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    await bootstrapFirestore();
  }
}

async function createFirestoreDocument(collection, data) {
  const projectId = requireEnv("FIREBASE_PROJECT_ID");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`;
  return firestoreRequest(url, "POST", toFirestoreDocument(data));
}

async function setFirestoreDocument(documentPath, data) {
  const projectId = requireEnv("FIREBASE_PROJECT_ID");
  const fieldPaths = Object.keys(data)
    .filter((key) => data[key] !== undefined)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join("&");
  const suffix = fieldPaths ? `?${fieldPaths}` : "";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}${suffix}`;
  return firestoreRequest(url, "PATCH", toFirestoreDocument(data));
}

async function firestoreRequest(url, method, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    firebaseDiagnostics.status = "error";
    firebaseDiagnostics.error = data.error?.message || "Firestore request failed.";
    throw new Error(firebaseDiagnostics.error);
  }
  firebaseDiagnostics.status = "connected";
  firebaseDiagnostics.error = "";
  return data;
}

async function getAccessToken() {
  if (accessTokenCache.token && accessTokenCache.expiresAt > Date.now() + 60_000) {
    return accessTokenCache.token;
  }

  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = [
    base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    base64Url(
      JSON.stringify({
        iss: requireEnv("FIREBASE_CLIENT_EMAIL"),
        scope: "https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  ].join(".");
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsignedJwt)
    .sign(normalizePrivateKey(requireEnv("FIREBASE_PRIVATE_KEY")));
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    firebaseDiagnostics.status = "error";
    firebaseDiagnostics.error = data.error_description || data.error || "Failed to get Firebase access token.";
    throw new Error(firebaseDiagnostics.error);
  }

  accessTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  firebaseDiagnostics.status = "connected";
  firebaseDiagnostics.error = "";
  return accessTokenCache.token;
}

function toFirestoreDocument(data) {
  return {
    fields: Object.fromEntries(
      Object.entries(data)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, toFirestoreValue(value)]),
    ),
  };
}

function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Number.isInteger(value)) return { integerValue: value };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, nestedValue]) => nestedValue !== undefined)
            .map(([key, nestedValue]) => [key, toFirestoreValue(nestedValue)]),
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

async function serveStatic(request, response) {
  const requestedPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (
    requestedPath.includes("data_store.json") ||
    requestedPath.includes("auth_store.json") ||
    requestedPath.includes(".env") ||
    requestedPath.includes(".git")
  ) {
    sendText(response, 403, "Forbidden");
    return;
  }
  const safePath = requestedPath === "/" ? "/index.html" : requestedPath;
  const filePath = path.normalize(path.join(rootDir, safePath));
  if (!filePath.startsWith(rootDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }
  const contentType = getContentType(filePath);
  const noCache = contentType.includes("javascript") || contentType.includes("css") || contentType.includes("html");
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": noCache ? "no-store" : "max-age=3600",
  });
  fs.createReadStream(filePath).pipe(response);
}

function serveFile(response, relativePath) {
  const filePath = path.normalize(path.join(rootDir, relativePath));
  if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(response, 404, "Not found");
    return;
  }
  const contentType = getContentType(filePath);
  const noCache = contentType.includes("javascript") || contentType.includes("css") || contentType.includes("html");
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": noCache ? "no-store" : "max-age=3600",
  });
  fs.createReadStream(filePath).pipe(response);
}

function sendRedirect(response, location, statusCode = 302) {
  response.writeHead(statusCode, {
    Location: location,
    "Cache-Control": "no-store",
  });
  response.end();
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let rawBody = "";
    request.on("data", (chunk) => {
      rawBody += chunk;
      if (rawBody.length > 1_000_000) reject(new Error("Request body too large."));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(rawBody || "{}"));
      } catch {
        reject(new Error("Invalid JSON."));
      }
    });
  });
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const fileContents = fs.readFileSync(filePath, "utf8");
  const rawJsonIndex = fileContents.search(/^\s*\{/m);
  const envContents = rawJsonIndex >= 0 ? fileContents.slice(0, rawJsonIndex) : fileContents;
  const rawJson = rawJsonIndex >= 0 ? fileContents.slice(rawJsonIndex).trim() : "";
  const parsedEnv = Object.fromEntries(
    envContents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const equalsIndex = line.indexOf("=");
        const key = line.slice(0, equalsIndex).trim();
        const rawValue = line.slice(equalsIndex + 1).trim();
        return [key, rawValue.replace(/^["']|["']$/g, "")];
      }),
  );

  const serviceAccount = parseServiceAccountJson(parsedEnv.FIREBASE_SERVICE_ACCOUNT_JSON || rawJson);
  if (serviceAccount) {
    if (isMissingEnvValue(parsedEnv.FIREBASE_PROJECT_ID)) {
      parsedEnv.FIREBASE_PROJECT_ID = serviceAccount.project_id;
    }
    if (isMissingEnvValue(parsedEnv.FIREBASE_CLIENT_EMAIL)) {
      parsedEnv.FIREBASE_CLIENT_EMAIL = serviceAccount.client_email;
    }
    if (isMissingEnvValue(parsedEnv.FIREBASE_PRIVATE_KEY)) {
      parsedEnv.FIREBASE_PRIVATE_KEY = serviceAccount.private_key;
    }
  }

  return parsedEnv;
}

function getNonEmptyProcessEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => String(value || "").trim() !== ""),
  );
}

function isMissingEnvValue(value) {
  return !value || value.startsWith("PASTE_") || value.includes("PASTE_PRIVATE_KEY");
}

function parseServiceAccountJson(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value.replace(/^["']|["']$/g, ""));
    if (parsed.type !== "service_account") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function parseList(value, fallback) {
  return String(value || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireEnv(name) {
  if (!env[name]) throw new Error(`Missing ${name} in .env`);
  return env[name];
}

function normalizePrivateKey(value) {
  return value.replace(/\\n/g, "\n");
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
    }[extension] || "application/octet-stream"
  );
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

async function bootstrapAuthStorage() {
  const eeswebUser = await getAuthUserByEmail("latisha.eesweb@gmail.com");
  if (!eeswebUser) {
    await saveAuthUser({
      id: `user_${createToken(10)}`,
      email: "latisha.eesweb@gmail.com",
      passwordHash: await hashPassword("eesweb@1"),
      role: "client",
      client: "eesweb",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const shelarUser = await getAuthUserByEmail("shelar.tvs@gmail.com");
  if (!shelarUser) {
    await saveAuthUser({
      id: `user_${createToken(10)}`,
      email: "shelar.tvs@gmail.com",
      passwordHash: await hashPassword("shelar@1"),
      role: "client",
      client: "shelar-tvs",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  const adminUser = await getAuthUserByEmail("admin@eesweb.in");
  if (!adminUser) {
    await saveAuthUser({
      id: `user_${createToken(10)}`,
      email: "admin@eesweb.in",
      passwordHash: await hashPassword("admin@123"),
      role: "admin",
      client: "eesweb",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

async function getAuthSessionResponse(request) {
  const session = await getActiveSession(request);
  if (!session) return { authenticated: false };
  return {
    authenticated: true,
    session: {
      email: session.email,
      role: session.role || "client",
      client: session.client || "eesweb",
      expiresAt: session.expiresAt,
    },
  };
}

function resolveDashboardScope(request, session, options = {}) {
  const url = new URL(request.url, "http://localhost");
  const requestedClient = normalizeSlug(url.searchParams.get("client") || "");
  const isAdmin = session?.role === "admin";

  if (isAdmin) {
    if (options.allowAll && (!requestedClient || requestedClient === "all")) {
      return { clientId: "", isAdmin, allTenants: true };
    }
    return {
      clientId: requestedClient || normalizeSlug(session.client || env.BUSINESS_ID || "eesweb"),
      isAdmin,
      allTenants: false,
    };
  }

  return {
    clientId: normalizeSlug(session?.client || env.BUSINESS_ID || "eesweb"),
    isAdmin: false,
    allTenants: false,
  };
}

async function getTenantPublicConfig(clientId = "", qrCodeId = "", qrCode = null) {
  const resolvedQr = qrCode || (qrCodeId ? await getQrCodeById(qrCodeId) : null);
  const resolvedClientId = clientId || resolvedQr?.businessId || env.BUSINESS_ID || "demo_business";
  const business = await getBusinessById(resolvedClientId);
  const fallback = getPublicConfig(qrCodeId, resolvedClientId);

  return {
    ...fallback,
    businessName: business?.name || fallback.businessName,
    businessId: resolvedClientId,
    logoUrl: business?.logoUrl || fallback.logoUrl || "",
    googlePlaceId: business?.googlePlaceId || fallback.googlePlaceId,
    reviewSystemPrompt: business?.reviewSystemPrompt || fallback.reviewSystemPrompt,
    reviewTopics: parseList(business?.reviewTopics, "").length
      ? parseList(business.reviewTopics, "")
      : fallback.reviewTopics,
    feedbackTopics: parseList(business?.feedbackTopics, "").length
      ? parseList(business.feedbackTopics, "")
      : fallback.feedbackTopics,
    aiTone: business?.aiTone || fallback.aiTone,
    aiLength: business?.aiLength || fallback.aiLength,
    branchId: resolvedQr?.branchId || fallback.branchId,
    branchName: resolvedQr?.branchName || fallback.branchName,
    qrCodeId: resolvedQr?.qrCodeId || fallback.qrCodeId,
    qrLabel: resolvedQr?.label || fallback.qrLabel,
    qrSource: resolvedQr?.source || resolvedQr?.staff || resolvedQr?.campaign || fallback.qrSource,
    campaign: resolvedQr?.campaign || fallback.campaign,
  };
}

async function getTenantSettings(clientId, publicConfig) {
  const defaultQr = await getDefaultQrCodeForBusiness(clientId);
  return {
    APP_BUSINESS_NAME: publicConfig.businessName,
    APP_BASE_URL: env.APP_BASE_URL || `http://127.0.0.1:${port}`,
    BUSINESS_ID: publicConfig.businessId,
    BRANCH_ID: defaultQr?.branchId || publicConfig.branchId,
    BRANCH_NAME: defaultQr?.branchName || publicConfig.branchName,
    QR_CODE_ID: defaultQr?.qrCodeId || publicConfig.qrCodeId,
    QR_CODE_LABEL: defaultQr?.label || publicConfig.qrLabel,
    GOOGLE_PLACE_ID: publicConfig.googlePlaceId,
    REVIEW_TOPICS: publicConfig.reviewTopics.join(","),
    FEEDBACK_TOPICS: publicConfig.feedbackTopics.join(","),
    GEMINI_MODEL: env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    REVIEW_SYSTEM_PROMPT: publicConfig.reviewSystemPrompt,
    AI_TONE: publicConfig.aiTone,
    AI_LENGTH: publicConfig.aiLength,
  };
}

async function saveTenantSettings(clientId, cleanUpdates) {
  const now = new Date().toISOString();
  const businessUpdates = {
    businessId: clientId,
    updatedAt: now,
  };

  if ("APP_BUSINESS_NAME" in cleanUpdates) businessUpdates.name = cleanUpdates.APP_BUSINESS_NAME;
  if ("GOOGLE_PLACE_ID" in cleanUpdates) businessUpdates.googlePlaceId = cleanUpdates.GOOGLE_PLACE_ID;
  if ("REVIEW_TOPICS" in cleanUpdates) businessUpdates.reviewTopics = cleanUpdates.REVIEW_TOPICS;
  if ("FEEDBACK_TOPICS" in cleanUpdates) businessUpdates.feedbackTopics = cleanUpdates.FEEDBACK_TOPICS;
  if ("REVIEW_SYSTEM_PROMPT" in cleanUpdates) businessUpdates.reviewSystemPrompt = cleanUpdates.REVIEW_SYSTEM_PROMPT;
  if ("AI_TONE" in cleanUpdates) businessUpdates.aiTone = cleanUpdates.AI_TONE;
  if ("AI_LENGTH" in cleanUpdates) businessUpdates.aiLength = cleanUpdates.AI_LENGTH;

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    await setFirestoreDocument(`businesses/${clientId}`, businessUpdates);
  }

  const db = readLocalDb();
  const businessIndex = db.businesses.findIndex((business) => business.businessId === clientId);
  const existingBusiness = businessIndex >= 0 ? db.businesses[businessIndex] : {};
  const nextBusiness = {
    ...existingBusiness,
    ...businessUpdates,
    status: existingBusiness.status || "active",
    createdAt: existingBusiness.createdAt || now,
  };
  if (businessIndex >= 0) db.businesses[businessIndex] = nextBusiness;
  else db.businesses.push(nextBusiness);

  const branchId = normalizeSlug(cleanUpdates.BRANCH_ID || "");
  const branchName = String(cleanUpdates.BRANCH_NAME || "").trim();
  if (branchId || branchName) {
    const resolvedBranchId = branchId || normalizeSlug(branchName);
    const branchIndex = db.branches.findIndex((branch) => branch.businessId === clientId && branch.branchId === resolvedBranchId);
    const branchPayload = {
      businessId: clientId,
      branchId: resolvedBranchId,
      name: branchName || resolvedBranchId,
      status: "active",
      updatedAt: now,
      createdAt: branchIndex >= 0 ? db.branches[branchIndex].createdAt : now,
    };
    if (branchIndex >= 0) db.branches[branchIndex] = { ...db.branches[branchIndex], ...branchPayload };
    else db.branches.push(branchPayload);
  }

  const qrCodeId = normalizeSlug(cleanUpdates.QR_CODE_ID || "");
  if (qrCodeId) {
    const qrIndex = db.qrCodes.findIndex((qr) => qr.qrCodeId === qrCodeId);
    const qrPayload = {
      businessId: clientId,
      branchId: branchId || db.qrCodes[qrIndex]?.branchId || "main",
      branchName: branchName || db.qrCodes[qrIndex]?.branchName || "Main",
      qrCodeId,
      label: cleanUpdates.QR_CODE_LABEL || db.qrCodes[qrIndex]?.label || qrCodeId,
      source: db.qrCodes[qrIndex]?.source || "General",
      staff: db.qrCodes[qrIndex]?.staff || "",
      campaign: db.qrCodes[qrIndex]?.campaign || "",
      scanCount: db.qrCodes[qrIndex]?.scanCount || 0,
      dynamicUrl: getDynamicQrUrl(qrCodeId, clientId),
      targetPath: getReviewPageUrl(qrCodeId, clientId),
      status: db.qrCodes[qrIndex]?.status || "active",
      updatedAt: now,
      createdAt: qrIndex >= 0 ? db.qrCodes[qrIndex].createdAt : now,
    };
    if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
      await setFirestoreDocument(`qrCodes/${qrCodeId}`, qrPayload);
    }
    if (qrIndex >= 0) db.qrCodes[qrIndex] = { ...db.qrCodes[qrIndex], ...qrPayload };
    else db.qrCodes.push(qrPayload);
  }

  writeLocalDb(db);
}

async function requireClientSession(request) {
  const session = await getActiveSession(request);
  if (!session) {
    const error = new Error("Authentication required.");
    error.statusCode = 401;
    throw error;
  }
  return session;
}

async function handleLogin(body, request, response) {
  const email = normalizeEmail(body?.email);
  const password = String(body?.password || "");
  if (!email || !password) {
    const error = new Error("Email and password are required.");
    error.statusCode = 400;
    throw error;
  }

  const user = await getAuthUserByEmail(email);
  if (!user || !(await verifyAuthPassword(email, password, user))) {
    const error = new Error("Incorrect email or password.");
    error.statusCode = 401;
    throw error;
  }

  const session = {
    id: `session_${createToken(12)}`,
    email: user.email,
    userId: user.id,
    client: user.client || user.businessId || "eesweb",
    role: user.role || "client",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
  };
  await saveSession(session);

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": serializeCookie(sessionCookieName, session.id, {
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
      httpOnly: true,
      sameSite: "Lax",
    }),
  });
  response.end(JSON.stringify({ ok: true, email: user.email, role: user.role, client: user.client || user.businessId }));
}

async function verifyAuthPassword(email, password, user) {
  if (user?.passwordHash) {
    return verifyPassword(password, user.passwordHash);
  }

  const firebaseApiKey = String(env.FIREBASE_API_KEY || "").trim();
  if (!firebaseApiKey || firebaseApiKey.startsWith("PASTE_")) {
    return false;
  }

  const authResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(firebaseApiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: false,
      }),
    },
  );

  if (authResponse.ok) {
    return true;
  }

  const authData = await authResponse.json().catch(() => ({}));
  const message = String(authData.error?.message || "");
  if (
    message.includes("INVALID_PASSWORD") ||
    message.includes("EMAIL_NOT_FOUND") ||
    message.includes("INVALID_LOGIN_CREDENTIALS") ||
    message.includes("USER_NOT_FOUND")
  ) {
    return false;
  }
  throw new Error(message || "Firebase Authentication failed.");
}

async function handleLogout(request, response) {
  const sessionId = readCookie(request, sessionCookieName);
  if (sessionId) {
    await invalidateSession(sessionId);
  }

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Set-Cookie": serializeCookie(sessionCookieName, "", {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "Lax",
    }),
  });
  response.end(JSON.stringify({ ok: true }));
}

async function handleForgotPassword(body, request) {
  const email = normalizeEmail(body?.email);
  if (!email) {
    const error = new Error("Email is required.");
    error.statusCode = 400;
    throw error;
  }

  const user = await getAuthUserByEmail(email);
  if (!user) return { ok: true };

  const token = createToken(24);
  const resetUrl = `${getRequestOrigin(request)}/reset-password.html?token=${encodeURIComponent(token)}`;
  await saveResetToken({
    id: token,
    email,
    userId: user.id,
    expiresAt: new Date(Date.now() + 1000 * 60 * 30).toISOString(),
    createdAt: new Date().toISOString(),
  });

  const emailResult = await sendPasswordResetEmail({ to: email, resetUrl });
  return emailResult?.debugResetUrl ? { ok: true, debugResetUrl: emailResult.debugResetUrl } : { ok: true };
}

async function handleResetPassword(body) {
  const token = String(body?.token || "").trim();
  const password = String(body?.password || "");
  if (!token || !password) {
    const error = new Error("Reset token and password are required.");
    error.statusCode = 400;
    throw error;
  }

  const record = await getResetToken(token);
  if (!record || record.usedAt) {
    const error = new Error("Reset link is invalid.");
    error.statusCode = 400;
    throw error;
  }

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    const error = new Error("Reset link has expired.");
    error.statusCode = 400;
    throw error;
  }

  const user = await getAuthUserByEmail(record.email);
  if (!user) {
    const error = new Error("This account no longer exists.");
    error.statusCode = 404;
    throw error;
  }

  user.passwordHash = await hashPassword(password);
  user.updatedAt = new Date().toISOString();
  await saveAuthUser(user);
  await markResetTokenUsed(token);
  return { ok: true };
}

async function getActiveSession(request) {
  const sessionId = readCookie(request, sessionCookieName);
  if (!sessionId) return null;
  const session = await getSessionById(sessionId);
  if (!session || session.invalidatedAt) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await invalidateSession(sessionId);
    return null;
  }
  return session;
}

async function getAuthUserByEmail(email) {
  const key = getEmailDocKey(email);
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return getFirestoreDocument(`clientUsers/${key}`);
  }
  return readAuthStore().users.find((item) => item.email === email) || null;
}

async function saveAuthUser(user) {
  const key = getEmailDocKey(user.email);
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    await setFirestoreDocument(`clientUsers/${key}`, user);
    return;
  }
  const store = readAuthStore();
  store.users = store.users.filter((item) => item.email !== user.email);
  store.users.push(user);
  writeAuthStore(store);
}

async function getSessionById(sessionId) {
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return getFirestoreDocument(`clientSessions/${sessionId}`);
  }
  return readAuthStore().sessions.find((item) => item.id === sessionId) || null;
}

async function saveSession(session) {
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    await setFirestoreDocument(`clientSessions/${session.id}`, session);
    return;
  }
  const store = readAuthStore();
  store.sessions = store.sessions.filter((item) => item.id !== session.id);
  store.sessions.push(session);
  writeAuthStore(store);
}

async function invalidateSession(sessionId) {
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    await setFirestoreDocument(`clientSessions/${sessionId}`, {
      invalidatedAt: new Date().toISOString(),
    });
    return;
  }
  const store = readAuthStore();
  const session = store.sessions.find((item) => item.id === sessionId);
  if (session) {
    session.invalidatedAt = new Date().toISOString();
    writeAuthStore(store);
  }
}

async function saveResetToken(record) {
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    await setFirestoreDocument(`passwordResetTokens/${record.id}`, record);
    return;
  }
  const store = readAuthStore();
  store.resetTokens = store.resetTokens.filter((item) => item.id !== record.id);
  store.resetTokens.push(record);
  writeAuthStore(store);
}

async function getResetToken(token) {
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    return getFirestoreDocument(`passwordResetTokens/${token}`);
  }
  return readAuthStore().resetTokens.find((item) => item.id === token) || null;
}

async function markResetTokenUsed(token) {
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    await setFirestoreDocument(`passwordResetTokens/${token}`, {
      usedAt: new Date().toISOString(),
    });
    return;
  }
  const store = readAuthStore();
  const record = store.resetTokens.find((item) => item.id === token);
  if (record) {
    record.usedAt = new Date().toISOString();
    writeAuthStore(store);
  }
}

function readAuthStore() {
  if (!fs.existsSync(authStorePath)) {
    return { users: [], sessions: [], resetTokens: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(authStorePath, "utf8"));
    return {
      users: parsed.users || [],
      sessions: parsed.sessions || [],
      resetTokens: parsed.resetTokens || [],
    };
  } catch {
    return { users: [], sessions: [], resetTokens: [] };
  }
}

function writeAuthStore(store) {
  fs.writeFileSync(authStorePath, JSON.stringify(store, null, 2), "utf8");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function getEmailDocKey(email) {
  return Buffer.from(normalizeEmail(email)).toString("base64url");
}

function createToken(size = 24) {
  return crypto.randomBytes(size).toString("hex");
}

function readCookie(request, name) {
  const cookies = String(request.headers?.cookie || "").split(";").map((item) => item.trim());
  for (const cookie of cookies) {
    if (!cookie) continue;
    const index = cookie.indexOf("=");
    const key = index >= 0 ? cookie.slice(0, index) : cookie;
    if (key === name) {
      return decodeURIComponent(index >= 0 ? cookie.slice(index + 1) : "");
    }
  }
  return "";
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || "/"}`);
  if (typeof options.maxAge === "number") parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

async function hashPassword(password) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, "review-funnel-auth", 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey.toString("hex"));
    });
  });
}

async function verifyPassword(password, hash) {
  return (await hashPassword(password)) === hash;
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const brevoApiKey = String(env.BREVO_API_KEY || "").trim();
  const brevoFromEmail = String(env.BREVO_FROM_EMAIL || "").trim();
  const brevoFromName = String(env.BREVO_FROM_NAME || "EESWEB").trim();

  if (brevoApiKey && brevoFromEmail) {
    const subject = "Reset your EESWEB dashboard password";
    const payload = {
      sender: {
        name: brevoFromName,
        email: brevoFromEmail,
      },
      to: [{ email: to }],
      subject,
      htmlContent: buildPasswordResetEmailHtml({
        brandName: "EESWEB",
        subject,
        resetUrl,
      }),
      textContent: buildPasswordResetEmailText({
        brandName: "EESWEB",
        resetUrl,
      }),
    };

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "Password reset email could not be sent.");
    }

    return { ok: true, id: data.messageId || "" };
  }

  const host = String(env.SMTP_HOST || "").trim();
  const user = String(env.SMTP_USER || "").trim();
  const pass = String(env.SMTP_PASS || "").trim();
  const fromEmail = String(env.SMTP_FROM_EMAIL || "").trim();

  if (!host || !user || !pass || !fromEmail) {
    return { ok: true, debugResetUrl: resetUrl, to };
  }

  const subject = "Reset your EESWEB dashboard password";
  await sendSmtpMail({
    host,
    port: Number(env.SMTP_PORT || 465),
    secure: String(env.SMTP_SECURE || "true") !== "false",
    user,
    pass,
    fromEmail,
    fromName: String(env.SMTP_FROM_NAME || "EESWEB").trim(),
    to,
    subject,
    text: buildPasswordResetEmailText({
      brandName: "EESWEB",
      resetUrl,
    }),
  });

  return { ok: true };
}

function buildPasswordResetEmailHtml({ brandName, subject, resetUrl }) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
      <h2 style="margin:0 0 16px">${escapeEmailHtml(subject)}</h2>
      <p style="margin:0 0 14px">We received a request to reset your ${escapeEmailHtml(brandName)} client dashboard password.</p>
      <p style="margin:0 0 22px">
        <a href="${escapeEmailAttribute(resetUrl)}" style="display:inline-block;background:#123d3a;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Reset password</a>
      </p>
      <p style="margin:0 0 10px">If the button does not open, use this link:</p>
      <p style="margin:0 0 16px"><a href="${escapeEmailAttribute(resetUrl)}">${escapeEmailHtml(resetUrl)}</a></p>
      <p style="margin:0;color:#667085">This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>
    </div>
  `.trim();
}

function buildPasswordResetEmailText({ brandName, resetUrl }) {
  return [
    `Reset your ${brandName} client dashboard password.`,
    "",
    "Use the link below to choose a new password:",
    resetUrl,
    "",
    "This link expires in 30 minutes. If you did not request this, you can ignore this email.",
  ].join("\n");
}

async function sendSmtpMail({ host, port, secure, user, pass, fromEmail, fromName, to, subject, text }) {
  let socket = await connectSmtpSocket({ host, port, secure });

  try {
    await readSmtpResponse(socket, 220);
    await sendSmtpCommand(socket, `EHLO ${getSmtpHelloName(host)}`, 250);
    await sendSmtpCommand(socket, "AUTH LOGIN", 334);
    await sendSmtpCommand(socket, Buffer.from(user).toString("base64"), 334);
    await sendSmtpCommand(socket, Buffer.from(pass).toString("base64"), 235);
    await sendSmtpCommand(socket, `MAIL FROM:<${fromEmail}>`, 250);
    await sendSmtpCommand(socket, `RCPT TO:<${to}>`, 250, 251);
    await sendSmtpCommand(socket, "DATA", 354);

    const message = buildSmtpMessage({
      fromEmail,
      fromName,
      to,
      subject,
      text,
    });

    socket.write(`${message}\r\n.\r\n`);
    await readSmtpResponse(socket, 250);
    await sendSmtpCommand(socket, "QUIT", 221);
  } finally {
    socket.end();
    socket.destroy();
  }
}

function connectSmtpSocket({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    const socket = secure
      ? tls.connect({ host, port, servername: host }, () => resolve(socket))
      : net.createConnection({ host, port }, () => resolve(socket));

    socket.once("error", onError);
    socket.once("secureConnect", () => socket.removeListener("error", onError));
    socket.once("connect", () => socket.removeListener("error", onError));
    socket.setEncoding("utf8");
  });
}

function readSmtpResponse(socket, ...expectedCodes) {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
    };

    const finish = (response) => {
      cleanup();
      const code = Number(response.slice(0, 3));
      if (!expectedCodes.length || expectedCodes.includes(code)) {
        resolve(response);
        return;
      }
      reject(new Error(`SMTP error ${code}: ${response}`));
    };

    const tryComplete = () => {
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return false;
      const lastLine = lines[lines.length - 1];
      if (!/^\d{3} /.test(lastLine)) return false;
      finish(lines.join("\n"));
      return true;
    };

    const onData = (chunk) => {
      buffer += chunk;
      tryComplete();
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error("SMTP connection closed unexpectedly."));
    };

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function sendSmtpCommand(socket, command, ...expectedCodes) {
  socket.write(`${command}\r\n`);
  return readSmtpResponse(socket, ...expectedCodes);
}

function buildSmtpMessage({ fromEmail, fromName, to, subject, text }) {
  const fromHeader = fromName ? `${sanitizeEmailHeader(fromName)} <${fromEmail}>` : fromEmail;
  const safeText = String(text || "")
    .replace(/\r?\n/g, "\r\n")
    .replace(/^\./gm, "..");

  return [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${sanitizeEmailHeader(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    safeText,
  ].join("\r\n");
}

function sanitizeEmailHeader(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function getSmtpHelloName(host) {
  return sanitizeEmailHeader(host || "localhost") || "localhost";
}

function escapeEmailHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeEmailAttribute(value) {
  return escapeEmailHtml(value).replace(/'/g, "&#39;");
}

async function getFirestoreDocument(documentPath) {
  const projectId = requireEnv("FIREBASE_PROJECT_ID");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${documentPath}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
  });
  if (response.status === 404) {
    return null;
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Firestore document lookup failed.");
  }
  return fromFirestoreDocument(data);
}

// ==========================================
// Dashboard and Local JSON Database Helpers
// ==========================================

function readLocalDb() {
  if (!fs.existsSync(localDbPath)) {
    return getEmptyLocalDb();
  }
  try {
    const data = JSON.parse(fs.readFileSync(localDbPath, "utf8"));
    return {
      businesses: data.businesses || [],
      branches: data.branches || [],
      ratings: data.ratings || [],
      feedback: data.feedback || [],
      reviewEvents: data.reviewEvents || [],
      postedReviews: data.postedReviews || [],
      scans: data.scans || [],
      qrCodes: data.qrCodes || []
    };
  } catch (error) {
    console.error("Error reading local database, resetting:", error.message);
    return getEmptyLocalDb();
  }
}

function getEmptyLocalDb() {
  return {
    businesses: [],
    branches: [],
    ratings: [],
    feedback: [],
    reviewEvents: [],
    postedReviews: [],
    scans: [],
    qrCodes: [],
  };
}

function getQrCodeFromLocalDb(qrCodeId) {
  if (!qrCodeId) {
    return null;
  }
  const db = readLocalDb();
  return (db.qrCodes || []).find((qr) => qr.qrCodeId === qrCodeId && qr.status !== "deleted") || null;
}

function getLocalBusinessById(businessId) {
  if (!businessId || !fs.existsSync(localDbPath)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(localDbPath, "utf8"));
    return (data.businesses || []).find((business) => business.businessId === businessId) || null;
  } catch {
    return null;
  }
}

async function getBusinessById(businessId) {
  if (!businessId) return null;
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      return await getFirestoreDocument(`businesses/${businessId}`);
    } catch (error) {
      firebaseDiagnostics.status = "fallback";
      firebaseDiagnostics.error = error.message || "Firestore business lookup failed.";
    }
  }
  return getLocalBusinessById(businessId);
}

async function getQrCodeById(qrCodeId) {
  if (!qrCodeId) return null;
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      const qr = await getFirestoreDocument(`qrCodes/${qrCodeId}`);
      return qr && qr.status !== "deleted" ? qr : null;
    } catch (error) {
      firebaseDiagnostics.status = "fallback";
      firebaseDiagnostics.error = error.message || "Firestore QR lookup failed.";
    }
  }
  return getQrCodeFromLocalDb(qrCodeId);
}

async function getDefaultQrCodeForBusiness(businessId) {
  if (!businessId) return null;
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      const qrCodes = await getFirestoreDocuments("qrCodes");
      return qrCodes.find((qr) => qr.businessId === businessId && qr.status !== "deleted") || null;
    } catch (error) {
      firebaseDiagnostics.status = "fallback";
      firebaseDiagnostics.error = error.message || "Firestore QR list failed.";
    }
  }
  const db = readLocalDb();
  return (db.qrCodes || []).find((qr) => qr.businessId === businessId && qr.status !== "deleted") || null;
}

function writeLocalDb(db) {
  try {
    fs.writeFileSync(localDbPath, JSON.stringify(db, null, 2), "utf8");
  } catch (error) {
    console.error("Error writing to local database:", error.message);
  }
}

function saveToLocalJson(collection, payload) {
  const db = readLocalDb();
  if (!db[collection]) {
    db[collection] = [];
  }
  const id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11);
  const doc = { id, ...payload };
  db[collection].push(doc);
  writeLocalDb(db);
  return `${collection}/${id}`;
}

function upsertLocalDocument(collection, key, payload) {
  const db = readLocalDb();
  if (!db[collection]) {
    db[collection] = [];
  }
  const value = payload[key];
  const index = db[collection].findIndex((item) => item[key] === value);
  if (index >= 0) {
    db[collection][index] = { ...db[collection][index], ...payload };
  } else {
    db[collection].push(payload);
  }
  writeLocalDb(db);
}

function normalizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeOptionalUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || text.startsWith("/")) return text;
  return "";
}

async function getDashboardData(request, session) {
  const { clientId, allTenants } = resolveDashboardScope(request, session, { allowAll: true });
  let data;
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      const businesses = await getFirestoreDocuments("businesses");
      const branches = await getFirestoreDocuments("branches");
      const ratings = await getFirestoreDocuments("ratings");
      const feedback = await getFirestoreDocuments("feedback");
      const reviewEvents = await getFirestoreDocuments("reviewEvents");
      const postedReviews = await getFirestoreDocuments("postedReviews");
      const scans = await getFirestoreDocuments("scans");
      const qrCodes = await getFirestoreDocuments("qrCodes");
      
      data = { businesses, branches, ratings, feedback, reviewEvents, postedReviews, scans, qrCodes };
      return normalizeDashboardData(filterDashboardData(data, allTenants ? "" : clientId));
    } catch (e) {
      firebaseDiagnostics.status = "fallback";
      firebaseDiagnostics.error = e.message || "Firestore data fetch failed.";
      console.warn("Firestore data fetch failed, using local DB fallback:", e.message);
    }
  } else {
    firebaseDiagnostics.status = "not_configured";
    firebaseDiagnostics.error = "";
  }

  // Local JSON DB fallback
  data = readLocalDb();
  return normalizeDashboardData(filterDashboardData(data, allTenants ? "" : clientId));
}

function filterDashboardData(data, clientId) {
  if (!clientId) return data;
  const matchesBusiness = (item) => item.businessId === clientId;
  return {
    businesses: (data.businesses || []).filter((item) => item.businessId === clientId),
    branches: (data.branches || []).filter(matchesBusiness),
    ratings: (data.ratings || []).filter(matchesBusiness),
    feedback: (data.feedback || []).filter(matchesBusiness),
    reviewEvents: (data.reviewEvents || []).filter(matchesBusiness),
    postedReviews: (data.postedReviews || []).filter(matchesBusiness),
    scans: (data.scans || []).filter(matchesBusiness),
    qrCodes: (data.qrCodes || []).filter(matchesBusiness),
  };
}

function normalizeDashboardData(data) {
  const db = {
    businesses: data.businesses || [],
    branches: data.branches || [],
    ratings: data.ratings || [],
    feedback: data.feedback || [],
    reviewEvents: data.reviewEvents || [],
    postedReviews: data.postedReviews || [],
    scans: data.scans || [],
    qrCodes: data.qrCodes || [],
  };
  const scanCounts = db.scans.reduce((counts, scan) => {
    const qrCodeId = scan.qrCodeId || "";
    if (qrCodeId) {
      counts[qrCodeId] = (counts[qrCodeId] || 0) + 1;
    }
    return counts;
  }, {});
  db.qrCodes = db.qrCodes.map((qr) => ({
    ...qr,
    scanCount: scanCounts[qr.qrCodeId] || Number(qr.scanCount || 0),
    dynamicUrl: qr.dynamicUrl || getDynamicQrUrl(qr.qrCodeId, qr.businessId),
    targetPath: qr.redirectUrl || qr.targetPath || getReviewPageUrl(qr.qrCodeId, qr.businessId),
  }));
  return db;
}

async function getFirestoreDocuments(collection) {
  const projectId = requireEnv("FIREBASE_PROJECT_ID");
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}`;
  
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
  });
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Firestore read failed for ${collection}`);
  }
  const data = await response.json();
  return (data.documents || []).map(fromFirestoreDocument);
}

function fromFirestoreDocument(doc) {
  const fields = doc.fields || {};
  const data = {};
  for (const [key, value] of Object.entries(fields)) {
    data[key] = fromFirestoreValue(value);
  }
  const parts = doc.name.split("/");
  data.id = parts[parts.length - 1];
  return data;
}

function fromFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in value) {
    const fields = value.mapValue.fields || {};
    return Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, fromFirestoreValue(v)])
    );
  }
  return value;
}

async function resolveFeedback(body, request, session) {
  const { clientId } = resolveDashboardScope(request, session);
  const { id, notes } = body;
  if (!id) throw new Error("Missing feedback ID.");
  const existing = await getCollectionDocumentById("feedback", id);
  ensureTenantAccess(existing, clientId);
  const updates = {
    status: "resolved",
    resolutionNotes: notes || "",
    resolvedAt: new Date().toISOString(),
  };

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      await setFirestoreDocument(`feedback/${id}`, updates);
    } catch (error) {
      console.warn("Firestore feedback resolve failed, updating local fallback:", error.message);
    }
  }
  const db = readLocalDb();
  const item = db.feedback.find(f => f.id === id);
  if (item) {
    Object.assign(item, updates);
    writeLocalDb(db);
  }
  return { ok: true };
}

async function addQrCode(body, request, session) {
  const { clientId } = resolveDashboardScope(request, session);
  const { label, branchName, staff, source, campaign } = body;
  const qrCodeId = normalizeSlug(body.qrCodeId || label || "");
  if (!qrCodeId) throw new Error("Missing QR Code ID.");
  const finalBranchName = String(branchName || env.BRANCH_NAME || "Main").trim();
  const branchId = normalizeSlug(body.branchId || finalBranchName || env.BRANCH_ID || "main");
  const publicConfig = await getTenantPublicConfig(clientId, qrCodeId);
  const redirectUrl = normalizeOptionalUrl(body.redirectUrl);
  const qrImageUrl = normalizeOptionalUrl(body.qrImageUrl);
  const fallbackTargetPath = getReviewPageUrlForContext({
    businessId: publicConfig.businessId,
    branchId,
    qrCodeId,
    source: String(source || staff || "").trim(),
    campaign: String(campaign || "").trim(),
  });

  const payload = {
    qrCodeId,
    businessId: publicConfig.businessId,
    label: String(label || `QR for ${staff || source || campaign || finalBranchName}`).trim(),
    branchId,
    branchName: finalBranchName,
    source: String(source || staff || "").trim(),
    staff: String(staff || "").trim(),
    campaign: String(campaign || "").trim(),
    scanCount: 0,
    dynamicUrl: getDynamicQrUrl(qrCodeId, publicConfig.businessId),
    targetPath: redirectUrl || fallbackTargetPath,
    redirectUrl,
    qrImageUrl,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      await setFirestoreDocument(`qrCodes/${qrCodeId}`, payload);
    } catch (error) {
      console.warn("Firestore QR save failed, keeping local tracker:", error.message);
    }
  }
  upsertLocalDocument("qrCodes", "qrCodeId", payload);
  return { ok: true, qrCode: payload };
}

function getReviewPageUrlForContext(context) {
  const params = new URLSearchParams({
    business: context.businessId,
    branch: context.branchId,
    qr: context.qrCodeId,
  });
  if (context.source) {
    params.set("source", context.source);
  }
  if (context.campaign) {
    params.set("campaign", context.campaign);
  }
  return `/?${params}`;
}

async function deleteQrCode(qrCodeId, request, session) {
  const { clientId } = resolveDashboardScope(request, session);
  if (!qrCodeId) throw new Error("Missing QR Code ID.");
  const existing = await getCollectionDocumentById("qrCodes", qrCodeId, "qrCodeId");
  ensureTenantAccess(existing, clientId);
  const updates = {
    status: "deleted",
    deletedAt: new Date().toISOString(),
  };

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      await setFirestoreDocument(`qrCodes/${qrCodeId}`, updates);
    } catch (error) {
      console.warn("Firestore QR delete failed, updating local fallback:", error.message);
    }
  }
  const db = readLocalDb();
  const qr = (db.qrCodes || []).find(q => q.qrCodeId === qrCodeId);
  if (qr) {
    Object.assign(qr, updates);
    writeLocalDb(db);
  }
  return { ok: true };
}

async function getCollectionDocumentById(collection, id, field = "id") {
  if (!id) return null;
  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      if (field === "id") {
        return await getFirestoreDocument(`${collection}/${id}`);
      }
      const docs = await getFirestoreDocuments(collection);
      return docs.find((doc) => doc[field] === id) || null;
    } catch (error) {
      firebaseDiagnostics.status = "fallback";
      firebaseDiagnostics.error = error.message || "Firestore document lookup failed.";
    }
  }
  const db = readLocalDb();
  return (db[collection] || []).find((item) => item[field] === id) || null;
}

function ensureTenantAccess(document, clientId) {
  if (!document) {
    const error = new Error("Record not found.");
    error.statusCode = 404;
    throw error;
  }
  if (clientId && document.businessId !== clientId) {
    const error = new Error("You do not have access to this tenant's data.");
    error.statusCode = 403;
    throw error;
  }
}

function trackQrScan(qrCodeId, request) {
  const userAgent = request.headers["user-agent"] || "";
  let deviceType = "Desktop";
  if (/mobile/i.test(userAgent)) {
    deviceType = "Mobile";
  } else if (/tablet/i.test(userAgent)) {
    deviceType = "Tablet";
  }
  
  const referer = request.headers["referer"] || "";
  let visitSource = "QR Scan";
  if (referer) {
    try {
      const url = new URL(referer);
      visitSource = url.hostname;
    } catch {
      visitSource = "External Link";
    }
  }

  const qrCode = getQrCodeFromLocalDb(qrCodeId);
  const publicConfig = getPublicConfig(qrCodeId, qrCode?.businessId);
  const scanEvent = {
    businessId: publicConfig.businessId,
    branchId: qrCode?.branchId || publicConfig.branchId,
    branchName: qrCode?.branchName || publicConfig.branchName,
    qrCodeId,
    qrLabel: qrCode?.label || "",
    source: qrCode?.source || qrCode?.staff || "",
    campaign: qrCode?.campaign || "",
    deviceType,
    visitSource,
    userAgent,
    ipHash: hashClientIp(request),
    createdAt: new Date().toISOString(),
  };

  if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    createFirestoreDocument("scans", scanEvent).catch(() => {});
  }

  const db = readLocalDb();
  if (!db.scans) db.scans = [];
  db.scans.push({ id: Math.random().toString(36).substring(2, 11), ...scanEvent });

  if (db.qrCodes) {
    const qr = db.qrCodes.find(q => q.qrCodeId === qrCodeId);
    if (qr) {
      qr.scanCount = (qr.scanCount || 0) + 1;
      qr.lastScannedAt = scanEvent.createdAt;
    }
  }
  writeLocalDb(db);
}

function hashClientIp(request) {
  const forwardedFor = request.headers["x-forwarded-for"] || "";
  const ip = String(forwardedFor).split(",")[0].trim() || request.socket?.remoteAddress || "";
  if (!ip) {
    return "";
  }
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}


function bootstrapLocalDbIfEmpty() {
  const dbPath = path.join(rootDir, "data_store.json");
  if (fs.existsSync(dbPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(dbPath, "utf8"));
      let updated = false;
      for (const col of ["businesses", "branches", "ratings", "feedback", "reviewEvents", "postedReviews", "scans", "qrCodes"]) {
        if (!parsed[col]) {
          parsed[col] = [];
          updated = true;
        }
      }
      const publicConfig = getPublicConfig();
      if (!parsed.businesses.some((business) => business.businessId === publicConfig.businessId)) {
        parsed.businesses.push(getLocalBusinessDocument());
        updated = true;
      }
      if (!parsed.branches.some((branch) => branch.branchId === publicConfig.branchId)) {
        parsed.branches.push(getLocalBranchDocument());
        updated = true;
      }
      const defaultQr = getLocalQrDocument();
      const existingDefaultQr = parsed.qrCodes.find((qr) => qr.qrCodeId === defaultQr.qrCodeId);
      if (existingDefaultQr) {
        Object.assign(existingDefaultQr, {
          businessId: existingDefaultQr.businessId || defaultQr.businessId,
          branchId: existingDefaultQr.branchId || defaultQr.branchId,
          branchName: existingDefaultQr.branchName || defaultQr.branchName,
          source: existingDefaultQr.source || existingDefaultQr.staff || defaultQr.source,
          campaign: existingDefaultQr.campaign || "",
          dynamicUrl: existingDefaultQr.dynamicUrl || defaultQr.dynamicUrl,
          targetPath: existingDefaultQr.targetPath || defaultQr.targetPath,
          createdAt: existingDefaultQr.createdAt || defaultQr.createdAt,
          updatedAt: existingDefaultQr.updatedAt || defaultQr.updatedAt,
        });
        updated = true;
      } else {
        parsed.qrCodes.push(defaultQr);
        updated = true;
      }
      if (updated) fs.writeFileSync(dbPath, JSON.stringify(parsed, null, 2), "utf8");
      return;
    } catch {
      // Re-create corrupt file
    }
  }

  const finalDb = {
    businesses: [getLocalBusinessDocument()],
    branches: [getLocalBranchDocument()],
    ratings: [],
    feedback: [],
    reviewEvents: [],
    postedReviews: [],
    scans: [],
    qrCodes: [getLocalQrDocument()]
  };

  fs.writeFileSync(dbPath, JSON.stringify(finalDb, null, 2), "utf8");
}

function ensureLocalBaseDocuments() {
  const publicConfig = getPublicConfig();
  const db = readLocalDb();
  let updated = false;
  if (!db.businesses.some((business) => business.businessId === publicConfig.businessId)) {
    db.businesses.push(getLocalBusinessDocument());
    updated = true;
  }
  if (!db.branches.some((branch) => branch.branchId === publicConfig.branchId)) {
    db.branches.push(getLocalBranchDocument());
    updated = true;
  }
  const defaultQr = getLocalQrDocument();
  const existingQr = db.qrCodes.find((qr) => qr.qrCodeId === defaultQr.qrCodeId);
  if (existingQr) {
    const normalizedQr = {
      ...defaultQr,
      scanCount: existingQr.scanCount || 0,
      createdAt: existingQr.createdAt || defaultQr.createdAt,
      updatedAt: existingQr.updatedAt || defaultQr.updatedAt,
    };
    if (JSON.stringify(existingQr) !== JSON.stringify(normalizedQr)) {
      Object.assign(existingQr, normalizedQr);
      updated = true;
    }
  } else {
    db.qrCodes.push(defaultQr);
    updated = true;
  }
  if (updated) {
    writeLocalDb(db);
  }
}

function getLocalBusinessDocument() {
  const publicConfig = getPublicConfig();
  return {
    businessId: publicConfig.businessId,
    name: publicConfig.businessName,
    googlePlaceId: publicConfig.googlePlaceId,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getLocalBranchDocument() {
  const publicConfig = getPublicConfig();
  return {
    businessId: publicConfig.businessId,
    branchId: publicConfig.branchId,
    name: publicConfig.branchName,
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function getLocalQrDocument() {
  const publicConfig = getPublicConfig(env.QR_CODE_ID || "eesweb-test");
  return {
    businessId: publicConfig.businessId,
    branchId: publicConfig.branchId,
    branchName: publicConfig.branchName,
    qrCodeId: publicConfig.qrCodeId,
    label: env.QR_CODE_LABEL || "EESWEB General QR",
    source: "General",
    staff: "",
    campaign: "",
    scanCount: 0,
    dynamicUrl: getDynamicQrUrl(publicConfig.qrCodeId),
    targetPath: getReviewPageUrl(publicConfig.qrCodeId),
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
