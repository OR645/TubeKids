/* הלוגו המונפש ומסך הפתיחה. נטען ב-<head> לפני app.js. */
(() => {
  "use strict";
  const LOGO_VIDEO = "assets/tubekids-logo.webm";
  const LOGO_IMAGE = "assets/tubekids-logo.png";
  const MIN_SPLASH = 1200;   // זמן מינימלי למסך הפתיחה, כדי שלא יהבהב
  const FAILSAFE = 6000;     // גם אם הטעינה נכשלה, לא נישארים תקועים במסך הפתיחה

  class TubeKidsLogo extends HTMLElement {
    connectedCallback() {
      if (this.dataset.ready) return;
      this.dataset.ready = "1";
      this.setAttribute("role", "img");
      const label = this.getAttribute("aria-label") || "TubeKids";
      const video = document.createElement("video");
      video.className = "tk-logo-video";
      video.src = LOGO_VIDEO;
      video.poster = LOGO_IMAGE;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = "auto";
      video.setAttribute("aria-hidden", "true");
      video.addEventListener("error", () => this.showStillImage(label), { once: true });
      this.replaceChildren(video);
      video.play().catch(() => { /* הדפדפן חסם ניגון — הפוסטר נשאר על המסך */ });
    }
    showStillImage(label) {
      const image = document.createElement("img");
      image.className = "tk-logo-video";
      image.src = LOGO_IMAGE;
      image.alt = label;
      this.replaceChildren(image);
    }
  }
  customElements.define("tubekids-logo", TubeKidsLogo);

  const openedAt = Date.now();
  function dismissSplash() {
    const splash = document.getElementById("splash");
    if (!splash || splash.dataset.done) return;
    splash.dataset.done = "1";
    setTimeout(() => {
      splash.classList.add("is-leaving");
      splash.addEventListener("transitionend", () => splash.remove(), { once: true });
      setTimeout(() => splash.remove(), 1200); // אם אין transition, מסירים בכל מקרה
    }, Math.max(0, MIN_SPLASH - (Date.now() - openedAt)));
  }
  window.TubeKidsSplash = { ready: dismissSplash };
  window.addEventListener("load", () => setTimeout(dismissSplash, FAILSAFE));
})();
