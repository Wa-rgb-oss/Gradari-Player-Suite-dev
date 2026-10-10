(() => {
  let session = null;
  let state = null;
  let factionDirectory = [];
  let chatFriends = [];
  let factionForumPosts = [];
  let factionJoinRequests = [];

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
    if ($("founderRequirement")) $("founderRequirement").textContent = cfg.faction_min_founders;
    if ($("factionCreationCost")) $("factionCreationCost").textContent = fmt(cfg.faction_creation_cost);
    if ($("founderMinimum")) $("founderMinimum").textContent = fmt(cfg.faction_min_contribution);
    const contribution = $("factionProposalForm")?.elements?.contribution;
    if (contribution) contribution.min = String(cfg.faction_min_contribution);
  }

  function factionTypeLabel(value) {
    const labels = {
      political_bloc:"Political Bloc",
      noble_house:"Noble House",
      corporate_alliance:"Corporate Alliance",
      colonial_movement:"Colonial Movement",
      military_institution:"Military Institution",
      regional_government:"Regional Government",
      ideological_organization:"Ideological Organization",
      commercial_alliance:"Commercial Alliance"
    };
    return labels[String(value || "").toLowerCase()] || "Player Faction";
  }

  async function loadFactionCommunityData() {
    const membership=state?.primaryMembership;
    const faction=membership?.faction;
    const isLeader=Boolean(faction && faction.leader_user_id===session.user.id && faction.leadership_status!=="vacant");
    const calls=[
      rpc("get_faction_directory"),
      rpc("get_my_chat_friends"),
      membership?.faction_id ? rpc("get_my_faction_forum_posts",{p_limit:60}) : Promise.resolve([])
    ];
    if(isLeader) calls.push(rpc("get_faction_join_requests"));
    const [directory,friends,forum,requests=[]]=await Promise.all(calls);
    factionDirectory=directory || [];
    chatFriends=friends || [];
    factionForumPosts=forum || [];
    factionJoinRequests=requests || [];
  }

  function renderFactionDirectory() {
    const root=$("factionDirectoryList");
    const empty=$("factionDirectoryEmpty");
    if(!root || !empty) return;
    const query=String($("factionDirectorySearch")?.value || "").trim().toLowerCase();
    const membership=state?.primaryMembership;
    const rows=factionDirectory.filter(row=>{
      if(!query) return true;
      return [row.name,row.code,row.leader_name,factionTypeLabel(row.faction_type),row.description]
        .some(value=>String(value||"").toLowerCase().includes(query));
    });

    empty.hidden=rows.length>0;
    root.innerHTML=rows.map(row=>{
      const current=membership?.faction_id===row.faction_id;
      const alreadyMember=Boolean(membership?.faction_id);
      const pending=row.my_request_status==="pending";
      let action="";
      if(current){
        action='<button class="hud-button secondary" type="button" disabled>CURRENT FACTION</button>';
      }else if(alreadyMember){
        action='<button class="hud-button secondary" type="button" disabled>IN A FACTION</button>';
      }else if(pending){
        action='<button class="hud-button secondary" type="button" disabled>REQUEST PENDING</button>';
      }else if(row.join_requests_enabled){
        action='<button class="hud-button faction-request-join" type="button" data-faction="'+esc(row.faction_id)+'">REQUEST TO JOIN</button>';
      }else{
        action='<button class="hud-button secondary" type="button" disabled>REQUESTS CLOSED</button>';
      }
      return '<article class="faction-directory-card">'+
        '<div class="faction-directory-card-head"><div>'+
          '<div class="section-code">'+esc(String(row.code||"NO CODE").toUpperCase())+' // '+esc(factionTypeLabel(row.faction_type).toUpperCase())+'</div>'+
          '<h3>'+esc(row.name||"Unnamed Faction")+'</h3>'+
        '</div><span class="status-chip">'+esc(fmt(row.member_count))+' MEMBER'+(Number(row.member_count)===1?"":"S")+'</span></div>'+
        '<p>'+esc(row.description||"No public faction description has been published.")+'</p>'+
        '<div class="faction-directory-meta"><span>LEADER</span><strong>'+esc(row.leader_name||"Vacant")+'</strong></div>'+
        '<div class="faction-directory-actions">'+action+'</div>'+
      '</article>';
    }).join("");

    root.querySelectorAll(".faction-request-join").forEach(button=>{
      button.addEventListener("click",async()=>{
        button.disabled=true;
        try{
          await rpc("request_join_faction",{p_faction_id:button.dataset.faction});
          setState($("factionDirectoryState"),"JOIN REQUEST SENT","success");
          await refresh();
        }catch(error){
          button.disabled=false;
          setState($("factionDirectoryState"),"JOIN REQUEST FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderFactionForum() {
    const root=$("factionForumList");
    const empty=$("factionForumEmpty");
    if(!root || !empty) return;
    const rows=(factionForumPosts||[]).slice().reverse();
    empty.hidden=rows.length>0;
    root.innerHTML=rows.map(row=>{
      const date=new Date(row.created_at);
      const stamp=Number.isNaN(date.getTime())?"":date.toLocaleDateString(undefined,{month:"short",day:"numeric"})+" // "+date.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
      return '<article class="faction-forum-post">'+
        '<div class="faction-forum-post-head"><strong>'+esc(row.display_name||"Player")+'</strong><small>'+esc(stamp)+'</small></div>'+
        '<p>'+esc(row.body||"")+'</p>'+
      '</article>';
    }).join("");
    root.scrollTop=root.scrollHeight;
  }

  function renderFactionJoinRequests() {
    const root=$("factionJoinRequestList");
    const empty=$("factionJoinRequestEmpty");
    if(!root || !empty) return;
    empty.hidden=factionJoinRequests.length>0;
    root.innerHTML=factionJoinRequests.map(row=>
      '<article class="notice"><div class="split-actions"><div><strong style="color:var(--text)">'+esc(row.display_name||"Player")+'</strong>'+
      '<div class="section-code">REQUESTED '+esc(new Date(row.created_at).toLocaleDateString())+'</div></div>'+
      '<div class="form-actions"><button class="hud-button faction-join-response" type="button" data-id="'+esc(row.request_id)+'" data-accept="true">ACCEPT</button>'+
      '<button class="hud-button danger faction-join-response" type="button" data-id="'+esc(row.request_id)+'" data-accept="false">DECLINE</button></div></div></article>'
    ).join("");

    root.querySelectorAll(".faction-join-response").forEach(button=>{
      button.addEventListener("click",async()=>{
        try{
          await rpc("respond_faction_join_request",{
            p_request_id:button.dataset.id,
            p_accept:button.dataset.accept==="true"
          });
          await refresh(button.dataset.accept==="true"?"PLAYER JOINED FACTION":"JOIN REQUEST DECLINED",$("factionLeaderState"));
        }catch(error){
          setState($("factionLeaderState"),"JOIN REQUEST UPDATE FAILED // "+error.message,"error");
        }
      });
    });
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
        const options = chatFriends
          .filter(p => p.user_id !== uid && !attached.has(p.user_id))
          .map(p => '<option value="' + esc(p.user_id) + '">' + esc(p.display_name || "Player") + '</option>')
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
    const memberSummary = $("factionMemberSummary");
    const memberControls = $("factionMemberControls");
    const leaderControls = $("factionLeaderControls");

    await loadFactionCommunityData();
    renderMembershipInvitations();
    renderFactionDirectory();

    if (!membership?.faction) {
      noFaction.hidden = false;
      memberSummary.hidden = true;
      memberControls.hidden = true;
      leaderControls.hidden = true;
      renderConfig();
      renderProposals();
      return;
    }

    noFaction.hidden = true;
    memberSummary.hidden = false;
    memberControls.hidden = false;
    renderFactionLedger();
    renderFactionForum();

    const faction = membership.faction;
    const directoryRow=factionDirectory.find(row=>row.faction_id===faction.id);
    if($("factionType")) $("factionType").textContent=factionTypeLabel(faction.faction_type).toUpperCase();
    if($("factionMemberCount")) $("factionMemberCount").textContent=fmt(directoryRow?.member_count||0)+" MEMBERS";

    const isLeader = faction.leader_user_id === session.user.id && faction.leadership_status !== "vacant";
    leaderControls.hidden = !isLeader;

    if (isLeader) {
      $("factionIdentityForm").elements.name.value = faction.name || "";
      $("factionIdentityForm").elements.code.value = faction.code || "";
      $("factionIdentityForm").elements.tax_rate.value = faction.tax_rate ?? 0;
      const select = $("factionInvitePlayer");
      const currentMembers = await GMAuth.api("faction_memberships?faction_id=eq." + encodeURIComponent(faction.id) + "&select=user_id");
      const memberIds = new Set(currentMembers.map(x => x.user_id));
      select.innerHTML = '<option value="">Select friend</option>' + chatFriends
        .filter(p => !memberIds.has(p.user_id))
        .map(p => '<option value="' + esc(p.user_id) + '">' + esc(p.display_name || "Player") + '</option>')
        .join("");
      renderFactionJoinRequests();
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
      const strategic=(state.tradeStationResources || []).filter(row=>row.market_id===station.market_id);
      const resourceNames=new Map((state.resourceCatalog || []).map(row=>[row.code,row]));
      cards.push(`
        <article class="notice">
          <div class="split-actions"><div><strong style="color:var(--text)">${esc(station.station_name)}</strong><div class="section-code">GUILDED CONCORD TRADE STATION // ${esc(station.location_ref)}</div></div><span class="status-chip">EXCHANGE</span></div>
          <div class="resource-list" style="margin-top:10px">
            ${strategic.map(row => {
              const resource=resourceNames.get(row.resource_code);
              return `<div class="resource-row station-resource-row" data-market="${esc(row.market_id)}" data-resource="${esc(row.resource_code)}">
                <div><strong>${esc(resource?.name || row.resource_code)}</strong><div class="section-code">${esc(String(resource?.category || "resource").toUpperCase())} // MARKET STOCK: ${row.stock==null?"UNLIMITED":esc(fmt(row.stock))} // AVAILABLE TO SELL: ${esc(fmt(Number((state.factionResources || []).find(item=>item.faction_id===state.primaryMembership?.faction_id && item.resource_code===row.resource_code)?.quantity || 0)))}</div></div>
                <div style="display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
                  <span class="${Number(row.demand_index||1)>1.015?"market-price-high":Number(row.demand_index||1)<.985?"market-price-low":"market-price-neutral"}">AVG ${esc(fmt(row.market_value ?? ((Number(row.buy_price)+Number(row.sell_price))/2)))} A // BUY ${esc(fmt(row.buy_price))} A // SELL ${esc(fmt(row.sell_price))} A</span>
                  <input class="station-resource-qty" type="number" min="0.01" step="0.01" value="1" style="width:82px">
                  <button class="hud-button secondary station-resource-buy" type="button">BUY</button>
                  <button class="hud-button secondary station-resource-sell" type="button">SELL</button>
                </div>
              </div>`;
            }).join("")}
            ${rows.map(row => `
              <div class="resource-row market-row" data-listing="${esc(row.id)}">
                <div><strong>${esc(row.asset.name)}</strong><div class="section-code">${esc(row.asset.kind || "resource")} // STOCK: ${row.stock==null?"UNLIMITED":esc(fmt(row.stock))}</div></div>
                <div style="display:flex;gap:7px;align-items:center;justify-content:flex-end;flex-wrap:wrap">
                  <span>${esc(fmt(row.price_per_unit))} A / ${esc(row.asset.unit || "unit")}</span>
                  <input class="market-qty" type="number" min="0.0001" step="0.0001" value="1" style="width:92px">
                  <button class="hud-button secondary market-buy" type="button">BUY</button>
                </div>
              </div>`).join("")}
            ${!rows.length&&!strategic.length?'<div class="empty-state">NO CURRENT LISTINGS.</div>':""}
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

    root.querySelectorAll(".station-resource-buy,.station-resource-sell").forEach(button => {
      button.addEventListener("click",async()=>{
        const row=button.closest(".station-resource-row");
        const qty=Number(row.querySelector(".station-resource-qty").value||0);
        const direction=button.classList.contains("station-resource-buy")?"buy":"sell";
        try{
          const result=await rpc("trade_station_resource",{p_market_id:row.dataset.market,p_resource_code:row.dataset.resource,p_quantity:qty,p_direction:direction});
          setState($("marketState"),direction.toUpperCase()+" COMPLETE // "+fmt(result.value)+" AUREUM","success");
          await refresh();
        }catch(error){setState($("marketState"),"TRADE FAILED // "+error.message,"error")}
      });
    });

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

  function resourceName(code) {
    return (state.resourceCatalog || []).find(r => r.code === code)?.name || code.replaceAll("_"," ");
  }

  function renderProduction() {
    const root=$("productionList"); if(!root) return;
    const factories=(state.facilities||[]).filter(f => f.owner_user_id===session.user.id && String(f.facility_type?.code||f.facility_type?.name||"").toUpperCase().includes("FACTORY"));
    $("productionEmpty").hidden=factories.length>0;
    if(!factories.length){root.innerHTML="";return;}
    const orders=new Map((state.factoryOrders||[]).map(o=>[o.facility_id,o]));
    root.innerHTML=factories.map(f=>{
      const o=orders.get(f.id), active=o?.status==="producing", done=active && new Date(o.completes_at)<=new Date();
      const recipe=(state.factoryRecipes||[]).find(r=>r.code===o?.recipe_code);
      if(active) return `<article class="notice production-factory" data-id="${esc(f.id)}"><div class="split-actions"><div><strong style="color:var(--text)">${esc(f.name||"Factory")}</strong><div class="section-code">${esc(f.location_ref||"UNPLACED")} // PRODUCTION LINE</div></div><span class="status-chip ${done?"":"amber"}">${done?"COMPLETE":"PRODUCING"}</span></div><div class="telemetry-stack" style="margin-top:10px"><div class="telemetry-row"><span>Output</span><strong>${esc(fmt(o.quantity))} × ${esc(recipe?.name||o.recipe_code)}</strong></div><div class="telemetry-row"><span>Completion</span><strong>${done?"READY TO COLLECT":esc(new Date(o.completes_at).toLocaleString())}</strong></div></div>${done?'<button class="hud-button collect-production" type="button">COLLECT PRODUCTION</button>':""}</article>`;
      const options=(state.factoryRecipes||[]).map(r=>`<option value="${esc(r.code)}">${esc(r.name)} // ${esc(fmt(r.production_world_hours||4))} HRS EACH</option>`).join("");
      return `<article class="notice production-factory" data-id="${esc(f.id)}"><div class="split-actions"><div><strong style="color:var(--text)">${esc(f.name||"Factory")}</strong><div class="section-code">${esc(f.location_ref||"UNPLACED")} // AVAILABLE</div></div></div><form class="production-form form-grid" style="margin-top:10px"><label><span>Production Line</span><select name="recipe_code">${options}</select></label><label><span>Quantity</span><input name="quantity" type="number" min="1" max="1000" step="1" value="1"></label><button class="hud-button" type="submit">BEGIN PRODUCTION</button></form></article>`;
    }).join("");
    root.querySelectorAll(".production-form").forEach(form=>form.addEventListener("submit",async e=>{e.preventDefault();const card=form.closest(".production-factory"),d=Object.fromEntries(new FormData(form));try{await rpc("queue_factory_production",{p_facility_id:card.dataset.id,p_recipe_code:d.recipe_code,p_quantity:Number(d.quantity)});await refresh("PRODUCTION STARTED",$("productionState"));}catch(error){setState($("productionState"),"PRODUCTION FAILED // "+error.message,"error");}}));
    root.querySelectorAll(".collect-production").forEach(btn=>btn.addEventListener("click",async()=>{const card=btn.closest(".production-factory");try{await rpc("collect_factory_production",{p_facility_id:card.dataset.id});await refresh("PRODUCTION COLLECTED",$("productionState"));}catch(error){setState($("productionState"),"COLLECTION FAILED // "+error.message,"error");}}));
  }

  function renderResourceStockpile() {
    const root=$("resourceStockpile"); if(!root)return;
    const catalog=new Map((state.resourceCatalog||[]).map(r=>[r.code,r]));
    const rows=(state.playerResources||[]).map(r=>({...r,resource:catalog.get(r.resource_code)})).filter(r=>Number(r.quantity||0)>0).sort((a,b)=>String(a.resource?.category||"Other").localeCompare(String(b.resource?.category||"Other"))||String(a.resource?.name||a.resource_code).localeCompare(String(b.resource?.name||b.resource_code)));
    $("resourceStockpileCount").textContent=rows.length+" RESOURCE"+(rows.length===1?"":"S");
    $("resourceStockpileEmpty").hidden=rows.length>0;
    root.innerHTML=rows.map(row=>`<article class="resource-stockpile-item"><div><span class="section-code">${esc(String(row.resource?.category||"RESOURCE").toUpperCase())}</span><strong>${esc(row.resource?.name||row.resource_code)}</strong></div><span class="resource-stockpile-qty">${esc(fmt(row.quantity))}</span></article>`).join("");
    const box=$("resourceContribution");
    if(!box)return;
    box.hidden=!rows.length||!state.primaryMembership?.faction_id;
    if(!box.hidden){
      box.innerHTML=`<div class="resource-contribution-head"><div><div class="section-code">FACTION TRANSFER</div><strong>Contribute Resources</strong></div><span class="resource-transfer-tag">PERSONAL → FACTION</span></div><p class="resource-contribution-copy">Move materials from your personal stockpile into your faction reserves.</p><div class="resource-contribution-controls"><label><span>Resource</span><select id="contributeResource">${rows.map(r=>`<option value="${esc(r.resource_code)}">${esc(r.resource?.name||r.resource_code)} // ${esc(fmt(r.quantity))} AVAILABLE</option>`).join("")}</select></label><label class="resource-contribution-qty"><span>Quantity</span><input id="contributeQuantity" type="number" min=".01" step=".01" value="1"></label><button id="contributeResourceButton" class="hud-button secondary" type="button">CONTRIBUTE</button></div><div id="contributeResourceState" class="form-state"></div>`;
      $("contributeResourceButton").addEventListener("click",async()=>{try{await rpc("contribute_resource_to_faction",{p_resource_code:$("contributeResource").value,p_quantity:Number($("contributeQuantity").value)});await refresh("RESOURCES CONTRIBUTED TO FACTION",$("contributeResourceState"));}catch(error){setState($("contributeResourceState"),"TRANSFER FAILED // "+error.message,"error")}});
    }
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
      const clock=(state.facilityProductionClocks||[]).find(x=>x.facility_id===row.id);
      const order=(state.factoryOrders||[]).find(x=>x.facility_id===row.id&&x.status==="producing");
      const nextAt=order?.completes_at||clock?.next_production_at||null;
      const timerLabel=order?"PRODUCTION COMPLETE":"NEXT OUTPUT";
      return `
        <article class="notice">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(row.name || type?.name || "Facility")}</strong><div class="section-code">${personal?"PERSONAL HOLDING":"FACTION HOLDING"} // ${esc(type?.category || "facility")}</div></div>
            <span class="status-chip ${row.status==="active"?"":"amber"}">${esc(row.status)}</span>
          </div>
          <div class="telemetry-stack" style="margin-top:10px">
            <div class="telemetry-row"><span>Location</span><strong>${esc(row.location_ref || "UNPLACED")}</strong></div>
            <div class="telemetry-row"><span>Upkeep / Day</span><strong>${esc(fmt(type?.upkeep_aureum_per_day ?? (Number(type?.upkeep_aureum_per_cycle || 0)/20)))} AUREUM</strong></div>
            <div class="telemetry-row"><span>Production Modifier</span><strong>${esc(fmt(Number(row.production_modifier || 1)*100))}%</strong></div>\n            ${nextAt?`<div class="telemetry-row facility-production-clock"><span>${timerLabel}</span><strong data-countdown="${esc(nextAt)}">--:--:--</strong></div>`:""}
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

    root.innerHTML = chars.map((char,index) => {
      const mode=char.presence_mode==="public"?"public":"hidden";
      return `
      <article class="notice character-presence-row" data-id="${esc(char.id)}">
        <div class="split-actions">
          <div><strong style="color:var(--text)">${esc(char.name)}</strong><div class="section-code">${esc(char.location_name || char.location_ref || "LOCATION NOT SET")}</div></div>
          <span class="status-chip ${counts[index]?"amber":"muted"}">${counts[index]} OTHER CHARACTER${counts[index]===1?"":"S"} PRESENT</span>
        </div>
        <div class="presence-choice-list" style="margin-top:12px">
          <label class="presence-choice ${mode==="public"?"selected":""}">
            <input class="presence-mode" type="radio" name="presence-${esc(char.id)}" value="public" ${mode==="public"?"checked":""}>
            <span><strong>PUBLIC PRESENCE</strong><small>Other players can see that you are here and see your character listed by name.</small></span>
          </label>
          <label class="presence-choice ${mode==="hidden"?"selected":""}">
            <input class="presence-mode" type="radio" name="presence-${esc(char.id)}" value="hidden" ${mode==="hidden"?"checked":""}>
            <span><strong>HIDE PRESENCE</strong><small>Your character is completely concealed from other players. You are not named and do not contribute to the visible character count.</small></span>
          </label>
        </div>
      </article>`;
    }).join("");

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

  function updateProductionCountdowns(){
    document.querySelectorAll("[data-countdown]").forEach(el=>{
      const ms=new Date(el.dataset.countdown).getTime()-Date.now();
      if(!Number.isFinite(ms)){el.textContent="--:--:--";return}
      if(ms<=0){el.textContent="READY";return}
      const sec=Math.ceil(ms/1000),h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
      el.textContent=String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
    });
  }
  if(!window.__gmProductionCountdown){window.__gmProductionCountdown=setInterval(updateProductionCountdowns,1000)}

  async function renderAll(nextState) {
    state = nextState;
    if (!session) session = state.session;
    renderConfig();
    renderMarkets();
    renderFactionMarketControls();
    renderFacilities();
    updateProductionCountdowns();
    renderProduction();
    renderResourceStockpile();
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

  $("factionDirectorySearch")?.addEventListener("input",renderFactionDirectory);

  $("factionForumForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const body=$("factionForumBody")?.value.trim();
    if(!body) return;
    try{
      await rpc("post_faction_forum_message",{p_body:body});
      $("factionForumBody").value="";
      await refresh("POST ADDED TO FACTION FORUM",$("factionForumState"));
    }catch(error){
      setState($("factionForumState"),"FORUM POST FAILED // "+error.message,"error");
    }
  });

  $("leaveFactionButton")?.addEventListener("click",async()=>{
    const faction=state?.primaryMembership?.faction;
    if(!faction) return;
    const confirmed=await GMUI.confirmAction(
      "Leave "+faction.name+"? Your Empire affiliation is not affected.",
      {code:"FACTION / MEMBERSHIP",title:"Leave Faction",confirmText:"LEAVE FACTION"}
    );
    if(!confirmed) return;
    try{
      await rpc("leave_faction");
      await refresh("FACTION MEMBERSHIP ENDED",$("leaveFactionState"));
    }catch(error){
      setState($("leaveFactionState"),"LEAVE FACTION FAILED // "+error.message,"error");
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
      const notice=$("suiteNotice") || $("marketState");
      if (notice) setState(notice,"SYSTEM DISPLAY ERROR // " + error.message,"error");
    });
  });

  (async () => {
    session = await GMAuth.getSession();
    if (window.GMPlayerSuiteState) await renderAll(window.GMPlayerSuiteState);
  })();
})();