(() => {
  "use strict";
  const STORAGE_KEY = "tubekids.local-library.v1";
  const AUTOPLAY_KEY = "tubekids.autoplay.v1";
  const PIN = "1234";
  const AUTOPLAY_DELAY = 5;
  const DEFAULT_CATEGORY_IMAGE = "assets/category-default.jpg";
  const CATEGORY_IMAGE_FALLBACK = "assets/tubekids-logo.png";
  const ROOT_CATEGORY = "סרטונים";   // הקטגוריה של קבצים שיושבים ישר בתיקיית המקור
  const THUMB_TIME = 20;      // השנייה שממנה נלקחת התמונה הממוזערת
  const PREVIEW_LENGTH = 6;   // אורך התצוגה המקדימה בריחוף, בשניות
  const state = { videos: [], categories: [], metadata: {}, category: "categories", search: "", parentMode: false, currentId: null, editId: null, autoplay: true, countdown: 0 };
  const durations = new Map();
  let tapTimer = 0;
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
    upNextThumb: $("#upNextThumb"), stageFeedback: $("#stageFeedback"),
    stageFullscreen: $("#stageFullscreen")
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
    const relativePath = String(file.id || "").replace(/^file:/, "");
    const inferredFolder = relativePath.includes("/") ? relativePath.split("/")[0] : null;
    return { ...file, folder: file.folder || inferredFolder || ROOT_CATEGORY, title: saved.title || file.title, category: saved.category || file.category || ROOT_CATEGORY,
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
      state.videos.forEach((video) => {
        const text = formatDuration(video.duration);
        if (text) durations.set(video.id, text);
      });
      const receivedCategories = Array.isArray(data.categories) ? data.categories :
        [...new Set(state.videos.map((video) => video.folder).filter(Boolean))].map((name) => ({ name }));
      state.categories = receivedCategories.map((category) => ({
        name: category.name,
        image: category.image || DEFAULT_CATEGORY_IMAGE
      }));
      // סרטונים שלא בתוך תיקייה מקבלים קטגוריה משלהם, אחרת אין דרך להגיע אליהם
      // ממסך הקטגוריות. היא נכנסת אחרונה, אחרי התיקיות האמיתיות.
      const hasLooseVideos = state.videos.some((video) => video.folder === ROOT_CATEGORY);
      if (hasLooseVideos && !state.categories.some((category) => category.name === ROOT_CATEGORY)) {
        state.categories.push({ name: ROOT_CATEGORY, image: DEFAULT_CATEGORY_IMAGE });
      }
      // בלי תיקיות משנה אין מה להציג במסך הקטגוריות, ולכן נפתחת ישר הספרייה כולה
      if (state.category === "categories" && state.categories.length === 0) state.category = "all";
      els.storageText.textContent = `תיקיית מקור: ${data.folder} — נמצאו ${state.videos.length} סרטונים`;
      els.storageDot.classList.add("connected");
      render();
      if (showMessage) showToast("רשימת הסרטונים עודכנה");
    } catch (error) {
      state.videos = [];
      state.categories = [];
      state.category = "all";   // אחרת מסך הקטגוריות הריק מסתיר את הודעת התקלה
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
      if (!["all", "favorites", "categories"].includes(state.category) && video.folder !== state.category) return false;
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
          <img class="thumb-image" src="${escapeHtml(video.thumb || "")}" alt="" loading="lazy" decoding="async"
            onerror="if(this.dataset.fallback)return;this.dataset.fallback='1';this.src='${CATEGORY_IMAGE_FALLBACK}'">
          <span class="play-badge" aria-hidden="true">${icon("play")}</span>
          <span class="duration-badge"${duration ? "" : " hidden"}>${escapeHtml(duration || "")}</span>
        </button>
        <div class="card-body">
          <h2>${escapeHtml(video.title)}</h2>
          ${state.parentMode ? `<span class="category-label">${escapeHtml(video.category)}</span>` : ""}
          ${state.parentMode ? `<div class="card-actions"><button class="small-action" data-action="edit" type="button">${icon("edit")}עריכה</button></div>` : ""}
        </div>
      </article>`;
  }
  function categoryMarkup(category, index) {
    const count = state.videos.filter((video) => video.folder === category.name).length;
    const label = count === 1 ? "סרטון אחד" : `${count} סרטונים`;
    return `
      <button class="category-card" data-open-category="${escapeHtml(category.name)}" type="button"
        aria-label="פתיחת הקטגוריה ${escapeHtml(category.name)}" style="animation-delay:${Math.min(index * 45, 315)}ms">
        <img src="${escapeHtml(category.image)}" alt="" loading="lazy"
          onerror="if(this.dataset.fallback)return;this.dataset.fallback='1';this.src='${CATEGORY_IMAGE_FALLBACK}'">
        <span class="category-card-shade" aria-hidden="true"></span>
        <span class="category-card-copy"><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(label)}</small></span>
      </button>`;
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

    const categoryNames = state.categories.map((category) => category.name);
    const chips = [
      { key: "categories", label: "קטגוריות", icon: "folder" },
      { key: "all", label: "הכל" },
      { key: "favorites", label: "מועדפים", icon: "star-fill", className: "chip-favorites" }
    ];
    els.chips.innerHTML = chips.map((chip) => {
      const active = chip.key === "categories" ? !["all", "favorites"].includes(state.category) : state.category === chip.key;
      return `<button class="chip${chip.className ? ` ${chip.className}` : ""}${active ? " active" : ""}" data-category="${chip.key}" type="button" aria-pressed="${active}">${chip.icon ? icon(chip.icon) : ""}${chip.label}</button>`;
    }).join("");
    els.categoryOptions.innerHTML = categoryNames.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("");
    els.toolbar.hidden = state.videos.length === 0 && state.categories.length === 0;
    els.searchBox.hidden = state.videos.length === 0;

    const visible = filteredVideos();
    const showingCategories = state.category === "categories";
    els.grid.classList.toggle("category-grid", showingCategories);
    els.grid.innerHTML = showingCategories ? state.categories.map(categoryMarkup).join("") : visible.map(cardMarkup).join("");
    if (!showingCategories) setupCards(els.grid);
    const noMatches = !showingCategories && state.videos.length > 0 && visible.length === 0;
    const noCategories = showingCategories && state.categories.length === 0;
    els.empty.hidden = showingCategories ? !noCategories : (state.videos.length > 0 && !noMatches);
    if (noMatches) {
      els.emptyTitle.textContent = "לא מצאנו סרטון מתאים";
      els.emptyText.textContent = "אפשר לנסות חיפוש אחר או לבחור קטגוריה אחרת.";
    } else if (noCategories) {
      els.emptyTitle.textContent = "עדיין אין קטגוריות";
      els.emptyText.textContent = "כל תיקייה שתיצרו בתוך תיקיית המקור תופיע כאן כקטגוריה.";
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
    stopPreview();
    const list = mostViewed(state.currentId).slice(0, 30);
    els.sidebarList.innerHTML = list.map((video) => `
      <button class="sidebar-item" data-play="${escapeHtml(video.id)}" type="button">
        <span class="sidebar-thumb">
          <img src="${escapeHtml(video.thumb || "")}" alt="" loading="lazy" decoding="async"
            onerror="if(this.dataset.fallback)return;this.dataset.fallback='1';this.src='${CATEGORY_IMAGE_FALLBACK}'">
        </span>
        <span class="sidebar-copy"><strong>${escapeHtml(video.title)}</strong><small>${escapeHtml(video.category)}</small></span>
      </button>`).join("");
    els.sidebar.hidden = list.length === 0;
    setupSidebarPreviews();
  }

  /* ---------- תצוגה מקדימה בריחוף ---------- */
  // התמונות הממוזערות מגיעות מהשרת כ־JPEG, ולכן אין יותר עשרות חיבורי וידאו במקביל.
  // תצוגה מקדימה נוצרת רק בריחוף, אחת בכל רגע, ומתפרקת ביציאה.
  let activePreview = null;
  function previewStart(element) {
    const duration = element.duration;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    return duration > THUMB_TIME + 1 ? THUMB_TIME : Math.max(0, duration / 2);
  }
  function seekTo(element, seconds) {
    try { element.currentTime = seconds; } catch { /* עוד אין מטא־דאטה */ }
  }
  function stopPreview() {
    if (!activePreview) return;
    const element = activePreview;
    activePreview = null;
    element.pause();
    element.removeAttribute("src");
    element.load();   // סוגר את החיבור לשרת במקום להשאיר אותו תלוי
    element.remove();
  }
  function startPreview(button, video) {
    stopPreview();
    const element = document.createElement("video");
    element.className = "thumb-preview";
    element.muted = true;
    element.playsInline = true;
    element.preload = "metadata";
    element.tabIndex = -1;
    element.addEventListener("loadedmetadata", () => {
      if (activePreview !== element) return;
      seekTo(element, previewStart(element));
      element.play().catch(() => stopPreview());
    }, { once: true });
    element.addEventListener("timeupdate", () => {
      const begin = previewStart(element);
      if (element.currentTime > begin + PREVIEW_LENGTH) seekTo(element, begin);
    });
    element.src = video.src;
    button.prepend(element);   // מתחת לתגי הפליי והאורך, מעל התמונה הממוזערת
    activePreview = element;
  }
  function setupCards(container) {
    container.querySelectorAll(".thumb-button").forEach((button) => {
      const id = button.closest("[data-id]")?.dataset.id;
      const video = state.videos.find((item) => item.id === id);
      if (!video) return;
      button.addEventListener("pointerenter", () => startPreview(button, video));
      button.addEventListener("pointerleave", stopPreview);
    });
  }
  function setupSidebarPreviews() {
    els.sidebarList.querySelectorAll(".sidebar-item").forEach((item) => {
      const video = state.videos.find((candidate) => candidate.id === item.dataset.play);
      const target = item.querySelector(".sidebar-thumb");
      if (!video || !target) return;
      item.addEventListener("pointerenter", () => startPreview(target, video));
      item.addEventListener("pointerleave", stopPreview);
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
    if (els.upNextThumb) els.upNextThumb.src = video.thumb || CATEGORY_IMAGE_FALLBACK;
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
    stopPreview();
    hideUpNext();
    video.views += 1; persistVideo(video); state.currentId = id;
    els.playingTitle.textContent = video.title; els.playingCategory.textContent = video.category;
    els.frame.innerHTML = `<video src="${escapeHtml(video.src)}" controls controlslist="nofullscreen" disablepictureinpicture autoplay playsinline></video>`;
    const element = playerVideo();
    element.addEventListener("ended", () => { const next = nextVideo(); if (next) showUpNext(next); });
    element.addEventListener("click", (event) => {
      if (onNativeControls(event)) return;   // לחיצה על פס הפקדים של הדפדפן
      nudgeStageControls();
      clearTimeout(tapTimer);
      tapTimer = setTimeout(togglePlay, 220);   // לחיצה בודדת = הפעלה/עצירה
    });
    element.addEventListener("dblclick", (event) => {
      if (onNativeControls(event)) return;
      clearTimeout(tapTimer);
      toggleFullscreen();                       // לחיצה כפולה = מסך מלא
    });
    els.player.hidden = false; document.body.style.overflow = "hidden"; updatePlayerButtons(); render();
  }
  async function closePlayer() {
    stopPreview();
    hideUpNext();
    clearTimeout(tapTimer);
    els.stage.classList.remove("show-controls");
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
    const label = active ? "יציאה ממסך מלא (F)" : "מסך מלא (F)";
    [els.fullscreen, els.stageFullscreen].forEach((button) => {
      setIcon(button, active ? "collapse" : "expand");
      button.setAttribute("aria-label", label); button.title = label;
    });
    const text = els.fullscreen.querySelector("span");
    if (text) text.textContent = active ? "יציאה" : "מסך מלא";
    if (active) nudgeStageControls();
  }

  /* ---------- שליטה בסרטון ---------- */
  function onNativeControls(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const strip = document.fullscreenElement ? 90 : 70;
    return event.clientY > rect.bottom - strip;
  }
  function nudgeStageControls() {
    els.stage.classList.add("show-controls");
    clearTimeout(nudgeStageControls.timer);
    nudgeStageControls.timer = setTimeout(() => els.stage.classList.remove("show-controls"), 2500);
  }
  function flashFeedback(name) {
    setIcon(els.stageFeedback, name);
    els.stageFeedback.classList.remove("flash");
    void els.stageFeedback.offsetWidth;
    els.stageFeedback.classList.add("flash");
  }
  function togglePlay() {
    const video = playerVideo(); if (!video) return;
    if (video.paused || video.ended) { video.play().catch(() => {}); flashFeedback("play"); }
    else { video.pause(); flashFeedback("pause"); }
  }
  function seekBy(seconds) {
    const video = playerVideo(); if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.min(Math.max(video.currentTime + seconds, 0), video.duration);
    flashFeedback(seconds > 0 ? "chevron-end" : "chevron-start");
  }
  function seekToRatio(ratio) {
    const video = playerVideo(); if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = video.duration * ratio;
  }
  function changeVolume(delta) {
    const video = playerVideo(); if (!video) return;
    video.muted = false;
    video.volume = Math.min(Math.max(video.volume + delta, 0), 1);
    flashFeedback("volume");
  }
  function toggleMute() {
    const video = playerVideo(); if (!video) return;
    video.muted = !video.muted;
    flashFeedback(video.muted ? "mute" : "volume");
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
  els.search.addEventListener("input", () => {
    state.search = els.search.value;
    if (state.search) state.category = "all";
    if (!els.player.hidden) closePlayer();
    render();
  });
  els.chips.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (button) { state.category = button.dataset.category; render(); }
  });
  els.grid.addEventListener("click", (event) => {
    const category = event.target.closest("[data-open-category]")?.dataset.openCategory;
    if (category) { state.category = category; render(); return; }
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
  els.stageFullscreen.addEventListener("click", toggleFullscreen);
  els.stage.addEventListener("mousemove", nudgeStageControls);
  els.stage.addEventListener("touchstart", nudgeStageControls, { passive: true });
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
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;

    const key = event.key.toLowerCase();
    const handled = () => { event.preventDefault(); nudgeStageControls(); };

    if (key === " " || key === "spacebar" || key === "k") { handled(); togglePlay(); return; }
    if (key === "f") { handled(); toggleFullscreen(); return; }
    if (key === "m") { handled(); toggleMute(); return; }
    if (key === "arrowright") { handled(); seekBy(5); return; }
    if (key === "arrowleft") { handled(); seekBy(-5); return; }
    if (key === "l") { handled(); seekBy(10); return; }
    if (key === "j") { handled(); seekBy(-10); return; }
    if (key === "arrowup") { handled(); changeVolume(0.1); return; }
    if (key === "arrowdown") { handled(); changeVolume(-0.1); return; }
    if (key === "home") { handled(); seekToRatio(0); return; }
    if (key === "end") { handled(); seekToRatio(0.999); return; }
    if (/^[0-9]$/.test(key)) { handled(); seekToRatio(Number(key) / 10); return; }
    if (key === "n" && !els.next.disabled) { handled(); stepPlayer(1); return; }
    if (key === "p" && !els.previous.disabled) { handled(); stepPlayer(-1); }
  });

  syncFullscreenButton();
  const syncTopbarHeight = () => document.documentElement.style.setProperty("--topbar-height", `${document.querySelector(".topbar").offsetHeight}px`);
  new ResizeObserver(syncTopbarHeight).observe(document.querySelector(".topbar"));
  syncTopbarHeight();
  loadMetadata();
  loadVideos().finally(() => window.TubeKidsSplash?.ready());
  setInterval(() => fetch("/__ping", { cache: "no-store" }).catch(() => {}), 30000);
})();
