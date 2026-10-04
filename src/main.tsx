import { createRoot } from "react-dom/client";
import App from "./app/App";
import { isPasswordRecoveryUrl } from "./lib/password-recovery";
import { registerCocoaBlushPaletteTheme } from "./app/lib/cocoa-blush-theme";
import { registerFrenchMatchaPaletteTheme } from "./app/lib/french-matcha-theme";
import { isDynamicImportError, reloadLatestAppVersion } from "./app/lib/lazy-routes";
import "./index.css";
import "./table-border-zero.css";
import "./title-alignment.css";

declare global {
  interface Window {
    __SUPABASE_CONFIG__?: {
      url: string;
      anonKey: string;
    };
  }
}

window.addEventListener("vite:preloadError", (event: Event) => {
  const preloadError = (event as Event & { payload?: unknown }).payload;
  if (!isDynamicImportError(preloadError)) return;
  event.preventDefault();
  reloadLatestAppVersion("vite-preload");
});

const staticSupabaseConfig = {
  url: import.meta.env.VITE_SUPABASE_URL || "",
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || "",
};

function isValidSupabaseConfig(config: { url?: string; anonKey?: string }) {
  if (!config.url || !config.anonKey) return false;
  try {
    new URL(config.url);
    return !config.url.includes("placeholder") && !config.anonKey.includes("placeholder");
  } catch {
    return false;
  }
}

async function loadDynamicSupabaseConfig() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch("/api/supabase-config", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("application/json")) {
      return;
    }

    const data = await response.json();
    if (isValidSupabaseConfig(data)) {
      window.__SUPABASE_CONFIG__ = data;
      try { localStorage.setItem('payroll_supabase_public_config', JSON.stringify(data)); } catch { /* Storage can be unavailable. */ }
    }
  } catch (err) {
    if (!(err instanceof DOMException && err.name === "AbortError")) {
      console.warn("[Supabase Config] Không thể tải cấu hình động; đang dùng cấu hình build-time.");
    }
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function start() {
  const recovery = isPasswordRecoveryUrl(window.location.href);
  registerCocoaBlushPaletteTheme();
  registerFrenchMatchaPaletteTheme();

  if (isValidSupabaseConfig(staticSupabaseConfig)) {
    window.__SUPABASE_CONFIG__ = staticSupabaseConfig;
  } else {
    try {
      const cached = JSON.parse(localStorage.getItem('payroll_supabase_public_config') || 'null');
      if (cached && isValidSupabaseConfig(cached)) window.__SUPABASE_CONFIG__ = cached;
    } catch { /* Public configuration cache is optional. */ }
    // Resolve configuration before Auth mounts so saved sessions work on every machine.
    await loadDynamicSupabaseConfig();
  }

  if (recovery) {
    const { default: PasswordRecovery } = await import('./app/components/PasswordRecovery');
    createRoot(document.getElementById("root")!).render(<PasswordRecovery />);
  } else {
    createRoot(document.getElementById("root")!).render(<App />);
  }
}

void start();
