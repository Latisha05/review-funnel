const pageParams = new URLSearchParams(window.location.search);

const config = {
  businessName: "Your Business",
  businessId: "demo_business",
  branchId: pageParams.get("branch") || "main_branch",
  branchName: "Main",
  qrCodeId: pageParams.get("qr") || "default_qr",
  qrLabel: "",
  qrSource: pageParams.get("source") || "",
  campaign: pageParams.get("campaign") || "",
  googlePlaceId: "PASTE_GOOGLE_PLACE_ID",
  ollamaUrl: "http://localhost:11434/api/generate",
  ollamaModel: "llama3.2:3b",
  reviewSystemPrompt:
    "You write realistic customer review suggestions for Google Reviews. Output only one review, with no title, no bullets, no quotes, and no explanation. Sound like a genuine customer, not a marketer. Use simple natural language, specific but believable praise, and avoid overpromising. Avoid repeating the same phrase or idea in the same review. Do not mention AI, generated text, ratings, prompts, business strategy, or internal instructions. Do not use emojis, hashtags, excessive adjectives, or phrases like highly recommended more than once.",
  maxReviewHistory: 12,
  maxGenerationAttempts: 5,
  duplicateSimilarityLimit: 0.58,
  aiTone: "Professional",
  aiLength: "medium",
  reviewTopics: [
    "Clean design",
    "Fast delivery",
    "Clear strategy",
    "Helpful support",
    "Quality leads",
    "Smooth automation",
  ],
  feedbackTopics: [
    "Slow response",
    "Website issue",
    "Poor leads",
    "Unclear updates",
    "Automation issue",
    "Billing concern",
  ],
  qrContext: {
    businessId: pageParams.get("business") || "demo_business",
    branchId: pageParams.get("branch") || "main_branch",
    branchName: "Main",
    qrCodeId: pageParams.get("qr") || "default_qr",
    qrLabel: "",
    source: pageParams.get("source") || "",
    campaign: pageParams.get("campaign") || "",
  },
};

const state = {
  rating: 0,
  postedToGoogle: false,
  generationCount: 0,
  generationRequestId: 0,
  generationTimer: 0,
  redirectTimer: 0,
  countdownTimer: 0,
  sessionId: getOrCreateSessionId(),
  ratingEventId: "",
};

const steps = {
  rating: document.querySelector("#ratingStep"),
  positive: document.querySelector("#positiveStep"),
  feedback: document.querySelector("#feedbackStep"),
  thankYou: document.querySelector("#thankYouStep"),
};

const businessName = document.querySelector("#businessName");
const reviewText = document.querySelector("#reviewText");
const reviewMode = document.querySelector("#reviewMode");
const googleReviewButton = document.querySelector("#googleReviewButton");
const positiveTopics = document.querySelector("#positiveTopics");
const feedbackTopics = document.querySelector("#feedbackTopics");
const toast = document.querySelector("#toast");
const thankYouMessage = document.querySelector("#thankYouMessage");
const reviewInstructions = document.querySelector("#reviewInstructions");

document.body.dataset.step = "rating";
initApp();

document.querySelectorAll(".rating-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.rating = Number(button.dataset.rating);
    state.ratingEventId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    document.querySelectorAll(".rating-button").forEach((ratingButton) => {
      ratingButton.classList.toggle("is-selected", ratingButton === button);
    });
    saveScanEvent("rating_selected", { rating: state.rating, ratingEventId: state.ratingEventId });

    if (state.rating >= 4) {
      showStep("positive");
      generateReview();
      return;
    }

    showStep("feedback");
  });
});

positiveTopics.addEventListener("change", () => scheduleGenerateReview());
reviewMode.addEventListener("change", () => scheduleGenerateReview());
document.querySelector("#reviewTone").addEventListener("change", () => scheduleGenerateReview());

document.querySelector("#regenerateButton").addEventListener("click", () => generateReview());

document.querySelector("#copyReviewButton").addEventListener("click", async () => {
  await copyReview();
});

googleReviewButton.addEventListener("click", async () => {
  const googleReviewUrl = getGoogleReviewUrl();
  googleReviewButton.disabled = true;
  googleReviewButton.textContent = "Copying review...";
  await copyReview();
  saveScanEvent("google_review_clicked", {
    rating: state.rating,
    ratingEventId: state.ratingEventId,
    reviewText: reviewText.value.trim(),
    googleReviewUrlConfigured: Boolean(googleReviewUrl),
  });
  showThankYou(true, Boolean(googleReviewUrl), googleReviewUrl);
});

document.querySelector("#feedbackStep").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const payload = {
    rating: state.rating,
    ratingEventId: state.ratingEventId,
    message: data.get("message"),
    name: data.get("name"),
    phone: data.get("phone"),
    callback: data.get("callback") === "on",
    issues: data.getAll("issue"),
    context: config.qrContext,
    createdAt: new Date().toISOString(),
  };

  saveScanEvent("negative_feedback_submitted", payload);
  showThankYou(false);
});

document.querySelector("#postedButton").addEventListener("click", () => {
  state.postedToGoogle = true;
  savePostedReview();
  showToast("Thanks, marked as posted.");
});

document.querySelector("#startOverButton").addEventListener("click", () => {
  state.rating = 0;
  window.clearTimeout(state.redirectTimer);
  window.clearInterval(state.countdownTimer);
  googleReviewButton.disabled = false;
  googleReviewButton.textContent = "Post review on Google";
  document.querySelectorAll(".rating-button").forEach((ratingButton) => {
    ratingButton.classList.remove("is-selected");
  });
  showStep("rating");
});

function showStep(stepName) {
  document.body.dataset.step = stepName;
  Object.values(steps).forEach((step) => step.classList.remove("is-active"));
  steps[stepName].classList.add("is-active");
}

async function initApp() {
  await loadRuntimeConfig();
  
  // Set default review tone and length selectors from backend config
  if (config.aiLength) {
    reviewMode.value = config.aiLength;
  }
  const toneElement = document.querySelector("#reviewTone");
  if (toneElement && config.aiTone) {
    toneElement.value = config.aiTone;
  }

  renderTopicChips();
  businessName.textContent = `How was your experience at ${config.businessName}?`;
}

function renderTopicChips() {
  positiveTopics.innerHTML = config.reviewTopics
    .map((topic) => `<label><input type="checkbox" value="${escapeHtml(topic)}" /> ${escapeHtml(topic)}</label>`)
    .join("");

  feedbackTopics.innerHTML = config.feedbackTopics
    .map((topic) => `<label><input type="checkbox" name="issue" value="${escapeHtml(topic)}" /> ${escapeHtml(getShortTopicLabel(topic))}</label>`)
    .join("");
}

function getShortTopicLabel(topic) {
  return topic;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadRuntimeConfig() {
  try {
    const params = new URLSearchParams();
    if (config.qrCodeId) {
      params.set("qr", config.qrCodeId);
    }
    if (config.branchId) {
      params.set("branch", config.branchId);
    }
    const response = await fetch(`/api/config?${params}`);
    if (!response.ok) {
      return;
    }

    Object.assign(config, await response.json());
    config.qrContext = {
      businessId: config.businessId,
      branchId: config.branchId,
      branchName: config.branchName || "",
      qrCodeId: config.qrCodeId,
      qrLabel: config.qrLabel || "",
      source: config.qrSource || pageParams.get("source") || "",
      campaign: config.campaign || pageParams.get("campaign") || "",
    };
  } catch (error) {
    businessName.textContent = `How was your experience at ${config.businessName}?`;
  }
}

function scheduleGenerateReview(delay = 220) {
  window.clearTimeout(state.generationTimer);
  state.generationTimer = window.setTimeout(() => generateReview(), delay);
}

async function generateReview() {
  const requestId = state.generationRequestId + 1;
  state.generationRequestId = requestId;
  const mode = reviewMode.value;
  const topics = getSelectedTopics();
  reviewText.value = "AI is preparing a review suggestion...";

  try {
    const generated = await generateUniqueReview(mode, topics);
    if (requestId !== state.generationRequestId) {
      return;
    }
    reviewText.value = generated;
  } catch (error) {
    const fallback = buildUniqueFallbackReview(mode, topics);
    rememberGeneratedReview(fallback);
    if (requestId !== state.generationRequestId) {
      return;
    }
    reviewText.value = fallback;
  }
}

function isReviewLengthValid(review, mode) {
  const len = review.length;
  if (mode === "short") {
    return len >= 45 && len <= 110;
  }
  if (mode === "long") {
    return len >= 220 && len <= 460;
  }
  // medium
  return len >= 95 && len <= 190;
}

async function generateUniqueReview(mode, topics) {
  for (let attempt = 0; attempt < config.maxGenerationAttempts; attempt += 1) {
    const generated = await generateWithOllama(mode, topics, attempt);
    const candidate = sanitizeReview(generated);

    if (candidate && isReviewLengthValid(candidate, mode) && !isRedundantReview(candidate)) {
      rememberGeneratedReview(candidate);
      return candidate;
    }
  }

  const fallback = buildUniqueFallbackReview(mode, topics);
  rememberGeneratedReview(fallback);
  return fallback;
}

async function generateWithOllama(mode, topics, attempt = 0) {
  const styleAngle = getReviewStyleAngle(attempt);
  const recentReviews = getReviewHistory().slice(0, 4);
  const toneElement = document.querySelector("#reviewTone");
  const tone = toneElement ? toneElement.value : "Professional";
  
  const toneInstructions = {
    Professional: "Measured, professional business-to-business (B2B) tone focusing on competence, reliable delivery, and high quality. Example style: 'Highly competent team that delivers on their promises.'",
    Enthusiastic: "High energy, excited, and dynamic focusing on outstanding results and absolute excellence. Example style: 'Absolutely incredible experience working with this team!'",
    Appreciative: "Focused on deep gratitude, warmth, support, relationship, and patient guidance. Example style: 'So thankful for their patience and guidance throughout the process.'"
  };

  const lengthInstructions = {
    short: "exactly 1 punchy sentence, 50 to 105 characters.",
    medium: "exactly 1 to 2 short sentences, 105 to 185 characters total. Do not exceed 185 characters.",
    long: "one polished paragraph of 3 to 4 sentences, 220 to 450 characters."
  };

  const topicInstructions = topics.length 
    ? `Praise these selected aspects: ${topics.join(", ")}. Keep the selected aspect wording recognizable, especially exact ideas like "attention to detail". Combine them into ONE compact impact statement instead of listing each aspect separately.`
    : "CRITICAL: The customer has NOT selected any specific features yet. You MUST NOT mention any specific service outcomes (such as B2B project delivery speed, ROI goals, web design, leads count, transparent reporting, or WhatsApp automation setups). Write a general recommendation focusing purely on overall satisfaction with EESWEB as a B2B partner, professional teamwork, and a very good overall partnership experience.";
  const recentOpenings = recentReviews
    .map((review) => review.split(/[.!?]/)[0])
    .filter(Boolean)
    .slice(0, 4);

  const prompt = [
    config.reviewSystemPrompt,
    "",
    `Write one ${mode} Google review for ${config.businessName} with a ${tone} tone.`,
    `Tone rules: ${toneInstructions[tone] || toneInstructions.Professional}`,
    `Length rules: Output must be ${lengthInstructions[mode] || lengthInstructions.medium}`,
    `Rating: ${state.rating} out of 5.`,
    topicInstructions,
    `Style angle: ${styleAngle}.`,
    "Keep it natural, human, specific, and B2B digital-agency oriented. Do not write about food, dining, or restaurants.",
    "The selected topics are context, not permission to make the review long. Mention impact briefly and keep the final text tight.",
    "Do not use the same opening, ending, sentence shape, or impact phrase as prior suggestions.",
    "Avoid template phrases like 'loved working with', 'really lifted the outcome', and 'made a real difference' unless they are not present in recent suggestions.",
    "Do not put quotes around the review.",
    "Avoid repeating the same phrase in the review.",
    recentOpenings.length ? `Do not start like these:\n- ${recentOpenings.join("\n- ")}` : "",
    recentReviews.length ? `Avoid sounding like these recent suggestions:\n- ${recentReviews.join("\n- ")}` : "",
  ].join("\n");

  const ollamaHost = config.ollamaUrl.replace(/\/api\/generate$/, "");
  if (!ollamaHost || ollamaHost.includes("NOT_USED") || ollamaHost.includes("localhost") && location.protocol === "https:") {
    throw new Error("Ollama not available in this environment.");
  }

  const response = await fetch(config.ollamaUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt,
      stream: false,
      options: {
        temperature: 1.08 + attempt * 0.12,
        top_p: 0.94,
        top_k: 80,
        repeat_penalty: 1.08,
        num_predict: mode === "long" ? 100 : mode === "medium" ? 42 : 26,
      },
    }),
  });

  if (!response.ok) {
    throw new Error("Ollama request failed");
  }

  const data = await response.json();
  return String(data.response || "").trim();
}

function sanitizeReview(review) {
  return String(review || "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function joinPhrases(phrases) {
  if (phrases.length === 0) return "";
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

function buildUniqueFallbackReview(mode, topics) {
  const toneElement = document.querySelector("#reviewTone");
  const tone = toneElement ? toneElement.value : "Professional";
  const compactReview = buildCompactFallbackReview(mode, topics, tone);
  if (compactReview) {
    return compactReview;
  }
  
}

function buildCompactFallbackReview(mode, topics, tone) {
  const options = buildFallbackOptions(mode, topics, tone);
  const start = getFallbackStartIndex(options.length, topics, tone, mode);
  for (let index = 0; index < options.length; index += 1) {
    const candidate = trimReviewToMode(options[(start + index) % options.length], mode);
    if (!isRedundantReview(candidate)) {
      return candidate;
    }
  }
  return trimReviewToMode(options[start], mode);
}

function buildFallbackOptions(mode, topics, tone) {
  const topicSet = getTopicSet(topics);
  const business = config.businessName;
  const noTopicOptions = getNoTopicFallbackOptions(mode, tone, business);
  if (!topicSet.length) {
    return noTopicOptions;
  }

  const openings = getFallbackOpenings(tone, business);
  const outcomes = getFallbackOutcomes(tone);
  const bridges = [
    "the project felt organized from the first call",
    "we always knew what was happening next",
    "the final work felt aligned with our goals",
    "the process stayed smooth without losing momentum",
    "our team could move forward with more confidence",
    "the collaboration felt focused and easy to trust",
  ];
  const topicPhrases = getTopicPhraseVariants(topicSet);
  const options = [];

  for (let i = 0; i < openings.length; i += 1) {
    const topicPhrase = topicPhrases[i % topicPhrases.length];
    const outcome = outcomes[(i + state.generationCount) % outcomes.length];
    const bridge = bridges[(i + topicSet.length + state.generationCount) % bridges.length];

    if (mode === "short") {
      options.push(`${openings[i]} ${topicPhrase.highlight}`);
      continue;
    }

    if (mode === "long") {
      options.push(`${openings[i]} ${topicPhrase.highlight} ${bridge}, and ${outcome}.`);
      continue;
    }

    options.push(`${openings[i]} ${topicPhrase.inline}, and ${outcome}.`);
    options.push(`${openings[i]} ${bridge}. ${topicPhrase.highlight}`);
  }

  return options;
}

function getTopicSet(topics) {
  return topics.slice(0, 3).map(normalizeTopicForImpact).filter(Boolean);
}

function normalizeTopicForImpact(topic) {
  const replacements = {
    "Highly Responsive": "quick support",
    "Clear Communication": "clear communication",
    "Patient & Helpful": "patient guidance",
    "Delivered on Time": "timely delivery",
    "Transparent Process": "process clarity",
    "Attention to Detail": "attention to detail",
    "Exceeded Expectations": "thoughtful extra effort",
    "Great ROI": "strong business value",
    "Stress-Free Experience": "calm project handling",
  };
  return replacements[topic] || String(topic || "").trim().toLowerCase();
}

function getTopicPhraseVariants(topicSet) {
  const joined = joinPhrases(topicSet);
  const first = topicSet[0];
  const second = topicSet[1] || topicSet[0];
  const third = topicSet[2] || topicSet[0];
  return [
    {
      inline: `${joined} stood out`,
      highlight: `${capitalizeFirst(joined)} stood out.`,
    },
    {
      inline: `their ${joined} made the work easier`,
      highlight: `Their ${joined} made the work easier.`,
    },
    {
      inline: `${first} and ${second} were handled really well`,
      highlight: `${capitalizeFirst(first)} and ${second} were handled really well.`,
    },
    {
      inline: `the team brought ${joined} into the whole project`,
      highlight: `The team brought ${joined} into the whole project.`,
    },
    {
      inline: `${third} showed clearly in the final result`,
      highlight: `${capitalizeFirst(third)} showed clearly in the final result.`,
    },
    {
      inline: `we noticed ${joined} throughout the process`,
      highlight: `We noticed ${joined} throughout the process.`,
    },
  ];
}

function getFallbackOpenings(tone, business) {
  const openings = {
    Professional: [
      `${business} gave us a solid experience.`,
      `Our project with ${business} felt well managed.`,
      `${business} handled the work with real care.`,
      `Working with ${business} was straightforward.`,
      `${business} was a reliable digital partner.`,
      `The team at ${business} kept things moving well.`,
    ],
    Enthusiastic: [
      `${business} genuinely impressed us.`,
      `The ${business} team brought great energy.`,
      `We had a fantastic run with ${business}.`,
      `${business} made the whole project feel exciting.`,
      `Really happy with how ${business} showed up.`,
      `${business} turned the work into a smooth win.`,
    ],
    Appreciative: [
      `We really appreciated ${business}.`,
      `${business} made the process feel calm.`,
      `We felt well supported by ${business}.`,
      `The team at ${business} was easy to trust.`,
      `We are thankful for how ${business} guided us.`,
      `${business} made the collaboration feel simple.`,
    ],
  };
  return openings[tone] || openings.Professional;
}

function getFallbackOutcomes(tone) {
  const outcomes = {
    Professional: [
      "the final result felt useful for our business",
      "the work gave us more clarity and confidence",
      "the outcome matched what we needed",
      "the delivery felt practical and dependable",
      "the experience felt polished without being complicated",
      "the result was easy for our team to build on",
    ],
    Enthusiastic: [
      "the final result had a real impact",
      "the outcome felt better than expected",
      "the whole experience felt smooth and energizing",
      "the work helped us move with more confidence",
      "the result felt sharp and genuinely useful",
      "the project ended with strong momentum",
    ],
    Appreciative: [
      "we felt confident at each step",
      "the outcome made the effort feel worthwhile",
      "the process felt easier than expected",
      "the support helped us move with confidence",
      "we finished with clarity and confidence",
      "the experience felt thoughtful and well guided",
    ],
  };
  return outcomes[tone] || outcomes.Professional;
}

function getNoTopicFallbackOptions(mode, tone, business) {
  const options = {
    Professional: {
      short: [`Solid, professional experience with ${business}.`, `${business} was reliable and clear throughout.`],
      medium: [
        `${business} was clear, responsive, and easy to work with. The project felt organized from start to finish.`,
        `A strong experience with ${business}. Their team kept the work practical, focused, and well managed.`,
      ],
      long: [
        `${business} gave us a smooth and professional experience. Their team communicated clearly, understood our goals, and kept the work moving without confusion. It felt like a reliable partnership from start to finish.`,
      ],
    },
    Enthusiastic: {
      short: [`Great experience with ${business}; the team was sharp.`, `${business} made the project feel easy and exciting.`],
      medium: [
        `${business} brought great energy and clear ownership. The whole project felt smooth, focused, and useful.`,
        `Really happy with ${business}. Their team made the process easy while still delivering a strong outcome.`,
      ],
      long: [
        `${business} brought great energy to the project. Their team stayed responsive, clear, and focused on the outcome. The experience felt smooth while still giving us work we could actually use.`,
      ],
    },
    Appreciative: {
      short: [`Grateful for the clear support from ${business}.`, `${business} made the process feel calm and guided.`],
      medium: [
        `We appreciated how ${business} supported us. The team made the process clear, calm, and easy to follow.`,
        `${business} was patient and reliable throughout. We felt guided without feeling rushed or confused.`,
      ],
      long: [
        `We appreciated the care ${business} brought to the project. Their team listened well, explained things clearly, and helped us make decisions with confidence. The collaboration felt calm, useful, and well guided.`,
      ],
    },
  };
  const toneOptions = options[tone] || options.Professional;
  return toneOptions[mode] || toneOptions.medium;
}

function getFallbackStartIndex(optionCount, topics, tone, mode) {
  const seed = `${topics.join("|")}:${tone}:${mode}:${Date.now()}:${state.generationCount}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return optionCount ? hash % optionCount : 0;
}

function capitalizeFirst(value) {
  return String(value || "").replace(/^./, (char) => char.toUpperCase());
}

function trimReviewToMode(review, mode) {
  const limits = {
    short: 110,
    medium: 190,
    long: 460,
  };
  const limit = limits[mode] || limits.medium;
  const clean = sanitizeReview(review);
  if (clean.length <= limit) {
    return clean;
  }
  const trimmed = clean.slice(0, limit - 1).replace(/\s+\S*$/, "").replace(/[,.!?;:]+$/, "");
  return `${trimmed}.`;
}

function getReviewStyleAngle(attempt) {
  const angles = [
    "warm and conversational, like a real customer sharing what they liked",
    "specific and concise, with a different opening than previous suggestions",
    "friendly and appreciative, focusing on the customer experience",
    "simple and believable, avoiding generic praise",
    "fresh wording with a natural recommendation at the end",
  ];
  const index = (state.generationCount + attempt) % angles.length;
  return angles[index];
}

function isRedundantReview(candidate) {
  const normalizedCandidate = normalizeForSimilarity(candidate);
  if (!normalizedCandidate) {
    return true;
  }

  return getReviewHistory().some((previousReview) => {
    const score = getSimilarityScore(normalizedCandidate, normalizeForSimilarity(previousReview));
    return score >= config.duplicateSimilarityLimit;
  });
}

function getSimilarityScore(firstReview, secondReview) {
  const firstWords = new Set(firstReview.split(" ").filter(Boolean));
  const secondWords = new Set(secondReview.split(" ").filter(Boolean));
  if (!firstWords.size || !secondWords.size) {
    return 0;
  }

  const sharedWords = [...firstWords].filter((word) => secondWords.has(word)).length;
  const uniqueWords = new Set([...firstWords, ...secondWords]).size;
  return sharedWords / uniqueWords;
}

function normalizeForSimilarity(review) {
  const commonWords = new Set([
    "a",
    "an",
    "and",
    "at",
    "for",
    "had",
    "i",
    "it",
    "of",
    "the",
    "to",
    "was",
  ]);

  return String(review || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !commonWords.has(word))
    .join(" ");
}

function rememberGeneratedReview(review) {
  const history = [sanitizeReview(review), ...getReviewHistory()]
    .filter(Boolean)
    .slice(0, config.maxReviewHistory);
  localStorage.setItem(getReviewHistoryKey(), JSON.stringify(history));
  state.generationCount += 1;
}

function getReviewHistory() {
  return JSON.parse(localStorage.getItem(getReviewHistoryKey()) || "[]");
}

function getReviewHistoryKey() {
  return `reviewFunnelRecentSuggestions:${config.businessName}`;
}

function getSoftUniquenessSuffix() {
  const suffixes = [
    "The experience felt personal and well cared for.",
    "It felt like a team that pays attention to the small details.",
    "That extra care made the collaboration easy to appreciate.",
  ];
  return suffixes[state.generationCount % suffixes.length];
}

function getSelectedTopics() {
  return Array.from(document.querySelectorAll('#positiveTopics input[type="checkbox"]:checked')).map(
    (input) => input.value,
  );
}

async function copyReview() {
  const text = reviewText.value.trim();
  if (!text) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    showToast("Review copied.");
  } catch (error) {
    reviewText.focus();
    reviewText.select();
    document.execCommand("copy");
    showToast("Review selected. Copy it if needed.");
  }
}

function savePostedReview() {
  saveToServer("postedReviews", "customer_self_reported_google_post", {
    rating: state.rating,
    ratingEventId: state.ratingEventId,
    reviewText: reviewText.value.trim(),
    status: "self_reported_posted",
  });
}

function getGoogleReviewUrl() {
  return "https://g.page/r/CUylmtiX6yoSEAE/review";
}

function showThankYou(isPositive, openedGoogle = false, googleReviewUrl = "") {
  window.clearTimeout(state.redirectTimer);
  window.clearInterval(state.countdownTimer);

  thankYouMessage.textContent = isPositive
    ? openedGoogle
      ? "Thank you, this means a lot to us. Your review has been copied and you will be redirected to Google Reviews shortly."
      : "Your review test has been saved. Add a Google Place ID later to enable the redirect."
    : "Thank you for your review! We truly value your input and our team will work on making your next experience even better.";
  reviewInstructions.hidden = !isPositive || !openedGoogle;
  document.querySelector("#postedButton").hidden = true;
  showStep("thankYou");

  if (isPositive && openedGoogle && googleReviewUrl) {
    startGoogleRedirectCountdown(googleReviewUrl);
  }
}

function startGoogleRedirectCountdown(googleReviewUrl) {
  const countdownElement = document.querySelector("#redirectCountdown");
  let secondsLeft = 5;
  if (countdownElement) {
    countdownElement.textContent = String(secondsLeft);
  }

  state.countdownTimer = window.setInterval(() => {
    secondsLeft -= 1;
    if (countdownElement) {
      countdownElement.textContent = String(Math.max(secondsLeft, 0));
    }
    if (secondsLeft <= 0) {
      window.clearInterval(state.countdownTimer);
    }
  }, 1000);

  state.redirectTimer = window.setTimeout(() => {
    window.location.href = googleReviewUrl;
  }, 5000);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function saveScanEvent(type, payload) {
  const collection = getCollectionForEvent(type);
  if (collection) {
    saveToServer(collection, type, payload);
  }

  const events = JSON.parse(localStorage.getItem("reviewFunnelEvents") || "[]");
  events.push({
    type,
    payload: {
      ...payload,
      sessionId: state.sessionId,
      businessId: config.businessId,
      branchId: config.branchId,
      qrCodeId: config.qrCodeId,
    },
    context: config.qrContext,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem("reviewFunnelEvents", JSON.stringify(events));
}

function getCollectionForEvent(type) {
  if (type === "rating_selected") {
    return "ratings";
  }
  if (type === "negative_feedback_submitted") {
    return "feedback";
  }
  if (type === "google_review_clicked") {
    return "reviewEvents";
  }
  return "";
}

async function saveToServer(collection, type, payload) {
  try {
    const response = await fetch("/api/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        collection,
        type,
        userAgent: navigator.userAgent,
        payload: {
          ...payload,
          businessId: config.businessId,
          branchId: config.branchId,
          branchName: config.branchName,
          qrCodeId: config.qrCodeId,
          qrLabel: config.qrLabel,
          source: config.qrSource || config.qrContext.source,
          campaign: config.campaign || config.qrContext.campaign,
          sessionId: state.sessionId,
          context: config.qrContext,
        },
      }),
    });

    if (!response.ok) {
      throw new Error("Firestore save failed");
    }
  } catch (error) {
    console.warn(error.message);
  }
}

function getOrCreateSessionId() {
  const key = "reviewFunnelSessionId";
  const existing = sessionStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem(key, id);
  return id;
}
