// EESWEB admin panel JS
// Full-access version of dashboard.js with IS_STATIC_DASHBOARD = false.
// All write operations (save settings, resolve feedback, create/delete QR) are enabled.

const IS_STATIC_DASHBOARD = false;

const dbState = {
  selectedClient: "shelar-tvs",
  settings: {},
  derived: {},
  ratings: [],
  feedback: [],
  reviewEvents: [],
  postedReviews: [],
  scans: [],
  qrCodes: [],
};

const elements = {
  menuButtons: document.querySelectorAll(".menu-item"),
  views: document.querySelectorAll(".dashboard-view"),
  pageTitle: document.querySelector("#pageTitle"),
  sidebar: document.querySelector("#sidebar"),
  mobileMenuButton: document.querySelector("#mobileMenuButton"),
  connectionBadge: document.querySelector("#connectionBadge"),
  feedbackCountBadge: document.querySelector("#feedbackCountBadge"),
  refreshDataButton: document.querySelector("#refreshDataButton"),
  logoutButton: document.querySelector("#logoutButton"),
  clientFilter: document.querySelector("#clientFilter"),
  branchFilter: document.querySelector("#branchFilter"),
  totalScans: document.querySelector("#totalScans"),
  avgRating: document.querySelector("#avgRating"),
  totalRatingsCount: document.querySelector("#totalRatingsCount"),
  reviewClicks: document.querySelector("#reviewClicks"),
  conversionPercentage: document.querySelector("#conversionPercentage"),
  negativeFeedback: document.querySelector("#negativeFeedback"),
  negativePercentage: document.querySelector("#negativePercentage"),
  ratingsActivityList: document.querySelector("#ratingsActivityList"),
  branchLinksGrid: document.querySelector("#branchLinksGrid"),
  feedbackSearch: document.querySelector("#feedbackSearch"),
  feedbackCardsList: document.querySelector("#feedbackCardsList"),
  qrCodesRegistryTable: document.querySelector("#qrCodesRegistryTable"),
  createQrForm: document.querySelector("#createQrForm"),
  qrCreationStatus: document.querySelector("#qrCreationStatus"),
  reviewEventsList: document.querySelector("#reviewEventsList"),
  settingsForm: document.querySelector("#settingsForm"),
  dashboardStatus: document.querySelector("#dashboardStatus"),
  sidebarBusinessName: document.querySelector("#sidebarBusinessName"),
  // Prompt Tester
  testerPromptInput: document.querySelector("#testerPromptInput"),
  testerResetPromptButton: document.querySelector("#testerResetPromptButton"),
  testerSavePromptButton: document.querySelector("#testerSavePromptButton"),
  testerChips: document.querySelector("#testerChips"),
  testerStaffInput: document.querySelector("#testerStaffInput"),
  testerModelInput: document.querySelector("#testerModelInput"),
  testerNoteInput: document.querySelector("#testerNoteInput"),
  testerLengthSelect: document.querySelector("#testerLengthSelect"),
  testerGenerateButton: document.querySelector("#testerGenerateButton"),
  testerResultBox: document.querySelector("#testerResultBox"),
  testerStatus: document.querySelector("#testerStatus"),
};

const fields = {
  GOOGLE_PLACE_ID: document.querySelector("#placeIdInput"),
  REVIEW_SYSTEM_PROMPT: document.querySelector("#systemPromptInput"),
  REVIEW_TOPICS: document.querySelector("#reviewTopicsInput"),
  FEEDBACK_TOPICS: document.querySelector("#feedbackTopicsInput"),
};

// Holds the uploaded QR image (base64 data URL) for the create form.
let pendingQrImage = "";

document.addEventListener("DOMContentLoaded", () => {
  setupNavigation();
  setupEvents();
  loadDashboardData();
});

function setupNavigation() {
  elements.menuButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;
      elements.menuButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      elements.views.forEach((view) => view.classList.toggle("is-active", view.id === `view-${page}`));
      elements.pageTitle.textContent = getPageTitle(page);
      elements.sidebar.classList.remove("is-open");
    });
  });

  elements.mobileMenuButton.addEventListener("click", () => {
    elements.sidebar.classList.toggle("is-open");
  });
}

function setupEvents() {
  elements.refreshDataButton.addEventListener("click", loadDashboardData);
  if (elements.logoutButton) elements.logoutButton.addEventListener("click", logout);
  if (elements.branchFilter) elements.branchFilter.addEventListener("change", syncDataToViews);
  if (elements.clientFilter) {
    elements.clientFilter.addEventListener("change", (e) => {
      dbState.selectedClient = e.target.value;
      loadDashboardData();
    });
  }
  elements.feedbackSearch.addEventListener("input", renderFeedbackInbox);
  elements.createQrForm.addEventListener("submit", createQrCode);
  elements.settingsForm.addEventListener("submit", saveSettings);

  // QR create form: live auto-generate of ID + review link as the branch name is typed.
  const branchInput = document.querySelector("#regBranchName");
  if (branchInput) branchInput.addEventListener("input", updateQrAutogenPreview);

  // QR image upload (create form)
  const fileInput = document.querySelector("#regQrImageFile");
  if (fileInput) fileInput.addEventListener("change", handleQrImagePick);
  const clearBtn = document.querySelector("#qrUploadClear");
  if (clearBtn) clearBtn.addEventListener("click", clearPendingQrImage);

  // QR image modal close (overlay, X, or Escape)
  document.querySelectorAll("[data-qr-close]").forEach((el) => el.addEventListener("click", closeQrModal));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeQrModal(); });

  // Prompt Tester
  if (elements.testerGenerateButton) elements.testerGenerateButton.addEventListener("click", runPromptTest);
  if (elements.testerSavePromptButton) elements.testerSavePromptButton.addEventListener("click", saveTesterPrompt);
  if (elements.testerResetPromptButton) elements.testerResetPromptButton.addEventListener("click", resetTesterPrompt);
}

function getPageTitle(page) {
  return {
    overview: "Overview",
    feedback: "Feedback Inbox",
    qrcodes: "QR Links",
    reviews: "Review Events",
    settings: "Settings",
    tester: "Prompt Tester",
  }[page] || "Dashboard";
}

async function loadDashboardData() {
  setConnectionStatus("connecting", "Connecting");
  try {
    const [settingsResponse, dataResponse] = await Promise.all([
      fetch(`/api/dashboard/settings?client=${dbState.selectedClient}`),
      fetch(`/api/dashboard/data?client=${dbState.selectedClient}`),
    ]);
    const settingsData = await settingsResponse.json();
    const dashboardData = await dataResponse.json();

    if (!settingsResponse.ok) throw new Error(settingsData.error || "Settings API failed.");
    if (!dataResponse.ok) throw new Error(dashboardData.error || "Dashboard data API failed.");

    Object.assign(dbState, {
      settings: settingsData.settings || {},
      derived: settingsData.derived || {},
      ratings: dashboardData.ratings || [],
      feedback: dashboardData.feedback || [],
      reviewEvents: dashboardData.reviewEvents || [],
      postedReviews: dashboardData.postedReviews || [],
      scans: dashboardData.scans || [],
      qrCodes: dashboardData.qrCodes || [],
    });

    const firebaseStatus = dbState.derived.firebaseStatus || "not_configured";
    if (firebaseStatus === "connected") {
      setConnectionStatus("live", "Firestore live");
    } else if (firebaseStatus === "fallback") {
      setConnectionStatus("demo", "Local fallback");
      setFormStatus(dbState.derived.firebaseError || "Firestore unavailable, using local fallback.", true);
    } else {
      setConnectionStatus("demo", "Local only");
    }
    syncDataToViews();
  } catch (error) {
    setConnectionStatus("demo", "Needs Node server");
    setFormStatus(error.message, true);
  }
}

function syncDataToViews() {
  renderClientFilter();
  renderBranchFilter();
  renderOverview();
  renderRatingsTable();
  renderFeedbackInbox();
  renderQrRegistry();
  renderReviewEvents();
  syncSettingsFormValues();
  renderBranchGoogleLinks();
  syncTester();
  // Admin panel: never apply client mode restrictions — always fully editable
}

// Per-branch Google review link editor (admin privilege).
function renderBranchGoogleLinks() {
  const container = document.querySelector("#branchGoogleLinks");
  if (!container) return;
  const activeQrCodes = dbState.qrCodes.filter((qr) => qr.status !== "deleted");
  if (!activeQrCodes.length) {
    container.innerHTML = `<span class="subtitle">No branches yet. Add one in QR Links.</span>`;
    return;
  }
  container.innerHTML = activeQrCodes
    .map((qr) => `
      <div class="branch-google-row">
        <span class="bg-branch">${escapeHtml(qr.branchName || qr.qrCodeId)}</span>
        <div class="branch-google-input-row">
          <input type="text" value="${escapeHtml(qr.googlePlaceId || "")}" placeholder="g.page review URL or Place ID" data-gqr="${escapeHtml(qr.qrCodeId)}" />
          <button class="bg-save-btn" type="button" data-gsave="${escapeHtml(qr.qrCodeId)}">Save</button>
        </div>
      </div>
    `)
    .join("");

  container.querySelectorAll("[data-gsave]").forEach((button) => {
    button.addEventListener("click", async () => {
      const qrCodeId = button.dataset.gsave;
      const input = container.querySelector(`[data-gqr="${CSS.escape(qrCodeId)}"]`);
      const value = input ? input.value.trim() : "";
      button.textContent = "Saving…";
      button.disabled = true;
      try {
        const response = await fetch(`/api/dashboard/qrcodes/google?client=${dbState.selectedClient}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qrCodeId, googlePlaceId: value }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save link.");
        const qr = dbState.qrCodes.find((q) => q.qrCodeId === qrCodeId);
        if (qr) qr.googlePlaceId = value;
        button.textContent = "Saved";
        button.classList.add("is-saved");
        setTimeout(() => { button.textContent = "Save"; button.classList.remove("is-saved"); button.disabled = false; }, 1500);
      } catch (error) {
        button.textContent = "Save";
        button.disabled = false;
        setFormStatus(error.message, true);
      }
    });
  });
}

function renderOverview() {
  const ratings = filterByBranch(dbState.ratings).filter((item) => Number(item.rating) >= 1 && Number(item.rating) <= 5);
  const positives = ratings.filter((item) => Number(item.rating) >= 4);
  const negatives = ratings.filter((item) => Number(item.rating) <= 3);
  const googleClicks = filterByBranch(dbState.reviewEvents).filter((item) => item.type === "google_review_clicked" || item.reviewText);
  const feedback = filterByBranch(dbState.feedback);
  const pendingFeedback = feedback.filter((item) => item.status !== "resolved");
  const scans = filterByBranch(dbState.scans);
  const average = ratings.length
    ? ratings.reduce((sum, item) => sum + Number(item.rating || 0), 0) / ratings.length
    : 0;
  const conversion = positives.length ? Math.round((googleClicks.length / positives.length) * 100) : 0;

  elements.totalScans.textContent = scans.length.toLocaleString();
  elements.avgRating.textContent = average ? average.toFixed(1) : "0.0";
  elements.totalRatingsCount.textContent = `${ratings.length} ratings logged`;
  elements.reviewClicks.textContent = googleClicks.length.toLocaleString();
  elements.conversionPercentage.textContent = `${conversion}% of positive ratings`;
  elements.negativeFeedback.textContent = feedback.length.toLocaleString();
  elements.negativePercentage.textContent = `${negatives.length} low ratings routed privately`;
  elements.feedbackCountBadge.textContent = pendingFeedback.length;
  elements.feedbackCountBadge.hidden = pendingFeedback.length === 0;

  // Keep "Admin Panel" label stable in the sidebar
  if (elements.sidebarBusinessName) {
    elements.sidebarBusinessName.textContent = "Admin Panel";
  }

  // Show the active business name in the breadcrumb instead
  const breadcrumb = document.querySelector(".breadcrumb");
  const biz = dbState.settings.APP_BUSINESS_NAME;
  if (breadcrumb && biz) {
    breadcrumb.textContent = `EESWEB \u203A ${biz}`;
  }

  // Update the review-page link in the sidebar for the active client.
  const openReviewPageLink = document.getElementById("openReviewPageLink");
  if (openReviewPageLink) openReviewPageLink.href = `/?business=${encodeURIComponent(dbState.selectedClient)}`;

  renderBranchLinks();
  updateQrAutogenPreview();
  renderRatingDistribution(ratings);
}

function renderBranchLinks() {
  if (!elements.branchLinksGrid) return;
  const activeQrCodes = dbState.qrCodes.filter((qr) => qr.status !== "deleted");
  if (!activeQrCodes.length) {
    elements.branchLinksGrid.innerHTML = `<div class="activity-empty">No branches yet. Add one in QR Links.</div>`;
    return;
  }
  elements.branchLinksGrid.innerHTML = activeQrCodes
    .map((qr, index) => {
      const url = qr.dynamicUrl || getQrUrl(qr.qrCodeId);
      return `
        <a class="branch-link-card branch-accent-${index % 5}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
          <span class="branch-link-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/></svg>
          </span>
          <span class="branch-link-copy">
            <span class="branch-link-label">${escapeHtml(qr.businessName || dbState.settings.APP_BUSINESS_NAME || "Review")}</span>
            <strong>${escapeHtml(qr.branchName || qr.label || qr.qrCodeId)}</strong>
            <span class="branch-link-url">${escapeHtml(shortenUrl(url))}</span>
          </span>
          <span class="branch-link-action">
            Open
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
          </span>
        </a>
      `;
    })
    .join("");
}

function renderRatingDistribution(ratings) {
  const max = ratings.length || 1;
  for (let star = 1; star <= 5; star++) {
    const count = ratings.filter((r) => Number(r.rating) === star).length;
    const pct = Math.round((count / max) * 100);
    const fill = document.getElementById(`dist${star}`);
    const counter = document.getElementById(`distCount${star}`);
    if (fill) fill.style.width = `${pct}%`;
    if (counter) counter.textContent = count;
  }
}

function renderRatingsTable() {
  if (!elements.ratingsActivityList) return;
  const latest = [...dbState.ratings]
    .filter((item) => filterMatchesBranch(item))
    .filter((item) => Number(item.rating) >= 1 && Number(item.rating) <= 5)
    .sort(sortNewestFirst)
    .slice(0, 12);
  if (!latest.length) {
    elements.ratingsActivityList.innerHTML = `<div class="activity-empty">No ratings yet.</div>`;
    return;
  }

  const star = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.9 6.26 6.9.54-5.25 4.52 1.62 6.74L12 16.9l-6.16 3.72 1.62-6.74L2.2 9.36l6.9-.54z"/></svg>';
  elements.ratingsActivityList.innerHTML = latest
    .map((item) => {
      const rating = Number(item.rating) || 0;
      const tone = rating >= 4 ? "good" : rating === 3 ? "warn" : "bad";
      const meta = [item.branchName, item.source || item.campaign].filter(Boolean).join(" · ");
      return `
        <div class="activity-row">
          <span class="activity-badge activity-${tone}">${star}<span>${rating}</span></span>
          <div class="activity-body">
            <strong>${escapeHtml(item.qrLabel || item.qrCodeId || "Review")}</strong>
            <span class="activity-meta">${escapeHtml(meta || "General")}</span>
          </div>
          <span class="activity-time">${formatDate(item.createdAt)}</span>
        </div>
      `;
    })
    .join("");
}

function renderFeedbackInbox() {
  const query = elements.feedbackSearch.value.trim().toLowerCase();
  const feedback = filterByBranch(dbState.feedback).sort(sortNewestFirst).filter((item) => {
    const searchable = [
      item.name,
      item.phone,
      item.message,
      item.qrCodeId,
      item.qrLabel,
      item.branchName,
      item.source,
      item.campaign,
      ...(item.issues || []),
    ].join(" ").toLowerCase();
    return !query || searchable.includes(query);
  });

  if (!feedback.length) {
    elements.feedbackCardsList.innerHTML = `
      <div class="empty-state">
        <h3>No private feedback found</h3>
        <p>Customers who rate 1-3 stars will appear here instead of being pushed to Google.</p>
      </div>
    `;
    return;
  }

  elements.feedbackCardsList.innerHTML = feedback
    .map((item) => `
      <article class="feedback-card">
        <div class="feedback-card-header">
          <div class="customer-info">
            <h4>${escapeHtml(item.name || "Anonymous customer")}</h4>
            <div class="contact">${escapeHtml(item.phone || "No phone")} - ${formatDate(item.createdAt)}</div>
            <div class="contact">${escapeHtml([item.qrLabel || item.qrCodeId, item.branchName, item.source || item.campaign].filter(Boolean).join(" / ") || "No QR context")}</div>
          </div>
          <div class="card-meta-tags">
            <span class="badge ${Number(item.rating) === 3 ? "badge-warning" : "badge-danger"}">${escapeHtml(item.rating || "-")} star</span>
            <span class="badge ${item.status === "resolved" ? "badge-success" : "badge-danger"}">${item.status === "resolved" ? "Resolved" : "Pending"}</span>
          </div>
        </div>
        <div class="feedback-body">
          <p>${escapeHtml(item.message || "No message provided.")}</p>
          <div class="issues-tags">
            ${(item.issues || []).map((issue) => `<span class="issue-tag">${escapeHtml(issue)}</span>`).join("")}
          </div>
        </div>
        <div class="feedback-actions">
          ${item.status === "resolved"
            ? `<span class="trend-up">Resolved: ${escapeHtml(item.resolutionNotes || "No note")}</span>`
            : `<button class="primary-button" data-resolve="${escapeHtml(item.id || "")}" type="button">Resolve</button>`}
        </div>
      </article>
    `)
    .join("");

  elements.feedbackCardsList.querySelectorAll("[data-resolve]").forEach((button) => {
    button.addEventListener("click", () => resolveFeedback(button.dataset.resolve));
  });
}

function renderQrRegistry() {
  const activeQrCodes = dbState.qrCodes.filter((qr) => qr.status !== "deleted");
  if (!activeQrCodes.length) {
    elements.qrCodesRegistryTable.innerHTML = `<tr><td colspan="8" class="table-empty">No QR links yet.</td></tr>`;
    return;
  }

  elements.qrCodesRegistryTable.innerHTML = activeQrCodes
    .map((qr) => {
      const url = getQrUrl(qr.qrCodeId);
      const destinationUrl = qr.redirectUrl || qr.targetPath || "";
      const qrImageUrl = qr.qrImageUrl || "";
      return `
        <tr>
          <td>${renderQrImageCell(qrImageUrl, qr.label || qr.qrCodeId)}</td>
          <td><code>/r/${escapeHtml(qr.qrCodeId)}</code></td>
          <td>${escapeHtml(qr.label || qr.qrCodeId)}</td>
          <td>${escapeHtml(qr.branchName || "Main")}</td>
          <td>${destinationUrl ? `<a href="${escapeHtml(destinationUrl)}" target="_blank" rel="noreferrer">${escapeHtml(shortenUrl(destinationUrl))}</a>` : "-"}</td>
          <td>${escapeHtml(qr.source || qr.campaign || qr.staff || "General")}</td>
          <td><span class="badge badge-info">${Number(qr.scanCount || 0)} scans</span></td>
          <td>
            <div class="qr-row-actions">
              <button class="qr-action-btn" data-copy="${escapeHtml(url)}" type="button">Copy URL</button>
              <button class="qr-action-btn" data-img="${escapeHtml(qr.qrCodeId)}" type="button">${qrImageUrl ? "Replace image" : "Upload image"}</button>
              ${qrImageUrl ? `<button class="qr-action-btn is-warn" data-img-del="${escapeHtml(qr.qrCodeId)}" type="button">Remove image</button>` : ""}
              <button class="qr-action-btn is-danger" data-delete="${escapeHtml(qr.qrCodeId)}" type="button">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.qrCodesRegistryTable.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy));
  });
  elements.qrCodesRegistryTable.querySelectorAll("[data-img]").forEach((button) => {
    button.addEventListener("click", () => pickImageForExistingQr(button.dataset.img));
  });
  elements.qrCodesRegistryTable.querySelectorAll("[data-img-del]").forEach((button) => {
    button.addEventListener("click", () => {
      if (window.confirm("Remove the QR image for this branch?")) uploadQrImageFor(button.dataset.imgDel, "");
    });
  });
  elements.qrCodesRegistryTable.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => deleteQrCode(button.dataset.delete));
  });
  elements.qrCodesRegistryTable.querySelectorAll("[data-qr-zoom]").forEach((button) => {
    button.addEventListener("click", () => openQrModal(button.dataset.qrZoom, button.dataset.qrLabel));
  });
}

// Enlarge a QR image in an in-page modal with a download button.
function openQrModal(src, label) {
  if (!src) return;
  const modal = document.querySelector("#qrImageModal");
  const img = document.querySelector("#qrModalImage");
  const dl = document.querySelector("#qrModalDownload");
  const title = document.querySelector("#qrModalTitle");
  if (!modal || !img || !dl) return;
  img.src = src;
  img.alt = label ? `${label} QR code` : "QR code";
  if (title) title.textContent = label || "QR code";
  dl.href = src;
  dl.setAttribute("download", `${slugify(label || "qr-code")}.png`);
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeQrModal() {
  const modal = document.querySelector("#qrImageModal");
  if (modal) modal.hidden = true;
  document.body.style.overflow = "";
}

function renderReviewEvents() {
  const events = filterByBranch(dbState.reviewEvents).sort(sortNewestFirst);
  const posted = filterByBranch(dbState.postedReviews).sort(sortNewestFirst);
  const merged = [
    ...events.map((item) => ({ ...item, label: "Review action clicked" })),
    ...posted.map((item) => ({ ...item, label: "Marked as posted" })),
  ].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  if (!merged.length) {
    elements.reviewEventsList.innerHTML = `
      <div class="empty-state">
        <h3>No review events yet</h3>
        <p>Generated reviews are not stored. Only customer review actions are saved here.</p>
      </div>
    `;
    return;
  }

  elements.reviewEventsList.innerHTML = merged
    .map((item) => `
      <article class="feedback-card">
        <div class="feedback-card-header">
          <div class="customer-info">
            <h4>${escapeHtml(item.label)}</h4>
            <div class="contact">${escapeHtml(item.qrLabel || item.qrCodeId || "-")} - ${formatDate(item.createdAt)}</div>
            <div class="contact">${escapeHtml([item.branchName, item.source || item.campaign].filter(Boolean).join(" / "))}</div>
          </div>
          <span class="badge badge-success">${escapeHtml(item.rating || "-")} star</span>
        </div>
        <div class="feedback-body">
          <p>${escapeHtml(item.reviewText || "No review text stored for this action.")}</p>
        </div>
      </article>
    `)
    .join("");
}

function syncSettingsFormValues() {
  Object.entries(fields).forEach(([key, field]) => {
    if (!field) return;
    field.value = key === "REVIEW_TOPICS" || key === "FEEDBACK_TOPICS"
      ? csvToLines(dbState.settings[key] || "")
      : dbState.settings[key] || "";
  });
}

async function saveSettings(event) {
  event.preventDefault();
  setFormStatus("Saving settings...");

  const settings = Object.fromEntries(
    Object.entries(fields)
      .filter(([, field]) => field && !field?.dataset?.readonlySetting)
      .map(([key, field]) => [
        key,
        key === "REVIEW_TOPICS" || key === "FEEDBACK_TOPICS" ? linesToCsv(field.value) : field.value.trim(),
      ]),
  );

  try {
    const response = await fetch(`/api/dashboard/settings?client=${dbState.selectedClient}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save settings.");

    dbState.settings = data.settings || settings;
    dbState.derived = data.derived || dbState.derived;
    syncDataToViews();
    setFormStatus("Settings saved.");
  } catch (error) {
    setFormStatus(error.message, true);
  }
}

// Live preview of the auto-generated QR ID + review link from the branch name.
function updateQrAutogenPreview() {
  const branchField = document.querySelector("#regBranchName");
  const idPreview = document.querySelector("#regQrIdPreview");
  const linkPreview = document.querySelector("#regLinkPreview");
  if (!branchField || !idPreview || !linkPreview) return;
  const branchName = branchField.value.trim();
  if (!branchName) {
    idPreview.textContent = "—";
    linkPreview.textContent = "—";
    return;
  }
  const branchId = slugify(branchName);
  const qrCodeId = `${dbState.selectedClient}-${branchId}`;
  idPreview.textContent = qrCodeId;
  linkPreview.textContent = `/?business=${dbState.selectedClient}&branch=${branchId}&qr=${qrCodeId}`;
}

// Read a picked image file into a base64 data URL preview.
function handleQrImagePick(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 3 * 1024 * 1024) {
    setQrStatus("Image is too large. Please use one under 3 MB.", true);
    event.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    pendingQrImage = String(reader.result || "");
    const preview = document.querySelector("#qrUploadPreview");
    const empty = document.querySelector("#qrUploadEmpty");
    const clearBtn = document.querySelector("#qrUploadClear");
    if (preview) { preview.src = pendingQrImage; preview.hidden = false; }
    if (empty) empty.hidden = true;
    if (clearBtn) clearBtn.hidden = false;
  };
  reader.readAsDataURL(file);
}

function clearPendingQrImage() {
  pendingQrImage = "";
  const fileInput = document.querySelector("#regQrImageFile");
  const preview = document.querySelector("#qrUploadPreview");
  const empty = document.querySelector("#qrUploadEmpty");
  const clearBtn = document.querySelector("#qrUploadClear");
  if (fileInput) fileInput.value = "";
  if (preview) { preview.src = ""; preview.hidden = true; }
  if (empty) empty.hidden = false;
  if (clearBtn) clearBtn.hidden = true;
}

function setQrStatus(message, isError = false) {
  if (!elements.qrCreationStatus) return;
  elements.qrCreationStatus.textContent = message;
  elements.qrCreationStatus.classList.toggle("is-error", isError);
}

async function createQrCode(event) {
  event.preventDefault();
  const branchName = document.querySelector("#regBranchName").value.trim();
  if (!branchName) {
    setQrStatus("Enter a branch name.", true);
    return;
  }
  setQrStatus("Creating branch…");

  const payload = {
    branchName,
    branchId: slugify(branchName),
    source: document.querySelector("#regStaff").value.trim(),
    qrImageUrl: pendingQrImage || "",
  };

  try {
    const response = await fetch(`/api/dashboard/qrcodes?client=${dbState.selectedClient}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create branch.");

    event.currentTarget.reset();
    clearPendingQrImage();
    updateQrAutogenPreview();
    setQrStatus("Branch created.");
    await loadDashboardData();
  } catch (error) {
    setQrStatus(error.message, true);
  }
}

// Upload / replace / remove the QR image for an existing tracker.
async function uploadQrImageFor(qrCodeId, dataUrl) {
  try {
    const response = await fetch(`/api/dashboard/qrcodes/image?client=${dbState.selectedClient}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrCodeId, qrImageUrl: dataUrl }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update image.");
    await loadDashboardData();
  } catch (error) {
    setFormStatus(error.message, true);
  }
}

function pickImageForExistingQr(qrCodeId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/svg+xml";
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setFormStatus("Image is too large. Please use one under 3 MB.", true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => uploadQrImageFor(qrCodeId, String(reader.result || ""));
    reader.readAsDataURL(file);
  };
  input.click();
}

async function resolveFeedback(id) {
  if (!id) return;
  const notes = window.prompt("Resolution note");
  if (notes === null) return;

  try {
    const response = await fetch(`/api/dashboard/feedback/resolve?client=${dbState.selectedClient}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, notes }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not resolve feedback.");
    await loadDashboardData();
  } catch (error) {
    setFormStatus(error.message, true);
  }
}

async function deleteQrCode(qrCodeId) {
  if (!qrCodeId || !window.confirm(`Delete /r/${qrCodeId}?`)) return;
  try {
    const response = await fetch(`/api/dashboard/qrcodes/${encodeURIComponent(qrCodeId)}?client=${dbState.selectedClient}`, {
      method: "DELETE",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not delete QR tracker.");
    await loadDashboardData();
  } catch (error) {
    setFormStatus(error.message, true);
  }
}

// ---- Prompt Tester ----

// Tracks whether the user has manually edited the prompt box so we don't clobber their edits on refresh.
let testerPromptDirty = false;

function syncTester() {
  if (!elements.testerPromptInput) return;

  // Fill the prompt box with the saved prompt unless the user is mid-edit.
  if (!testerPromptDirty) {
    elements.testerPromptInput.value = dbState.settings.REVIEW_SYSTEM_PROMPT || "";
  }
  elements.testerPromptInput.oninput = () => { testerPromptDirty = true; };

  renderTesterChips();
}

function renderTesterChips() {
  if (!elements.testerChips) return;
  const topics = String(dbState.settings.REVIEW_TOPICS || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  // Preserve current selections across re-render.
  const selected = new Set(
    Array.from(elements.testerChips.querySelectorAll(".tester-chip.is-selected")).map((el) => el.dataset.topic),
  );

  if (!topics.length) {
    elements.testerChips.innerHTML = `<span class="subtitle">No topics configured for this client.</span>`;
    return;
  }

  elements.testerChips.innerHTML = topics
    .map((topic) => {
      const isSel = selected.has(topic) ? " is-selected" : "";
      return `<button type="button" class="tester-chip${isSel}" data-topic="${escapeHtml(topic)}">${escapeHtml(topic)}</button>`;
    })
    .join("");

  elements.testerChips.querySelectorAll(".tester-chip").forEach((chip) => {
    chip.addEventListener("click", () => chip.classList.toggle("is-selected"));
  });
}

function getTesterSelectedTopics() {
  return Array.from(elements.testerChips.querySelectorAll(".tester-chip.is-selected")).map((el) => el.dataset.topic);
}

async function runPromptTest() {
  const prompt = elements.testerPromptInput.value.trim();
  if (!prompt) {
    setTesterStatus("Enter a system prompt to test.", true);
    return;
  }

  const topics = getTesterSelectedTopics();
  const payload = {
    businessId: dbState.selectedClient,
    overridePrompt: prompt,
    mode: elements.testerLengthSelect.value,
    topics: topics.join(","),
    staff: elements.testerStaffInput.value.trim(),
    vehicle: elements.testerModelInput.value.trim(),
    note: elements.testerNoteInput ? elements.testerNoteInput.value.trim() : "",
  };

  elements.testerGenerateButton.disabled = true;
  elements.testerResultBox.className = "tester-result-box is-loading";
  elements.testerResultBox.textContent = "Generating…";
  setTesterStatus("");

  try {
    const response = await fetch("/api/review/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Generation failed.");

    elements.testerResultBox.className = "tester-result-box";
    elements.testerResultBox.textContent = data.review || "(empty response)";
    const len = (data.review || "").length;
    setTesterStatus(`Generated ${len} characters.`);
  } catch (error) {
    elements.testerResultBox.className = "tester-result-box is-error";
    elements.testerResultBox.textContent = error.message;
    setTesterStatus(error.message, true);
  } finally {
    elements.testerGenerateButton.disabled = false;
  }
}

async function saveTesterPrompt() {
  const prompt = elements.testerPromptInput.value.trim();
  if (!prompt) {
    setTesterStatus("Cannot save an empty prompt.", true);
    return;
  }
  if (!window.confirm(`Save this prompt as the live system prompt for ${dbState.selectedClient}? It takes effect on the next real review.`)) {
    return;
  }

  setTesterStatus("Saving prompt…");
  try {
    const response = await fetch(`/api/dashboard/settings?client=${dbState.selectedClient}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ settings: { REVIEW_SYSTEM_PROMPT: prompt } }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save prompt.");

    dbState.settings = data.settings || dbState.settings;
    testerPromptDirty = false;
    // Keep the Settings tab textarea in sync too.
    if (fields.REVIEW_SYSTEM_PROMPT) fields.REVIEW_SYSTEM_PROMPT.value = dbState.settings.REVIEW_SYSTEM_PROMPT || prompt;
    setTesterStatus("Prompt saved live.");
  } catch (error) {
    setTesterStatus(error.message, true);
  }
}

function resetTesterPrompt() {
  testerPromptDirty = false;
  elements.testerPromptInput.value = dbState.settings.REVIEW_SYSTEM_PROMPT || "";
  setTesterStatus("Reset to the saved prompt.");
}

function setTesterStatus(message, isError = false) {
  if (!elements.testerStatus) return;
  elements.testerStatus.textContent = message;
  elements.testerStatus.style.color = isError ? "var(--danger)" : "var(--success)";
}

async function logout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
  } finally {
    window.location.replace("/login");
  }
}

async function copyText(value) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    setFormStatus("Copied.");
  } catch {
    setFormStatus("Could not access clipboard.", true);
  }
}

function setConnectionStatus(type, text) {
  if (!elements.connectionBadge) return;
  elements.connectionBadge.className = `connection-status badge is-${type}`;
  const statusText = elements.connectionBadge.querySelector(".status-text");
  if (statusText) statusText.textContent = text;
}

function setFormStatus(message, isError = false) {
  if (!elements.dashboardStatus) return;
  elements.dashboardStatus.textContent = message;
  elements.dashboardStatus.style.color = isError ? "var(--danger)" : "var(--success)";
  window.clearTimeout(setFormStatus.timer);
  setFormStatus.timer = window.setTimeout(() => {
    elements.dashboardStatus.textContent = "";
  }, 3500);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sortNewestFirst(a, b) {
  return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
}

function getQrUrl(qrCodeId) {
  const baseUrl = (dbState.settings.APP_BASE_URL || window.location.origin).replace(/\/$/, "");
  return `${baseUrl}/r/${encodeURIComponent(qrCodeId)}`;
}

function renderQrImageCell(qrImageUrl, label) {
  if (!qrImageUrl) {
    return `<span class="qr-thumb-placeholder">No image</span>`;
  }
  return `
    <button class="qr-thumb-btn" type="button" title="Click to enlarge" data-qr-zoom="${escapeHtml(qrImageUrl)}" data-qr-label="${escapeHtml(label || "QR code")}">
      <img class="qr-thumb" src="${escapeHtml(qrImageUrl)}" alt="${escapeHtml(label || "QR code")}" loading="lazy" />
    </button>
  `;
}

function shortenUrl(value) {
  const text = String(value || "");
  return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}

function renderClientFilter() {
  if (!elements.clientFilter) return;
  const current = elements.clientFilter.value || dbState.selectedClient;

  const clientsList = [
    { id: "eesweb", name: "EESWEB" },
    { id: "shelar-tvs", name: "Shelar TVS" },
  ];

  elements.clientFilter.innerHTML = clientsList
    .map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
    .join("");

  elements.clientFilter.value = current;
}

function renderBranchFilter() {
  if (!elements.branchFilter) return;
  const current = elements.branchFilter.value;
  const branches = new Map();
  dbState.qrCodes
    .filter((qr) => qr.status !== "deleted")
    .forEach((qr) => {
      const id = qr.branchId || slugify(qr.branchName || "");
      if (id) branches.set(id, qr.branchName || id);
    });
  [...dbState.ratings, ...dbState.feedback, ...dbState.reviewEvents, ...dbState.postedReviews, ...dbState.scans]
    .forEach((item) => {
      const id = item.branchId || slugify(item.branchName || "");
      if (id) branches.set(id, item.branchName || id);
    });

  elements.branchFilter.innerHTML = [
    `<option value="">All branches</option>`,
    ...Array.from(branches.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`),
  ].join("");

  if (current && branches.has(current)) {
    elements.branchFilter.value = current;
  }
}

function filterByBranch(items) {
  return items.filter((item) => filterMatchesBranch(item));
}

function filterMatchesBranch(item) {
  const selected = elements.branchFilter?.value || "";
  if (!selected) return true;
  return (item.branchId || slugify(item.branchName || "")) === selected;
}

function csvToLines(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n");
}

function linesToCsv(value) {
  return String(value || "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .join(",");
}

function slugify(value) {
  return String(value || "main")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
