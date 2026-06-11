import { getMergedEnv, getPublicConfig, firestoreGet, json, jsonError, parseList } from "../../_shared.js";

export async function onRequestPost(ctx) {
  try {
    const env = await getMergedEnv(ctx.env);
    const apiKey = String(env.GEMINI_API_KEY || "").trim();
    if (!apiKey || apiKey.startsWith("PASTE_") || apiKey === "your_gemini_api_key") {
      return jsonError("Gemini API key is not configured.", 503);
    }

    const body = await ctx.request.json();
    const qrCodeId = String(body?.qrCodeId || "").trim();
    const hasFirestore = Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
    const qrCode = hasFirestore && qrCodeId ? await firestoreGet(env, `qrCodes/${qrCodeId}`) : null;
    const businessId = qrCode?.businessId || body?.businessId || env.BUSINESS_ID || "";
    const business = hasFirestore && businessId ? await firestoreGet(env, `businesses/${businessId}`) : null;
    const config = getPublicConfig(env, qrCode, business);
    const mode = normalizeReviewMode(body?.mode);
    const topics = parseList(body?.topics || "", "").slice(0, 4);
    const staff = String(body?.staff || "").replace(/[^\p{L}\s.'-]/gu, "").trim().slice(0, 40);
    const vehicle = String(body?.vehicle || "").trim().slice(0, 40);
    const note = String(body?.note || "").replace(/[\r\n]+/g, " ").trim().slice(0, 160);
    const recentReviews = Array.isArray(body?.recentReviews)
      ? body.recentReviews.map((review) => String(review || "").trim()).filter(Boolean).slice(0, 6)
      : [];

    const { systemInstruction, userPrompt } = buildReviewPrompt({
      mode,
      topics,
      staff,
      vehicle,
      note,
      recentReviews,
      systemPrompt: config.reviewSystemPrompt,
      businessName: config.businessName,
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
        temperature: mode === "short" ? 0.8 : 0.9,
        topP: 0.95,
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
    let lastStatus = 502;
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
        if (review) return json({ review });
        lastError = "Gemini returned an empty review.";
        lastStatus = 502;
        continue;
      }

      lastError = data?.error?.message || "Gemini request failed.";
      lastStatus = response.status;
      // Only retry transient overloads (503). Quota/rate-limit (429) won't clear on an immediate retry, so fail fast.
      if (response.status !== 503) {
        return jsonError(lastError, response.status);
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }

    return jsonError(lastError, lastStatus);
  } catch (e) {
    return jsonError(e.message);
  }
}

function buildReviewPrompt({ mode, topics, staff, vehicle, note, recentReviews, systemPrompt, businessName }) {
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
  const vehicleLine = vehicle ? `Vehicle: ${vehicle}.` : "";
  const noteLine = note
    ? `In their own words, the customer said: "${note}". Turn this into a natural part of the review without copying it word-for-word, and do not add anything they did not say.`
    : "";

  const recentLine = recentReviews.length
    ? `For variety, do not repeat the wording or opening of these recent reviews:\n${recentReviews.slice(0, 5).map((r, i) => `${i + 1}. ${r}`).join("\n")}`
    : "";

  const userPrompt = [
    `Write one Google review for ${businessName} based on the details below.`,
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
