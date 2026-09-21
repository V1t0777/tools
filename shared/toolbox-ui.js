(function toolboxUIBootstrap(global) {
  "use strict";

  const THEME_KEY = "toolbox-theme";
  const themeMedia = global.matchMedia("(prefers-color-scheme: dark)");

  function storedTheme(storageKey) {
    try {
      const value = global.localStorage.getItem(storageKey);
      return value === "dark" || value === "light" ? value : null;
    } catch (_) {
      return null;
    }
  }

  function preferredTheme(storageKey) {
    return storedTheme(storageKey) || (themeMedia.matches ? "dark" : "light");
  }

  function applyTheme(theme) {
    const normalized = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = normalized;
    document.documentElement.style.colorScheme = normalized;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = normalized === "dark" ? "#11151e" : "#f5f7fb";
    return normalized;
  }

  function themeIcon(theme) {
    const isDark = theme === "dark";
    const label = isDark ? "切换为浅色模式" : "切换为深色模式";
    const path = isDark
      ? '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path>'
      : '<path d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6 8.5 8.5 0 1 0 20.4 15.2Z"></path>';
    return {
      label,
      svg: `<svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`
    };
  }

  function paintThemeButton(button, theme) {
    if (!button) return;
    const icon = themeIcon(theme);
    button.setAttribute("aria-label", icon.label);
    button.setAttribute("title", icon.label);
    button.innerHTML = icon.svg;
  }

  function initTheme(options) {
    const settings = options || {};
    const storageKey = settings.storageKey || THEME_KEY;
    const button = typeof settings.button === "string"
      ? document.querySelector(settings.button)
      : settings.button;
    let theme = applyTheme(preferredTheme(storageKey));
    paintThemeButton(button, theme);

    function setTheme(nextTheme, persist) {
      theme = applyTheme(nextTheme);
      if (persist !== false) {
        try { global.localStorage.setItem(storageKey, theme); } catch (_) { /* no-op */ }
      }
      paintThemeButton(button, theme);
      document.dispatchEvent(new CustomEvent("toolbox:themechange", { detail: { theme } }));
      return theme;
    }

    if (button) {
      button.addEventListener("click", function toggleTheme() {
        button.classList.remove("is-switching");
        void button.offsetWidth;
        button.classList.add("is-switching");
        setTheme(theme === "dark" ? "light" : "dark", true);
      });
      button.addEventListener("animationend", function endThemeAnimation() {
        button.classList.remove("is-switching");
      });
    }

    const onSystemChange = function onSystemChange(event) {
      if (!storedTheme(storageKey)) setTheme(event.matches ? "dark" : "light", false);
    };
    if (themeMedia.addEventListener) themeMedia.addEventListener("change", onSystemChange);
    else if (themeMedia.addListener) themeMedia.addListener(onSystemChange);

    return { getTheme: () => theme, setTheme };
  }

  function ensureToastRegion() {
    let region = document.querySelector(".tbx-toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "tbx-toast-region";
      region.setAttribute("role", "status");
      region.setAttribute("aria-live", "polite");
      region.setAttribute("aria-atomic", "true");
      document.body.appendChild(region);
    }
    return region;
  }

  function toast(message, options) {
    const settings = options || {};
    const item = document.createElement("div");
    item.className = "tbx-toast";
    item.textContent = String(message);
    ensureToastRegion().appendChild(item);
    const duration = Number(settings.duration) > 0 ? Number(settings.duration) : 2200;
    global.setTimeout(function dismiss() {
      item.classList.add("is-leaving");
      global.setTimeout(() => item.remove(), 220);
    }, duration);
    return item;
  }

  applyTheme(preferredTheme(THEME_KEY));

  global.ToolboxUI = Object.freeze({ initTheme, toast, applyTheme });
})(window);
