const state = { user: null, data: null, view: "open", authMode: "login", sort: "priority", categoryFilter: "all", page: 1, selectedReportIds: null, pin: null, maps: [] };
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const statusNames = ["New", "Verified", "In progress", "Resolved"];
const categories = ["Flooding", "Road damage", "Streetlight", "Garbage", "Safety hazard", "Others"];
function pageSize() {
  // Mobile has no scrolling, so each page must be short enough to fit the screen on its own.
  return window.innerWidth <= 760 ? 3 : 6;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(`/api/${path}`, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

async function loadGoogleMaps() {
  try {
    const { googleMapsApiKey } = await api("config");
    if (!googleMapsApiKey) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&loading=async`;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
  } catch {
    // OpenStreetMap remains available if Google Maps does not load.
  }
}

function showAuth(splash = false) {
  $("#appView").hidden = true;
  $("#authView").hidden = false;
  $("#authError").textContent = "";
  const view = $("#authView");
  view.classList.remove("reveal-form", "intro-fading");
  if (splash && window.innerWidth <= 760) {
    // Mobile's intro is the plain default (see styles.css) so it's already showing with no flash
    // of the form - hold it a few seconds, fade it out, then fade the form in.
    setTimeout(() => {
      view.classList.add("intro-fading");
      setTimeout(() => view.classList.add("reveal-form"), 400);
    }, 4000);
  } else {
    view.classList.add("reveal-form");
  }
}

async function showApp(user) {
  state.user = user;
  $("#authView").hidden = true;
  $("#appView").hidden = false;
  const admin = user.role === "admin";
  $("#roleLabel").textContent = admin ? "COMMUNITY OFFICE" : "COMMUNITY REPORTS";
  updateUserChip(user);
  $$(".user-role").forEach(badge => { badge.textContent = admin ? "ADMIN" : "CITIZEN"; });
  fillAccountPanel(user);
  closeAccountPanel();
  updateReportRanges();
  $("#newReport").hidden = admin;
  $("#reportDownload").hidden = !admin;
  $(".mobile-plus").hidden = admin;
  state.sort = admin ? "priority" : "severity";
  state.categoryFilter = "all";
  state.page = 1;
  $("#recentSortOption").hidden = !admin;
  $("#categoryFilterControl").hidden = !admin;
  $("#filterCategory").value = "all";
  $("#sortReports").value = state.sort;
  $("#sortReports").disabled = false;
  $("#listEyebrow").textContent = admin ? "LIVE PRIORITY QUEUE" : "ISSUES IN YOUR AREA";
  $("#listTitle").textContent = admin ? "Ranked reports" : "Open reports";
  $("#pageTitle").textContent = admin ? "Reports" : "Community reports";
  setMobilePage(false);
  await loadDashboard();
  state.maps = [new ComfixMap($("#mainMap"), report => selectReport(report.ids))];
  renderDashboard();
  requestAnimationFrame(() => state.maps.forEach(map => map.resize()));
}

function setMobilePage(showingList) {
  $("#openView").classList.toggle("showing-list", showingList);
  $("#pagerToggleIcon").textContent = showingList ? "⌃" : "⌄";
  $("#pagerToggleLabel").textContent = showingList ? "Map" : "Reports";
  $("#pagerToggle").setAttribute("aria-label", showingList ? "Show map" : "Show reports");
}
$("#pagerToggle").addEventListener("click", () => setMobilePage(!$("#openView").classList.contains("showing-list")));

function setAuthMode(mode) {
  state.authMode = mode;
  const registering = mode === "register";
  $("#authTitle").textContent = registering ? "Create an account" : "Welcome";
  $("#authDescription").textContent = registering ? "Create a citizen account to send reports." : "Sign in to view your ComFix workspace.";
  $("#authSubmit").innerHTML = registering ? 'Create account <span aria-hidden="true">→</span>' : 'Sign in <span aria-hidden="true">→</span>';
  $("#authPrompt").textContent = registering ? "Already have an account?" : "New to ComFix?";
  $("#authSwitch").textContent = registering ? "Sign in" : "Create a citizen account";
  $("#password").autocomplete = registering ? "new-password" : "current-password";
  $("#authError").textContent = "";
}

async function loadDashboard() {
  state.data = await api("dashboard");
  renderDashboard();
}

function updateClock() {
  const now = new Date();
  $("#clockLabel").dateTime = now.toISOString();
  $("#clockLabel").textContent = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(now);
}

updateClock();
setInterval(updateClock, 15_000);

function mostRecentHour(report) {
  return Math.max(...report.reports.map(item => item.createdHour));
}

function sortedReports() {
  let reports = [...state.data.openReports];
  if (state.categoryFilter !== "all") reports = reports.filter(report => report.categoryKey === state.categoryFilter);
  if (state.sort === "reports") return reports.sort((a, b) => b.count - a.count || b.severity - a.severity);
  if (state.sort === "severity") return reports.sort((a, b) => b.severity - a.severity || b.count - a.count);
  if (state.sort === "recent") return reports.sort((a, b) => mostRecentHour(b) - mostRecentHour(a));
  return reports.sort((a, b) => b.priority - a.priority);
}

function sameReportIds(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every(id => right.includes(id));
}

function renderDashboard() {
  const data = state.data;
  $("#metricOpen").textContent = data.openReportCount;
  $("#metricReports").textContent = data.reportsReceived;
  $("#metricResolved").textContent = data.resolvedReportCount;
  $("#metricUrgent").textContent = data.openReports.filter(report => report.severity >= 5).length;
  $("#openNavCount").textContent = data.openReportCount;
  $("#listCaption").textContent = state.user.role === "admin" ? "Sort reports by priority, severity, or report count." : "Open issues reported by residents in the community.";
  const reports = sortedReports();
  const size = pageSize();
  const pageCount = Math.max(1, Math.ceil(reports.length / size));
  state.page = Math.min(state.page, pageCount);
  const startIndex = (state.page - 1) * size;
  const pageReports = reports.slice(startIndex, state.page * size);
  const pinnedTotal = reports.filter(report => report.pin).length;
  $("#pinCount").textContent = `${pinnedTotal} ${pinnedTotal === 1 ? "pin" : "pins"}`;
  $("#reportList").innerHTML = pageReports.map((report, index) => reportMarkup(report, startIndex + index)).join("");
  $("#emptyReports").hidden = reports.length > 0;
  $("#reportPagination").hidden = reports.length <= size;
  $("#pageLabel").textContent = `${state.page} / ${pageCount}`;
  $("#previousPage").disabled = state.page <= 1;
  $("#nextPage").disabled = state.page >= pageCount;
  $("#resolvedList").innerHTML = data.resolvedReports.map(report => resolvedMarkup(report)).join("");
  $("#emptyResolved").hidden = data.resolvedReports.length > 0;
  $("#resolvedCount").textContent = `${data.resolvedReports.length} closed`;
  const selectedReport = pageReports.find(report => sameReportIds(report.ids, state.selectedReportIds)) || pageReports[0];
  renderFactors(selectedReport);
  // The map shows every pinned report (not just this list page), numbered exactly like the list.
  const mapReports = reports.map((report, index) => ({ ...report, displayNumber: listNumber(report, index) }));
  state.maps.forEach(map => map.setReports(mapReports, report => selectReport(report.ids), state.pinPanelIds));
  renderPinPanel();
}

function listNumber(report, index) {
  return state.sort === "priority" ? report.rank : index + 1;
}

function reportMarkup(report, index) {
  const rank = listNumber(report, index);
  const statusClass = `status-${report.status.toLowerCase().replaceAll(" ", "-")}`;
  const age = report.ageHours < 24 ? `${Math.max(1, Math.round(report.ageHours))}h open` : `${Math.floor(report.ageHours / 24)}d open`;
  const controls = state.user.role === "admin"
    ? `<label class="status-select-label"><span class="sr-only">Change status</span><select class="status-select ${statusClass}" data-report-ids="${report.ids.join(",")}" aria-label="Change status for ${escapeHtml(report.title)}">${statusNames.map(status => `<option ${status === report.status ? "selected" : ""}>${status}</option>`).join("")}</select></label>`
    : `<span class="status-pill ${statusClass}">${escapeHtml(report.status)}</span>`;
  const selected = sameReportIds(report.ids, state.selectedReportIds);
  return `<article class="report-row ${index === 0 && state.page === 1 ? "report-row-top" : ""} ${selected ? "report-row-selected" : ""} ${report.mine ? "report-row-mine" : ""}" data-report-ids="${report.ids.join(",")}">
    <span class="rank-number">${rank}</span><div class="report-main"><div class="report-title-line"><h3>${escapeHtml(report.title)}${report.mine ? ' <span class="mine-tag">YOURS</span>' : ""}</h3>${controls}</div>
    <p class="report-meta">${escapeHtml(report.category)} <span>·</span> ${report.count} ${report.count === 1 ? "report" : "reports"} <span>·</span> ${age}${report.pin ? " <span>·</span> Pinned" : ""}</p>
    <div class="report-score-line"><div class="score-track"><span style="width:${Math.min(100, Math.max(4, report.priority / 20 * 100))}%"></span></div><b>${report.priority.toFixed(1)}</b><small>priority</small></div></div></article>`;
}

function renderFactors(report) {
  const factors = report?.factors;
  if (!factors) {
    $("#factorSeverity").textContent = "—";
    $("#factorReports").textContent = "—";
    $("#factorAge").textContent = "—";
    $("#factorDanger").textContent = "—";
    $("#factorAgeLabel").textContent = "Time open";
    return;
  }
  const ageRate = report.ageHours >= 72 ? 0 : factors.sev * factors.rep * factors.dng / 144;
  $("#factorSeverity").textContent = factors.sev;
  $("#factorReports").textContent = factors.rep.toFixed(2);
  $("#factorAge").textContent = factors.age.toFixed(2);
  $("#factorDanger").textContent = factors.dng.toFixed(1);
  $("#factorAgeLabel").textContent = `Time open (+${ageRate.toFixed(3)} priority/hr)`;
}

function resolvedMarkup(report) {
  const action = state.user.role === "admin"
    ? `<button class="button button-outline reopen-report" data-report-ids="${report.ids.join(",")}" type="button">Reopen</button>`
    : `<button class="button button-outline re-report" data-category="${escapeHtml(report.categoryKey)}" data-custom="${escapeHtml(report.categoryKey === "Others" ? report.category : "")}" data-text="${escapeHtml(report.title)}" data-pin="${report.pin ? report.pin.join(",") : ""}" type="button">Re-report</button>`;
  return `<article class="resolved-row"><span class="resolved-check">✓</span><div class="resolved-copy"><h3>${escapeHtml(report.title)}</h3><p>${escapeHtml(report.category)} <span>·</span> ${report.count} ${report.count === 1 ? "report" : "reports"}</p></div><span class="status-pill status-resolved">Resolved</span>${action}</article>`;
}

const placeCache = new Map();
async function placeName(pin) {
  const key = pin.map(n => n.toFixed(4)).join(",");
  if (placeCache.has(key)) return placeCache.get(key);
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${pin[0]}&lon=${pin[1]}`, { headers: { "Accept-Language": "en" } });
    const result = await response.json(), a = result.address || {};
    const road = a.road || a.pedestrian || a.footway || a.neighbourhood;
    const area = a.suburb || a.village || a.town || a.municipality || a.city;
    const name = [road, area].filter(Boolean).join(", ") || (result.display_name || "").split(",").slice(0, 3).join(",");
    placeCache.set(key, name);
    return name;
  } catch { return null; }
}

function renderPinPanel() {
  const panel = $("#pinPanel");
  const report = state.pinPanelIds && state.data?.openReports.find(item => sameReportIds(item.ids, state.pinPanelIds));
  if (!report) {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
    panel.dataset.signature = "";
    $("#pinBackdrop").hidden = true;
    return;
  }
  const signature = JSON.stringify([report.ids, report.status, report.count, report.priority, window.innerWidth <= 760]);
  if (panel.dataset.signature === signature && panel.classList.contains("open")) return;
  panel.dataset.signature = signature;
  const statusClass = `status-${report.status.toLowerCase().replaceAll(" ", "-")}`;
  const age = report.ageHours < 24 ? `${Math.max(1, Math.round(report.ageHours))}h` : `${Math.floor(report.ageHours / 24)}d`;
  const admin = state.user.role === "admin";
  const mergeOptions = admin ? state.data.openReports.filter(item => !sameReportIds(item.ids, report.ids)) : [];
  // On a wide screen the real map is still visible around this panel, so repeating it here is redundant; on a
  // phone the panel covers the whole screen, so it is the only place left to show where the report is.
  const showLocation = window.innerWidth <= 760;
  panel.innerHTML = `<button class="icon-button pin-close" type="button" aria-label="Close details">×</button>
    <p class="eyebrow">${escapeHtml(report.category).toUpperCase()}</p>
    <h3>${escapeHtml(report.title)}</h3>
    <span class="status-pill ${statusClass}">${escapeHtml(report.status)}</span>
    <dl class="pin-facts"><div><dt>PRIORITY</dt><dd>${report.priority.toFixed(1)}</dd></div><div><dt>SEVERITY</dt><dd>${report.severity}/5</dd></div><div><dt>REPORTS</dt><dd>${report.count}</dd></div><div><dt>TIME OPEN</dt><dd>${age}</dd></div></dl>
    ${showLocation ? `<section class="pin-location"><h4>LOCATION</h4>
    ${report.pin ? `<div id="pinMiniMap" class="pin-mini-map"></div><p class="pin-place">Finding the street name...</p><p class="pin-coords">${report.pin[0].toFixed(5)}, ${report.pin[1].toFixed(5)}</p><a class="button button-outline pin-directions" href="https://www.google.com/maps/dir/?api=1&destination=${report.pin[0]},${report.pin[1]}" target="_blank" rel="noopener noreferrer">Show in directions <span aria-hidden="true">↗</span></a>` : `<p class="pin-coords">No location pin was added to this report.</p>`}</section>` : ""}
    <h4>WHAT WAS REPORTED</h4>
    <ul class="pin-said">${report.reports.map(item => `<li>${escapeHtml(item.text)}</li>`).join("")}</ul>
    ${admin ? `<h4>COMBINE REPORTS</h4>${mergeOptions.length ? `<div class="merge-control"><select id="mergeTarget" aria-label="Combine with another report"><option value="">Choose a report…</option>${mergeOptions.map(item => `<option value="${item.ids.join(",")}">${escapeHtml(item.title)} (${escapeHtml(item.category)}, ${item.count} ${item.count === 1 ? "report" : "reports"})</option>`).join("")}</select><button id="mergeConfirm" class="button button-outline" type="button">Combine</button></div><p class="merge-note">Combining folds both reports into one, so the office sees a single problem.</p>` : `<p class="merge-note">No other open reports to combine with right now.</p>`}` : ""}`;
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  $("#pinBackdrop").hidden = false;
  if (report.pin && showLocation) {
    placeName(report.pin).then(name => {
      const place = panel.querySelector(".pin-place");
      if (place && panel.dataset.signature === signature) place.textContent = name || "Street name not available. Use the coordinates below.";
    });
    const miniMapEl = $("#pinMiniMap");
    if (miniMapEl) {
      const miniMap = new ComfixMap(miniMapEl);
      miniMap.setReports([{ ...report, displayNumber: "" }], () => {});
      requestAnimationFrame(() => miniMap.resize());
    }
  }
}

function closePinPanel(flyBack = true) {
  if (!state.pinPanelIds) return;
  state.pinPanelIds = null;
  renderPinPanel();
  if (flyBack) state.maps.forEach(map => map.overview());
}

$("#pinPanel").addEventListener("click", async event => {
  if (event.target.closest(".pin-close")) { closePinPanel(); return; }
  if (event.target.closest("#mergeConfirm")) {
    const select = $("#mergeTarget");
    const targetIds = select.value ? select.value.split(",").map(Number) : null;
    if (!targetIds) { showToast("Choose a report to combine with."); return; }
    try {
      await api("merge", { method: "POST", body: JSON.stringify({ ids: state.pinPanelIds, withIds: targetIds }) });
      state.pinPanelIds = [...new Set([...state.pinPanelIds, ...targetIds])];
      state.selectedReportIds = state.pinPanelIds;
      await loadDashboard();
      showToast("Reports combined.");
    } catch (error) { showToast(error.message); }
  }
});
$("#pinBackdrop").addEventListener("click", () => closePinPanel());
document.addEventListener("keydown", event => { if (event.key === "Escape" && state.pinPanelIds && !$("#reportDialog").open) closePinPanel(); });

function selectReport(ids) {
  state.selectedReportIds = ids;
  state.pinPanelIds = ids;
  const index = sortedReports().findIndex(report => sameReportIds(report.ids, ids));
  if (index >= 0) state.page = Math.floor(index / pageSize()) + 1;
  renderDashboard();
  state.maps.forEach(map => map.openReport(ids));
  document.querySelector(`[data-report-ids="${ids.join(",")}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showView(view) {
  state.view = view;
  state.selectedReportIds = null;
  closePinPanel(false);
  $("#openView").hidden = view !== "open";
  $("#resolvedView").hidden = view !== "resolved";
  $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === view));
  $("#pageTitle").textContent = view === "open" ? (state.user.role === "admin" ? "Reports" : "Community reports") : "Resolved reports";
  if (view === "open") { setMobilePage(false); state.maps.forEach(map => map.resize()); }
  if (view === "resolved") updateReportRanges();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function updateCustomCategoryField() {
  const isOthers = $("#reportCategory").value === "Others";
  $("#customCategoryLabel").hidden = !isOthers;
  $("#customCategoryInput").required = isOthers;
  if (!isOthers) $("#customCategoryInput").value = "";
}

function openReportDialog(prefill = null) {
  $("#reportError").textContent = "";
  $("#reportText").value = prefill?.text || "";
  $("#reportSeverity").value = 3;
  $("#severityValue").value = "3 / 5";
  state.pin = prefill?.pin || null;
  $("#clearPin").hidden = !state.pin;
  $("#selectedLocation").textContent = state.pin ? `${state.pin[0].toFixed(5)}, ${state.pin[1].toFixed(5)}` : "Choose a point on the map or leave it blank.";
  $("#reportCategory").value = prefill?.category || categories[0];
  updateCustomCategoryField();
  if (prefill?.category === "Others") $("#customCategoryInput").value = prefill.customCategory || "";
  $("#reportDialog").showModal();
  if (!state.maps[1]) {
    state.maps[1] = new ComfixMap($("#reportMap"), pin => {
      state.pin = pin;
      state.maps[1].setPin(pin);
      $("#selectedLocation").textContent = `${pin[0].toFixed(5)}, ${pin[1].toFixed(5)}`;
      $("#clearPin").hidden = false;
    });
  } else if (state.pin) {
    state.maps[1].setPin(state.pin);
  } else {
    state.maps[1].clearPin();
  }
  requestAnimationFrame(() => state.maps[1].resize());
}
$("#reportCategory").addEventListener("change", updateCustomCategoryField);

$("#authForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#authError").textContent = "";
  const payload = { username: $("#username").value.trim(), password: $("#password").value };
  try {
    const result = await api(state.authMode === "login" ? "login" : "register", { method: "POST", body: JSON.stringify(payload) });
    await showApp(result.user);
  } catch (error) {
    $("#authError").textContent = error.message;
  }
});

$("#togglePassword").addEventListener("click", () => {
  const input = $("#password"), show = input.type === "password";
  input.type = show ? "text" : "password";
  $("#togglePassword").textContent = show ? "Hide" : "Show";
  $("#togglePassword").setAttribute("aria-label", show ? "Hide password" : "Show password");
  $("#togglePassword").setAttribute("aria-pressed", String(show));
});

// Same window the server uses for the CSV: weekly starts on Monday, monthly on the 1st, both end today.
function reportRange(period) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), period === "weekly" ? now.getDate() - ((now.getDay() + 6) % 7) : 1);
  const short = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  const full = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  return start.toDateString() === now.toDateString() ? full.format(now) : `${short.format(start)} – ${full.format(now)}`;
}

function updateReportRanges() {
  $("#weeklyRange").textContent = reportRange("weekly");
  $("#monthlyRange").textContent = reportRange("monthly");
}

function initials(user) {
  const source = (user.fullName || "").trim() || user.username;
  const words = source.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : source.slice(0, 2)).toUpperCase();
}

function updateUserChip(user) {
  $("#userLabel").textContent = user.fullName || user.username;
  $("#avatarInitials").textContent = initials(user);
}

function setDetail(selector, value) {
  const element = $(selector);
  element.textContent = value || "Not set";
  element.classList.toggle("empty", !value);
}

function showProfileMode(mode) {
  $("#profileView").hidden = mode !== "view";
  $("#profileForm").hidden = mode !== "edit";
  $("#passwordForm").hidden = mode !== "password";
  $("#profileError").textContent = "";
  $("#passwordError").textContent = "";
}

function fillAccountPanel(user) {
  const admin = user.role === "admin";
  showProfileMode("view");
  $("#accountAvatar").textContent = initials(user);
  $("#accountUsername").textContent = user.username;
  setDetail("#accountFullName", user.fullName);
  setDetail("#accountContact", user.contact);
  setDetail("#accountAddress", user.address);
  $("#accountType").textContent = admin ? "Community office (admin)" : "Citizen";
  $("#accountAccess").textContent = admin ? "Review, update and reopen reports" : "View and submit reports";
}

function closeAccountPanel() {
  showProfileMode("view");
  $("#accountPanel").hidden = true;
  $("#accountButton").setAttribute("aria-expanded", "false");
}

$("#editProfile").addEventListener("click", () => {
  $("#profileUsername").value = state.user.username;
  $("#profileFullName").value = state.user.fullName || "";
  $("#profileContact").value = state.user.contact || "";
  $("#profileAddress").value = state.user.address || "";
  showProfileMode("edit");
  $("#profileFullName").focus();
});
$("#cancelProfile").addEventListener("click", () => showProfileMode("view"));
$("#changePassword").addEventListener("click", () => { $("#passwordForm").reset(); showProfileMode("password"); $("#currentPassword").focus(); });
$("#cancelPassword").addEventListener("click", () => showProfileMode("view"));
$("#profileForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#profileError").textContent = "";
  const payload = { username: $("#profileUsername").value.trim(), fullName: $("#profileFullName").value.trim(), contact: $("#profileContact").value.trim(), address: $("#profileAddress").value.trim() };
  try {
    const { user } = await api("profile", { method: "POST", body: JSON.stringify(payload) });
    state.user = user;
    $("#userLabel").textContent = user.fullName || user.username;
    updateUserChip(user);
    fillAccountPanel(user);
    await loadDashboard();
    showToast("Profile updated.");
  } catch (error) { $("#profileError").textContent = error.message; }
});
$("#passwordForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#passwordError").textContent = "";
  try {
    await api("password", { method: "POST", body: JSON.stringify({ currentPassword: $("#currentPassword").value, newPassword: $("#newPassword").value }) });
    $("#passwordForm").reset();
    showProfileMode("view");
    showToast("Password updated.");
  } catch (error) { $("#passwordError").textContent = error.message; }
});
$("#accountButton").addEventListener("click", () => {
  const open = $("#accountPanel").hidden;
  $("#accountPanel").hidden = !open;
  $("#accountButton").setAttribute("aria-expanded", String(open));
});
document.addEventListener("click", event => { if (!event.target.closest(".account-menu") && !$("#accountPanel").hidden) closeAccountPanel(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closeAccountPanel(); });

async function downloadResolvedReport(period) {
  try {
    const response = await fetch(`/api/resolved-report?period=${period}`);
    if (!response.ok) throw new Error((await response.json()).error || "Could not create the report.");
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `comfix-resolved-${period}-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    showToast(`${period === "weekly" ? "Weekly" : "Monthly"} report downloaded (${reportRange(period)}).`);
  } catch (error) { showToast(error.message); }
}
$("#downloadWeekly").addEventListener("click", () => downloadResolvedReport("weekly"));
$("#downloadMonthly").addEventListener("click", () => downloadResolvedReport("monthly"));

$("#authSwitch").addEventListener("click", () => setAuthMode(state.authMode === "login" ? "register" : "login"));
async function signOut() {
  closeAccountPanel();
  await api("logout", { method: "POST", body: "{}" });
  state.maps = [];
  state.user = null;
  showAuth();
}
$("#signOut").addEventListener("click", signOut);
$("#accountSignOut").addEventListener("click", signOut);
$(".side-nav").addEventListener("click", event => {
  const button = event.target.closest("[data-view]");
  if (button) showView(button.dataset.view);
  if (event.target.closest("[data-action='report']")) openReportDialog();
});
$("#sortReports").addEventListener("change", event => { state.sort = event.target.value; state.page = 1; state.selectedReportIds = null; renderDashboard(); });
$("#filterCategory").addEventListener("change", event => { state.categoryFilter = event.target.value; state.page = 1; state.selectedReportIds = null; renderDashboard(); });
$("#previousPage").addEventListener("click", () => { state.page -= 1; renderDashboard(); });
$("#nextPage").addEventListener("click", () => { state.page += 1; renderDashboard(); });
$("#reportList").addEventListener("change", async event => {
  const select = event.target.closest(".status-select");
  if (!select) return;
  try {
    await api("status", { method: "POST", body: JSON.stringify({ ids: select.dataset.reportIds.split(",").map(Number), status: select.value }) });
    await loadDashboard();
    showToast(`Report status changed to ${select.value}.`);
  } catch (error) { showToast(error.message); }
});
$("#resolvedList").addEventListener("click", async event => {
  const reopenButton = event.target.closest(".reopen-report");
  if (reopenButton) {
    try {
      await api("status", { method: "POST", body: JSON.stringify({ ids: reopenButton.dataset.reportIds.split(",").map(Number), status: "New" }) });
      await loadDashboard();
      showView("open");
      showToast("Report reopened.");
    } catch (error) { showToast(error.message); }
    return;
  }
  const reReportButton = event.target.closest(".re-report");
  if (reReportButton) {
    const pin = reReportButton.dataset.pin ? reReportButton.dataset.pin.split(",").map(Number) : null;
    openReportDialog({ category: reReportButton.dataset.category, customCategory: reReportButton.dataset.custom, text: reReportButton.dataset.text, pin });
  }
});
$("#reportList").addEventListener("click", event => {
  const row = event.target.closest(".report-row");
  if (row && !event.target.closest("select")) selectReport(row.dataset.reportIds.split(",").map(Number));
});
$("#newReport").addEventListener("click", openReportDialog);
$("#closeDialog").addEventListener("click", () => $("#reportDialog").close());
$("#cancelReport").addEventListener("click", () => $("#reportDialog").close());
$("#reportSeverity").addEventListener("input", event => { $("#severityValue").value = `${event.target.value} / 5`; });
$("#clearPin").addEventListener("click", () => {
  state.pin = null;
  state.maps[1]?.clearPin();
  $("#selectedLocation").textContent = "Choose a point on the map or leave it blank.";
  $("#clearPin").hidden = true;
});
$("#reportForm").addEventListener("submit", async event => {
  event.preventDefault();
  $("#reportError").textContent = "";
  const payload = { category: $("#reportCategory").value, customCategory: $("#customCategoryInput").value.trim(), severity: Number($("#reportSeverity").value), text: $("#reportText").value.trim(), pin: state.pin };
  try {
    const result = await api("reports", { method: "POST", body: JSON.stringify(payload) });
    $("#reportDialog").close();
    state.selectedReportIds = null;
    state.page = 1;
    await loadDashboard();
    showToast(`${result.ticket} filed${result.reopened ? "; resolved report reopened" : ""}.`);
  } catch (error) { $("#reportError").textContent = error.message; }
});

$("#reportCategory").innerHTML = categories.map(category => `<option>${escapeHtml(category)}</option>`).join("");
$("#filterCategory").insertAdjacentHTML("beforeend", categories.map(category => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join(""));

// Keep the layout correct across resizes and orientation changes (e.g. crossing the phone/desktop breakpoint).
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!state.user) return;
    renderDashboard();
    state.maps.forEach(map => map.resize());
  }, 150);
});

(async () => {
  await loadGoogleMaps();
  try {
    const { user } = await api("session");
    if (user) await showApp(user);
    else showAuth(true);
  } catch {
    showAuth(true);
  }
})();