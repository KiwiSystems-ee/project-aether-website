(() => {
  "use strict";

  const SUPABASE_URL = window.AETHER_SUPABASE_URL;
  const SUPABASE_KEY = window.AETHER_SUPABASE_KEY;
  const SESSION_KEY = "aether-community-web-session-v1";
  const RELEASE_URL = "https://github.com/KiwiSystems-ee/aether-client/releases/latest";
  const $ = id => document.getElementById(id);

  function readSession() {
    try {
      const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return session?.access_token && session?.user?.id ? session : null;
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    if (session?.access_token && session?.user?.id) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  }

  async function responseError(response, fallback) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    const message = data?.msg || data?.message || data?.hint || data?.details || data?.error_description || data?.error;
    return new Error(message || fallback + " (" + response.status + ").");
  }

  async function fetchCurrentUser(session) {
    const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token }
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw await responseError(response, "Account verification failed");
    return response.json();
  }

  function tokenClaims(accessToken) {
    try {
      const payload = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return {};
    }
  }

  async function fetchTotpFactors(session) {
    const response = await fetch(SUPABASE_URL + "/auth/v1/factors", {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token }
    });
    if (!response.ok) throw await responseError(response, "Could not verify authenticator status");
    const result = await response.json();
    const all = result.all || result.factors || [
      ...(result.totp || []),
      ...(result.phone || []),
      ...(result.webauthn || [])
    ];
    return result.totp || all.filter(factor => factor.factor_type === "totp" || factor.type === "totp");
  }

  async function refreshSession(session) {
    if (!session?.refresh_token) return null;
    const response = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token })
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) return null;
    if (!response.ok) throw await responseError(response, "Could not refresh the account session");
    return response.json();
  }

  function showDownloadLink(user) {
    const link = document.createElement("a");
    link.className = "button button-primary";
    link.href = RELEASE_URL;
    link.rel = "noreferrer";
    link.textContent = "Download Project Aether";
    const arrow = document.createElement("span");
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "↓";
    link.appendChild(arrow);
    $("downloadActions").replaceChildren(link, $("downloadSignOut"));
    $("downloadSignOut").hidden = false;
    $("downloadStatus").textContent = "Account verified. Signed in as " + (user.email || "Aether member") + ".";
  }

  function showSignIn(message) {
    $("downloadStatus").textContent = message;
    $("downloadSignOut").hidden = true;
  }

  async function verifyAccount() {
    const session = readSession();
    if (!session) {
      showSignIn("An Aether account is required to continue.");
      return;
    }

    try {
      let user = await fetchCurrentUser(session);
      if (!user) {
        const refreshed = await refreshSession(session);
        if (refreshed) {
          saveSession(refreshed);
          user = await fetchCurrentUser(refreshed);
        }
      }
      if (!user) {
        saveSession(null);
        showSignIn("Your session expired or could not be verified. Sign in to your Aether account again to continue.");
        return;
      }

      const activeSession = JSON.parse(localStorage.getItem(SESSION_KEY));
      activeSession.user = user;
      saveSession(activeSession);
      const totpFactors = await fetchTotpFactors(activeSession);
      const verifiedTotp = totpFactors.some(factor => factor.status === "verified");
      if (verifiedTotp && tokenClaims(activeSession.access_token).aal !== "aal2") {
        showSignIn("This account needs an authenticator code before continuing. Return to the community page to verify it, then come back here.");
        return;
      }
      showDownloadLink(user);
    } catch (error) {
      showSignIn("Could not verify your account: " + error.message);
    }
  }

  async function signOut() {
    const session = readSession();
    if (session) {
      try {
        await fetch(SUPABASE_URL + "/auth/v1/logout", {
          method: "POST",
          headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token }
        });
      } catch (error) {
        console.warn("Could not notify Supabase of sign-out:", error);
      }
    }
    saveSession(null);
    $("downloadActions").replaceChildren($("downloadAccountLink"), $("downloadSignOut"));
    $("downloadAccountLink").hidden = false;
    showSignIn("Signed out. Sign in to your Aether account to continue.");
  }

  $("downloadSignOut").addEventListener("click", signOut);
  verifyAccount();
})();

