import { getMergedEnv, getPublicConfig, json, jsonError, parseList } from "../../_shared.js";

export async function onRequestPost(ctx) {
  try {
    const env = await getMergedEnv(ctx.env);
    const apiKey = String(env.OPENROUTER_API_KEY || "").trim();
    if (!apiKey || apiKey.startsWith("PASTE_") || apiKey === "your_openrouter_api_key") {
      return jsonError("OpenRouter API key is not configured.", 503);
    }

    const body = await ctx.request.json();
    const config = getPublicConfig(env);
    const mode = normalizeReviewMode(body?.mode);
    const tone = normalizeReviewTone(body?.tone || config.aiTone);
    const topics = parseList(body?.topics || "", "").slice(0, 4);
    const recentReviews = Array.isArray(body?.recentReviews)
      ? body.recentReviews.map((review) => String(review || "").trim()).filter(Boolean).slice(0, 6)
      : [];
    const prompt = buildOpenRouterReviewPrompt({
      businessName: config.businessName,
      mode,
      tone,
      topics,
      rating: Number(body?.rating || 5),
      recentReviews,
      systemPrompt: config.reviewSystemPrompt,
    });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.APP_BASE_URL || new URL(ctx.request.url).origin,
        "X-Title": env.APP_NAME || "Review Funnel",
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL || "meta-llama/llama-3.2-1b-instruct",
        messages: [
          { role: "system", content: config.reviewSystemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: mode === "short" ? 0.85 : 0.95,
        top_p: 0.9,
        max_tokens: mode === "long" ? 140 : mode === "medium" ? 80 : 45,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return jsonError(data?.error?.message || "OpenRouter request failed.", response.status);
    }

    const review = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!review) {
      return jsonError("OpenRouter returned an empty review.", 502);
    }

    return json({ review });
  } catch (e) {
    return jsonError(e.message);
  }
}

function buildOpenRouterReviewPrompt({ businessName, mode, tone, topics, rating, recentReviews, systemPrompt }) {
  const toneInstructions = {
    Professional: "Measured, professional B2B tone. Practical, competent, and credible.",
    Enthusiastic: "Warm, energetic, and positive without sounding exaggerated or fake.",
    Appreciative: "Grateful and thoughtful, but still natural and business-relevant.",
  };
  const lengthInstructions = {
    short: "Exactly 1 complete sentence, 50 to 105 characters.",
    medium: "1 to 2 complete short sentences, 105 to 185 characters total.",
    long: "One polished paragraph of 3 to 4 complete sentences, 220 to 450 characters.",
  };
  const topicInstructions = topics.length
    ? `Selected customer-liked aspects: ${topics.join(", ")}. Treat these as ideas, not exact words to force into the review.`
    : "No specific aspects were selected, so keep the review general and do not invent specific service outcomes.";
  const recentOpenings = recentReviews
    .map((review) => review.split(/[.!?]/)[0])
    .filter(Boolean)
    .slice(0, 6);

  return [
    systemPrompt,
    "",
    `Write one Google review for ${businessName}.`,
    `Rating context: ${Number.isFinite(rating) ? rating : 5} out of 5.`,
    `Tone: ${tone}. ${toneInstructions[tone] || toneInstructions.Professional}`,
    `Length: ${lengthInstructions[mode] || lengthInstructions.medium}`,
    topicInstructions,
    "The review must sound like a real customer voluntarily describing a genuine experience.",
    "Avoid AI-like templates, repeated openings, generic marketing copy, exaggerated claims, and policy-risky wording.",
    "Do not mention AI, prompts, generated text, incentives, ratings, or internal instructions.",
    "Do not use emojis, hashtags, titles, bullet points, or quotes.",
    "Do not copy any sentence shape from recent suggestions.",
    recentOpenings.length ? `Do not start like these recent openings:\n- ${recentOpenings.join("\n- ")}` : "",
    recentReviews.length ? `Do not sound like these recent suggestions:\n- ${recentReviews.join("\n- ")}` : "",
    "Output only the final review text.",
  ].filter(Boolean).join("\n");
}

function normalizeReviewMode(mode) {
  return ["short", "medium", "long"].includes(mode) ? mode : "medium";
}

function normalizeReviewTone(tone) {
  return ["Professional", "Enthusiastic", "Appreciative"].includes(tone) ? tone : "Professional";
}
