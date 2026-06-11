const pageParams = new URLSearchParams(window.location.search);
const appContext = resolveAppContext();

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
  reviewModel: "meta-llama/llama-3.2-1b-instruct",
  reviewSystemPrompt:
    "You write realistic customer review suggestions for Google Reviews. Output only one review, with no title, no bullets, no quotes, and no explanation. Sound like a genuine customer, not a marketer. Use simple natural language, specific but believable praise, and avoid overpromising. Avoid repeating the same phrase or idea in the same review. Do not mention AI, generated text, ratings, prompts, business strategy, or internal instructions. Do not use emojis, hashtags, excessive adjectives, or phrases like highly recommended more than once.",
  maxReviewHistory: 12,
  maxGenerationAttempts: 5,
  duplicateSimilarityLimit: 0.72,
  aiTone: "Enthusiastic",
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
const brandLogoImage = document.querySelector(".brand-mark img");
const reviewText = document.querySelector("#reviewText");
const reviewMode = document.querySelector("#reviewMode");
const googleReviewButton = document.querySelector("#googleReviewButton");
const positiveTopics = document.querySelector("#positiveTopics");
const feedbackTopics = document.querySelector("#feedbackTopics");
const toast = document.querySelector("#toast");
const thankYouMessage = document.querySelector("#thankYouMessage");
const reviewInstructions = document.querySelector("#reviewInstructions");

const vehicleModal = document.querySelector("#vehicleModal");
const vehicleModalOverlay = document.querySelector("#vehicleModalOverlay");
const vehicleModalClose = document.querySelector("#vehicleModalClose");
const vehicleModalKicker = document.querySelector("#vehicleModalKicker");
const vehicleModalTitle = document.querySelector("#vehicleModalTitle");
const vehicleQuickOptions = document.querySelector("#vehicleQuickOptions");
const vehicleModelInput = document.querySelector("#vehicleModelInput");
const skipVehicleButton = document.querySelector("#skipVehicleButton");
const saveVehicleButton = document.querySelector("#saveVehicleButton");
const editVehicleButton = document.querySelector("#editVehicleButton");

const vehicleQuickOptionsByTopic = {
  "New Bike Purchase": ["Apache RTR 160", "Apache RTR 200", "Raider", "Radeon"],
  "New Scooter Purchase": ["Jupiter", "Ntorq", "iQube", "Zest"],
};

document.body.dataset.step = "rating";
initApp();

function paintStars(rating) {
  document.querySelectorAll(".rating-button").forEach((ratingButton) => {
    const value = Number(ratingButton.dataset.rating);
    ratingButton.classList.toggle("is-filled", value <= rating);
    ratingButton.classList.toggle("is-selected", value === rating);
  });
}

document.querySelectorAll(".rating-button").forEach((button) => {
  button.addEventListener("click", () => {
    state.rating = Number(button.dataset.rating);
    state.ratingEventId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    paintStars(state.rating);
    saveScanEvent("rating_selected", { rating: state.rating, ratingEventId: state.ratingEventId });

    // Brief pause so the reviewer sees the stars fill before advancing
    window.setTimeout(() => {
      if (state.rating >= 4) {
        showStep("positive");
        // A topic chip is mandatory: gate the controls until the reviewer picks one.
        applyTopicGate();
      } else {
        showStep("feedback");
      }
    }, 280);
  });
});

positiveTopics.addEventListener("change", (e) => {
  // Show/hide the free-text field when "Others" is toggled.
  const changedEl = e.target;
  if (changedEl && changedEl.type === "checkbox" && changedEl.value === "Others") {
    updateOthersField(changedEl.checked);
  }

  // Only generate once at least one chip is selected; otherwise re-show the "pick a chip" gate.
  if (hasSelectedTopics()) {
    setReviewControlsEnabled(true);
    reviewText.placeholder = "";
    scheduleGenerateReview();
  } else {
    applyTopicGate();
  }
  if (config.businessId === "shelar-tvs") {
    const changed = e.target;
    if (changed && changed.type === "checkbox") {
      const topic = changed.value;
      const isVehicleTopic = topic === "New Bike Purchase" || topic === "New Scooter Purchase";
      if (isVehicleTopic && changed.checked) {
        window.setTimeout(() => openVehicleModal(topic), 100);
      } else if (isVehicleTopic && !changed.checked) {
        // Check if any other vehicle topic is still checked
        const anyVehicleChecked = Array.from(positiveTopics.querySelectorAll("input[type=checkbox]"))
          .some((cb) => cb.checked && (cb.value === "New Bike Purchase" || cb.value === "New Scooter Purchase"));
        if (!anyVehicleChecked) {
          state.vehicleModel = "";
          updateVehicleContext();
        }
      }
    }
  }
});
reviewMode.addEventListener("change", () => scheduleGenerateReview());
document.querySelector("#reviewTone").addEventListener("change", () => scheduleGenerateReview());

// Regenerate as the reviewer types their custom "Others" note (debounced).
const othersNoteInput = document.querySelector("#othersNote");
if (othersNoteInput) {
  othersNoteInput.addEventListener("input", () => {
    if (isOthersSelected()) scheduleGenerateReview(600);
  });
}

// Regenerate when the staff name is added/changed (debounced), so it gets woven in instantly.
const staffNameInput = document.querySelector("#staffName");
if (staffNameInput) {
  staffNameInput.addEventListener("input", () => {
    if (hasSelectedTopics()) scheduleGenerateReview(600);
  });
}

document.querySelector("#regenerateButton").addEventListener("click", () => {
  if (!hasSelectedTopics()) {
    applyTopicGate();
    showToast(SELECT_TOPIC_HINT);
    return;
  }
  generateReview();
});

if (vehicleModalOverlay) vehicleModalOverlay.addEventListener("click", closeVehicleModal);
if (vehicleModalClose) vehicleModalClose.addEventListener("click", closeVehicleModal);
if (skipVehicleButton) skipVehicleButton.addEventListener("click", skipVehicleDetail);
if (saveVehicleButton) saveVehicleButton.addEventListener("click", saveVehicleDetail);
if (vehicleModelInput) vehicleModelInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveVehicleDetail();
});

document.querySelector("#copyReviewButton").addEventListener("click", async () => {
  await copyReview();
});

googleReviewButton.addEventListener("click", async () => {
  if (!hasSelectedTopics() || !reviewText.value.trim()) {
    applyTopicGate();
    showToast(SELECT_TOPIC_HINT);
    return;
  }
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
  const issues = data.getAll("issue");
  const message = String(data.get("message") || "").trim();

  // If "Other" is selected, the review message becomes mandatory
  const otherSelected = issues.some((issue) => issue.toLowerCase() === "other");
  if (otherSelected && !message) {
    const messageField = document.querySelector("#feedbackMessage");
    showToast("Please describe the issue in your review.");
    if (messageField) {
      messageField.setAttribute("aria-invalid", "true");
      messageField.classList.add("is-invalid");
      messageField.focus();
    }
    return;
  }

  const payload = {
    rating: state.rating,
    ratingEventId: state.ratingEventId,
    message,
    name: data.get("name"),
    phone: data.get("phone"),
    callback: data.get("callback") === "on",
    issues,
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
    ratingButton.classList.remove("is-selected", "is-filled");
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
  updateBrandUI();
}

function updateBrandUI() {
  const business = String(config.businessName || "").trim();
  const branch = String(config.branchName || "").trim();
  const isMain = !branch || ["main", "pune"].includes(branch.toLowerCase());

  // Eyebrow: "Shelar TVS · Aranyeshwar" or just "Shelar TVS"
  const eyebrow = document.querySelector("#businessEyebrow");
  if (eyebrow) {
    eyebrow.textContent = isMain ? business : `${business} · ${branch}`;
    eyebrow.style.visibility = "";
  }

  // h1 question
  if (businessName) {
    businessName.textContent = isMain
      ? `How was your experience at ${business}?`
      : `How was your experience at ${business}, ${branch}?`;
    businessName.style.visibility = "";
  }

  // Logo -- use logoUrl from config if set, otherwise fall back to per-client static file
  const logoEl = document.querySelector("#businessLogo");
  if (logoEl) {
    const fallbackLogo = config.businessId === "shelar-tvs" ? "shelar-tvs-logo.png" : "logo.png";
    logoEl.src = config.logoUrl || fallbackLogo;
    logoEl.alt = business;
  }

  // Apply shelar-tvs blue theme to body
  if (config.businessId === "shelar-tvs") {
    document.body.dataset.brand = "shelar-tvs";
  } else {
    delete document.body.dataset.brand;
  }
}

function renderTopicChips() {
  positiveTopics.innerHTML = config.reviewTopics
    .map((topic) => `<label><input type="checkbox" value="${escapeHtml(topic)}" /> ${escapeHtml(topic)}</label>`)
    .join("");

  feedbackTopics.innerHTML = config.feedbackTopics
    .map((topic) => `<label><input type="checkbox" name="issue" value="${escapeHtml(topic)}" /> ${escapeHtml(getShortTopicLabel(topic))}</label>`)
    .join("");

  // When "Other" is toggled, reflect whether the review message is required
  feedbackTopics.querySelectorAll('input[name="issue"]').forEach((input) => {
    input.addEventListener("change", updateFeedbackMessageRequirement);
  });

  const messageField = document.querySelector("#feedbackMessage");
  if (messageField) {
    messageField.addEventListener("input", () => {
      messageField.removeAttribute("aria-invalid");
      messageField.classList.remove("is-invalid");
    });
  }
}

function updateFeedbackMessageRequirement() {
  const otherSelected = Array.from(
    feedbackTopics.querySelectorAll('input[name="issue"]:checked')
  ).some((input) => input.value.toLowerCase() === "other");

  const optionalTag = document.querySelector("#feedbackMessageLabel .field-optional");
  const messageField = document.querySelector("#feedbackMessage");
  if (optionalTag) {
    optionalTag.textContent = otherSelected ? "(required)" : "(optional)";
  }
  if (messageField && !otherSelected) {
    messageField.removeAttribute("aria-invalid");
    messageField.classList.remove("is-invalid");
  }
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
    if (pageParams.get("business") || config.qrContext.businessId) {
      params.set("business", pageParams.get("business") || config.qrContext.businessId);
    }
    const response = await fetch(apiUrl(`/api/config?${params}`));
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
    updateBrandUI();
  } catch (error) {
    updateBrandUI();
  }
}

function scheduleGenerateReview(delay = 220) {
  // Never generate without at least one selected topic chip.
  if (!hasSelectedTopics()) {
    applyTopicGate();
    return;
  }
  window.clearTimeout(state.generationTimer);
  state.generationTimer = window.setTimeout(() => generateReview(), delay);
}

function getAutoMode(topics) {
  const count = state.generationCount;
  // Keep reviews concise: never "long". Favour medium (1-2 sentences) with some short variation.
  if (topics.length >= 2) {
    // A couple of topics: mostly medium, occasionally short.
    return ["medium", "short", "medium", "medium"][count % 4];
  }
  // Single topic (or none): alternate short and medium so it stays brief.
  return count % 2 === 0 ? "short" : "medium";
}

function getAutoTone() {
  const tones = ["Enthusiastic", "Appreciative", "Professional"];
  return tones[state.generationCount % tones.length];
}

async function generateReview() {
  const topics = getSelectedTopics();
  // Hard guard: a topic chip is mandatory. Never call the API without one.
  if (!topics.length) {
    applyTopicGate();
    return;
  }
  const requestId = state.generationRequestId + 1;
  state.generationRequestId = requestId;
  const mode = getAutoMode(topics);
  const tone = getAutoTone();
  reviewText.value = "Generating your review suggestion...";

  try {
    const generated = await generateUniqueReview(mode, tone, topics);
    if (requestId !== state.generationRequestId) return;
    reviewText.value = generated;
  } catch (error) {
    const fallback = buildUniqueFallbackReview(mode, topics);
    if (requestId !== state.generationRequestId) return;
    if (fallback) {
      rememberGeneratedReview(fallback);
      reviewText.value = fallback;
    } else {
      reviewText.value = getOpeningSafeFallback(mode);
    }
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

async function generateUniqueReview(mode, tone, topics) {
  const generated = await generateWithOpenRouter(mode, tone, topics);
  const candidate = sanitizeReview(generated);
  if (candidate) {
    rememberGeneratedReview(candidate);
    return candidate;
  }
  throw new Error("No acceptable LLM review generated.");
}

async function generateWithOpenRouter(mode, tone, topics) {
  const recentReviews = getReviewHistory().slice(0, 4);
  const staffEl = document.querySelector("#staffName");
  const staff = staffEl ? staffEl.value.replace(/[^\p{L}\s.'-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40) : "";

  const note = isOthersSelected() ? getOthersNote() : "";

  const response = await fetch(apiUrl("/api/review/generate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      tone,
      topics,
      staff,
      vehicle: state.vehicleModel || "",
      note,
      rating: state.rating,
      qrCodeId: config.qrCodeId,
      recentReviews,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Review generation failed");
  }

  return String(data.review || "").trim();
}

function sanitizeReview(review) {
  return String(review || "")
    .replace(/^["'""]+|["'""]+$/g, "")
    .replace(/\s*--\s*/g, ". ")
    .replace(/\s*--\s*/g, ". ")
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
  const tone = config.aiTone || (document.querySelector("#reviewTone")?.value) || "Enthusiastic";
  const compactReview = buildCompactFallbackReview(mode, topics, tone);
  return compactReview || getOpeningSafeFallback(mode);
}

function buildCompactFallbackReview(mode, topics, tone) {
  const options = buildFallbackOptions(mode, topics, tone);
  const start = getFallbackStartIndex(options.length, topics, tone, mode);
  const candidates = [];

  // First pass: find a review that passes all quality checks
  for (let index = 0; index < options.length; index += 1) {
    const candidate = trimReviewToMode(options[(start + index) % options.length], mode);
    if (!candidate) continue;
    candidates.push(candidate);
    if (isReviewQualityAcceptable(candidate)) return candidate;
  }

  // Second pass: relax -- accept anything not exact-matched or awkward (ignore similarity score)
  const relaxed = candidates.find((c) =>
    !hasExactReviewMatch(c) && !hasAwkwardReviewWording(c)
  );
  if (relaxed) return relaxed;

  // Last resort: mutate the best candidate slightly to make it distinct
  return buildDistinctFallbackVariant(candidates[0] || "", mode);
}

function buildFallbackOptions(mode, topics, tone) {
  const topicSet = getTopicSet(topics);
  const business = config.businessName;
  const noTopicOptions = getNoTopicFallbackOptions(mode, tone, business);
  if (!topicSet.length) {
    return noTopicOptions;
  }

  if (mode === "short") {
    return buildShortTopicFallbackOptions(topicSet, tone, business);
  }

  return buildTopicFallbackOptions(topicSet, mode, tone, business);
}

function buildTopicFallbackOptions(topicSet, mode, tone, business) {
  const topicSentences = getTopicSentenceVariants(topicSet);
  const openings = {
    Professional: [
      `${business} gave us a solid, practical experience.`,
      `Working with ${business} felt organized and dependable.`,
      `${business} was a reliable digital partner for our team.`,
      `${business} kept the project practical and focused.`,
      `Our team had a dependable experience with ${business}.`,
      `${business} brought a steady, professional approach.`,
      `The project with ${business} felt well structured.`,
      `${business} handled the work with clear ownership.`,
      `Our work with ${business} stayed clear and purposeful.`,
      `${business} approached the project with real professionalism.`,
      `The ${business} team kept the work moving in the right direction.`,
      `${business} gave us a practical and reliable collaboration.`,
      `We found ${business} easy to work with throughout the project.`,
      `${business} supported the project with a steady approach.`,
    ],
    Enthusiastic: [
      `Really happy with the work from ${business}.`,
      `${business} genuinely impressed us on this project.`,
      `We had a strong experience working with ${business}.`,
      `${business} did a great job on this project.`,
      `The ${business} team made a strong impression.`,
      `Working with ${business} was a very positive experience.`,
      `${business} brought real energy to the work.`,
      `Our experience with ${business} was genuinely positive.`,
      `${business} delivered a really solid experience for us.`,
      `We liked how ${business} showed up on this project.`,
      `The project with ${business} went really well.`,
      `${business} gave us work we felt good about.`,
      `We came away impressed with ${business}.`,
      `${business} made the collaboration feel worthwhile.`,
      `The ${business} team did work we could trust.`,
      `We were pleased with the way ${business} worked.`,
    ],
    Appreciative: [
      `We appreciated the way ${business} worked with us.`,
      `${business} was thoughtful, clear, and reliable throughout.`,
      `We valued the care ${business} brought to the project.`,
      `${business} made the collaboration easy to appreciate.`,
      `We were glad to have ${business} on this project.`,
      `The ${business} team was considerate and dependable.`,
      `We appreciated ${business}'s practical support.`,
      `${business} gave us a thoughtful working experience.`,
      `We valued the way ${business} supported the work.`,
      `${business} made the project feel well cared for.`,
      `The support from ${business} felt clear and dependable.`,
      `We appreciated how seriously ${business} took the project.`,
      `${business} gave us a reliable and thoughtful experience.`,
      `We felt ${business} brought real care to the work.`,
    ],
  };
  const closing = {
    Professional: "The result felt useful for our business.",
    Enthusiastic: "The final result felt genuinely useful.",
    Appreciative: "It made the collaboration easy to value.",
  };
  const toneOpenings = openings[tone] || openings.Professional;
  const options = [];

  if (mode === "long") {
    for (const opening of toneOpenings) {
      for (const topicSentence of topicSentences) {
        options.push(`${opening} ${topicSentence} ${closing[tone] || closing.Professional}`);
      }
    }
    return options;
  }

  for (const opening of toneOpenings) {
    for (const topicSentence of topicSentences) {
      options.push(`${opening} ${topicSentence}`);
    }
  }
  return options;
}

function buildShortTopicFallbackOptions(topicSet, tone, business) {
  const clauses = topicSet.slice(0, 2).map(getShortTopicClause).filter(Boolean);
  const joined = joinShortClauses(clauses);
  const options = {
    Professional: [
      `${business} ${joined}.`,
      `${business} delivered solid work and ${joined}.`,
      `A reliable experience with ${business}; they ${joined}.`,
      `Good work from ${business}; they ${joined}.`,
      `${business} was practical and ${joined}.`,
      `${business} kept things focused and ${joined}.`,
      `Solid experience with ${business}; they ${joined}.`,
      `${business} supported the work well and ${joined}.`,
    ],
    Enthusiastic: [
      `${business} did great work and ${joined}.`,
      `Really happy with ${business}; they ${joined}.`,
      `${business} impressed us and ${joined}.`,
      `Great experience with ${business}; they ${joined}.`,
      `${business} showed up strongly and ${joined}.`,
      `${business} made a strong impression and ${joined}.`,
      `Loved the experience with ${business}; they ${joined}.`,
      `${business} delivered a solid result and ${joined}.`,
    ],
    Appreciative: [
      `We appreciated ${business}; they ${joined}.`,
      `${business} was reliable and ${joined}.`,
      `We valued working with ${business}; they ${joined}.`,
      `Grateful for ${business}; they ${joined}.`,
      `${business} supported us well and ${joined}.`,
      `We valued ${business}'s support; they ${joined}.`,
      `${business} was helpful and ${joined}.`,
      `We appreciated the work from ${business}; they ${joined}.`,
    ],
  };
  return options[tone] || options.Professional;
}

function getShortTopicClause(topic) {
  const clauses = {
    "quick support": "responded quickly",
    "clear communication": "communicated clearly",
    "patient guidance": "explained things patiently",
    "timely delivery": "managed timelines well",
    "process clarity": "kept the process clear",
    "attention to detail": "thought through the small details",
    "thoughtful extra effort": "went beyond the basics",
    "strong business value": "added business value",
    "calm project handling": "kept the project manageable",
  };
  return clauses[topic] || `made ${topic} stand out`;
}

function getReviewTopicClause(topic) {
  const clauses = {
    "quick support": "responded quickly",
    "clear communication": "communicated clearly",
    "patient guidance": "explained things patiently",
    "timely delivery": "managed timelines well",
    "process clarity": "kept the process clear",
    "attention to detail": "thought through the small details",
    "thoughtful extra effort": "went beyond the basics",
    "strong business value": "added business value",
    "calm project handling": "kept the project manageable",
  };
  return clauses[topic] || `made ${topic} stand out`;
}

function getReviewTopicNounPhrase(topic) {
  const phrases = {
    "quick support": "responsive support",
    "clear communication": "clear communication",
    "patient guidance": "patient explanations",
    "timely delivery": "well-managed timelines",
    "process clarity": "a clear process",
    "attention to detail": "careful attention to detail",
    "thoughtful extra effort": "thoughtful extra effort",
    "strong business value": "business value",
    "calm project handling": "steady project handling",
  };
  return phrases[topic] || topic;
}

function getTopicSentenceVariants(topicSet) {
  const clauses = topicSet.map(getReviewTopicClause).filter(Boolean);
  const nounPhrases = topicSet.map(getReviewTopicNounPhrase).filter(Boolean);
  const joinedClauses = joinReviewClauses(clauses);
  const joinedNouns = joinNaturalPhrases(nounPhrases);
  return [
    `They ${joinedClauses}.`,
    `${capitalizeFirst(joinedNouns)} stood out during the project.`,
    `We noticed ${joinedNouns} throughout the work.`,
    `The team showed ${joinedNouns} in the way they worked.`,
    `Their ${joinedNouns} made the project easier to trust.`,
    `The project benefited from ${joinedNouns}.`,
    `It was clear that the team ${joinedClauses}.`,
    `What stood out most was ${joinedNouns}.`,
    `${capitalizeFirst(joinedNouns)} made the collaboration stronger.`,
    `The team brought ${joinedNouns} into the work.`,
    `We could see ${joinedNouns} in the final experience.`,
    `The work showed ${joinedNouns} in a practical way.`,
    `That mix of ${joinedNouns} made the work stronger.`,
    `The experience was stronger because of ${joinedNouns}.`,
    `Their work gave us ${joinedNouns} in a practical way.`,
    `The team made ${joinedNouns} feel consistent throughout.`,
  ];
}

function joinShortClauses(clauses) {
  if (clauses.length <= 1) {
    return clauses[0] || "delivered a solid experience";
  }
  return `${clauses[0]} and ${clauses[1]}`;
}

function joinReviewClauses(clauses) {
  if (clauses.length <= 1) {
    return clauses[0] || "delivered a solid experience";
  }
  if (clauses.length === 2) {
    return `${clauses[0]}, and ${clauses[1]}`;
  }
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
}

function joinNaturalPhrases(phrases) {
  if (phrases.length <= 1) {
    return phrases[0] || "a solid experience";
  }
  if (phrases.length === 2) {
    return `${phrases[0]} and ${phrases[1]}`;
  }
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

function getTopicSet(topics) {
  return topics.slice(0, 4).map(normalizeTopicForImpact).filter(Boolean);
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
  const handledPhrase = getNaturalTopicPhrase(first);
  const pairedPhrase = topicSet.length > 1
    ? `${getNaturalTopicPhrase(first)} and ${getNaturalTopicPhrase(second)}`
    : handledPhrase;
  const practicalPhrase = getNaturalTopicPhrase(third);
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
      inline: topicSet.length > 1 ? pairedPhrase : handledPhrase,
      highlight: `${capitalizeFirst(topicSet.length > 1 ? pairedPhrase : handledPhrase)}.`,
    },
    {
      inline: `the team brought ${joined} into the whole project`,
      highlight: `The team brought ${joined} into the whole project.`,
    },
    {
      inline: practicalPhrase,
      highlight: `${capitalizeFirst(practicalPhrase)}.`,
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
      `We appreciated ${business}'s practical approach.`,
      `${business} kept the work clear and focused.`,
      `We valued ${business}'s focused way of working.`,
      `The team at ${business} was thoughtful and reliable.`,
      `${business} understood what our business needed.`,
      `${business} made the collaboration productive.`,
    ],
  };
  return openings[tone] || openings.Professional;
}

function getNaturalTopicPhrase(topic) {
  const phrases = {
    "quick support": "the team responded quickly when it mattered",
    "clear communication": "communication stayed clear throughout",
    "patient guidance": "the team explained things patiently",
    "timely delivery": "timelines were managed well",
    "process clarity": "the process was easy to follow",
    "attention to detail": "the small details were clearly thought through",
    "thoughtful extra effort": "the team put in thoughtful extra effort",
    "strong business value": "the work felt valuable for our business",
    "calm project handling": "the project stayed easy to manage",
  };
  return phrases[topic] || `${topic} stood out in the work`;
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
  const short = [
    `Good experience at ${business}, would visit again.`,
    `Pretty happy with the visit, no complaints.`,
    `Nice place, staff was helpful.`,
    `Smooth visit overall, would recommend.`,
  ];
  const medium = [
    `Had a good experience at ${business}. Staff was friendly and the place was clean.`,
    `Visited ${business} recently and left satisfied. Would come back without hesitation.`,
    `Overall a solid visit to ${business}. Everything went smoothly.`,
    `Pretty happy with how things went at ${business}. No issues at all.`,
  ];
  const long = [
    `Had a good experience at ${business}. The staff was friendly, the place was well maintained, and everything went smoothly. Would definitely come back and recommend it to others.`,
    `Visited ${business} and was quite happy with the overall experience. The team was helpful and made the visit easy. Will be back.`,
  ];
  if (mode === "short") return short;
  if (mode === "long") return long;
  return medium;
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
  if (mode === "short") {
    return "";
  }
  const trimmed = clean.slice(0, limit - 1).replace(/\s+\S*$/, "").replace(/[,.!?;:]+$/, "");
  return `${trimmed}.`;
}

function buildDistinctFallbackVariant(review, mode) {
  const clean = sanitizeReview(review);
  if (!hasExactReviewMatch(clean) && !hasOpeningSentenceMatch(clean) && !hasRepeatedSentenceMatch(clean)) {
    return clean;
  }

  return getOpeningSafeFallback(mode);
}

function getOpeningSafeFallback(mode) {
  const fallbacks = mode === "short"
    ? [
      "Good experience overall, would visit again.",
      "Nice place, staff was helpful.",
      "Smooth visit, no complaints.",
    ]
    : [
      "Had a good experience here, staff was friendly and helpful.",
      "Visited recently and left satisfied, would come back.",
      "Overall a solid visit, everything went smoothly.",
      "Pretty happy with the experience, no issues at all.",
      "Good place to visit, would recommend to others.",
    ];
  return fallbacks.find((fallback) => !hasOpeningSentenceMatch(fallback) && !hasRepeatedSentenceMatch(fallback)) || fallbacks[0];
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

function isReviewQualityAcceptable(candidate) {
  return !hasExactReviewMatch(candidate)
    && !hasOpeningSentenceMatch(candidate)
    && !hasRepeatedSentenceMatch(candidate)
    && !hasAwkwardReviewWording(candidate)
    && !isRedundantReview(candidate);
}

function hasExactReviewMatch(candidate) {
  const normalizedCandidate = normalizeExactReview(candidate);
  if (!normalizedCandidate) {
    return false;
  }
  return getReviewHistory().some((previousReview) => normalizeExactReview(previousReview) === normalizedCandidate);
}

function normalizeExactReview(review) {
  return sanitizeReview(review).toLowerCase();
}

function hasOpeningSentenceMatch(candidate) {
  const opening = normalizeOpeningSentence(candidate);
  if (!opening) {
    return false;
  }
  return getReviewHistory().some((previousReview) => normalizeOpeningSentence(previousReview) === opening);
}

function normalizeOpeningSentence(review) {
  const firstSentence = sanitizeReview(review).split(/[.!?]/)[0] || "";
  return firstSentence.toLowerCase().trim();
}

function hasRepeatedSentenceMatch(candidate) {
  const candidateSentences = getNormalizedReviewSentences(candidate);
  if (!candidateSentences.length) {
    return false;
  }
  const previousSentences = new Set(getReviewHistory().flatMap(getNormalizedReviewSentences));
  return candidateSentences.some((sentence) => previousSentences.has(sentence));
}

function getNormalizedReviewSentences(review) {
  return sanitizeReview(review)
    .split(/[.!?]/)
    .map((sentence) => sentence.toLowerCase().trim())
    .filter(Boolean);
}

function hasAwkwardReviewWording(candidate) {
  const normalized = String(candidate || "").toLowerCase().replace(/\s+/g, " ").trim();
  const blockedPatterns = [
    /\bprocess clarity and process clarity\b/,
    /\b(\w+(?:\s+\w+)?) and \1 were handled\b/,
    /\bshowed clearly in the final result\b/,
    /\bprocess clarity showed clearly\b/,
    /\battention to detail was handled\b/,
    /\bwas handled really well\b/,
    /\bwork reflected attention to detail\b/,
    /\bvalued how .* handled the project\b/,
    /\bmade the process feel calm\b/,
    /\bthankful for how .* guided us\b/,
  ];
  return blockedPatterns.some((pattern) => pattern.test(normalized));
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
  return `reviewFunnelRecentSuggestions:${appContext.namespace || "root"}:${config.businessId}:${config.branchId}:${config.qrCodeId}`;
}

function getSoftUniquenessSuffix() {
  const suffixes = [
    "Will definitely be back.",
    "Would recommend to anyone.",
    "Happy with the overall visit.",
  ];
  return suffixes[state.generationCount % suffixes.length];
}

function getSelectedTopics() {
  return Array.from(document.querySelectorAll('#positiveTopics input[type="checkbox"]:checked')).map(
    (input) => input.value,
  );
}

function hasSelectedTopics() {
  return getSelectedTopics().length > 0;
}

function isOthersSelected() {
  return getSelectedTopics().includes("Others");
}

function getOthersNote() {
  const el = document.querySelector("#othersNote");
  return el ? el.value.trim().slice(0, 160) : "";
}

// Show/hide the free-text "Others" field. Clears it when hidden.
function updateOthersField(show) {
  const field = document.querySelector("#othersField");
  const input = document.querySelector("#othersNote");
  if (!field) return;
  field.hidden = !show;
  if (show) {
    if (input) input.focus();
  } else if (input) {
    input.value = "";
  }
}

// At least one topic chip is mandatory before a review can be generated, copied, or posted.
const SELECT_TOPIC_HINT = "Select at least one thing you liked above to generate your review.";

function setReviewControlsEnabled(enabled) {
  const copyButton = document.querySelector("#copyReviewButton");
  const regenerateButton = document.querySelector("#regenerateButton");
  if (copyButton) copyButton.disabled = !enabled;
  if (regenerateButton) regenerateButton.disabled = !enabled;
  if (googleReviewButton) googleReviewButton.disabled = !enabled;
}

// Reflects the "pick a chip first" state: clears any review text, shows the hint, disables actions.
function applyTopicGate() {
  if (hasSelectedTopics()) {
    setReviewControlsEnabled(true);
    return true;
  }
  window.clearTimeout(state.generationTimer);
  state.generationRequestId += 1; // cancel any in-flight generation
  reviewText.value = "";
  reviewText.placeholder = SELECT_TOPIC_HINT;
  setReviewControlsEnabled(false);
  return false;
}

async function copyReview() {
  const text = reviewText.value.trim();
  if (!text) {
    if (!hasSelectedTopics()) showToast(SELECT_TOPIC_HINT);
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
  const place = String(config.googlePlaceId || "").trim();
  if (!place || place === "PASTE_GOOGLE_PLACE_ID") return "";
  if (/^https?:\/\//i.test(place)) return place;
  if (/^ChI[A-Za-z0-9_-]+$/.test(place)) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(place)}`;
  }
  return `https://g.page/r/${encodeURIComponent(place)}/review`;
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
    const response = await fetch(apiUrl("/api/events"), {
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

function resolveAppContext() {
  return { namespace: "" };
}

function apiUrl(pathname) {
  return `${appContext.namespace}${pathname}`;
}

function updateBrandLogo() {
  if (!brandLogoImage || !config.logoUrl) return;
  brandLogoImage.src = config.logoUrl;
  brandLogoImage.alt = `${config.businessName} logo`;
}

function getSelectedPurchaseTopic() {
  if (!positiveTopics) return null;
  const selected = positiveTopics.querySelector("input:checked");
  if (!selected) return null;
  return selected.value;
}

function openVehicleModal(topic) {
  if (!vehicleModal || !topic) return;
  const options = vehicleQuickOptionsByTopic[topic] || [];
  if (vehicleModalKicker) vehicleModalKicker.textContent = topic === "New Scooter Purchase" ? "Scooter purchased" : "Bike purchased";
  if (vehicleModalTitle) vehicleModalTitle.textContent = topic === "New Scooter Purchase" ? "Which scooter was it?" : "Which bike was it?";
  if (vehicleQuickOptions) {
    vehicleQuickOptions.innerHTML = options
      .map((opt) => `<button class="vehicle-option-button" type="button" data-vehicle="${opt}">${opt}</button>`)
      .join("");
    vehicleQuickOptions.querySelectorAll("[data-vehicle]").forEach((button) => {
      button.addEventListener("click", () => {
        vehicleQuickOptions.querySelectorAll("[data-vehicle]").forEach((b) => b.classList.remove("is-selected"));
        button.classList.add("is-selected");
        if (vehicleModelInput) vehicleModelInput.value = button.dataset.vehicle;
        // Auto-save and close when a quick option is tapped
        window.setTimeout(() => saveVehicleDetail(), 120);
      });
    });
  }
  if (vehicleModelInput) vehicleModelInput.value = "";
  vehicleModal.classList.add("is-active");
  vehicleModal.setAttribute("aria-hidden", "false");
}

function closeVehicleModal() {
  if (!vehicleModal) return;
  vehicleModal.classList.remove("is-active");
  vehicleModal.setAttribute("aria-hidden", "true");
}

function skipVehicleDetail() {
  closeVehicleModal();
}

function saveVehicleDetail() {
  const vehicleModel = vehicleModelInput?.value.trim() || "";
  state.vehicleModel = vehicleModel;
  closeVehicleModal();
  updateVehicleContext();
  scheduleGenerateReview();
}

function updateVehicleContext() {
  const contextEl = document.querySelector("#vehicleContext");
  const textEl = document.querySelector("#vehicleContextText");
  const editBtn = document.querySelector("#editVehicleButton");
  if (!contextEl || !textEl) return;

  if (state.vehicleModel) {
    textEl.textContent = `🏍 ${state.vehicleModel}`;
    contextEl.hidden = false;
    if (editBtn) {
      editBtn.onclick = () => {
        const topic = getSelectedPurchaseTopic();
        if (topic) openVehicleModal(topic);
      };
    }
  } else {
    contextEl.hidden = true;
  }
}
