(() => {
  let session = null;
  let data = {
    profiles: [],
    registrations: [],
    wallets: [],
    factions: [],
    memberships: [],
    catalog: [],
    playerAssets: [],
    factionAssets: [],
    actions: [],
    world: [],
    config: [],
    markets: [],
    marketListings: [],
    facilityTypes: [],
    facilities: [],
    events: [],
    eventObjectives: [],
    eventParticipants: [],
    eventAwards: [],
    territories: [],
    locationModifiers: [],
    factionTransactions: [],
    characters: [],
    characterInfluence: [],
    influenceTransactions: [],
    republic: [],
    senateSeats: [],
    senateBills: [],
    senateVotes: [],
    federalTaxAssessments: []
  };

  const $ = id => document.getElementById(id);
  const esc = value => GMUI.esc(value);
  const fmt = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const setState = (el, message, type="") => GMUI.setState(el, message, type);

  async function isAdmin() {
    const result = await GMAuth.api("rpc/is_admin", {method:"POST", body:"{}"});
    return result === true;
  }

  function showLogin(message="") {
    document.body.classList.remove("auth-pending");
    $("adminDashboard").hidden = true;
    $("adminLogin").hidden = false;
    if (message) setState($("loginState"), message, "error");
  }

  function showDashboard() {
    document.body.classList.remove("auth-pending");
    $("adminLogin").hidden = true;
    $("adminDashboard").hidden = false;
    $("adminIdentity").textContent = session?.user?.email || "AUTHORIZED ADMIN";
    GMUI.initTabs();
  }

  function profileName(userId) {
    const profile = data.profiles.find(row => row.user_id === userId);
    const registration = data.registrations.find(row => row.user_id === userId);
    return profile?.display_name || registration?.preferred || registration?.player || userId.slice(0,8);
  }

  function membershipFor(userId) {
    return data.memberships.find(row => row.user_id === userId && row.status === "active") || null;
  }

  function factionById(id) {
    return data.factions.find(row => row.id === id) || null;
  }

  function fillSelects() {
    const playerOptions = '<option value="">Select player</option>' + data.profiles.map(row =>
      '<option value="' + esc(row.user_id) + '">' + esc(profileName(row.user_id)) + '</option>'
    ).join("");
    document.querySelectorAll("[data-player-select]").forEach(select => select.innerHTML = playerOptions);

    const factionOptions = '<option value="">Select faction</option>' + data.factions.map(row =>
      '<option value="' + esc(row.id) + '">' + esc(row.name) + '</option>'
    ).join("");
    document.querySelectorAll("[data-faction-select]").forEach(select => {
      const keepBlank = select.closest("#newsForm");
      select.innerHTML = (keepBlank ? '<option value="">None</option>' : '<option value="">Select faction</option>') +
        data.factions.map(row => '<option value="' + esc(row.id) + '">' + esc(row.name) + '</option>').join("");
    });

    const assetOptions = '<option value="">Select asset</option>' + data.catalog.map(row =>
      '<option value="' + esc(row.id) + '">' + esc(row.name) + '</option>'
    ).join("");
    document.querySelectorAll("[data-asset-select]").forEach(select => select.innerHTML = assetOptions);
  }

  function renderOverview() {
    $("adminPlayerCount").textContent = data.profiles.length;
    $("adminFactionCount").textContent = data.factions.length;
    $("adminPendingCount").textContent = data.actions.filter(row => !["Resolved","Rejected"].includes(row.status || "Pending")).length;
    $("adminAssetCount").textContent = data.catalog.length;
  }

  function renderPlayers() {
    $("adminPlayerRows").innerHTML = data.profiles.map(row => {
      const reg = data.registrations.find(x => x.user_id === row.user_id);
      const membership = membershipFor(row.user_id);
      const faction = membership ? factionById(membership.faction_id) : null;
      return `<tr>
        <td>${esc(row.display_name || reg?.preferred || reg?.player || "Player")}</td>
        <td>${esc(row.handle || "—")}</td>
        <td>${reg ? esc(reg.status || "Pending") : "Not registered"}</td>
        <td>${esc(faction?.name || "—")}</td>
        <td>${esc(membership?.title || membership?.rank || "—")}</td>
        <td style="max-width:220px;overflow-wrap:anywhere">${esc(row.user_id)}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="6">No player profiles.</td></tr>';
  }

  function renderFactions() {
    const root = $("adminFactionList");
    root.innerHTML = data.factions.map(row => `
      <article class="notice">
        <div class="split-actions">
          <div><strong style="color:var(--text)">${esc(row.name)}</strong><div class="section-code">${esc(row.code || "NO CODE")} // ${esc(row.status || "active")}</div></div>
          <span class="status-chip amber">${esc(fmt(row.treasury))} AUREUM</span>
        </div>
        ${row.description ? '<div style="margin-top:10px">' + esc(row.description) + '</div>' : ""}
        <form class="faction-edit form-shell" data-id="${esc(row.id)}" style="margin-top:14px">
          <div class="form-grid">
            <label><span>Name</span><input name="name" value="${esc(row.name)}"></label>
            <label><span>Code</span><input name="code" value="${esc(row.code || "")}"></label>
          </div>
          <label><span>Treasury</span><input name="treasury" type="number" min="0" step="0.01" value="${esc(row.treasury)}"></label>
          <label><span>Description</span><textarea name="description">${esc(row.description || "")}</textarea></label>
          <button class="hud-button secondary" type="submit">SAVE FACTION</button>
        </form>
      </article>`).join("") || '<div class="empty-state">NO FACTIONS CREATED.</div>';

    root.querySelectorAll(".faction-edit").forEach(form => {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const d = Object.fromEntries(new FormData(form));
        await GMAuth.api("factions?id=eq." + encodeURIComponent(form.dataset.id), {
          method:"PATCH",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify({
            name:d.name.trim(),
            code:d.code.trim() || null,
            treasury:Number(d.treasury || 0),
            description:d.description.trim() || null
          })
        });
        await refreshData("FACTION UPDATED");
      });
    });
  }

  function renderWallets() {
    $("walletRows").innerHTML = data.wallets.map(row => `
      <tr><td>${esc(profileName(row.user_id))}</td><td>${esc(row.currency)}</td><td>${esc(fmt(row.balance))}</td></tr>
    `).join("") || '<tr><td colspan="3">No wallets.</td></tr>';
  }

  function renderAssets() {
    $("assetCatalogList").innerHTML = data.catalog.map(row => `
      <div class="resource-row">
        <div><strong>${esc(row.name)}</strong><div class="section-code">${esc((row.kind || "resource").toUpperCase())} // ${esc(row.code || "NO CODE")}</div></div>
        <span>${esc(row.unit || "unit")}</span>
      </div>`).join("") || '<div class="empty-state">NO ASSET TYPES CREATED.</div>';
  }

  function renderActions() {
    const filter = $("statusFilter").value;
    const rows = data.actions.filter(row => !filter || (row.status || "Pending") === filter);
    $("actionAdminList").innerHTML = rows.map(row => `
      <article class="hud-panel compact">
        <div class="section-head">
          <div><div class="section-code">${row.secret ? "CLASSIFIED ACTION" : "ACTION RECORD"} // ${esc(row.category || "UNCATEGORIZED")}</div><h2>${esc(row.action_title || "Untitled Action")}</h2></div>
          <p>${esc(row.created_at ? new Date(row.created_at).toLocaleString() : "NO TIMESTAMP")}</p>
        </div>
        <div class="form-grid">
          <div class="notice"><strong>PLAYER / FACTION</strong><br>${esc(row.player || profileName(row.user_id || ""))}</div>
          <label><span>Status</span><select class="action-status" data-id="${esc(row.id)}"><option ${(!row.status || row.status==="Pending")?"selected":""}>Pending</option><option ${row.status==="Reviewing"?"selected":""}>Reviewing</option><option ${row.status==="Resolved"?"selected":""}>Resolved</option><option ${row.status==="Rejected"?"selected":""}>Rejected</option></select></label>
        </div>
        <div class="form-grid" style="margin-top:14px">
          <div class="notice"><strong>OBJECTIVE</strong><br>${esc(row.objective || "Not specified")}</div>
          <div class="notice"><strong>TARGET / LOCATION</strong><br>${esc(row.target || "Not specified")}</div>
        </div>
        <div class="notice" style="margin-top:14px"><strong>METHOD</strong><br>${esc(row.method || "Not specified")}</div>
        <div class="notice" style="margin-top:14px"><strong>COMMITMENTS</strong><br>${esc(row.commitments || "Not specified")}</div>
        <div class="notice" style="margin-top:14px"><strong>INTENT</strong><br>${esc(row.intent || "Not specified")}</div>
        <form class="action-resolution form-shell" data-id="${esc(row.id)}" style="margin-top:14px">
          <label><span>GM Resolution</span><textarea name="resolution">${esc(row.resolution || "")}</textarea></label>
          <label><span>Admin Notes</span><textarea name="admin_notes">${esc(row.admin_notes || "")}</textarea></label>
          <button class="hud-button" type="submit">SAVE RESOLUTION</button>
        </form>
      </article>`).join("") || '<div class="empty-state">NO MATCHING ACTION RECORDS.</div>';

    document.querySelectorAll(".action-status").forEach(select => {
      select.addEventListener("change", async () => {
        const status = select.value;
        const payload = {status};
        if (status === "Resolved" || status === "Rejected") payload.resolved_at = new Date().toISOString();
        await GMAuth.api("actions_tab?id=eq." + encodeURIComponent(select.dataset.id), {
          method:"PATCH",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify(payload)
        });
        await refreshData("ACTION STATUS UPDATED");
      });
    });

    document.querySelectorAll(".action-resolution").forEach(form => {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const d = Object.fromEntries(new FormData(form));
        await GMAuth.api("actions_tab?id=eq." + encodeURIComponent(form.dataset.id), {
          method:"PATCH",
          headers:{Prefer:"return=minimal"},
          body:JSON.stringify({resolution:d.resolution.trim() || null,admin_notes:d.admin_notes.trim() || null})
        });
        await refreshData("ACTION RESOLUTION SAVED");
      });
    });
  }

  function renderWorld() {
    $("worldStateList").innerHTML = data.world.map(row => `
      <article class="notice">
        <div class="split-actions"><div><strong style="color:var(--text)">${esc(row.label)}</strong><div class="section-code">${esc(row.category)} // ${esc(row.key)}</div></div><span class="status-chip ${row.player_visible ? "" : "muted"}">${row.player_visible ? "PLAYER VISIBLE" : "ADMIN ONLY"}</span></div>
        <pre style="white-space:pre-wrap;color:var(--muted);font:400 .72rem/1.5 var(--mono);margin:10px 0 0">${esc(JSON.stringify(row.value,null,2))}</pre>
      </article>`).join("") || '<div class="empty-state">NO WORLD STATE VALUES PUBLISHED.</div>';
  }

  async function loadData() {
    const results = await Promise.all([
      GMAuth.api("player_profiles?select=*&order=created_at.asc"),
      GMAuth.api("players_tab?select=*&order=created_at.asc"),
      GMAuth.api("player_wallets?select=*&order=updated_at.desc"),
      GMAuth.api("factions?select=*&order=name.asc"),
      GMAuth.api("faction_memberships?select=*&order=created_at.asc"),
      GMAuth.api("asset_catalog?select=*&order=name.asc"),
      GMAuth.api("player_assets?select=*"),
      GMAuth.api("faction_assets?select=*"),
      GMAuth.api("actions_tab?select=*&order=created_at.desc"),
      GMAuth.api("world_state?select=*&order=category.asc,key.asc"),
      GMAuth.api("game_config?select=*"),
      GMAuth.api("markets?select=*&order=name.asc"),
      GMAuth.api("market_listings?select=*&order=created_at.asc"),
      GMAuth.api("facility_types?select=*&order=name.asc"),
      GMAuth.api("facilities?select=*&order=created_at.desc"),
      GMAuth.api("game_events?select=*&order=created_at.desc"),
      GMAuth.api("event_objectives?select=*&order=sort_order.asc"),
      GMAuth.api("event_participants?select=*&order=joined_at.desc"),
      GMAuth.api("event_awards?select=*&order=awarded_at.desc"),
      GMAuth.api("territories?select=*&order=location_ref.asc"),
      GMAuth.api("location_modifiers?select=*&order=created_at.desc"),
      GMAuth.api("faction_transactions?select=*&order=created_at.desc&limit=100"),
      GMAuth.api("characters?select=*&order=created_at.asc"),
      GMAuth.api("character_influence?select=*&order=updated_at.desc"),
      GMAuth.api("influence_transactions?select=*&order=created_at.desc&limit=100"),
      GMAuth.api("republic_state?select=*&limit=1"),
      GMAuth.api("senate_faction_seats?select=*&order=seats.desc"),
      GMAuth.api("senate_bills?select=*&order=created_at.desc"),
      GMAuth.api("senate_votes?select=*&order=updated_at.desc"),
      GMAuth.api("federal_tax_assessments?select=*&order=assessed_at.desc&limit=100")
    ]);
    [
      data.profiles,data.registrations,data.wallets,data.factions,data.memberships,
      data.catalog,data.playerAssets,data.factionAssets,data.actions,data.world,
      data.config,data.markets,data.marketListings,data.facilityTypes,data.facilities,
      data.events,data.eventObjectives,data.eventParticipants,data.eventAwards,
      data.territories,data.locationModifiers,data.factionTransactions,
      data.characters,data.characterInfluence,data.influenceTransactions,
      data.republic,data.senateSeats,data.senateBills,data.senateVotes,
      data.federalTaxAssessments
    ] = results;
  }

  function renderAll() {
    fillSelects();
    renderOverview();
    renderPlayers();
    renderFactions();
    renderWallets();
    renderAssets();
    renderActions();
    renderWorld();
    window.GMAdminData = data;
    document.dispatchEvent(new CustomEvent("gm:admin-state",{detail:data}));
  }

  async function refreshData(message="DATA REFRESHED") {
    setState($("adminState"), "LOADING AUTHORITATIVE GAME STATE...");
    try {
      await loadData();
      renderAll();
      setState($("adminState"), message, "success");
    } catch (error) {
      setState($("adminState"), "ADMIN DATA ERROR // " + error.message, "error");
    }
  }

  window.GMAdminRefresh = refreshData;

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    setState($("loginState"), "AUTHENTICATING GM ACCOUNT...");
    try {
      session = await GMAuth.signIn($("email").value.trim(), $("password").value);
      if (!await isAdmin()) {
        await GMAuth.signOut();
        session = null;
        showLogin("ACCESS DENIED // THIS ACCOUNT IS NOT AN AUTHORIZED GAME MASTER");
        return;
      }
      showDashboard();
      await refreshData("ADMIN SESSION READY");
    } catch (error) {
      showLogin("GM AUTHENTICATION FAILED // " + error.message);
    }
  });

  $("forgotPassword").addEventListener("click", async () => {
    const address = $("email").value.trim();
    if (!address) return setState($("loginState"), "ENTER THE ADMIN EMAIL ADDRESS FIRST.", "error");
    try {
      const response = await fetch(GMAuth.CONFIG.url + "/auth/v1/recover?redirect_to=" + encodeURIComponent(new URL("reset-password.html", location.href).href), {
        method:"POST",
        headers:{apikey:GMAuth.CONFIG.key,"Content-Type":"application/json"},
        body:JSON.stringify({email:address})
      });
      if (!response.ok) throw new Error(await response.text());
      setState($("loginState"), "RECOVERY EMAIL SENT", "success");
    } catch (error) {
      setState($("loginState"), "RECOVERY FAILED // " + error.message, "error");
    }
  });

  $("refreshAdmin").addEventListener("click", () => refreshData());
  $("adminLogout").addEventListener("click", async () => {
    await GMAuth.signOut();
    session = null;
    showLogin();
  });
  $("statusFilter").addEventListener("change", renderActions);

  $("membershipForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    const existing = data.memberships.find(row => row.user_id === d.user_id && row.faction_id === d.faction_id);
    const payload = {
      user_id:d.user_id,
      faction_id:d.faction_id,
      title:d.title.trim() || null,
      rank:d.rank.trim() || null,
      permissions:d.permissions.split(",").map(x => x.trim()).filter(Boolean),
      status:"active"
    };
    try {
      if (existing) {
        await GMAuth.api("faction_memberships?id=eq." + encodeURIComponent(existing.id), {method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)});
      } else {
        await GMAuth.api("faction_memberships", {method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)});
      }
      setState($("membershipState"), "FACTION MEMBERSHIP SAVED", "success");
      await refreshData();
    } catch (error) {
      setState($("membershipState"), "MEMBERSHIP SAVE FAILED // " + error.message, "error");
    }
  });

  $("factionForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("factions", {method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({
        code:d.code.trim() || null,
        name:d.name.trim(),
        description:d.description.trim() || null,
        treasury:Number(d.treasury || 0)
      })});
      form.reset();
      setState($("factionState"), "FACTION CREATED", "success");
      await refreshData();
    } catch (error) {
      setState($("factionState"), "FACTION CREATE FAILED // " + error.message, "error");
    }
  });

  $("walletForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    const wallet = data.wallets.find(row => row.user_id === d.user_id);
    const newBalance = Number(d.balance || 0);
    try {
      await GMAuth.api("player_wallets?user_id=eq." + encodeURIComponent(d.user_id), {method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({balance:newBalance,currency:d.currency.trim() || "Aureum"})});
      const delta = newBalance - Number(wallet?.balance || 0);
      await GMAuth.api("player_transactions", {method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({
        user_id:d.user_id,
        amount:delta,
        currency:d.currency.trim() || "Aureum",
        kind:"gm_adjustment",
        description:d.description.trim() || "Game Master balance adjustment",
        balance_after:newBalance
      })});
      setState($("walletState"), "BALANCE UPDATED AND LEDGER ENTRY CREATED", "success");
      await refreshData();
    } catch (error) {
      setState($("walletState"), "BALANCE UPDATE FAILED // " + error.message, "error");
    }
  });

  $("assetForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("asset_catalog", {method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({
        code:d.code.trim() || null,
        name:d.name.trim(),
        kind:d.kind,
        unit:d.unit.trim() || "unit",
        description:d.description.trim() || null
      })});
      form.reset();
      setState($("assetState"), "ASSET TYPE CREATED", "success");
      await refreshData();
    } catch (error) {
      setState($("assetState"), "ASSET CREATE FAILED // " + error.message, "error");
    }
  });

  async function saveAssetAssignment(table, keys, quantity) {
    const filters = Object.entries(keys).map(([key,value]) => key + "=eq." + encodeURIComponent(value)).join("&");
    const rows = await GMAuth.api(table + "?" + filters + "&select=*");
    if (rows.length) {
      await GMAuth.api(table + "?" + filters, {method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({quantity})});
    } else {
      await GMAuth.api(table, {method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({...keys,quantity})});
    }
  }

  $("playerAssetForm").addEventListener("submit", async event => {
    event.preventDefault();
    const d = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await saveAssetAssignment("player_assets",{user_id:d.user_id,asset_id:d.asset_id},Number(d.quantity || 0));
      setState($("playerAssetState"), "PLAYER ASSET SAVED", "success");
      await refreshData();
    } catch (error) {
      setState($("playerAssetState"), "PLAYER ASSET SAVE FAILED // " + error.message, "error");
    }
  });

  $("factionAssetForm").addEventListener("submit", async event => {
    event.preventDefault();
    const d = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await saveAssetAssignment("faction_assets",{faction_id:d.faction_id,asset_id:d.asset_id},Number(d.quantity || 0));
      setState($("factionAssetState"), "FACTION ASSET SAVED", "success");
      await refreshData();
    } catch (error) {
      setState($("factionAssetState"), "FACTION ASSET SAVE FAILED // " + error.message, "error");
    }
  });

  $("worldForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    const visible = form.elements.player_visible.checked;
    let value;
    try { value = JSON.parse(d.value || "{}"); } catch { value = {text:d.value || ""}; }
    try {
      const rows = await GMAuth.api("world_state?key=eq." + encodeURIComponent(d.key) + "&select=key");
      const payload = {key:d.key.trim(),label:d.label.trim(),category:d.category.trim() || "general",value,player_visible:visible};
      if (rows.length) await GMAuth.api("world_state?key=eq." + encodeURIComponent(d.key), {method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)});
      else await GMAuth.api("world_state", {method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)});
      setState($("worldState"), "WORLD STATE SAVED", "success");
      await refreshData();
    } catch (error) {
      setState($("worldState"), "WORLD STATE SAVE FAILED // " + error.message, "error");
    }
  });

  $("newsForm").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("game_news", {method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({
        title:d.title.trim(),
        body:d.body.trim(),
        visibility:d.visibility,
        faction_id:d.faction_id || null
      })});
      form.reset();
      setState($("newsState"), "NEWS PUBLISHED", "success");
    } catch (error) {
      setState($("newsState"), "NEWS PUBLISH FAILED // " + error.message, "error");
    }
  });

  (async () => {
    session = await GMAuth.getSession();
    if (!session?.user?.id) {
      showLogin();
      return;
    }
    try {
      if (!await isAdmin()) {
        showLogin("CURRENT ACCOUNT IS NOT AUTHORIZED FOR GAME MASTER ACCESS");
        return;
      }
      showDashboard();
      await refreshData("ADMIN SESSION READY");
    } catch (error) {
      showLogin("ADMIN AUTHORIZATION CHECK FAILED // " + error.message);
    }
  })();
})();