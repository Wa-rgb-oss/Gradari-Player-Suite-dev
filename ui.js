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

  function ensureModal() {
    let root=document.getElementById("gmUiModal");
    if(root) return root;
    root=document.createElement("div");
    root.id="gmUiModal";
    root.className="gm-modal-backdrop";
    root.hidden=true;
    root.innerHTML='<section class="gm-modal" role="dialog" aria-modal="true" aria-labelledby="gmModalTitle">'+
      '<div class="section-code" id="gmModalCode">SYSTEM / CONFIRMATION</div>'+
      '<h2 id="gmModalTitle">Confirm Action</h2>'+
      '<p id="gmModalMessage"></p>'+
      '<label id="gmModalInputWrap" hidden><span id="gmModalInputLabel">Value</span><input id="gmModalInput" type="text"></label>'+
      '<div class="gm-modal-actions"><button class="hud-button secondary" id="gmModalCancel" type="button">CANCEL</button><button class="hud-button amber" id="gmModalConfirm" type="button">CONFIRM</button></div>'+
      '</section>';
    document.body.appendChild(root);
    return root;
  }

  function modal(options={}) {
    const root=ensureModal();
    const title=root.querySelector("#gmModalTitle"),message=root.querySelector("#gmModalMessage");
    const code=root.querySelector("#gmModalCode"),inputWrap=root.querySelector("#gmModalInputWrap");
    const input=root.querySelector("#gmModalInput"),inputLabel=root.querySelector("#gmModalInputLabel");
    const cancel=root.querySelector("#gmModalCancel"),confirm=root.querySelector("#gmModalConfirm");
    title.textContent=options.title || "Confirm Action";
    message.textContent=options.message || "";
    code.textContent=options.code || "SYSTEM / CONFIRMATION";
    confirm.textContent=options.confirmText || "CONFIRM";
    confirm.classList.toggle("danger",Boolean(options.danger));
    confirm.classList.toggle("amber",!options.danger);
    inputWrap.hidden=!options.input;
    inputLabel.textContent=options.inputLabel || "Value";
    input.value=options.defaultValue || "";
    input.placeholder=options.placeholder || "";
    root.hidden=false;
    document.body.classList.add("gm-modal-open");
    if(options.input) setTimeout(()=>input.focus(),0); else setTimeout(()=>confirm.focus(),0);
    return new Promise(resolve=>{
      const close=value=>{
        root.hidden=true; document.body.classList.remove("gm-modal-open");
        confirm.onclick=null; cancel.onclick=null; root.onclick=null; document.onkeydown=null; resolve(value);
      };
      confirm.onclick=()=>close(options.input ? input.value : true);
      cancel.onclick=()=>close(options.input ? null : false);
      root.onclick=e=>{if(e.target===root) close(options.input ? null : false);};
      document.onkeydown=e=>{if(e.key==="Escape") close(options.input ? null : false); if(e.key==="Enter" && options.input) close(input.value);};
    });
  }

  const confirmAction=(message,options={})=>modal({...options,message});
  const promptAction=(message,defaultValue="",options={})=>modal({...options,message,input:true,defaultValue});

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

  function startWorldClock() {
    const hosts = document.querySelectorAll(".top-telemetry");
    if (!hosts.length || !window.GMAuth) return;

    let snapshot = null;
    let fetchedAt = 0;

    const ensureReadout = () => {
      hosts.forEach(host => {
        if (host.querySelector("[data-world-clock]")) return;
        const el = document.createElement("span");
        el.dataset.worldClock = "";
        el.className = "world-clock-readout";
        el.textContent = "WORLD TIME // --";
        host.insertBefore(el, host.firstChild);
      });
    };

    const format = data => {
      const state = data.running ? "" : " // PAUSED";
      return "A" + data.aevum +
        " // C" + String(data.cycle).padStart(2,"0") +
        " // W" + data.week +
        " // D" + data.day +
        " // H" + String(data.hour).padStart(2,"0") +
        state;
    };

    const refresh = async () => {
      try {
        snapshot = await GMAuth.api("rpc/get_world_clock",{method:"POST",body:"{}"});
        fetchedAt = Date.now();
        document.querySelectorAll("[data-world-clock]").forEach(el => el.textContent = format(snapshot));
      } catch {
        document.querySelectorAll("[data-world-clock]").forEach(el => el.textContent = "WORLD TIME // OFFLINE");
      }
    };

    ensureReadout();
    refresh();
    setInterval(() => {
      if (!snapshot || Date.now()-fetchedAt > 60000) refresh();
    },12000);
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

    try {
      const admin = await GMAuth.api("rpc/is_admin",{method:"POST",body:"{}"});
      if (admin === true) {
        document.querySelectorAll(".sidebar-footer").forEach(footer => {
          if (footer.querySelector("[data-admin-link]")) return;
          const link = document.createElement("a");
          link.href = "admin.html";
          link.className = "admin-access-btn";
          link.dataset.adminLink = "";
          link.textContent = "ADMIN CONSOLE";
          const signout = footer.querySelector("[data-signout]");
          if (signout) footer.insertBefore(link, signout);
          else footer.appendChild(link);
        });
      }
    } catch {
      // Player interface remains available if the optional admin check fails.
    }

    document.querySelectorAll("[data-signout]").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "SIGNING OUT...";
        await GMAuth.signOut();
        window.location.replace("login.html");
      });
    });

    startClock();
    startWorldClock();
    initTabs();
    return session;
  }

  window.GMUI = { esc, setState, modal, confirmAction, promptAction, startClock, startWorldClock, initTabs, initProtected };
})();