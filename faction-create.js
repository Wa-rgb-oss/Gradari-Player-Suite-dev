(() => {
  const $=id=>document.getElementById(id);
  const esc=value=>GMUI.esc(value);
  const fmt=value=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const rpc=(name,args={})=>GMAuth.api("rpc/"+name,{method:"POST",body:JSON.stringify(args)});
  let session=null;
  let config=null;
  let wallet=null;
  let factions=[];
  let memberships=[];
  let proposals=[];
  let proposalMembers=[];
  let friends=[];
  let activeProposal=null;

  const typeInfo={
    political_bloc:["Political Bloc","A political coalition organized around shared policy, voting power, or institutional goals."],
    noble_house:["Noble House","A dynastic organization built around a House, lineage, retainers, and political influence."],
    corporate_alliance:["Corporate Alliance","A corporate or industrial organization pursuing commercial power, contracts, and economic influence."],
    colonial_movement:["Colonial Movement","An organization focused on settlement, expansion, colonial interests, and developing new systems."],
    military_institution:["Military Institution","A military-centered organization built around defense, fleets, armies, security, or strategic authority."],
    regional_government:["Regional Government","A territorial or administrative government representing a defined region, system, or group of worlds."],
    ideological_organization:["Ideological Organization","A movement organized around a political, social, religious, philosophical, or reformist cause."],
    commercial_alliance:["Commercial Alliance","A trade-focused coalition built around markets, logistics, merchants, and shared economic interests."]
  };

  function typeLabel(value){return typeInfo[value]?.[0]||"Player Faction";}
  function playerName(id){
    return friends.find(row=>row.user_id===id)?.display_name ||
      (id===session.user.id?"YOU":"PLAYER");
  }

  function renderTypes(){
    const select=$("factionCreateType");
    const root=$("factionTypeList");
    const renderDescription=()=>{
      const info=typeInfo[select.value]||["Player Faction",""];
      $("factionTypeDescription").innerHTML='<strong>'+esc(info[0])+'</strong><span>'+esc(info[1])+'</span>';
    };
    root.innerHTML=Object.entries(typeInfo).map(([code,[label,description]])=>
      '<button class="faction-type-option" type="button" data-type="'+esc(code)+'">'+
        '<strong>'+esc(label)+'</strong><span>'+esc(description)+'</span>'+
      '</button>'
    ).join("");
    root.querySelectorAll("[data-type]").forEach(button=>{
      button.addEventListener("click",()=>{
        select.value=button.dataset.type;
        renderDescription();
        root.querySelectorAll("[data-type]").forEach(x=>x.classList.toggle("active",x.dataset.type===select.value));
      });
    });
    select.addEventListener("change",()=>{
      renderDescription();
      root.querySelectorAll("[data-type]").forEach(x=>x.classList.toggle("active",x.dataset.type===select.value));
    });
    renderDescription();
    root.querySelector('[data-type="'+select.value+'"]')?.classList.add("active");
  }

  async function load(){
    const uid=encodeURIComponent(session.user.id);
    const [cfgRows,walletRows,membershipRows,factionRows,proposalRows,memberRows,friendRows]=await Promise.all([
      GMAuth.api("game_config?select=*&limit=1"),
      GMAuth.api("player_wallets?user_id=eq."+uid+"&select=balance&limit=1"),
      GMAuth.api("faction_memberships?user_id=eq."+uid+"&status=eq.active&select=*"),
      GMAuth.api("factions?select=id,name,code,is_player_created,status&order=name.asc"),
      GMAuth.api("faction_proposals?select=*&order=created_at.desc"),
      GMAuth.api("faction_proposal_members?select=*&order=created_at.asc"),
      rpc("get_my_chat_friends")
    ]);
    config=cfgRows?.[0]||null;
    wallet=walletRows?.[0]||null;
    memberships=membershipRows||[];
    factions=factionRows||[];
    proposals=proposalRows||[];
    proposalMembers=memberRows||[];
    friends=friendRows||[];
    activeProposal=proposals.find(row=>row.created_by===session.user.id&&row.status==="open")||null;
    render();
  }

  function render(){
    $("createFounderRequirement").textContent=config?.faction_min_founders||3;
    $("createFactionCost").textContent=fmt(config?.faction_creation_cost||0);
    $("createFounderMinimum").textContent=fmt(config?.faction_min_contribution||0);
    $("createPlayerBalance").textContent=fmt(wallet?.balance||0);
    const pledge=$("factionCreateForm").elements.contribution;
    pledge.min=String(config?.faction_min_contribution||0);

    const activeMembership=memberships.find(row=>{
      const faction=factions.find(item=>item.id===row.faction_id);
      return faction?.is_player_created!==false;
    });
    const activeFaction=factions.find(row=>row.id===activeMembership?.faction_id);

    $("factionCreateMemberBlock").hidden=!activeMembership;
    $("factionCreateFormBlock").hidden=Boolean(activeMembership)||Boolean(activeProposal);
    $("factionProposalWorkspace").hidden=!activeProposal;
    if(activeMembership){
      $("factionCreateMemberCopy").textContent="You are already a member of "+(activeFaction?.name||"an active faction")+". Leave that faction before creating another one.";
    }

    renderActiveProposal();
    renderFounderInvitations();
  }

  function renderActiveProposal(){
    if(!activeProposal) return;
    const members=proposalMembers.filter(row=>row.proposal_id===activeProposal.id);
    const accepted=members.filter(row=>row.status==="accepted");
    const pool=accepted.reduce((sum,row)=>sum+Number(row.contribution||0),0);
    $("activeProposalName").textContent=activeProposal.name;
    $("activeProposalDescription").textContent=activeProposal.description||"No public description.";
    $("activeFounderCount").textContent=accepted.length+" / "+(config?.faction_min_founders||3);
    $("activeFoundingPool").textContent=fmt(pool);
    $("activeProposalType").textContent=typeLabel(activeProposal.faction_type).toUpperCase();

    $("activeFounderList").innerHTML=members.map(row=>
      '<article class="resource-row"><div><strong>'+esc(playerName(row.user_id))+'</strong>'+
      '<div class="section-code">'+esc(String(row.status||"invited").toUpperCase())+'</div></div>'+
      '<span>'+esc(fmt(row.contribution))+' AUREUM</span></article>'
    ).join("");

    renderFriendList();

    const ready=accepted.length>=Number(config?.faction_min_founders||3) &&
      pool>=Number(config?.faction_creation_cost||0);
    $("finalizeFactionButton").disabled=!ready;
    $("finalizeFactionButton").textContent=ready?"FOUND FACTION":"WAITING FOR FOUNDERS";
  }

  function renderFriendList(){
    if(!activeProposal) return;
    const root=$("founderFriendList");
    const empty=$("founderFriendEmpty");
    const search=String($("founderFriendSearch").value||"").trim().toLowerCase();
    const attached=new Set(
      proposalMembers.filter(row=>row.proposal_id===activeProposal.id).map(row=>row.user_id)
    );
    const rows=friends.filter(row=>
      !attached.has(row.user_id) &&
      (!search || String(row.display_name||"").toLowerCase().includes(search))
    );
    empty.hidden=rows.length>0;
    root.innerHTML=rows.map(row=>
      '<button class="faction-friend-row" type="button" data-user="'+esc(row.user_id)+'">'+
        '<span class="game-chat-avatar">'+esc(String(row.display_name||"P").slice(0,1).toUpperCase())+'</span>'+
        '<span><strong>'+esc(row.display_name||"Player")+'</strong><small>FRIEND</small></span>'+
        '<i>INVITE</i>'+
      '</button>'
    ).join("");
    root.querySelectorAll("[data-user]").forEach(button=>{
      button.addEventListener("click",async()=>{
        button.disabled=true;
        try{
          await rpc("invite_faction_founder",{p_proposal_id:activeProposal.id,p_user_id:button.dataset.user});
          GMUI.setState($("factionFinalizeState"),"FOUNDER INVITATION SENT","success");
          await load();
        }catch(error){
          button.disabled=false;
          GMUI.setState($("factionFinalizeState"),"INVITATION FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderFounderInvitations(){
    const root=$("founderInvitationList");
    const empty=$("founderInvitationEmpty");
    const mine=proposalMembers.filter(row=>row.user_id===session.user.id&&row.status==="invited");
    const rows=mine.map(member=>({
      member,
      proposal:proposals.find(row=>row.id===member.proposal_id)
    })).filter(row=>row.proposal?.status==="open");

    empty.hidden=rows.length>0;
    root.innerHTML=rows.map(({member,proposal})=>
      '<article class="notice"><div class="split-actions"><div><strong style="color:var(--text)">'+esc(proposal.name)+'</strong>'+
      '<div class="section-code">'+esc(typeLabel(proposal.faction_type).toUpperCase())+' // FOUNDING INVITATION</div></div>'+
      '<span class="status-chip amber">INVITED</span></div>'+
      '<p>'+esc(proposal.description||"No description.")+'</p>'+
      '<label><span>Your Founder Pledge</span><input class="invite-pledge" data-id="'+esc(proposal.id)+'" type="number" min="'+esc(config?.faction_min_contribution||0)+'" step="0.01"></label>'+
      '<div class="form-actions"><button class="hud-button founder-invite-response" type="button" data-id="'+esc(proposal.id)+'" data-accept="true">ACCEPT</button>'+
      '<button class="hud-button danger founder-invite-response" type="button" data-id="'+esc(proposal.id)+'" data-accept="false">DECLINE</button></div></article>'
    ).join("");

    root.querySelectorAll(".founder-invite-response").forEach(button=>{
      button.addEventListener("click",async()=>{
        const accept=button.dataset.accept==="true";
        const pledge=root.querySelector('.invite-pledge[data-id="'+button.dataset.id+'"]');
        try{
          await rpc("respond_faction_invite",{
            p_proposal_id:button.dataset.id,
            p_accept:accept,
            p_contribution:accept?Number(pledge?.value||0):0
          });
          GMUI.setState($("founderInvitationState"),accept?"FOUNDING INVITATION ACCEPTED":"INVITATION DECLINED","success");
          await load();
        }catch(error){
          GMUI.setState($("founderInvitationState"),"INVITATION RESPONSE FAILED // "+error.message,"error");
        }
      });
    });
  }

  $("factionCreateForm").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const data=Object.fromEntries(new FormData(form));
    try{
      await rpc("create_faction_proposal",{
        p_name:data.name.trim(),
        p_code:data.code.trim()||null,
        p_description:data.description.trim()||null,
        p_contribution:Number(data.contribution||0),
        p_faction_type:data.faction_type
      });
      GMUI.setState($("factionCreateState"),"FOUNDING PROPOSAL CREATED","success");
      await load();
    }catch(error){
      GMUI.setState($("factionCreateState"),"PROPOSAL FAILED // "+error.message,"error");
    }
  });

  $("founderFriendSearch").addEventListener("input",renderFriendList);

  $("finalizeFactionButton").addEventListener("click",async()=>{
    if(!activeProposal) return;
    try{
      const result=await rpc("finalize_faction_proposal",{p_proposal_id:activeProposal.id});
      GMUI.setState($("factionFinalizeState"),"FACTION FOUNDED","success");
      setTimeout(()=>{location.href="player-suite/#faction";},500);
    }catch(error){
      GMUI.setState($("factionFinalizeState"),"FACTION CREATION FAILED // "+error.message,"error");
    }
  });

  window.addEventListener("load",async()=>{
    session=await GMUI.initProtected();
    if(!session) return;
    renderTypes();
    try{
      await load();
    }catch(error){
      GMUI.setState($("factionCreateState"),"FACTION DATA ERROR // "+error.message,"error");
    }
  });
})();