(() => {
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function setState(el, message, type = "") {
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("success", "error");
    if (type) el.classList.add(type);
  }

  function startClock() {
    const targets = document.querySelectorAll("[data-system-time]");
    if (!targets.length) return;
    const tick = () => {
      const now = new Date();
      const value = now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
      targets.forEach(el => el.textContent = value);
    };
    tick();
    setInterval(tick, 1000);
  }

  function initTabs() {
    document.querySelectorAll("[data-tabs]").forEach(group => {
      const buttons = group.querySelectorAll("[data-tab-target]");
      buttons.forEach(button => {
        button.addEventListener("click", () => {
          const id = button.dataset.tabTarget;
          buttons.forEach(x => x.classList.toggle("active", x === button));
          document.querySelectorAll("[data-tab-panel]").forEach(panel => {
            if (panel.closest("[data-tab-scope]") === group.closest("[data-tab-scope]")) {
              panel.classList.toggle("active", panel.id === id);
            }
          });
        });
      });
    });
  }

  async function initProtected() {
    const session = await GMAuth.requireAuth();
    if (!session) return null;

    document.querySelectorAll("[data-user-email]").forEach(el => {
      el.textContent = session.user?.email || "Authenticated Player";
    });

    document.querySelectorAll("[data-signout]").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "SIGNING OUT...";
        await GMAuth.signOut();
        window.location.replace("login.html");
      });
    });

    startClock();
    initTabs();
    return session;
  }

  window.GMUI = { esc, setState, startClock, initTabs, initProtected };
})();