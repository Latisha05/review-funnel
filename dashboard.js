const dbState = {
  settings: {},
  derived: {},
  ratings: [],
  feedback: [],
  reviewEvents: [],
  postedReviews: [],
  scans: [],
  qrCodes: [],
  businesses: [],
  branches: [],
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
  dashboardBreadcrumb: document.querySelector("#dashboardBreadcrumb"),
  dashboardBusinessTitle: document.querySelector("#dashboardBusinessTitle"),
  overviewHeading: document.querySelector("#overviewHeading"),
  sectionHeading: document.querySelector("#sectionHeading"),
  branchFilter: document.querySelector("#branchFilter"),
  branchFilterSelect: document.querySelector("#branchFilterSelect"),
  logoutConfirmModal: document.querySelector("#logoutConfirmModal"),
  cancelLogoutButton: document.querySelector("#cancelLogoutButton"),
  confirmLogoutButton: document.querySelector("#confirmLogoutButton"),
};

const appContext = resolveAppContext();
let selectedBranchId = "all";
let activeDashboardPage = "overview";

let currentUserSession = {
  email: "",
  role: "client",
  client: "eesweb",
};

// Client dashboard settings are read-only; values are rendered into an info panel, not a form.

document.addEventListener("DOMContentLoaded", async () => {
  const allowed = await ensureAuthenticated();
  if (!allowed) return;
  setupNavigation();
  setupEvents();
  loadDashboardData();
});

function setupNavigation() {
  elements.menuButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;
      activeDashboardPage = page;
      elements.menuButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      elements.views.forEach((view) => view.classList.toggle("is-active", view.id === `view-${page}`));
      elements.pageTitle.textContent = getPageTitle(page);
      syncDashboardHeader(page);
      syncBranchFilter();
      elements.sidebar.classList.remove("is-open");
    });
  });

  elements.mobileMenuButton.addEventListener("click", () => {
    elements.sidebar.classList.toggle("is-open");
  });
}

function setupEvents() {
  elements.refreshDataButton.addEventListener("click", loadDashboardData);
  if (elements.logoutButton) {
    elements.logoutButton.addEventListener("click", openLogoutConfirmation);
  }
  if (elements.cancelLogoutButton) {
    elements.cancelLogoutButton.addEventListener("click", closeLogoutConfirmation);
  }
  if (elements.confirmLogoutButton) {
    elements.confirmLogoutButton.addEventListener("click", logout);
  }
  if (elements.logoutConfirmModal) {
    elements.logoutConfirmModal.addEventListener("click", (event) => {
      if (event.target === elements.logoutConfirmModal) closeLogoutConfirmation();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.logoutConfirmModal?.hidden) {
      closeLogoutConfirmation();
    }
  });
  elements.feedbackSearch.addEventListener("input", renderFeedbackInbox);
  if (elements.branchFilterSelect) {
    elements.branchFilterSelect.addEventListener("change", () => {
      selectedBranchId = elements.branchFilterSelect.value || "all";
      renderOverview();
      renderRatingsTable();
      renderFeedbackInbox();
      renderReviewEvents();
    });
  }
}

function getPageTitle(page) {
  return {
    overview: "Overview",
    feedback: "Feedback Inbox",
    qrcodes: "QR Links",
    reviews: "Review Events",
    settings: "Settings",
  }[page] || "Dashboard";
}

async function loadDashboardData() {
  setConnectionStatus("connecting", "Connecting");
  try {
    const [settingsResponse, dataResponse] = await Promise.all([
      fetch(appUrl("/api/dashboard/settings"), { credentials: "same-origin" }),
      fetch(appUrl("/api/dashboard/data"), { credentials: "same-origin" }),
    ]);
    const settingsData = await settingsResponse.json();
    const dashboardData = await dataResponse.json();

    if (!settingsResponse.ok) throw new Error(settingsData.error || "Settings API failed.");
    if (!dataResponse.ok) throw new Error(dashboardData.error || "Dashboard data API failed.");

    const activeBusinessId = String(
      settingsData.settings?.BUSINESS_ID || currentUserSession.client || "",
    ).trim().toLowerCase();
    const scopeToBusiness = (items) => (items || []).filter((item) => {
      const itemBusinessId = String(item.businessId || item.context?.businessId || "").trim().toLowerCase();
      if (activeBusinessId && itemBusinessId !== activeBusinessId) return false;
      if (activeBusinessId === "shelar-tvs" && hasEeswebIdentity(item)) return false;
      return true;
    });

    Object.assign(dbState, {
      settings: settingsData.settings || {},
      derived: settingsData.derived || {},
      ratings: scopeToBusiness(dashboardData.ratings),
      feedback: scopeToBusiness(dashboardData.feedback),
      reviewEvents: scopeToBusiness(dashboardData.reviewEvents),
      postedReviews: scopeToBusiness(dashboardData.postedReviews),
      scans: scopeToBusiness(dashboardData.scans),
      qrCodes: scopeToBusiness(dashboardData.qrCodes),
      businesses: scopeToBusiness(dashboardData.businesses),
      branches: scopeToBusiness(dashboardData.branches),
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
  syncBranchFilter();
  renderOverview();
  renderRatingsTable();
  renderBranchLinks();
  renderFeedbackInbox();
  renderQrRegistry();
  renderReviewEvents();
  syncSettingsFormValues();
  applyClientMode();
}

function renderOverview() {
  const ratings = filterBySelectedBranch(dbState.ratings)
    .filter((item) => Number(item.rating) >= 1 && Number(item.rating) <= 5);
  const positives = ratings.filter((item) => Number(item.rating) >= 4);
  const negatives = ratings.filter((item) => Number(item.rating) <= 3);
  const googleClicks = filterBySelectedBranch(dbState.reviewEvents)
    .filter((item) => item.type === "google_review_clicked" || item.reviewText);
  const feedback = filterBySelectedBranch(dbState.feedback);
  const scans = filterBySelectedBranch(dbState.scans);
  const pendingFeedback = feedback.filter((item) => item.status !== "resolved");
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
  const businessName = dbState.settings.APP_BUSINESS_NAME || "Dashboard";
  elements.sidebarBusinessName.textContent = businessName;
  if (elements.dashboardBreadcrumb) {
    elements.dashboardBreadcrumb.textContent = `${businessName} Dashboard`;
  }

  // Dynamically update page title and brand logo
  document.title = `${businessName} Dashboard`;
  const sidebarLogo = document.querySelector(".brand-logo img");
  if (sidebarLogo && dbState.derived.logoUrl) {
    sidebarLogo.src = dbState.derived.logoUrl;
    sidebarLogo.alt = `${businessName} logo`;
  }

  renderRatingDistribution(ratings);
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
  const latest = filterBySelectedBranch(dbState.ratings)
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

function renderBranchLinks() {
  if (!elements.branchLinksGrid) return;

  const branchOrder = ["main", "aranyeshwar", "balaji-nagar", "kothrud", "narhe"];
  const activeQrCodes = dbState.qrCodes
    .filter((qr) => qr.status !== "deleted" && qr.qrCodeId)
    .sort((a, b) => {
      const aIndex = branchOrder.indexOf(getItemBranchId(a));
      const bIndex = branchOrder.indexOf(getItemBranchId(b));
      const safeA = aIndex === -1 ? branchOrder.length : aIndex;
      const safeB = bIndex === -1 ? branchOrder.length : bIndex;
      return safeA - safeB || String(a.branchName || "").localeCompare(String(b.branchName || ""));
    });

  if (!activeQrCodes.length) {
    elements.branchLinksGrid.innerHTML = `
      <div class="branch-links-empty">
        <strong>No branch links available</strong>
        <span>Active branch review links will appear here.</span>
      </div>
    `;
    return;
  }

  elements.branchLinksGrid.innerHTML = activeQrCodes
    .map((qr, index) => {
      const branchName = qr.branchName || qr.label || qr.qrCodeId;
      const url = qr.dynamicUrl || getQrUrl(qr.qrCodeId);
      return `
        <a class="branch-link-card branch-accent-${index % 5}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">
          <span class="branch-link-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0z"/><circle cx="12" cy="10" r="2.5"/></svg>
          </span>
          <span class="branch-link-copy">
            <span class="branch-link-label">Shelar TVS</span>
            <strong>${escapeHtml(branchName)}</strong>
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

function renderFeedbackInbox() {
  const query = elements.feedbackSearch.value.trim().toLowerCase();
  const feedback = filterBySelectedBranch(dbState.feedback).sort(sortNewestFirst).filter((item) => {
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
            <button class="qr-download-btn" data-copy="${escapeHtml(url)}" type="button">Copy URL</button>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.qrCodesRegistryTable.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => copyText(button.dataset.copy));
  });
}

function renderReviewEvents() {
  const events = filterBySelectedBranch(dbState.reviewEvents).sort(sortNewestFirst);
  const posted = filterBySelectedBranch(dbState.postedReviews).sort(sortNewestFirst);
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

// Render the read-only settings info panel for the client.
function syncSettingsFormValues() {
  const s = dbState.settings || {};
  const setText = (id, value) => {
    const el = document.querySelector(id);
    if (el) el.textContent = value;
  };

  setText("#infoBusinessName", s.APP_BUSINESS_NAME || "-");

  const branches = getAvailableBranches();
  setText("#infoBranchCount", branches.length ? `${branches.length}` : "-");

  const place = String(s.GOOGLE_PLACE_ID || "").trim();
  setText("#infoGoogleStatus", place ? "Connected" : "Not connected yet");

  const branchList = document.querySelector("#infoBranchList");
  if (branchList) {
    branchList.innerHTML = branches.length
      ? branches.map((b) => `<span class="info-chip">${escapeHtml(b.name)}</span>`).join("")
      : `<span class="subtitle">No branches yet.</span>`;
  }

  const topics = String(s.REVIEW_TOPICS || "").split(",").map((t) => t.trim()).filter(Boolean);
  const topicList = document.querySelector("#infoReviewTopics");
  if (topicList) {
    topicList.innerHTML = topics.length
      ? topics.map((t) => `<span class="info-chip info-chip-positive">${escapeHtml(t)}</span>`).join("")
      : `<span class="subtitle">No topics configured.</span>`;
  }

  const feedbackTopics = String(s.FEEDBACK_TOPICS || "").split(",").map((t) => t.trim()).filter(Boolean);
  const feedbackList = document.querySelector("#infoFeedbackTopics");
  if (feedbackList) {
    feedbackList.innerHTML = feedbackTopics.length
      ? feedbackTopics.map((t) => `<span class="info-chip info-chip-negative">${escapeHtml(t)}</span>`).join("")
      : `<span class="subtitle">No feedback categories configured.</span>`;
  }
}

// Client dashboard is always read-only; nothing to toggle.
function applyClientMode() {}


async function createQrCode(event) {
  event.preventDefault();
  elements.qrCreationStatus.textContent = "Creating tracker...";
  elements.qrCreationStatus.classList.remove("is-error");

  const branchName = document.querySelector("#regBranchName").value.trim() || "Main";
  const payload = {
    qrCodeId: document.querySelector("#regQrId").value.trim(),
    label: document.querySelector("#regQrLabel").value.trim(),
    branchName,
    branchId: slugify(branchName),
    redirectUrl: document.querySelector("#regRedirectUrl")?.value.trim() || "",
    qrImageUrl: document.querySelector("#regQrImageUrl")?.value.trim() || "",
    source: document.querySelector("#regStaff").value.trim(),
  };

  try {
    const response = await fetch(appUrl("/api/dashboard/qrcodes"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create QR tracker.");

    event.currentTarget.reset();
    elements.qrCreationStatus.textContent = "Tracker created.";
    await loadDashboardData();
  } catch (error) {
    elements.qrCreationStatus.textContent = error.message;
    elements.qrCreationStatus.classList.add("is-error");
  }
}

async function resolveFeedback(id) {
  if (!id) return;
  const notes = window.prompt("Resolution note");
  if (notes === null) return;

  try {
    const response = await fetch(appUrl("/api/dashboard/feedback/resolve"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
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
    const response = await fetch(appUrl(`/api/dashboard/qrcodes/${encodeURIComponent(qrCodeId)}`), {
      method: "DELETE",
      credentials: "same-origin",
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not delete QR tracker.");
    await loadDashboardData();
  } catch (error) {
    setFormStatus(error.message, true);
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
  elements.connectionBadge.querySelector(".status-text").textContent = text;
}

function syncDashboardHeader(page) {
  const isOverview = page === "overview";
  if (elements.overviewHeading) elements.overviewHeading.hidden = !isOverview;
  if (elements.sectionHeading) elements.sectionHeading.hidden = isOverview;
}

function syncBranchFilter() {
  if (!elements.branchFilter || !elements.branchFilterSelect) return;

  const isShelarTvs = getActiveBusinessId() === "shelar-tvs";
  const supportsBranchFilter = ["overview", "feedback", "reviews"].includes(activeDashboardPage);
  elements.branchFilter.hidden = !isShelarTvs || !supportsBranchFilter;
  if (!isShelarTvs) {
    selectedBranchId = "all";
    return;
  }

  const branches = getAvailableBranches();
  const availableIds = new Set(branches.map((branch) => branch.id));
  if (selectedBranchId !== "all" && !availableIds.has(selectedBranchId)) {
    selectedBranchId = "all";
  }

  elements.branchFilterSelect.innerHTML = [
    '<option value="all">All branches</option>',
    ...branches.map((branch) => `<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name)}</option>`),
  ].join("");
  elements.branchFilterSelect.value = selectedBranchId;
}

function getAvailableBranches() {
  const branchMap = new Map();
  const addBranch = (item) => {
    const id = getItemBranchId(item);
    const name = String(item.name || item.branchName || item.context?.branchName || "").trim();
    if (!id || !name || item.status === "deleted") return;
    if (!branchMap.has(id)) branchMap.set(id, { id, name });
  };

  // Only the authoritative sources (active branches + active QR codes) feed the dropdown,
  // so stale branch names left in historical event data never reappear.
  dbState.branches.forEach(addBranch);
  dbState.qrCodes.forEach(addBranch);

  return [...branchMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function filterBySelectedBranch(items) {
  const list = [...(items || [])];
  if (selectedBranchId === "all") return list;
  return list.filter((item) => getItemBranchId(item) === selectedBranchId);
}

function getItemBranchId(item) {
  const branchId = item.branchId || item.context?.branchId;
  if (branchId) return slugify(branchId);
  return slugify(item.branchName || item.context?.branchName || "");
}

function getActiveBusinessId() {
  return String(dbState.settings.BUSINESS_ID || currentUserSession.client || "").trim().toLowerCase();
}

function hasEeswebIdentity(item) {
  return [
    item.qrCodeId,
    item.qrLabel,
    item.context?.qrCodeId,
    item.context?.qrLabel,
  ].some((value) => /\beesweb\b/i.test(String(value || "")));
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
    <a class="qr-thumb-link" href="${escapeHtml(qrImageUrl)}" target="_blank" rel="noreferrer">
      <img class="qr-thumb" src="${escapeHtml(qrImageUrl)}" alt="${escapeHtml(label || "QR code")}" loading="lazy" />
    </a>
  `;
}

function shortenUrl(value) {
  const text = String(value || "");
  return text.length > 42 ? `${text.slice(0, 39)}...` : text;
}

function resolveAppContext() {
  return {
    namespace: "",
    dashboardUrl: "/dashboard",
    loginUrl: "/login",
    authApiBase: "/api/auth",
  };
}

function appUrl(path) {
  return `${appContext.namespace}${path}`;
}

async function ensureAuthenticated() {
  try {
    const response = await fetch(`${appContext.authApiBase}/session`, {
      credentials: "same-origin",
    });
    if (!response.ok) {
      window.location.replace(appContext.loginUrl);
      return false;
    }
    const data = await response.json();
    if (!data.authenticated) {
      window.location.replace(appContext.loginUrl);
      return false;
    }
    if (data.session) {
      currentUserSession = data.session;
    }
    return true;
  } catch {
    window.location.replace(appContext.loginUrl);
    return false;
  }
}

async function logout() {
  if (elements.confirmLogoutButton) {
    elements.confirmLogoutButton.disabled = true;
    elements.confirmLogoutButton.textContent = "Logging out...";
  }
  try {
    await fetch(`${appContext.authApiBase}/logout`, {
      method: "POST",
      credentials: "same-origin",
    });
  } finally {
    window.location.replace(appContext.loginUrl);
  }
}

function openLogoutConfirmation() {
  if (!elements.logoutConfirmModal) return;
  elements.logoutConfirmModal.hidden = false;
  document.body.classList.add("has-modal-open");
  elements.cancelLogoutButton?.focus();
}

function closeLogoutConfirmation() {
  if (!elements.logoutConfirmModal) return;
  elements.logoutConfirmModal.hidden = true;
  document.body.classList.remove("has-modal-open");
  if (elements.confirmLogoutButton) {
    elements.confirmLogoutButton.disabled = false;
    elements.confirmLogoutButton.textContent = "Log out";
  }
  elements.logoutButton?.focus();
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
