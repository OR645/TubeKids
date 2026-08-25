(() => {
  "use strict";
  const STORAGE_KEY = "tubekids.local-library.v1";
  const AUTOPLAY_KEY = "tubekids.autoplay.v1";
  const PIN = "1234";
  const AUTOPLAY_DELAY = 5;
  const state = { videos: [], metadata: {}, category: "all", search: "", parentMode: false, currentId: null, editId: null, autoplay: true, countdown: 0 };
  const $ = (selector) => document.querySelector(selector);
  const els = {
    grid: $("#videoGrid"), toolbar: $("#toolbar"), chips: $("#categoryChips"), search: $("#searchInput"), empty: $("#emptyState"),
    emptyTitle: $("#emptyTitle"), emptyText: $("#emptyText"), toast: $("#toast"), parentBadge: $("#parentBadge"), lock: $("#lockButton"),
    refresh: $("#refreshButton"), notice: $("#storageNotice"), storageText: $("#storageText"), storageDot: $("#storageDot"),
    parentDialog: $("#parentDialog"), parentForm: $("#parentForm"), pin: $("#pinInput"), pinError: $("#pinError"),
    editDialog: $("#editDialog"), editForm: $("#editForm"), editTitle: $("#editVideoTitle"), editCategory: $("#editCategoryInput"),
    editTags: $("#editTagsInput"), categoryOptions: $("#categoryOptions"), player: $("#playerOverlay"), stage: $("#playerStage"),
    frame: $("#playerFrameWrap"), playingTitle: $("#playingTitle"), playingCategory: $("#playingCategory"), closePlayer: $("#closePlayer"),
    fullscreen: $("#fullscreenButton"), previous: $("#previousButton"), next: $("#nextButton"), favoritePlaying: $("#favoritePlaying"),
    autoplayToggle: $("#autoplayToggle"), sidebar: $("#playerSidebar"), sidebarList: $("#sidebarList"),
    upNext: $("#upNextCard"), upNextKicker: $("#upNextKicker"), upNextTitle: $("#upNextTitle"), upNextPlay: $("#upNextPlay"), upNextCancel: $("#upNextCancel")
  };

  function loadMetadata() {
    try { state.metadata = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { state.metadata = {}; }
    state.autoplay = localStorage.getItem(AUTOPLAY_KEY) !== "off";
    els.autoplayToggle.checked = state.autoplay;
  }
  function saveMetadata() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.metadata)); }
  function applyMetadata(file) {
    const saved = state.metadata[file.id] || {};
    return { ...file, title: saved.title || file.title, category: saved.category || file.category || "סרטונים",
      tags: Array.isArray(saved.tags) ? saved.tags : [], favorite: Boolean(saved.favorite), views: Number(saved.views) || 0 };
  }
  function persistVideo(video) {
    state.metadata[video.id] = { title: video.title, category: video.category, tags: video.tags, favorite: video.favorite, views: video.views };
    saveMetadata();
  }
  async function loadVideos(showMessage = false) {
    try {
      const response = await fetch("/__videos", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.videos = (data.videos || []).map(applyMetadata);
      els.storageText.textContent = `תיקיית מקור: ${data.folder} — נמצאו ${state.videos.length} סרטונים`;
      els.storageDot.classList.add("connected");
      render();
      if (showMessage) showToast("רשימת הסרטונים עודכנה");
    } catch (error) {
      state.videos = [];
      els.storageText.textContent = "לא ניתן לקרוא את תיקיית הסרטונים. הפעילו את TubeKids.cmd";
      els.storageDot.classList.remove("connected");
      render();
      console.warn(error);
    }
  }
  function filteredVideos() {
    const query = state.search.trim().toLocaleLowerCase("he");
    return state.videos.filter((video) => {
      if (state.category === "favorites" && !video.favorite) return false;
      if (!["all", "favorites"].includes(state.category) && video.category !== state.category) return false;
      return !query || `${video.title} ${video.category} ${video.tags.join(" ")}`.toLocaleLowerCase("he").includes(query);
    });
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  }
  function render() {
    document.querySelectorAll(".parent-only").forEach((element) => { element.hidden = !state.parentMode; });
    els.parentBadge.hidden = !state.parentMode;
    els.lock.textContent = state.parentMode ? "🔓" : "🔒";
    els.lock.setAttribute("aria-label", state.parentMode ? "יציאה ממצב הורים" : "כניסה למצב הורים");
    els.notice.hidden = !state.parentMode;
    const categories = [...new Set(state.videos.map((video) => video.category))].sort((a, b) => a.localeCompare(b, "he"));
    const chips = [{ key: "all", label: "הכל" }, { key: "favorites", label: "★ מועדפים" }, ...categories.map((category) => ({ key: category, label: category }))];
    els.chips.innerHTML = chips.map((chip) => `<button class="chip${state.category === chip.key ? " active" : ""}" data-category="${escapeHtml(chip.key)}" type="button">${escapeHtml(chip.label)}</button>`).join("");
    els.categoryOptions.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
    els.toolbar.hidden = state.videos.length === 0;
    const visible = filteredVideos();
    els.grid.innerHTML = visible.map((video, index) => `
      <article class="video-card" data-id="${escapeHtml(video.id)}" style="animation-delay:${Math.min(index * 45, 360)}ms">
        <button class="favorite-button${video.favorite ? " active" : ""}" data-action="favorite" type="button" aria-label="מועדפים">${video.favorite ? "★" : "☆"}</button>
        <button class="thumb-button local-thumb" data-action="play" type="button" aria-label="ניגון ${escapeHtml(video.title)}">
          <video src="${escapeHtml(video.src)}#t=0.1" preload="metadata" muted playsinline tabindex="-1"></video>
        </button>
        <div class="card-body"><h2>${escapeHtml(video.title)}</h2>
          <div class="meta-row"><span class="category-label">${escapeHtml(video.category)}</span></div>
          ${video.tags.length ? `<div class="tag-row">${video.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
          ${state.parentMode ? '<div class="card-actions"><button class="small-action" data-action="edit" type="button">עריכה</button></div>' : ""}
        </div></article>`).join("");
    const noMatches = state.videos.length > 0 && visible.length === 0;
    els.empty.hidden = state.videos.length > 0 && !noMatches;
    if (noMatches) { els.emptyTitle.textContent = "לא מצאנו סרטון מתאים"; els.emptyText.textContent = "אפשר לנסות חיפוש אחר או לבחור קטגוריה אחרת."; }
    else if (!state.videos.length) { els.emptyTitle.textContent = "תיקיית הסרטונים עדיין ריקה"; els.emptyText.textContent = "העתיקו קובצי וידאו לתיקיית המקור והפעילו רענון במצב הורים."; }
    if (!els.player.hidden) renderSidebar();
  }
  function showToast(message) {
    els.toast.textContent = message; els.toast.hidden = false; clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => { els.toast.hidden = true; }, 2800);
  }
  function mostViewed(excludeId) {
    return state.videos.filter((video) => video.id !== excludeId)
      .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title, "he"));
  }
  function renderSidebar() {
    const list = mostViewed(state.currentId).slice(0, 30);
    els.sidebarList.innerHTML = list.map((video) => `
      <button class="sidebar-item" data-play="${escapeHtml(video.id)}" type="button">
        <video src="${escapeHtml(video.src)}#t=0.1" preload="metadata" muted playsinline tabindex="-1"></video>
        <span><strong>${escapeHtml(video.title)}</strong><small>${escapeHtml(video.category)}${video.views ? ` · ${video.views} צפיות` : ""}</small></span>
      </button>`).join("");
    els.sidebar.hidden = list.length === 0;
  }
  function playerVideo() { return els.frame.querySelector("video"); }
  function nextVideo() {
    const list = filteredVideos();
    const index = list.findIndex((video) => video.id === state.currentId);
    return (index >= 0 && list[index + 1]) || mostViewed(state.currentId)[0] || null;
  }
  function hideUpNext() { clearInterval(hideUpNext.timer); els.upNext.hidden = true; }
  function showUpNext(video) {
    els.upNextTitle.textContent = video.title;
    els.upNext.hidden = false;
    els.upNextCancel.hidden = !state.autoplay;
    if (!state.autoplay) { els.upNextKicker.textContent = "הסרטון הבא"; return; }
    state.countdown = AUTOPLAY_DELAY;
    els.upNextKicker.textContent = `מתחיל בעוד ${state.countdown} שניות`;
    clearInterval(hideUpNext.timer);
    hideUpNext.timer = setInterval(() => {
      state.countdown -= 1;
      if (state.countdown <= 0) { hideUpNext(); openPlayer(video.id); return; }
      els.upNextKicker.textContent = `מתחיל בעוד ${state.countdown} שניות`;
    }, 1000);
  }
  function openPlayer(id) {
    const video = state.videos.find((item) => item.id === id); if (!video) return;
    hideUpNext();
    video.views += 1; persistVideo(video); state.currentId = id;
    els.playingTitle.textContent = video.title; els.playingCategory.textContent = video.category;
    els.frame.innerHTML = `<video src="${escapeHtml(video.src)}" controls controlslist="nofullscreen" disablepictureinpicture autoplay playsinline></video>`;
    playerVideo().addEventListener("ended", () => { const next = nextVideo(); if (next) showUpNext(next); });
    els.player.hidden = false; document.body.style.overflow = "hidden"; updatePlayerButtons(); render();
  }
  async function closePlayer() {
    hideUpNext();
    if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch { /* לא קריטי */ } }
    const video = playerVideo(); if (video) { video.pause(); video.removeAttribute("src"); video.load(); }
    els.frame.innerHTML = ""; els.player.hidden = true; state.currentId = null; document.body.style.overflow = "";
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else els.stage.requestFullscreen?.().catch(() => showToast("הדפדפן לא אישר מסך מלא"));
  }
  function syncFullscreenButton() {
    const active = document.fullscreenElement === els.stage;
    els.fullscreen.textContent = active ? "⤡" : "⛶";
    const label = active ? "יציאה ממסך מלא" : "מסך מלא";
    els.fullscreen.setAttribute("aria-label", label); els.fullscreen.title = label;
  }
  function updatePlayerButtons() {
    const list = filteredVideos(); const index = list.findIndex((video) => video.id === state.currentId); const current = list[index];
    els.previous.disabled = index <= 0; els.next.disabled = index < 0 || index >= list.length - 1; els.favoritePlaying.textContent = current?.favorite ? "★" : "☆";
  }
  function stepPlayer(direction) { const list = filteredVideos(); const index = list.findIndex((video) => video.id === state.currentId); const video = list[index + direction]; if (video) openPlayer(video.id); }
  function toggleFavorite(id) {
    const video = state.videos.find((item) => item.id === id); if (!video) return;
    video.favorite = !video.favorite; persistVideo(video); render(); if (state.currentId === id) updatePlayerButtons(); showToast(video.favorite ? "נוסף למועדפים" : "הוסר מהמועדפים");
  }
  function openEditor(id) {
    const video = state.videos.find((item) => item.id === id); if (!video) return;
    state.editId = id; els.editTitle.textContent = video.title; els.editCategory.value = video.category; els.editTags.value = video.tags.join(", "); els.editDialog.showModal();
  }
  function saveEdit(event) {
    event.preventDefault(); const video = state.videos.find((item) => item.id === state.editId); if (!video) return;
    video.category = els.editCategory.value.trim() || "סרטונים";
    video.tags = [...new Set(els.editTags.value.split(",").map((tag) => tag.trim()).filter(Boolean))];
    persistVideo(video); els.editDialog.close(); render(); showToast("השינויים נשמרו");
  }
  els.lock.addEventListener("click", () => {
    if (state.parentMode) { state.parentMode = false; render(); showToast("מצב הורים ננעל"); }
    else { els.parentForm.reset(); els.pinError.hidden = true; els.parentDialog.showModal(); setTimeout(() => els.pin.focus(), 50); }
  });
  els.parentForm.addEventListener("submit", (event) => {
    event.preventDefault(); if (els.pin.value !== PIN) { els.pinError.hidden = false; els.pin.select(); return; }
    state.parentMode = true; els.parentDialog.close(); render(); showToast("מצב הורים פתוח");
  });
  els.refresh.addEventListener("click", () => loadVideos(true));
  els.editForm.addEventListener("submit", saveEdit);
  els.search.addEventListener("input", () => { state.search = els.search.value; render(); });
  els.chips.addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (button) { state.category = button.dataset.category; render(); } });
  els.grid.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action; const id = event.target.closest("[data-id]")?.dataset.id;
    if (action === "play") openPlayer(id); if (action === "favorite") toggleFavorite(id); if (action === "edit") openEditor(id);
  });
  els.sidebarList.addEventListener("click", (event) => { const id = event.target.closest("[data-play]")?.dataset.play; if (id) openPlayer(id); });
  els.autoplayToggle.addEventListener("change", () => {
    state.autoplay = els.autoplayToggle.checked;
    localStorage.setItem(AUTOPLAY_KEY, state.autoplay ? "on" : "off");
    if (!els.upNext.hidden) { const next = nextVideo(); hideUpNext(); if (next) showUpNext(next); }
    showToast(state.autoplay ? "הסרטון הבא יופעל אוטומטית" : "הסרטון הבא יחכה לבחירה");
  });
  els.upNextPlay.addEventListener("click", () => { const next = nextVideo(); hideUpNext(); if (next) openPlayer(next.id); });
  els.upNextCancel.addEventListener("click", hideUpNext);
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
  els.closePlayer.addEventListener("click", closePlayer);
  els.fullscreen.addEventListener("click", toggleFullscreen);
  els.frame.addEventListener("dblclick", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  els.previous.addEventListener("click", () => stepPlayer(-1)); els.next.addEventListener("click", () => stepPlayer(1));
  els.favoritePlaying.addEventListener("click", () => toggleFavorite(state.currentId));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || els.player.hidden) return;
    if (document.fullscreenElement) return; // הדפדפן יוצא ממסך מלא, הנגן נשאר פתוח
    if (!els.upNext.hidden) { hideUpNext(); return; }
    closePlayer();
  });
  loadMetadata(); loadVideos(); setInterval(() => fetch("/__ping", { cache: "no-store" }).catch(() => {}), 30000);
})();
