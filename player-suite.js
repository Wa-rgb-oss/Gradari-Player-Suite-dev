(() => {
  let session = null;
  let state = null;
  let factionAssets = [];

  const $ = id => document.getElementById(id);
  const esc = value => GMUI.esc(value);
  const fmt = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const setState = (el, message, type="") => GMUI.setState(el, message, type);

  const registrationForm = $("registrationForm");
  const profileForm = $("profileForm");
  const characterForm = $("characterForm");
  const actionForm = $("actionForm");
  const registrationState = $("registrationState");
  const profileState = $("profileState");
  const characterState = $("characterState");
  const actionState = $("actionState");
  const commitList = $("commitList");
  const secretAction = $("secretAction");
  const actionCategory = $("actionCategory");
  const coverWrap = $("coverWrap");
  const ordersWrap = $("ordersWrap");
  const preview = $("recordPreview");
  const previewBody = $("previewBody");

  function openTab(id, updateHash=true) {
    document.querySelectorAll("[data-tab-target]").forEach(button => {
      button.classList.toggle("active", button.dataset.tabTarget === id);
    });
    document.querySelectorAll("[data-tab-panel]").forEach(panel => {
      panel.classList.toggle("active", panel.id === id);
    });
    if (updateHash) {
      const slug = id.replace("suite-","");
      history.replaceState(null,"","#" + slug);
    }
  }

  function initTabLinks() {
    document.querySelectorAll("[data-tab-target]").forEach(button => {
      button.addEventListener("click", () => openTab(button.dataset.tabTarget));
    });
    document.querySelectorAll("[data-open-tab]").forEach(button => {
      button.addEventListener("click", () => openTab(button.dataset.openTab));
    });
    const hash = location.hash.replace("#","").trim();
    const map = {
      account:"suite-account",
      economy:"suite-economy",
      inventory:"suite-characters",
      faction:"suite-faction",
      characters:"suite-characters",
      friends:"suite-friends",
      actions:"suite-actions",
      markets:"suite-markets",
      canon:"suite-canon"
    };
    if (map[hash]) openTab(map[hash], false);
  }

  function restoreForm(form, data) {
    if (!data) return;
    Object.entries(data).forEach(([key,value]) => {
      const field = form.elements[key];
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value ?? "";
    });
  }

  function disableRegistration() {
    registrationForm.hidden = true;
    $("registrationComplete").hidden = false;
    $("registrationPanel").classList.add("is-registered");
    setState(registrationState, "");
  }

  function enableRegistrationAgain() {
    registrationForm.reset();
    registrationForm.querySelectorAll("input,textarea,select,button").forEach(control => control.disabled = false);
    $("registrationComplete").hidden = true;
    $("registrationPanel").classList.remove("is-registered");
    registrationForm.hidden = false;
    setState(registrationState, "");
  }

  function addCommitment(item="", detail="") {
    const row = document.createElement("div");
    row.className = "form-grid commit-row";
    row.innerHTML = `
      <input data-commit-item placeholder="Asset / resource / personnel" aria-label="Committed asset or resource">
      <div style="display:flex;gap:8px">
        <input data-commit-detail placeholder="Amount / detail" aria-label="Commitment amount or detail">
        <button class="hud-button danger" type="button" style="padding-inline:12px">REMOVE</button>
      </div>`;
    row.querySelector("[data-commit-item]").value = item;
    row.querySelector("[data-commit-detail]").value = detail;
    row.querySelector("button").addEventListener("click", () => {
      row.remove();
      if (!commitList.children.length) addCommitment();
    });
    commitList.appendChild(row);
  }

  function commitments() {
    return [...commitList.querySelectorAll(".commit-row")].map(row => ({
      item: row.querySelector("[data-commit-item]").value.trim(),
      detail: row.querySelector("[data-commit-detail]").value.trim()
    })).filter(x => x.item || x.detail);
  }

  function conditionalFields() {
    coverWrap.hidden = !secretAction.checked;
    ordersWrap.hidden = actionCategory.value !== "Military";
  }

  function formObject(form) {
    const data = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type="checkbox"]').forEach(input => data[input.name] = input.checked);
    return data;
  }

  function recordText(form) {
    const data = formObject(form);
    if (form === actionForm) data.commitments = commitments();
    const lines = ["GRADARI MIRERIS // PLAYER RECORD","Generated: " + new Date().toLocaleString(),""];
    Object.entries(data).forEach(([key,value]) => {
      if (key === "commitments") {
        lines.push("COMMITTED RESOURCES");
        value.forEach((entry,index) => lines.push((index+1) + ". " + (entry.item || "Unspecified") + (entry.detail ? " // " + entry.detail : "")));
        lines.push("");
      } else {
        lines.push(key.replace(/_/g," ").toUpperCase());
        lines.push(typeof value === "boolean" ? (value ? "YES" : "NO") : (value || "Not specified"));
        lines.push("");
      }
    });
    return lines.join("\n");
  }

  async function loadFactionAssets() {
    try {
      const rows = await GMAuth.api("faction_assets?select=faction_id,asset_id,quantity,notes&order=updated_at.desc");
      const catalog = new Map(state.catalog.map(row => [row.id,row]));
      factionAssets = (rows || []).map(row => ({...row,asset:catalog.get(row.asset_id) || null}));
    } catch {
      factionAssets = [];
    }
  }

  function renderOverview() {
    $("suiteProfileStatus").textContent = state.registration ? "REGISTERED" : "ACCOUNT ONLY";
    $("suiteWallet").textContent = fmt(state.wallet?.balance) + " " + String(state.wallet?.currency || "Aureum").toUpperCase();
    $("suiteFaction").textContent = state.primaryMembership?.faction?.code || state.primaryMembership?.faction?.name || "UNASSIGNED";
    $("suiteAssetCount").textContent = String(state.assets.length).padStart(2,"0");
    const livingCharacters = state.characters.filter(row => row.status === "active" && row.life_status === "alive");
    $("suiteCharacterCount").textContent = String(livingCharacters.length).padStart(2,"0");
    $("suiteActionCount").textContent = String(state.actions.length).padStart(2,"0");
    $("suiteNotice").textContent = "YOUR ACCOUNT IS SYNCHRONIZED WITH THE CURRENT GAME STATE.";
  }

  function renderAccount() {
    $("accountUserId").textContent = session.user.id;
    profileForm.elements.display_name.value = state.profile?.display_name || "";
    profileForm.elements.handle.value = state.profile?.handle || "";

    const displayName = state.profile?.display_name || state.registration?.preferred || state.registration?.player || session.user.email || "Player";
    const initials = String(displayName).trim().split(/\s+/).slice(0,2).map(part => part[0] || "").join("").toUpperCase() || "PL";
    $("accountProfileInitials").textContent = initials;

    const photoUrl = state.profile?.avatar_url || state.profile?.profile_photo_url || state.profile?.photo_url || "";
    const photo = $("accountProfilePhoto");
    if (photoUrl) {
      photo.src = photoUrl;
      photo.alt = displayName + " profile photo";
      photo.hidden = false;
      $("accountProfileInitials").hidden = true;
    } else {
      photo.removeAttribute("src");
      photo.hidden = true;
      $("accountProfileInitials").hidden = false;
    }

    if (state.registration) {
      restoreForm(registrationForm, state.registration);
      disableRegistration();
    } else {
      $("registrationComplete").hidden = true;
      $("registrationPanel").classList.remove("is-registered");
      registrationForm.hidden = false;
    }
  }

  function renderEconomy() {
    $("economyBalance").textContent = fmt(state.wallet?.balance);
    $("economyCurrency").textContent = String(state.wallet?.currency || "Aureum").toUpperCase();
    const body = $("transactionRows");
    if (!state.transactions.length) {
      body.innerHTML = "";
      $("transactionEmpty").hidden = false;
      return;
    }
    $("transactionEmpty").hidden = true;
    body.innerHTML = state.transactions.map(row => `
      <tr>
        <td>${esc(new Date(row.created_at).toLocaleDateString())}</td>
        <td>${esc(row.kind || "Transaction")}</td>
        <td>${esc(row.description || "—")}</td>
        <td>${row.amount >= 0 ? "+" : ""}${esc(fmt(row.amount))} ${esc(row.currency || "Aureum")}</td>
        <td>${row.balance_after == null ? "—" : esc(fmt(row.balance_after))}</td>
      </tr>`).join("");
  }

  function renderAssets() {
    const root = $("playerAssetList");
    if (!state.assets.length) {
      root.innerHTML = "";
      $("playerAssetEmpty").hidden = false;
      return;
    }
    $("playerAssetEmpty").hidden = true;
    root.innerHTML = state.assets.map((row,index) => {
      const name = row.asset?.name || "Unknown Asset";
      const kind = row.asset?.kind || "asset";
      const initials = String(name).split(/\s+/).slice(0,2).map(part => part[0] || "").join("").toUpperCase();
      return `
        <button class="inventory-slot" type="button" title="${esc(name)} — ${esc(row.asset?.description || kind)}">
          <span class="inventory-slot-icon">${esc(initials || "•")}</span>
          <strong>${esc(name)}</strong>
          <span class="inventory-slot-qty">${esc(fmt(row.quantity))}</span>
          <small>${esc(row.asset?.unit || kind)}</small>
        </button>`;
    }).join("");
  }

  function renderFaction() {
    const membership = state.primaryMembership;
    const faction = membership?.faction;
    if (!membership || !faction) {
      $("factionName").textContent = "No Active Faction";
      $("factionCode").textContent = "UNASSIGNED";
      $("factionDescription").textContent = "You are not currently part of a faction.";
      $("factionTitle").textContent = "--";
      $("factionRank").textContent = "--";
      $("factionTreasury").textContent = "--";
      $("factionLeadership").textContent = "--";
      $("permissionList").innerHTML = '<span class="status-chip muted">NO FACTION PERMISSIONS</span>';
      $("factionAssetList").innerHTML = "";
      $("factionAssetEmpty").hidden = false;
      return;
    }

    $("factionName").textContent = faction.name;
    $("factionCode").textContent = faction.code || "FACTION";
    $("factionDescription").textContent = faction.description || "No faction description has been published.";
    $("factionTitle").textContent = membership.title || "Member";
    $("factionRank").textContent = membership.rank || "Unranked";
    $("factionTreasury").textContent = fmt(faction.treasury) + " Aureum";
    $("factionLeadership").textContent = faction.leadership_status === "vacant" ? "VACANT" : "ACTIVE";

    const permissions = membership.permissions || [];
    $("permissionList").innerHTML = permissions.length
      ? permissions.map(p => '<span class="status-chip">' + esc(p) + '</span>').join("")
      : '<span class="status-chip muted">STANDARD MEMBER</span>';

    const ownFactionAssets = factionAssets.filter(row => row.faction_id === faction.id);
    if (!ownFactionAssets.length) {
      $("factionAssetList").innerHTML = "";
      $("factionAssetEmpty").hidden = false;
    } else {
      $("factionAssetEmpty").hidden = true;
      $("factionAssetList").innerHTML = ownFactionAssets.map(row => `
        <div class="resource-row">
          <div><strong>${esc(row.asset?.name || "Unknown Asset")}</strong><div class="section-code">${esc((row.asset?.kind || "asset").toUpperCase())}</div></div>
          <span>${esc(fmt(row.quantity))} ${esc(row.asset?.unit || "unit")}</span>
        </div>`).join("");
    }
  }

  function renderCharacterFactionOptions() {
    const select = $("characterFaction");
    select.innerHTML = '<option value="">No faction</option>' + state.memberships
      .filter(row => row.status === "active" && row.faction)
      .map(row => '<option value="' + esc(row.faction_id) + '">' + esc(row.faction.name) + '</option>')
      .join("");
  }

  function renderCharacters() {
    const living = state.characters.find(row => row.status === "active" && row.life_status === "alive");
    const emptyState = $("characterEmptyState");
    const dashboard = $("characterDashboard");
    const createForm = $("characterForm");

    emptyState.hidden = Boolean(living);
    dashboard.hidden = !living;
    if (!living) {
      createForm.hidden = true;
      $("openCharacterCreate").hidden = false;
      return;
    }

    const faction = state.factions.find(row => row.id === living.faction_id);
    const title = living.title || "No formal title";
    const factionName = faction?.name || "No faction";
    const influence = living.political_influence ?? living.influence ?? 0;
    const location = living.location_name || living.location_ref || "Location not set";

    $("characterStandingTitle").textContent = title;
    $("characterStandingFaction").textContent = factionName;
    $("characterStandingInfluence").textContent = fmt(influence);
    $("characterStandingLocation").textContent = location;
    $("characterStandingBio").textContent = living.bio || "No character notes recorded.";
    $("characterStandingStatus").textContent = "ACTIVE";

    $("characterIdentityName").textContent = living.name;
    $("characterIdentityMeta").textContent = String(title).toUpperCase() + " // " + String(factionName).toUpperCase();
    $("characterIdentityLife").textContent = "ALIVE";
    $("characterIdentityLocation").textContent = String(location).toUpperCase();

    const involvement = (state.eventParticipation || []).filter(row =>
      row.character_id === living.id || (!row.character_id && row.user_id === session.user.id)
    );
    $("characterInvolvement").textContent = involvement.length
      ? involvement.length + " active event" + (involvement.length === 1 ? "" : "s") + " / assignment" + (involvement.length === 1 ? "" : "s") + "."
      : "No active events or assignments.";
  }

  function renderSuccession() {
    const root=$("characterSuccessionList");
    const empty=$("characterSuccessionEmpty");
    const rows=state.characterSuccessions || [];
    if (!root || !empty) return;

    if (!rows.length) {
      root.innerHTML="";
      empty.hidden=false;
      return;
    }

    empty.hidden=true;
    root.innerHTML=rows.map(row => {
      const predecessor=state.characters.find(char=>char.id===row.predecessor_character_id);
      const successor=state.characters.find(char=>char.id===row.successor_character_id);
      return '<article class="notice">'+
        '<div class="split-actions"><div><strong style="color:var(--text)">'+esc(predecessor?.name || "Predecessor")+' → '+esc(successor?.name || "Successor")+'</strong>'+
        '<div class="section-code">'+esc(new Date(row.created_at).toLocaleDateString())+'</div></div>'+
        '<span class="status-chip">'+esc(fmt(row.influence_inherited || 0))+' INF</span></div>'+
        '<div class="telemetry-stack" style="margin-top:10px">'+
        '<div class="telemetry-row"><span>Account Assets</span><strong>'+(row.assets_continued ? "CONTINUED" : "RESTRICTED")+'</strong></div>'+
        '<div class="telemetry-row"><span>Influence Inherited</span><strong>'+esc(fmt(row.influence_inherited || 0))+'</strong></div>'+
        '</div>'+
        (row.notes?'<div style="margin-top:9px">'+esc(row.notes)+'</div>':"")+
        '</article>';
    }).join("");
  }

  function renderActions() {
    const root = $("actionHistory");
    if (!state.actions.length) {
      root.innerHTML = "";
      $("actionHistoryEmpty").hidden = false;
      return;
    }
    $("actionHistoryEmpty").hidden = true;
    root.innerHTML = state.actions.slice(0,12).map(row => `
      <article class="notice">
        <div class="split-actions">
          <div><strong style="color:var(--text)">${esc(row.action_title || "Untitled Action")}</strong><div class="section-code">${esc(row.category || "UNCATEGORIZED")} // ${esc(new Date(row.created_at).toLocaleDateString())}</div></div>
          <span class="status-chip ${["Pending","Reviewing"].includes(row.status || "Pending") ? "amber" : ""}">${esc(row.status || "Pending")}</span>
        </div>
        ${row.resolution ? '<div style="margin-top:10px">' + esc(row.resolution) + '</div>' : ""}
      </article>`).join("");
  }

  function setActionIdentity() {
    const membership = state.primaryMembership;
    const playerName = state.profile?.display_name || state.registration?.preferred || state.registration?.player || "Player";
    actionForm.elements.player.value = membership?.faction?.name ? playerName + " // " + membership.faction.name : playerName;
  }

  async function refreshState() {
    state = await GMPlayerData.load(session);
    await loadFactionAssets();
    renderAccount();
    renderEconomy();
    renderAssets();
    renderFaction();
    renderCharacterFactionOptions();
    renderCharacters();
    renderSuccession();
    renderActions();
    setActionIdentity();
    window.GMPlayerSuiteState = state;
    document.dispatchEvent(new CustomEvent("gm:player-state",{detail:state}));
  }

  $("friendSearchButton")?.addEventListener("click", () => {
    const query = $("friendSearchInput")?.value.trim();
    const root = $("friendSearchResults");
    const empty = $("friendSearchEmpty");
    if (!query) {
      root.innerHTML = "";
      empty.textContent = "ENTER A USERNAME OR ACCOUNT NAME.";
      empty.hidden = false;
      return;
    }
    root.innerHTML = "";
    empty.textContent = "PLAYER DISCOVERY IS READY FOR THE FRIENDS DATABASE CONNECTION.";
    empty.hidden = false;
  });

  $("registerAgain")?.addEventListener("click", enableRegistrationAgain);
  $("copyAccountUserId")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(session.user.id);
      setState($("copyUserIdState"), "USER ID COPIED", "success");
    } catch {
      setState($("copyUserIdState"), "COPY FAILED", "error");
    }
  });

  $("openCharacterCreate")?.addEventListener("click", () => {
    $("openCharacterCreate").hidden = true;
    $("characterForm").hidden = false;
  });
  $("cancelCharacterCreate")?.addEventListener("click", () => {
    $("characterForm").reset();
    $("characterForm").hidden = true;
    $("openCharacterCreate").hidden = false;
    setState(characterState, "");
  });
  $("toggleCharacterPresence")?.addEventListener("click", () => {
    const drawer = $("characterPresenceDrawer");
    drawer.hidden = !drawer.hidden;
  });

  profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = formObject(profileForm);
    setState(profileState, "SAVING PLAYER PROFILE...");
    try {
      await GMAuth.api("player_profiles?user_id=eq." + encodeURIComponent(session.user.id), {
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          display_name:data.display_name?.trim() || null,
          handle:data.handle?.trim() || null
        })
      });
      setState(profileState, "PROFILE SAVED", "success");
      await refreshState();
    } catch (error) {
      setState(profileState, "PROFILE SAVE FAILED // " + error.message, "error");
    }
  });

  registrationForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!registrationForm.reportValidity()) return;
    const data = formObject(registrationForm);
    setState(registrationState, "SUBMITTING PLAYER REGISTRATION...");
    try {
      await GMAuth.api(state.registration ? "players_tab?user_id=eq." + encodeURIComponent(session.user.id) : "players_tab", {
        method:state.registration ? "PATCH" : "POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          user_id:session.user.id,
          player:data.player?.trim() || null,
          preferred:data.preferred?.trim() || null,
          interests:data.interests?.trim() || null,
          playstyle:data.playstyle?.trim() || null,
          faction:data.faction?.trim() || null,
          role:data.role?.trim() || null,
          goals:data.goals?.trim() || null,
          notes:data.notes?.trim() || null
        })
      });
      setState(registrationState, "PLAYER REGISTRATION SUBMITTED", "success");
      await refreshState();
    } catch (error) {
      setState(registrationState, "REGISTRATION FAILED // " + error.message, "error");
    }
  });

  characterForm.addEventListener("submit", async event => {
    event.preventDefault();
    const living = state.characters.find(row => row.status === "active" && row.life_status === "alive");
    if (living) {
      setState(characterState, "ONLY ONE ACTIVE LIVING CHARACTER IS ALLOWED", "error");
      return;
    }

    const data = formObject(characterForm);
    setState(characterState, "CREATING CHARACTER...");
    try {
      await GMAuth.api("characters", {
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          user_id:session.user.id,
          name:data.name.trim(),
          title:data.title?.trim() || null,
          faction_id:data.faction_id || null,
          is_main:true,
          status:"active",
          life_status:"alive",
          bio:data.bio?.trim() || null
        })
      });
      characterForm.reset();
      setState(characterState, "CHARACTER CREATED", "success");
      await refreshState();
    } catch (error) {
      setState(characterState, "CHARACTER CREATION FAILED // " + error.message, "error");
    }
  });

  actionForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!actionForm.reportValidity()) return;
    const data = formObject(actionForm);
    const committed = commitments();
    if (!committed.length) {
      setState(actionState, "ADD AT LEAST ONE COMMITTED RESOURCE OR PERSONNEL ENTRY", "error");
      return;
    }
    setState(actionState, "SUBMITTING ACTION...");
    try {
      await GMAuth.api("actions_tab", {
        method:"POST",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          user_id:session.user.id,
          player:actionForm.elements.player.value,
          action_title:data.action_title?.trim() || null,
          category:data.category || null,
          target:data.target?.trim() || null,
          objective:data.objective?.trim() || null,
          method:data.method?.trim() || null,
          commitments:JSON.stringify(committed),
          intent:data.intent?.trim() || null,
          secret:Boolean(data.secret),
          cover_story:data.cover_story?.trim() || null,
          orders:data.orders?.trim() || null,
          notes:data.notes?.trim() || null,
          action_scope:state.primaryMembership ? "faction" : "player"
        })
      });
      actionForm.reset();
      commitList.innerHTML = "";
      addCommitment();
      conditionalFields();
      setState(actionState, "ACTION SUBMITTED FOR GAME MASTER REVIEW", "success");
      await refreshState();
    } catch (error) {
      setState(actionState, "ACTION SUBMISSION FAILED // " + error.message, "error");
    }
  });

  document.querySelectorAll("[data-preview-form]").forEach(button => {
    button.addEventListener("click", () => {
      previewBody.textContent = recordText($(button.dataset.previewForm));
      preview.showModal();
    });
  });
  $("closePreview").addEventListener("click", () => preview.close());
  $("addCommit").addEventListener("click", () => addCommitment());
  secretAction.addEventListener("change", conditionalFields);
  actionCategory.addEventListener("change", conditionalFields);

  window.GMPlayerSuiteRefresh = refreshState;

  (async () => {
    session = await GMUI.initProtected();
    if (!session) return;
    initTabLinks();
    addCommitment();
    conditionalFields();
    try {
      await refreshState();
    } catch (error) {
      $("suiteNotice").textContent = "PLAYER SUITE DATA ERROR // " + error.message;
    }
  })();
})();