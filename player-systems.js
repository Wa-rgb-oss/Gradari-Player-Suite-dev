(() => {
  let session = null;
  let state = null;

  const $ = id => document.getElementById(id);
  const esc = value => GMUI.esc(value);
  const fmt = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const setState = (el,message,type="") => GMUI.setState(el,message,type);

  function rpc(name,args={}) {
    return GMAuth.api("rpc/" + name,{
      method:"POST",
      body:JSON.stringify(args)
    });
  }

  function playerLabel(userId) {
    const row = state?.directory?.find(x => x.user_id === userId);
    return row?.display_name || row?.handle || "Player";
  }

  async function refresh(message="",target=null) {
    if (target && message) setState(target,message,"success");
    if (window.GMPlayerSuiteRefresh) await window.GMPlayerSuiteRefresh();
  }

  function renderConfig() {
    const cfg = state.config;
    if (!cfg) return;
    $("founderRequirement").textContent = cfg.faction_min_founders;
    $("factionCreationCost").textContent = fmt(cfg.faction_creation_cost);
    $("founderMinimum").textContent = fmt(cfg.faction_min_contribution);
    const contribution = $("factionProposalForm")?.elements?.contribution;
    if (contribution) contribution.min = String(cfg.faction_min_contribution);
  }

  function proposalMemberRows(proposalId) {
    return state.proposalMembers.filter(row => row.proposal_id === proposalId);
  }

  function renderProposals() {
    const root = $("factionProposalList");
    if (!root) return;
    const proposals = state.proposals || [];
    if (!proposals.length) {
      root.innerHTML = "";
      $("factionProposalEmpty").hidden = false;
      return;
    }
    $("factionProposalEmpty").hidden = true;
    const uid = session.user.id;

    root.innerHTML = proposals.map(proposal => {
      const members = proposalMemberRows(proposal.id);
      const accepted = members.filter(m => m.status === "accepted");
      const pledged = accepted.reduce((sum,m) => sum + Number(m.contribution || 0),0);
      const mine = members.find(m => m.user_id === uid);
      const isCreator = proposal.created_by === uid;
      const cfg = state.config || {};
      const founderText = accepted.length + " / " + (cfg.faction_min_founders || 3) + " founders";
      const costText = fmt(pledged) + " / " + fmt(cfg.faction_creation_cost || 0) + " Aureum pledged";

      const memberHtml = members.map(m =>
        '<div class="resource-row"><div><strong>' + esc(playerLabel(m.user_id)) +
        '</strong><div class="section-code">' + esc(String(m.status).toUpperCase()) +
        '</div></div><span>' + fmt(m.contribution) + ' AUREUM</span></div>'
      ).join("");

      let controls = "";
      if (proposal.status === "open" && isCreator) {
        const attached = new Set(members.map(m => m.user_id));
        const options = state.directory
          .filter(p => p.user_id !== uid && !attached.has(p.user_id))
          .map(p => '<option value="' + esc(p.user_id) + '">' + esc(p.display_name || p.handle || "Player") + '</option>')
          .join("");
        controls = `
          <div class="form-shell" style="margin-top:14px">
            <label><span>Invite Founder</span><select class="founder-invite-select" data-proposal="${esc(proposal.id)}"><option value="">Select player</option>${options}</select></label>
            <div class="form-actions">
              <button class="hud-button secondary founder-invite" type="button" data-proposal="${esc(proposal.id)}">INVITE FOUNDER</button>
              <button class="hud-button founder-finalize" type="button" data-proposal="${esc(proposal.id)}">FOUND FACTION</button>
            </div>
          </div>`;
      } else if (proposal.status === "open" && mine?.status === "invited") {
        controls = `
          <div class="form-shell" style="margin-top:14px">
            <label><span>Your Founder Pledge</span><input class="founder-pledge" data-proposal="${esc(proposal.id)}" type="number" min="${esc(state.config?.faction_min_contribution || 0)}" step="0.01"></label>
            <div class="form-actions">
              <button class="hud-button founder-respond" type="button" data-proposal="${esc(proposal.id)}" data-accept="true">ACCEPT & PLEDGE</button>
              <button class="hud-button danger founder-respond" type="button" data-proposal="${esc(proposal.id)}" data-accept="false">DECLINE</button>
            </div>
          </div>`;
      }

      return `
        <article class="notice">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(proposal.name)}</strong><div class="section-code">${esc(proposal.code || "NO CODE")} // ${esc(String(proposal.status).toUpperCase())}</div></div>
            <span class="status-chip ${proposal.status==="open"?"amber":""}">${esc(proposal.status)}</span>
          </div>
          <div class="telemetry-stack" style="margin-top:10px">
            <div class="telemetry-row"><span>Founders</span><strong>${esc(founderText)}</strong></div>
            <div class="telemetry-row"><span>Founding Pool</span><strong>${esc(costText)}</strong></div>
          </div>
          <div class="section-code" style="margin-top:12px">FOUNDERS</div>
          <div class="resource-list">${memberHtml}</div>
          <div class="section-code" style="margin-top:12px">Creation cost is removed from the founding pool; any excess becomes the faction's starting treasury.</div>
          ${controls}
        </article>`;
    }).join("");

    root.querySelectorAll(".founder-invite").forEach(button => {
      button.addEventListener("click", async () => {
        const proposalId = button.dataset.proposal;
        const select = root.querySelector('.founder-invite-select[data-proposal="' + proposalId + '"]');
        if (!select?.value) return;
        try {
          await rpc("invite_faction_founder",{p_proposal_id:proposalId,p_user_id:select.value});
          await refresh();
        } catch (error) {
          $("factionProposalState").textContent = "FOUNDER INVITE FAILED // " + error.message;
        }
      });
    });

    root.querySelectorAll(".founder-finalize").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await rpc("finalize_faction_proposal",{p_proposal_id:button.dataset.proposal});
          await refresh("FACTION CREATED",$("factionProposalState"));
        } catch (error) {
          setState($("factionProposalState"),"FACTION CREATION FAILED // " + error.message,"error");
        }
      });
    });

    root.querySelectorAll(".founder-respond").forEach(button => {
      button.addEventListener("click", async () => {
        const proposalId = button.dataset.proposal;
        const accept = button.dataset.accept === "true";
        const pledge = root.querySelector('.founder-pledge[data-proposal="' + proposalId + '"]');
        try {
          await rpc("respond_faction_invite",{
            p_proposal_id:proposalId,
            p_accept:accept,
            p_contribution:accept ? Number(pledge?.value || 0) : 0
          });
          await refresh();
        } catch (error) {
          setState($("factionProposalState"),"INVITATION RESPONSE FAILED // " + error.message,"error");
        }
      });
    });
  }

  function renderMembershipInvitations() {
    const root = $("factionInvitationList");
    if (!root) return;
    const pending = (state.factionInvitations || []).filter(x =>
      x.invited_user_id === session.user.id && x.status === "pending"
    );
    if (!pending.length) {
      root.innerHTML = "";
      $("factionInvitationEmpty").hidden = false;
      return;
    }
    $("factionInvitationEmpty").hidden = true;
    root.innerHTML = pending.map(inv => {
      const faction = state.factions.find(f => f.id === inv.faction_id);
      return `
        <article class="notice">
          <strong style="color:var(--text)">${esc(faction?.name || "Faction Invitation")}</strong>
          <div class="section-code">MEMBERSHIP INVITATION</div>
          <div class="form-actions" style="margin-top:10px">
            <button class="hud-button membership-response" data-id="${esc(inv.id)}" data-accept="true" type="button">ACCEPT</button>
            <button class="hud-button danger membership-response" data-id="${esc(inv.id)}" data-accept="false" type="button">DECLINE</button>
          </div>
        </article>`;
    }).join("");

    root.querySelectorAll(".membership-response").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await rpc("respond_faction_membership_invite",{
            p_invitation_id:button.dataset.id,
            p_accept:button.dataset.accept === "true"
          });
          await refresh();
        } catch (error) {
          setState($("factionProposalState"),"MEMBERSHIP RESPONSE FAILED // " + error.message,"error");
        }
      });
    });
  }

  function renderFactionLedger() {
    const root = $("factionLedger");
    if (!root) return;
    const factionId = state.primaryMembership?.faction_id;
    const rows = (state.factionTransactions || []).filter(x => x.faction_id === factionId).slice(0,12);
    if (!rows.length) {
      root.innerHTML = "";
      $("factionLedgerEmpty").hidden = false;
      return;
    }
    $("factionLedgerEmpty").hidden = true;
    root.innerHTML = rows.map(row => `
      <article class="notice">
        <div class="split-actions">
          <div><strong style="color:var(--text)">${esc(row.description || row.kind)}</strong><div class="section-code">${esc(new Date(row.created_at).toLocaleDateString())} // ${esc(String(row.kind).toUpperCase())}</div></div>
          <span class="status-chip">${row.amount>=0?"+":""}${esc(fmt(row.amount))} ${esc(row.currency || "Aureum")}</span>
        </div>
      </article>`).join("");
  }

  async function renderLeaderMembers(faction) {
    const root = $("factionMemberList");
    if (!root) return;
    let rows=[];
    try {
      rows = await GMAuth.api("faction_memberships?faction_id=eq." + encodeURIComponent(faction.id) + "&status=eq.active&select=*&order=created_at.asc");
    } catch (error) {
      root.innerHTML = '<div class="empty-state">MEMBER DIRECTORY ERROR // ' + esc(error.message) + '</div>';
      return;
    }

    const allowed = ["treasury","military","diplomacy","construction","market","research","events","intelligence","economy","politics"];
    root.innerHTML = rows.map(member => {
      const isLeader = member.user_id === faction.leader_user_id;
      const checks = allowed.map(permission =>
        '<label class="checkbox-line"><input type="checkbox" value="' + esc(permission) + '" ' +
        (member.permissions?.includes(permission) ? "checked" : "") +
        ' ' + (isLeader ? "disabled" : "") + '><span>' + esc(permission) + '</span></label>'
      ).join("");
      return `
        <form class="member-config notice form-shell" data-id="${esc(member.id)}">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(playerLabel(member.user_id))}</strong><div class="section-code">${isLeader?"FACTION LEADER":"MEMBER"}</div></div>
            ${isLeader?'<span class="status-chip amber">NON-DELEGABLE LEADER</span>':'<button class="hud-button secondary" type="submit">SAVE MEMBER</button>'}
          </div>
          <div class="form-grid">
            <label><span>Title / Position</span><input name="title" value="${esc(member.title || "")}" ${isLeader?"disabled":""}></label>
            <label><span>Rank</span><input name="rank" value="${esc(member.rank || "")}" ${isLeader?"disabled":""}></label>
          </div>
          <div class="permission-list member-permissions">${checks}</div>
        </form>`;
    }).join("") || '<div class="empty-state">NO FACTION MEMBERS FOUND.</div>';

    root.querySelectorAll(".member-config").forEach(form => {
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const permissions=[...form.querySelectorAll('.member-permissions input:checked')].map(x => x.value);
        try {
          await rpc("configure_faction_member",{
            p_membership_id:form.dataset.id,
            p_title:form.elements.title.value || null,
            p_rank:form.elements.rank.value || null,
            p_permissions:permissions
          });
          setState($("factionLeaderState"),"MEMBER AUTHORITY UPDATED","success");
          await renderLeaderMembers(faction);
        } catch (error) {
          setState($("factionLeaderState"),"MEMBER UPDATE FAILED // " + error.message,"error");
        }
      });
    });
  }

  async function renderFactionSystems() {
    const membership = state.primaryMembership;
    const noFaction = $("factionNoMembership");
    const memberControls = $("factionMemberControls");
    const leaderControls = $("factionLeaderControls");

    renderMembershipInvitations();

    if (!membership?.faction) {
      noFaction.hidden = false;
      memberControls.hidden = true;
      leaderControls.hidden = true;
      renderConfig();
      renderProposals();
      return;
    }

    noFaction.hidden = true;
    memberControls.hidden = false;
    renderFactionLedger();

    const faction = membership.faction;
    const isLeader = faction.leader_user_id === session.user.id && faction.leadership_status !== "vacant";
    leaderControls.hidden = !isLeader;

    if (isLeader) {
      $("factionIdentityForm").elements.name.value = faction.name || "";
      $("factionIdentityForm").elements.code.value = faction.code || "";
      $("factionIdentityForm").elements.tax_rate.value = faction.tax_rate ?? 0;
      const select = $("factionInvitePlayer");
      const currentMembers = await GMAuth.api("faction_memberships?faction_id=eq." + encodeURIComponent(faction.id) + "&select=user_id");
      const memberIds = new Set(currentMembers.map(x => x.user_id));
      select.innerHTML = '<option value="">Select player</option>' + state.directory
        .filter(p => !memberIds.has(p.user_id))
        .map(p => '<option value="' + esc(p.user_id) + '">' + esc(p.display_name || p.handle || "Player") + '</option>')
        .join("");
      await renderLeaderMembers(faction);
    }
  }

  function canManageFactionMarket() {
    const membership=state?.primaryMembership;
    const faction=membership?.faction;
    if(!membership || !faction) return false;
    return faction.leader_user_id===session.user.id || (membership.permissions||[]).includes("market");
  }

  function renderFactionMarketControls() {
    const controls=$("factionMarketControls");
    const unavailable=$("factionMarketUnavailable");
    if(!controls || !unavailable) return;

    const allowed=canManageFactionMarket();
    controls.hidden=!allowed;
    unavailable.hidden=allowed;
    if(!allowed) return;

    const factionId=state.primaryMembership.faction_id;
    const markets=(state.markets||[]).filter(row=>row.faction_id===factionId && row.status==="active");
    const marketSelect=$("factionMarketSelect");
    marketSelect.innerHTML=markets.length
      ? markets.map(row=>'<option value="'+esc(row.id)+'">'+esc(row.name)+' // '+esc(row.location_ref || "UNPLACED")+'</option>').join("")
      : '<option value="">No faction markets</option>';

    const availableAssets=(state.factionAssets||[])
      .filter(row=>row.faction_id===factionId && Number(row.quantity)>0)
      .map(row=>({...row,asset:state.catalog.find(asset=>asset.id===row.asset_id)}))
      .filter(row=>row.asset);

    $("factionListingAsset").innerHTML=availableAssets.length
      ? availableAssets.map(row=>'<option value="'+esc(row.asset_id)+'">'+esc(row.asset.name)+' // '+esc(fmt(row.quantity))+' '+esc(row.asset.unit || "units")+'</option>').join("")
      : '<option value="">No faction inventory</option>';
  }

  function renderMarkets() {
    const root = $("marketList");
    if (!root) return;
    const listings = (state.marketListings || []).filter(x => x.market && x.asset);
    const stations = state.tradeStations || [];
    const stationByMarket = new Map(stations.map(row=>[row.market_id,row]));
    const groups = new Map();
    listings.forEach(row => {
      if (!groups.has(row.market_id)) groups.set(row.market_id,[]);
      groups.get(row.market_id).push(row);
    });

    const cards=[];
    stations.forEach(station => {
      const rows=groups.get(station.market_id) || [];
      const market=state.markets?.find(row=>row.id===station.market_id);
      cards.push(`
        <article class="notice">
          <div class="split-actions"><div><strong style="color:var(--text)">${esc(station.station_name)}</strong><div class="section-code">GUILDED CONCORD TRADE STATION // ${esc(station.location_ref)}</div></div><span class="status-chip">EXCHANGE</span></div>
          <div class="resource-list" style="margin-top:10px">
            ${rows.length ? rows.map(row => `
              <div class="resource-row market-row" data-listing="${esc(row.id)}">
                <div><strong>${esc(row.asset.name)}</strong><div class="section-code">${esc(row.asset.kind || "resource")} // STOCK: ${row.stock==null?"UNLIMITED":esc(fmt(row.stock))}</div></div>
                <div style="display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
                  <span>${esc(fmt(row.price_per_unit))} A / ${esc(row.asset.unit || "unit")}</span>
                  <input class="market-qty" type="number" min="0.0001" step="0.0001" value="1" style="width:92px">
                  <button class="hud-button secondary market-buy" type="button">BUY</button>
                </div>
              </div>`).join("") : '<div class="empty-state">NO CURRENT LISTINGS.</div>'}
          </div>
        </article>`);
      groups.delete(station.market_id);
    });

    groups.forEach(rows => {
      const market=rows[0].market;
      cards.push(`
        <article class="notice">
          <div class="split-actions"><div><strong style="color:var(--text)">${esc(market.name)}</strong><div class="section-code">${esc(String(market.market_type).toUpperCase())} MARKET // ${esc(market.location_ref || "NETWORK ACCESS")}</div></div></div>
          <div class="resource-list" style="margin-top:10px">
            ${rows.map(row => `
              <div class="resource-row market-row" data-listing="${esc(row.id)}">
                <div><strong>${esc(row.asset.name)}</strong><div class="section-code">${esc(row.asset.kind || "resource")} // STOCK: ${row.stock==null?"UNLIMITED":esc(fmt(row.stock))}</div></div>
                <div style="display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
                  <span>${esc(fmt(row.price_per_unit))} A / ${esc(row.asset.unit || "unit")}</span>
                  <input class="market-qty" type="number" min="0.0001" step="0.0001" value="1" style="width:92px">
                  <button class="hud-button secondary market-buy" type="button">BUY</button>
                </div>
              </div>`).join("")}
          </div>
        </article>`);
    });

    root.innerHTML=cards.join("");
    $("marketEmpty").hidden=cards.length>0;

    root.querySelectorAll(".market-buy").forEach(button => {
      button.addEventListener("click", async () => {
        const row = button.closest(".market-row");
        const qty = Number(row.querySelector(".market-qty").value || 0);
        try {
          const result = await rpc("purchase_market_listing",{p_listing_id:row.dataset.listing,p_quantity:qty});
          setState($("marketState"),"PURCHASE COMPLETE // " + fmt(result.cost) + " AUREUM","success");
          await refresh();
        } catch (error) {
          setState($("marketState"),"PURCHASE FAILED // " + error.message,"error");
        }
      });
    });
  }

  function renderFacilities() {
    const root = $("facilityList");
    if (!root) return;
    const rows = state.facilities || [];
    if (!rows.length) {
      root.innerHTML = "";
      $("facilityEmpty").hidden = false;
      return;
    }
    $("facilityEmpty").hidden = true;
    root.innerHTML = rows.map(row => {
      const type = row.facility_type;
      const personal = row.owner_user_id === session.user.id;
      return `
        <article class="notice">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(row.name || type?.name || "Facility")}</strong><div class="section-code">${personal?"PERSONAL HOLDING":"FACTION HOLDING"} // ${esc(type?.category || "facility")}</div></div>
            <span class="status-chip ${row.status==="active"?"":"amber"}">${esc(row.status)}</span>
          </div>
          <div class="telemetry-stack" style="margin-top:10px">
            <div class="telemetry-row"><span>Location</span><strong>${esc(row.location_ref || "UNPLACED")}</strong></div>
            <div class="telemetry-row"><span>Upkeep / Cycle</span><strong>${esc(fmt(type?.upkeep_aureum_per_cycle || 0))} AUREUM</strong></div>
            <div class="telemetry-row"><span>Production Modifier</span><strong>${esc(fmt(Number(row.production_modifier || 1)*100))}%</strong></div>
          </div>
        </article>`;
    }).join("");
  }

  async function renderCharacterPresence() {
    const root = $("characterLocationList");
    if (!root) return;
    const chars = (state.characters || []).filter(char => char.status === "active" && char.life_status === "alive");
    if (!chars.length) {
      root.innerHTML = "";
      $("characterLocationEmpty").hidden = false;
      return;
    }
    $("characterLocationEmpty").hidden = true;
    const counts = await Promise.all(chars.map(async char => {
      try { return await rpc("character_presence_count",{p_character_id:char.id}); }
      catch { return 0; }
    }));

    const living = chars[0];
    const livingCount = counts[0] || 0;
    const summary = $("characterPresenceSummary");
    if (summary) summary.textContent = livingCount + " OTHER CHARACTER" + (livingCount === 1 ? "" : "S") + " PRESENT";
    const identityLocation = $("characterIdentityLocation");
    if (identityLocation && living) identityLocation.textContent = String(living.location_name || living.location_ref || "LOCATION NOT SET").toUpperCase();

    root.innerHTML = chars.map((char,index) => `
      <article class="notice character-presence-row" data-id="${esc(char.id)}">
        <div class="split-actions">
          <div><strong style="color:var(--text)">${esc(char.name)}</strong><div class="section-code">${esc(char.location_name || char.location_ref || "LOCATION NOT SET")}</div></div>
          <span class="status-chip ${counts[index]?"amber":"muted"}">${counts[index]} OTHER CHARACTER${counts[index]===1?"":"S"} PRESENT</span>
        </div>
        <label style="margin-top:12px"><span>Presence Visibility</span>
          <select class="presence-mode">
            <option value="count_only" ${char.presence_mode==="count_only"?"selected":""}>Count only</option>
            <option value="public" ${char.presence_mode==="public"?"selected":""}>Public presence</option>
            <option value="hidden" ${char.presence_mode==="hidden"?"selected":""}>Hidden</option>
          </select>
        </label>
      </article>`).join("");

    root.querySelectorAll(".presence-mode").forEach(select => {
      select.addEventListener("change", async () => {
        const card = select.closest(".character-presence-row");
        try {
          await rpc("set_character_presence_mode",{p_character_id:card.dataset.id,p_mode:select.value});
          await refresh();
        } catch (error) {
          setState($("characterState"),"PRESENCE UPDATE FAILED // " + error.message,"error");
        }
      });
    });
  }

  async function renderAll(nextState) {
    state = nextState;
    if (!session) session = state.session;
    renderConfig();
    renderMarkets();
    renderFactionMarketControls();
    renderFacilities();
    await renderFactionSystems();
    await renderCharacterPresence();
  }

  $("factionMarketForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try{
      const result=await rpc("create_faction_market",{
        p_name:d.name.trim(),
        p_location_ref:d.location_ref.trim(),
        p_description:d.description.trim() || null
      });
      form.reset();
      await refresh("MARKET ESTABLISHED // "+fmt(result.cost)+" AUREUM",$("factionMarketState"));
    }catch(error){
      setState($("factionMarketState"),"MARKET CREATION FAILED // "+error.message,"error");
    }
  });

  $("factionListingForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try{
      await rpc("set_faction_market_listing",{
        p_market_id:d.market_id,
        p_asset_id:d.asset_id,
        p_price_per_unit:Number(d.price_per_unit),
        p_stock:d.stock===""?null:Number(d.stock)
      });
      await refresh("FACTION MARKET LISTING SAVED",$("factionListingState"));
    }catch(error){
      setState($("factionListingState"),"LISTING SAVE FAILED // "+error.message,"error");
    }
  });

  $("factionProposalForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      await rpc("create_faction_proposal",{
        p_name:d.name.trim(),
        p_code:d.code.trim() || null,
        p_description:d.description.trim() || null,
        p_contribution:Number(d.contribution || 0)
      });
      form.reset();
      await refresh("FOUNDING PROPOSAL CREATED",$("factionProposalState"));
    } catch (error) {
      setState($("factionProposalState"),"PROPOSAL FAILED // " + error.message,"error");
    }
  });

  $("factionFundingForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const membership=state.primaryMembership;
    try {
      await rpc("fund_faction",{
        p_faction_id:membership.faction_id,
        p_amount:Number(form.elements.amount.value || 0)
      });
      form.reset();
      await refresh("FACTION TREASURY FUNDED",$("factionFundingState"));
    } catch (error) {
      setState($("factionFundingState"),"TRANSFER FAILED // " + error.message,"error");
    }
  });

  $("factionIdentityForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    try {
      await rpc("rename_faction",{
        p_faction_id:state.primaryMembership.faction_id,
        p_name:form.elements.name.value.trim(),
        p_code:form.elements.code.value.trim() || null
      });
      await refresh("FACTION IDENTITY UPDATED",$("factionLeaderState"));
    } catch (error) {
      setState($("factionLeaderState"),"IDENTITY UPDATE FAILED // " + error.message,"error");
    }
  });

  $("saveFactionTax")?.addEventListener("click",async () => {
    try {
      await rpc("set_faction_tax_rate",{
        p_faction_id:state.primaryMembership.faction_id,
        p_tax_rate:Number($("factionIdentityForm").elements.tax_rate.value || 0)
      });
      await refresh("FACTION TAX RATE UPDATED",$("factionLeaderState"));
    } catch (error) {
      setState($("factionLeaderState"),"TAX UPDATE FAILED // " + error.message,"error");
    }
  });

  $("factionMemberInviteForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    if (!form.elements.user_id.value) return;
    try {
      await rpc("invite_faction_member",{
        p_faction_id:state.primaryMembership.faction_id,
        p_user_id:form.elements.user_id.value
      });
      setState($("factionLeaderState"),"MEMBERSHIP INVITATION SENT","success");
      form.reset();
    } catch (error) {
      setState($("factionLeaderState"),"INVITATION FAILED // " + error.message,"error");
    }
  });

  document.addEventListener("gm:player-state",event => {
    renderAll(event.detail).catch(error => {
      const notice=$("suiteNotice");
      if (notice) notice.textContent="EXTENDED SYSTEM ERROR // " + error.message;
    });
  });

  (async () => {
    session = await GMAuth.getSession();
    if (window.GMPlayerSuiteState) await renderAll(window.GMPlayerSuiteState);
  })();
})();