(() => {
  const CONFIG = {
    url: "https://tgszdvvitdijzkkbrlpl.supabase.co",
    key: "sb_publishable_6GE5AFuO7AH1Ym7GU5qjoA_iUAoFAI2",
    siteUrl: "https://gradarimireris.com/"
  };

  const KEYS = {
    access: "gm_access_token",
    refresh: "gm_refresh_token",
    user: "gm_auth_user",
    expires: "gm_access_expires_at"
  };

  function siteHref(path = "") {
    return new URL(path, document.baseURI).href;
  }

  const parseJSON = (value, fallback = null) => {
    try { return JSON.parse(value); } catch { return fallback; }
  };

  function getStored() {
    return {
      access_token: localStorage.getItem(KEYS.access),
      refresh_token: localStorage.getItem(KEYS.refresh),
      user: parseJSON(localStorage.getItem(KEYS.user)),
      expires_at: Number(localStorage.getItem(KEYS.expires) || 0)
    };
  }

  function tokenExpiryMs(token) {
    try {
      let encoded = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      encoded += "=".repeat((4 - encoded.length % 4) % 4);
      const payload = JSON.parse(atob(encoded));
      return payload.exp ? payload.exp * 1000 : 0;
    } catch {
      return 0;
    }
  }

  function saveSession(data) {
    if (!data?.access_token || !data?.refresh_token) return null;
    const expiresAt = data.expires_at
      ? Number(data.expires_at) * 1000
      : data.expires_in
        ? Date.now() + Number(data.expires_in) * 1000
        : tokenExpiryMs(data.access_token);

    localStorage.setItem(KEYS.access, data.access_token);
    localStorage.setItem(KEYS.refresh, data.refresh_token);
    localStorage.setItem(KEYS.expires, String(expiresAt || 0));

    if (data.user) {
      localStorage.setItem(KEYS.user, JSON.stringify(data.user));
    }

    return getStored();
  }

  function clearSession() {
    Object.values(KEYS).forEach(key => localStorage.removeItem(key));
  }

  async function request(path, options = {}) {
    const headers = {
      apikey: CONFIG.key,
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    const response = await fetch(CONFIG.url + path, { ...options, headers });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const message = data?.msg || data?.message || data?.error_description || data?.error || (typeof data === "string" ? data : "Request failed");
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function signIn(email, password) {
    const data = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    return saveSession(data);
  }

  async function signUp(email, password) {
    const redirectTo = new URL("login/", CONFIG.siteUrl).href;
    const data = await request("/auth/v1/signup?redirect_to=" + encodeURIComponent(redirectTo), {
      method: "POST",
      body: JSON.stringify({ email, password })
    });

    const signupIdentities = Array.isArray(data?.user?.identities) ? data.user.identities : data?.identities;

    if (Array.isArray(signupIdentities) && signupIdentities.length === 0) {
      const error = new Error("An account already exists with this email. Use Sign In instead.");
      error.code = "account_exists";
      throw error;
    }

    if (data?.access_token) saveSession(data);
    return data;
  }

  function consumeAuthRedirect() {
    if (!window.location.hash || window.location.hash.length < 2) return null;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return null;

    const session = saveSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Number(params.get("expires_in") || 0),
      expires_at: Number(params.get("expires_at") || 0)
    });

    history.replaceState(null, "", window.location.pathname + window.location.search);
    return session;
  }

  async function refreshSession() {
    const stored = getStored();
    if (!stored.refresh_token) return null;

    try {
      const data = await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: stored.refresh_token })
      });
      return saveSession(data);
    } catch (error) {
      clearSession();
      return null;
    }
  }

  async function fetchUser(accessToken) {
    return request("/auth/v1/user", {
      method: "GET",
      headers: { Authorization: "Bearer " + accessToken }
    });
  }

  async function getSession() {
    consumeAuthRedirect();
    let stored = getStored();
    if (!stored.access_token || !stored.refresh_token) return null;

    const expiresSoon = !stored.expires_at || stored.expires_at - Date.now() < 90_000;
    if (expiresSoon) {
      const refreshed = await refreshSession();
      if (!refreshed) return null;
      stored = refreshed;
    }

    try {
      const user = await fetchUser(stored.access_token);
      if (user?.id) {
        stored.user = user;
        localStorage.setItem(KEYS.user, JSON.stringify(user));
      }
      return stored;
    } catch (error) {
      if (error.status === 401) {
        const refreshed = await refreshSession();
        if (!refreshed) return null;
        try {
          const user = await fetchUser(refreshed.access_token);
          if (user?.id) {
            refreshed.user = user;
            localStorage.setItem(KEYS.user, JSON.stringify(user));
          }
          return refreshed;
        } catch {
          clearSession();
          return null;
        }
      }
      return stored.user?.id ? stored : null;
    }
  }

  async function requireAuth(loginPath = "login/") {
    const session = await getSession();
    if (!session?.user?.id) {
      window.location.replace(siteHref(loginPath));
      return null;
    }
    document.body.classList.remove("auth-pending");
    document.dispatchEvent(new CustomEvent("gm:authenticated", { detail: session }));
    return session;
  }

  async function redirectIfAuthenticated(target = "home/") {
    const session = await getSession();
    if (session?.user?.id) {
      window.location.replace(siteHref(target));
      return true;
    }
    document.body.classList.remove("auth-pending");
    return false;
  }

  async function routeEntry(authTarget = "home/", guestTarget = "login/") {
    const session = await getSession();
    window.location.replace(siteHref(session?.user?.id ? authTarget : guestTarget));
  }

  async function signOut() {
    const stored = getStored();
    if (stored.access_token) {
      try {
        await request("/auth/v1/logout", {
          method: "POST",
          headers: { Authorization: "Bearer " + stored.access_token }
        });
      } catch {}
    }
    clearSession();
  }

  async function api(path, options = {}, retry = true) {
    let session = await getSession();
    if (!session?.access_token) {
      const error = new Error("Authentication required");
      error.status = 401;
      throw error;
    }

    const headers = {
      apikey: CONFIG.key,
      Authorization: "Bearer " + session.access_token,
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    const response = await fetch(CONFIG.url + "/rest/v1/" + path, { ...options, headers });

    if (response.status === 401 && retry) {
      session = await refreshSession();
      if (session?.access_token) return api(path, options, false);
    }

    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!response.ok) {
      const error = new Error(typeof data === "string" ? data : JSON.stringify(data));
      error.status = response.status;
      throw error;
    }

    return data;
  }

  window.GMAuth = {
    CONFIG,
    siteHref,
    getStored,
    saveSession,
    clearSession,
    signIn,
    signUp,
    consumeAuthRedirect,
    signOut,
    refreshSession,
    getSession,
    requireAuth,
    redirectIfAuthenticated,
    routeEntry,
    api
  };
})();