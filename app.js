(() => {
  "use strict";
  const STORAGE_KEY = "tubekids.local-library.v1";
  const AUTOPLAY_KEY = "tubekids.autoplay.v1";
  const PIN = "1234";
  const AUTOPLAY_DELAY = 5;
  const THUMB_TIME = 20;      // השנייה שממנה נלקחת התמונה הממוזערת
  const PREVIEW_LENGTH = 6;   // אורך התצוגה המקדימה בריחוף, בשניות
  const state = { videos: [], metadata: {}, category: "all", search: "", parentMode: false, currentId: null, editId: null, autoplay: true, countdown: 0 };
  const durations = new Map();
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
    upNext: $("#upNextCard"), upNextKicker: $("#upNextKicker"), upNextTitle: $("#upNextTitle"), upNextPlay: $("#upNextPlay"),
    upNextCancel: $("#upNextCancel"), upNextProgress: $("#upNextProgress")?.firstElementChild, searchBox: $("#searchBox"),
    upNextThumb: $("#upNextThumb")
  };

  /* ---------- עזרי תצוגה ---------- */
  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  }
  function icon(name, className = "icon") {
    return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  }
  function setIcon(button, name) {
    button.querySelector("use")?.setAttribute("href", `#i-${name}`);
  }
  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const total = Math.round(seconds);
    const minutes = Math.floor(total / 60);
    const rest = String(total % 60).padStart(2, "0");
    if (minutes < 60) return `${minutes}:${rest}`;
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${rest}`;
  }

  /* ---------- מטא־דאטה מקומית ---------- */
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

  /* ---------- טעינת הספרייה ---------- */
  async function loadVideos(showMessage = false) {
    if (showMessage) els.refresh.classList.add("is-busy");
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
    } finally {
      els.refresh.classList.remove("is-busy");
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

  /* ---------- רינדור ---------- */
  function cardMarkup(video, index) {
    const duration = durations.get(video.id);
    return `
      <article class="video-card" data-id="${escapeHtml(video.id)}" style="animation-delay:${Math.min(index * 35, 280)}ms">
        <button class="favorite-button${video.favorite ? " active" : ""}" data-action="favorite" type="button"
          aria-pressed="${video.favorite}" aria-label="${video.favorite ? "הסרה מהמועדפים" : "הוספה למועדפים"}"
          title="${video.favorite ? "הסרה מהמועדפים" : "הוספה למועדפים"}">${icon(video.favorite ? "star-fill" : "star")}</button>
        <button class="thumb-button local-thumb" data-action="play" type="button" aria-label="ניגון ${escapeHtml(video.title)}">
          <video src="${escapeHtml(video.src)}" preload="none" muted playsinline tabindex="-1" data-preview></video>
          <span class="play-badge" aria-hidden="true">${icon("play")}</span>
          <span class="duration-badge"${duration ? "" : " hidden"}>${escapeHtml(duration || "")}</span>
        </button>
        <div class="card-body">
          <h2>${escapeHtml(video.title)}</h2>
          <span class="category-label">${escapeHtml(video.category)}</span>
          ${state.parentMode ? `<div class="card-actions"><button class="small-action" data-action="edit" type="button">${icon("edit")}עריכה</button></div>` : ""}
        </div>
      </article>`;
  }
  function render() {
    document.querySelectorAll(".parent-only").forEach((element) => { element.hidden = !state.parentMode; });
    document.body.classList.toggle("parent-mode", state.parentMode);
    els.parentBadge.hidden = !state.parentMode;
    setIcon(els.lock, state.parentMode ? "unlock" : "lock");
    const lockLabel = state.parentMode ? "יציאה ממצב הורים" : "כניסה למצב הורים";
    els.lock.setAttribute("aria-label", lockLabel);
    els.lock.title = lockLabel;
    els.notice.hidden = !state.parentMode;

    const categories = [...new Set(state.videos.map((video) => video.category))].sort((a, b) => a.localeCompare(b, "he"));
    const chips = [{ key: "all", label: "הכל" }, { key: "favorites", label: "מועדפים", icon: "star-fill", className: "chip-favorites" },
      ...categories.map((category) => ({ key: category, label: category }))];
    els.chips.innerHTML = chips.map((chip) => `<button class="chip${chip.className ? ` ${chip.className}` : ""}${state.category === chip.key ? " active" : ""}" data-category="${escapeHtml(chip.key)}" type="button" aria-pressed="${state.category === chip.key}">${chip.icon ? icon(chip.icon) : ""}${escapeHtml(chip.label)}</button>`).join("");
    els.categoryOptions.innerHTML = categories.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
    els.toolbar.hidden = state.videos.length === 0;
    els.searchBox.hidden = state.videos.length === 0;

    const visible = filteredVideos();
    els.grid.innerHTML = visible.map(cardMarkup).join("");
    setupPreviews(els.grid);
    const noMatches = state.videos.length > 0 && visible.length === 0;
    els.empty.hidden = state.videos.length > 0 && !noMatches;
    if (noMatches) {
      els.emptyTitle.textContent = "לא מצאנו סרטון מתאים";
      els.emptyText.textContent = "אפשר לנסות חיפוש אחר או לבחור קטגוריה אחרת.";
    } else if (!state.videos.length) {
      els.emptyTitle.textContent = "תיקיית הסרטונים עדיין ריקה";
      els.emptyText.textContent = "העתיקו קובצי וידאו לתיקיית המקור והפעילו רענון במצב הורים.";
    }
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
        <video src="${escapeHtml(video.src)}" preload="none" muted playsinline tabindex="-1" data-preview></video>
        <span><strong>${escapeHtml(video.title)}</strong><small>${escapeHtml(video.category)}</small></span>
      </button>`).join("");
    els.sidebar.hidden = list.length === 0;
    setupPreviews(els.sidebarList);
  }

  /* ---------- תמונה ממוזערת ותצוגה מקדימה ---------- */
  function previewStart(element) {
    const duration = element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return duration > THUMB_TIME + 1 ? THUMB_TIME : Math.max(0, duration / 2);
  }
  function seekToPoster(element) {
    try { element.currentTime = previewStart(element); } catch { /* עוד אין מטא־דאטה */ }
  }
  function preparePoster(element) {
    if (element.readyState >= 1) { seekToPoster(element); return; }
    element.addEventListener("loadedmetadata", () => seekToPoster(element), { once: true });
    element.preload = "metadata";
    element.load();
  }
  function stopPreview(element) {
    element.dataset.previewing = "";
    element.pause();
    seekToPoster(element);
  }
  function startPreview(element) {
    element.muted = true;
    element.dataset.previewing = "1";
    const begin = () => {
      if (!element.dataset.previewing) return;
      seekToPoster(element);
      element.play().catch(() => { element.dataset.previewing = ""; });
    };
    if (element.readyState >= 1) begin();
    else { element.addEventListener("loadedmetadata", begin, { once: true }); preparePoster(element); }
  }
  // השרת המקומי מטפל בבקשה אחת בכל פעם, ולכן טוענים תמונות ממוזערות רק כשהן מתקרבות למסך
  const posterObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      posterObserver.unobserve(entry.target);
      preparePoster(entry.target);
    });
  }, { rootMargin: "300px" });
  function setupPreviews(container) {
    container.querySelectorAll("video[data-preview]").forEach((element) => {
      posterObserver.observe(element);
      element.addEventListener("timeupdate", () => {
        if (!element.dataset.previewing) return;
        const start = previewStart(element);
        if (element.currentTime > start + PREVIEW_LENGTH) element.currentTime = start;
      });
      const hoverTarget = element.parentElement;
      hoverTarget.addEventListener("pointerenter", () => startPreview(element));
      hoverTarget.addEventListener("pointerleave", () => stopPreview(element));
    });
  }

  /* ---------- אורך סרטון מהקובץ המקומי ---------- */
  function captureDuration(event) {
    const media = event.target;
    if (!(media instanceof HTMLVideoElement)) return;
    const card = media.closest("[data-id]");
    if (!card) return;
    const text = formatDuration(media.duration);
    if (!text) return;
    durations.set(card.dataset.id, text);
    const badge = card.querySelector(".duration-badge");
    if (badge) { badge.textContent = text; badge.hidden = false; }
  }

  /* ---------- נגן ---------- */
  function playerVideo() { return els.frame.querySelector("video"); }
  function nextVideo() {
    const list = filteredVideos();
    const index = list.findIndex((video) => video.id === state.currentId);
    return (index >= 0 && list[index + 1]) || mostViewed(state.currentId)[0] || null;
  }
  function hideUpNext() { clearInterval(hideUpNext.timer); els.upNext.hidden = true; }
  function showUpNext(video) {
    els.upNextTitle.textContent = video.title;
    if (els.upNextThumb) els.upNextThumb.src = `${video.src}#t=${THUMB_TIME}`;
    els.upNext.hidden = false;
    els.upNextCancel.hidden = !state.autoplay;
    els.upNextProgress.parentElement.hidden = !state.autoplay;
    if (!state.autoplay) { els.upNextKicker.textContent = "הסרטון הבא"; return; }
    state.countdown = AUTOPLAY_DELAY;
    els.upNextKicker.textContent = `מתחיל בעוד ${state.countdown} שניות`;
    els.upNextProgress.style.width = "100%";
    clearInterval(hideUpNext.timer);
    hideUpNext.timer = setInterval(() => {
      state.countdown -= 1;
      els.upNextProgress.style.width = `${Math.max(0, (state.countdown / AUTOPLAY_DELAY) * 100)}%`;
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
    setIcon(els.fullscreen, active ? "collapse" : "expand");
    const label = active ? "יציאה ממסך מלא" : "מסך מלא";
    els.fullscreen.setAttribute("aria-label", label); els.fullscreen.title = label;
  }
  function updatePlayerButtons() {
    const list = filteredVideos();
    const index = list.findIndex((video) => video.id === state.currentId);
    const current = list[index];
    els.previous.disabled = index <= 0;
    els.next.disabled = index < 0 || index >= list.length - 1;
    const favorite = Boolean(current?.favorite);
    setIcon(els.favoritePlaying, favorite ? "star-fill" : "star");
    els.favoritePlaying.classList.toggle("is-on", favorite);
    els.favoritePlaying.setAttribute("aria-pressed", String(favorite));
    const favoriteLabel = favorite ? "הסרה מהמועדפים" : "הוספה למועדפים";
    els.favoritePlaying.setAttribute("aria-label", favoriteLabel);
    els.favoritePlaying.title = favoriteLabel;
    els.sidebarList.querySelectorAll(".sidebar-item").forEach((item) => {
      item.classList.toggle("is-playing", item.dataset.play === state.currentId);
    });
  }
  function stepPlayer(direction) {
    const list = filteredVideos();
    const index = list.findIndex((video) => video.id === state.currentId);
    const video = list[index + direction];
    if (video) openPlayer(video.id);
  }

  /* ---------- מועדפים ועריכה ---------- */
  function pulse(element) {
    if (!element) return;
    element.classList.remove("pop");
    void element.offsetWidth;
    element.classList.add("pop");
  }
  function toggleFavorite(id) {
    const video = state.videos.find((item) => item.id === id); if (!video) return;
    video.favorite = !video.favorite; persistVideo(video); render();
    if (state.currentId === id) { updatePlayerButtons(); pulse(els.favoritePlaying); }
    pulse(els.grid.querySelector(`[data-id="${CSS.escape(id)}"] .favorite-button`));
    showToast(video.favorite ? "נוסף למועדפים" : "הוסר מהמועדפים");
  }
  function openEditor(id) {
    const video = state.videos.find((item) => item.id === id); if (!video) return;
    state.editId = id; els.editTitle.textContent = video.title; els.editCategory.value = video.category;
    els.editTags.value = video.tags.join(", "); els.editDialog.showModal();
  }
  function saveEdit(event) {
    event.preventDefault();
    const video = state.videos.find((item) => item.id === state.editId); if (!video) return;
    video.category = els.editCategory.value.trim() || "סרטונים";
    video.tags = [...new Set(els.editTags.value.split(",").map((tag) => tag.trim()).filter(Boolean))];
    persistVideo(video); els.editDialog.close(); render(); showToast("השינויים נשמרו");
  }

  /* ---------- אירועים ---------- */
  els.lock.addEventListener("click", () => {
    if (state.parentMode) { state.parentMode = false; render(); showToast("מצב הורים ננעל"); }
    else { els.parentForm.reset(); els.pinError.hidden = true; els.parentDialog.showModal(); setTimeout(() => els.pin.focus(), 50); }
  });
  els.parentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (els.pin.value !== PIN) {
      els.pinError.hidden = false; els.pin.select();
      els.parentDialog.classList.remove("shake"); void els.parentDialog.offsetWidth; els.parentDialog.classList.add("shake");
      return;
    }
    state.parentMode = true; els.parentDialog.close(); render(); showToast("מצב הורים פתוח");
  });
  els.refresh.addEventListener("click", () => loadVideos(true));
  els.editForm.addEventListener("submit", saveEdit);
  els.search.addEventListener("input", () => { state.search = els.search.value; render(); });
  els.chips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (button) { state.category = button.dataset.category; render(); }
  });
  els.grid.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    const id = event.target.closest("[data-id]")?.dataset.id;
    if (action === "play") openPlayer(id);
    if (action === "favorite") toggleFavorite(id);
    if (action === "edit") openEditor(id);
  });
  els.grid.addEventListener("loadedmetadata", captureDuration, true);
  els.sidebarList.addEventListener("click", (event) => {
    const id = event.target.closest("[data-play]")?.dataset.play;
    if (id) openPlayer(id);
  });
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
  els.previous.addEventListener("click", () => stepPlayer(-1));
  els.next.addEventListener("click", () => stepPlayer(1));
  els.favoritePlaying.addEventListener("click", () => toggleFavorite(state.currentId));
  document.addEventListener("keydown", (event) => {
    if (els.player.hidden) return;
    if (event.key === "Escape") {
      if (document.fullscreenElement) return; // הדפדפן יוצא ממסך מלא, הנגן נשאר פתוח
      if (!els.upNext.hidden) { hideUpNext(); return; }
      closePlayer();
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowRight" && !els.previous.disabled) { stepPlayer(-1); return; }
    if (event.key === "ArrowLeft" && !els.next.disabled) stepPlayer(1);
  });

  syncFullscreenButton();
  loadMetadata();
  loadVideos().finally(() => window.TubeKidsSplash?.ready());
  setInterval(() => fetch("/__ping", { cache: "no-store" }).catch(() => {}), 30000);
})();
