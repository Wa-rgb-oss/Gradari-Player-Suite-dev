(() => {
  let session = null;
  let player = null;
  let republic = null;
  let seats = [];
  let bills = [];
  let votes = [];
  let influence = [];
  let influenceTransactions = [];
  let taxAssessments = [];
  let policies = [];
  let politicalActionTypes = [];
  let politicalActivity = [];
  let worldClock = null;
  let offices = [];
  let elections = [];
  let electionCandidates = [];
  let electionVotes = [];

  const $ = id => document.getElementById(id);
  const esc = value => GMUI.esc(value);
  const fmt = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const setState = (el,message,type="") => GMUI.setState(el,message,type);

  function initPoliticsCommandPanel() {
    const panel=document.querySelector(".politics-command-panel");
    const tabs=[...document.querySelectorAll("[data-politics-tab]")];
    const pages=[...document.querySelectorAll(".politics-command-page")];
    tabs.forEach(tab=>tab.addEventListener("click",()=>{
      tabs.forEach(item=>item.classList.toggle("active",item===tab));
      pages.forEach(page=>page.classList.toggle("active",page.id===tab.dataset.politicsTab));
      if (tab.dataset.politicsTab==="politics-senate") scheduleChamberDraw();
    }));
    $("politicsPanelCollapse")?.addEventListener("click",()=>{
      panel?.classList.toggle("collapsed");
      $("politicsPanelCollapse").textContent=panel?.classList.contains("collapsed") ? "›" : "‹";
      setTimeout(scheduleChamberDraw,80);
    });
  }

  function factionById(id) {
    return player?.factions?.find(row => row.id === id) || null;
  }

  function characterById(id) {
    return player?.characters?.find(row => row.id === id) || null;
  }

  function influenceByCharacter(id) {
    return influence.find(row => row.character_id === id) || {balance:0,lifetime_earned:0,lifetime_spent:0};
  }

  function ownMembership() {
    return player?.primaryMembership || null;
  }

  function ownFaction() {
    return ownMembership()?.faction || null;
  }

  function ownSeatCount() {
    const faction = ownFaction();
    if (!faction) return 0;
    return Number(seats.find(row => row.faction_id === faction.id)?.seats || 0);
  }

  function canPolitics() {
    const membership = ownMembership();
    const faction = ownFaction();
    if (!membership || !faction) return false;
    return faction.leader_user_id === session.user.id || (membership.permissions || []).includes("politics");
  }

  function activeCharacters() {
    return (player?.characters || []).filter(char => char.status === "active" && char.life_status === "alive");
  }

  function eligibleCharacters() {
    const faction = ownFaction();
    if (!faction) return [];
    return activeCharacters().filter(char => char.faction_id === faction.id);
  }

  function worldTimeLabel(totalHours) {
    if (!Number.isFinite(Number(totalHours))) return "--";
    const whole = Math.floor(Number(totalHours));
    const aevum = Math.floor(whole/9360);
    const cycle = Math.floor((whole%9360)/720)+1;
    const week = Math.floor((whole%720)/180)+1;
    const day = Math.floor((whole%180)/36)+1;
    const hour = (whole%36)+1;
    return "A"+aevum+" C"+cycle+" W"+week+" D"+day+" H"+String(hour).padStart(2,"0");
  }

  async function loadPolitics() {
    const uid = encodeURIComponent(session.user.id);
    const [
      republicRows,seatRows,billRows,voteRows,influenceRows,txRows,taxRows,policyRows,
      politicalTypes,activityRows,clock,officeRows,electionRows,candidateRows,electionVoteRows
    ] = await Promise.all([
      GMAuth.api("republic_state?select=*&limit=1"),
      GMAuth.api("senate_faction_seats?select=*&order=seats.desc"),
      GMAuth.api("senate_bills?select=*&order=created_at.desc"),
      GMAuth.api("senate_votes?select=*&order=updated_at.desc"),
      GMAuth.api("character_influence?select=*&order=updated_at.desc"),
      GMAuth.api("influence_transactions?select=*&order=created_at.desc&limit=50"),
      GMAuth.api("federal_tax_assessments?select=*&order=assessed_at.desc&limit=20"),
      GMAuth.api("federal_policies?select=*&order=enacted_at.desc"),
      GMAuth.api("political_action_types?active=eq.true&select=*&order=name.asc"),
      GMAuth.api("political_activity_log?user_id=eq."+uid+"&select=*&order=world_hour.desc&limit=20"),
      GMAuth.api("rpc/get_world_clock",{method:"POST",body:"{}"}),
      GMAuth.api("imperial_offices?select=*&order=name.asc"),
      GMAuth.api("political_elections?select=*&order=created_at.desc"),
      GMAuth.api("election_candidates?select=*&order=created_at.asc"),
      GMAuth.api("election_votes?select=*&order=created_at.asc")
    ]);
    republic = republicRows?.[0] || null;
    seats = seatRows || [];
    bills = billRows || [];
    votes = voteRows || [];
    influence = influenceRows || [];
    influenceTransactions = txRows || [];
    taxAssessments = taxRows || [];
    policies = policyRows || [];
    politicalActionTypes = politicalTypes || [];
    politicalActivity = activityRows || [];
    worldClock = clock || null;
    offices = officeRows || [];
    elections = electionRows || [];
    electionCandidates = candidateRows || [];
    electionVotes = electionVoteRows || [];
  }

  function seatColor(factionId) {
    return factionById(factionId)?.color || "#4fa8c4";
  }

  const senateCanvas = $("senateCanvas");
  const senateCtx = senateCanvas.getContext("2d");
  let chamberResizeObserver = null;
  let chamberDrawFrame = 0;

  function buildSeatOwners(total) {
    const owners = [];
    seats
      .filter(row => Number(row.seats || 0) > 0)
      .sort((a,b) => Number(b.seats)-Number(a.seats))
      .forEach(row => {
        for (let i=0;i<Number(row.seats || 0) && owners.length<total;i++) {
          owners.push(row.faction_id);
        }
      });

    while (owners.length < total) owners.push(null);
    return owners.slice(0,total);
  }

  function referenceRowCounts(total) {
    if (total === 120) return [14,18,20,22,22,24];

    const rows = Math.min(7,Math.max(4,Math.round(Math.sqrt(total)/2)));
    const weights = Array.from({length:rows},(_,i)=>1+i*.16);
    const weightTotal = weights.reduce((a,b)=>a+b,0);
    const counts = weights.map(weight => Math.max(1,Math.floor(total*weight/weightTotal)));
    let used = counts.reduce((a,b)=>a+b,0);
    let cursor = counts.length-1;

    while (used < total) {
      counts[cursor]++;
      used++;
      cursor = (cursor-1+counts.length)%counts.length;
    }

    while (used > total) {
      const index = counts.findIndex(value=>value>1);
      if (index < 0) break;
      counts[index]--;
      used--;
    }

    return counts;
  }

  function buildSeatPositions(total) {
    const positions = [];
    const counts = referenceRowCounts(total);
    const baseRadius = 160;
    const rowGap = 34;

    counts.forEach((count,row) => {
      const radius = baseRadius + row*rowGap;
      const angleStart = Math.PI*1.05;
      const angleEnd = Math.PI*1.95;

      for (let i=0;i<count;i++) {
        const t = count===1 ? .5 : i/(count-1);
        const angle = angleStart+(angleEnd-angleStart)*t;
        positions.push({
          x:Math.cos(angle)*radius,
          y:Math.sin(angle)*radius,
          angle,
          row
        });
      }
    });

    return positions;
  }

  function hexPath(ctx,x,y,size) {
    ctx.beginPath();
    for (let i=0;i<6;i++) {
      const angle = Math.PI/180*(60*i-30);
      const px = x+size*Math.cos(angle);
      const py = y+size*Math.sin(angle);
      if (i===0) ctx.moveTo(px,py);
      else ctx.lineTo(px,py);
    }
    ctx.closePath();
  }

  function currentChamberTotal() {
    return Number(republic?.total_seats || player?.config?.senate_total_seats || 120);
  }

  function drawChamberCanvas() {
    const stage = senateCanvas.closest(".senate-stage");
    if (!stage) return;

    const width = Math.max(460,stage.clientWidth || 900);
    const height = Math.max(560,stage.clientHeight || 720);
    const dpr = Math.min(2,window.devicePixelRatio || 1);
    const total = currentChamberTotal();
    const owners = buildSeatOwners(total);

    senateCanvas.width = Math.round(width*dpr);
    senateCanvas.height = Math.round(height*dpr);
    senateCanvas.style.width = width+"px";
    senateCanvas.style.height = height+"px";

    senateCtx.setTransform(dpr,0,0,dpr,0,0);
    senateCtx.clearRect(0,0,width,height);

    const scale = Math.min(width/930,height/790);
    const center = {x:width/2,y:height*.72};
    const positions = buildSeatPositions(total);

    const ordered = positions
      .map((position,index)=>({position,index}))
      .sort((a,b)=>a.position.angle-b.position.angle || a.position.row-b.position.row);

    const ownerByPosition = Array(total).fill(null);
    ordered.forEach((entry,orderIndex) => {
      ownerByPosition[entry.index] = owners[orderIndex] || null;
    });

    const background = senateCtx.createRadialGradient(
      center.x,center.y*.62,30,
      center.x,center.y,Math.max(width,height)*.72
    );
    background.addColorStop(0,"rgba(12,31,43,.44)");
    background.addColorStop(.54,"rgba(4,16,23,.20)");
    background.addColorStop(1,"rgba(1,7,10,0)");
    senateCtx.fillStyle = background;
    senateCtx.fillRect(0,0,width,height);

    senateCtx.strokeStyle = "rgba(55,135,154,.58)";
    senateCtx.lineWidth = Math.max(1,2*scale);
    [150,184,218,252,286,320,354].forEach(radius => {
      senateCtx.beginPath();
      senateCtx.arc(center.x,center.y,radius*scale,Math.PI*1.05,Math.PI*1.95);
      senateCtx.stroke();
    });

    senateCtx.strokeStyle = "rgba(79,205,227,.16)";
    senateCtx.lineWidth = 1;
    senateCtx.beginPath();
    senateCtx.arc(center.x,center.y,383*scale,Math.PI*1.05,Math.PI*1.95);
    senateCtx.stroke();

    positions.forEach((position,index) => {
      const factionId = ownerByPosition[index];
      const x = center.x+position.x*scale;
      const y = center.y+position.y*scale;
      const size = Math.max(7,13*scale);

      hexPath(senateCtx,x,y,size);

      if (factionId) {
        const color = seatColor(factionId);
        senateCtx.save();
        senateCtx.shadowColor = color;
        senateCtx.shadowBlur = Math.max(2,6*scale);
        senateCtx.fillStyle = color;
        senateCtx.fill();
        senateCtx.restore();
        senateCtx.strokeStyle = "rgba(2,8,12,.95)";
      } else {
        senateCtx.fillStyle = "#edf1f2";
        senateCtx.fill();
        senateCtx.strokeStyle = "#101619";
      }

      senateCtx.lineWidth = Math.max(1,2*scale);
      senateCtx.stroke();
    });

    const daisRadius = 120*scale;
    senateCtx.fillStyle = "rgba(4,14,20,.97)";
    senateCtx.beginPath();
    senateCtx.arc(center.x,center.y,daisRadius,0,Math.PI*2);
    senateCtx.fill();

    senateCtx.strokeStyle = "#4fd4e8";
    senateCtx.lineWidth = Math.max(1.5,2.2*scale);
    senateCtx.shadowColor = "rgba(79,212,232,.28)";
    senateCtx.shadowBlur = 12*scale;
    senateCtx.stroke();
    senateCtx.shadowBlur = 0;

    senateCtx.strokeStyle = "rgba(79,212,232,.18)";
    senateCtx.lineWidth = 1;
    senateCtx.beginPath();
    senateCtx.arc(center.x,center.y,daisRadius-8*scale,0,Math.PI*2);
    senateCtx.stroke();

    const titleY = center.y-430*scale;
    senateCtx.textAlign = "center";
    senateCtx.textBaseline = "middle";
    senateCtx.fillStyle = "#d8a35d";
    senateCtx.font = `500 ${Math.max(17,22*scale)}px "Share Tech Mono", Consolas, monospace`;
    senateCtx.fillText("SENATE",center.x,titleY);

    senateCtx.fillStyle = "rgba(134,215,232,.55)";
    senateCtx.font = `400 ${Math.max(8,10*scale)}px "Share Tech Mono", Consolas, monospace`;
    senateCtx.fillText(
      `${owners.filter(Boolean).length} ASSIGNED // ${total} TOTAL SEATS`,
      center.x,titleY+26*scale
    );

    senateCtx.fillStyle = "#91a9b1";
    senateCtx.font = `400 ${Math.max(9,12*scale)}px "Share Tech Mono", Consolas, monospace`;
    senateCtx.fillText("FIRST CONSUL",center.x,center.y-10*scale);

    senateCtx.fillStyle = "#d8a35d";
    senateCtx.font = `500 ${Math.max(13,18*scale)}px "Share Tech Mono", Consolas, monospace`;
    senateCtx.fillText(republic?.first_consul_name || "Vacant",center.x,center.y+17*scale);
  }

  function scheduleChamberDraw() {
    cancelAnimationFrame(chamberDrawFrame);
    chamberDrawFrame = requestAnimationFrame(() => {
      drawChamberCanvas();
      setTimeout(drawChamberCanvas,60);
    });
  }

  function renderChamber() {
    scheduleChamberDraw();

    if (!chamberResizeObserver && "ResizeObserver" in window) {
      const stage = senateCanvas.closest(".senate-stage");
      chamberResizeObserver = new ResizeObserver(scheduleChamberDraw);
      chamberResizeObserver.observe(stage);
    }

    $("senateLegend").innerHTML = seats
      .filter(row => Number(row.seats || 0)>0)
      .sort((a,b)=>Number(b.seats)-Number(a.seats))
      .map(row => {
        const faction = factionById(row.faction_id);
        if (!faction) return "";
        return '<span class="senate-legend-item"><i style="--legend-color:'+esc(faction.color || "#4fa8c4")+'"></i><strong>'+esc(faction.name)+'</strong><small>'+esc(String(row.seats))+' seats</small></span>';
      }).join("") || '<span class="status-chip muted">NO SENATE SEATS ASSIGNED</span>';
  }

  function renderSummary() {
    const total = Number(republic?.total_seats || player?.config?.senate_total_seats || 120);
    const assigned = seats.reduce((sum,row)=>sum+Number(row.seats || 0),0);
    const faction = ownFaction();
    const ownSeats = ownSeatCount();
    const authority = canPolitics();

    $("governmentName").textContent = republic?.government_name || "Gradari Mireris Empire";
    $("firstConsul").textContent = republic?.first_consul_name || "Vacant";
    $("politicsAuthority").textContent = authority ? "DELEGATE" : "OBSERVER";
    $("totalSeats").textContent = total;
    $("assignedSeats").textContent = assigned;
    $("unassignedSeats").textContent = Math.max(0,total-assigned);
    $("senateStageStatus").textContent = total+"-SEAT CHAMBER";
    $("federalTreasury").textContent = fmt(republic?.federal_treasury || 0);
    $("yourFactionSeats").textContent = faction ? ownSeats : "--";
    $("yourFactionSeatShare").textContent = faction && total ? ((ownSeats/total)*100).toFixed(1)+"% OF CHAMBER" : "NO REPRESENTATION";

    $("politicalFactionName").textContent = faction?.name || "No Active Faction";
    $("politicalFactionCode").textContent = faction?.code || "UNASSIGNED";
    $("factionSeatCount").textContent = faction ? ownSeats : "--";
    $("factionSeatPercent").textContent = faction && total ? ((ownSeats/total)*100).toFixed(1)+"%" : "--";
    $("factionFederalTax").textContent = faction && faction.federal_member ? fmt(faction.federal_tax_rate)+"%" : "--";

    const arrears = taxAssessments.reduce((sum,row)=>sum+Number(row.arrears || 0),0);
    $("factionTaxArrears").textContent = faction ? fmt(arrears)+" A" : "--";

    const permissions = [];
    if (faction?.leader_user_id === session.user.id) permissions.push("FACTION LEADER");
    if ((ownMembership()?.permissions || []).includes("politics")) permissions.push("POLITICS");
    $("politicsPermissionList").innerHTML = permissions.length
      ? permissions.map(p=>'<span class="status-chip">'+esc(p)+'</span>').join("")
      : '<span class="status-chip muted">OBSERVER</span>';

    $("billInfluenceCost").textContent = fmt(player?.config?.bill_proposal_influence_cost || 0);
  }

  function renderInfluence() {
    const root = $("influenceList");
    const chars = player?.characters || [];
    if (!chars.length) {
      root.innerHTML = "";
      $("influenceEmpty").hidden = false;
      return;
    }
    $("influenceEmpty").hidden = true;
    root.innerHTML = chars.map(char => {
      const wallet = influenceByCharacter(char.id);
      const alive = char.status === "active" && char.life_status === "alive";
      const recent = influenceTransactions.filter(tx=>tx.character_id===char.id).slice(0,3);
      const history = recent.length
        ? recent.map(tx=>'<div class="section-code">'+esc(new Date(tx.created_at).toLocaleDateString())+' // '+(Number(tx.amount)>=0?"+":"")+esc(fmt(tx.amount))+' // '+esc(tx.description || tx.kind)+'</div>').join("")
        : '<div class="section-code">NO INFLUENCE LEDGER ACTIVITY</div>';
      return '<article class="notice">'+
        '<div class="split-actions"><div><strong style="color:var(--text)">'+esc(char.name)+'</strong><div class="section-code">'+esc(char.title || "NO TITLE")+' // '+(alive?"ALIVE":"DECEASED")+'</div></div>'+
        '<span class="influence-badge"><b>'+esc(fmt(wallet.balance))+'</b> INFLUENCE</span></div>'+
        '<div class="telemetry-stack" style="margin-top:10px">'+
        '<div class="telemetry-row"><span>Lifetime Earned</span><strong>'+esc(fmt(wallet.lifetime_earned))+'</strong></div>'+
        '<div class="telemetry-row"><span>Lifetime Spent</span><strong>'+esc(fmt(wallet.lifetime_spent))+'</strong></div>'+
        '</div><div style="margin-top:10px">'+history+'</div></article>';
    }).join("");
  }

  function renderPoliticalActivity() {
    const form = $("politicalActivityForm");
    const locked = $("politicalActivityLocked");
    if (!form || !locked) return;

    const chars = activeCharacters();
    form.hidden = !chars.length;
    locked.hidden = Boolean(chars.length);

    if (!chars.length) return;

    const charSelect = $("politicalActivityCharacter");
    const previousChar = charSelect.value;
    charSelect.innerHTML = chars.map(char =>
      '<option value="'+esc(char.id)+'">'+esc(char.name)+'</option>'
    ).join("");
    if (chars.some(char=>char.id===previousChar)) charSelect.value=previousChar;

    const typeSelect = $("politicalActivityType");
    const previousType = typeSelect.value;
    typeSelect.innerHTML = politicalActionTypes.length
      ? politicalActionTypes.map(row =>
          '<option value="'+esc(row.code)+'">'+esc(row.name)+'</option>'
        ).join("")
      : '<option value="">No activities available</option>';
    if (politicalActionTypes.some(row=>row.code===previousType)) typeSelect.value=previousType;

    const charId = charSelect.value;
    const action = politicalActionTypes.find(row=>row.code===typeSelect.value);
    const last = politicalActivity
      .filter(row=>row.character_id===charId)
      .sort((a,b)=>Number(b.world_hour)-Number(a.world_hour))[0] || null;
    const cooldown = Number(player?.config?.political_action_cooldown_world_hours || 36);
    const now = Number(worldClock?.total_world_hours || 0);
    const availableAt = last ? Number(last.world_hour)+cooldown : now;
    const remaining = Math.max(0,availableAt-now);

    $("politicalActivityReward").textContent = action ? "+"+fmt(action.influence_reward)+" INF" : "--";
    $("politicalActivityCost").textContent = action ? fmt(action.aureum_cost)+" A" : "--";
    $("politicalActivityAvailability").textContent = remaining>0
      ? worldTimeLabel(availableAt)+" // "+fmt(remaining)+" HRS"
      : "AVAILABLE";

    const button = $("politicalActivityBtn");
    button.disabled = !action || remaining>0;
    button.textContent = remaining>0 ? "ACTIVITY ON COOLDOWN" : "PERFORM ACTIVITY";
  }

  function billTally(billId) {
    const rows = votes.filter(v=>v.bill_id===billId);
    return {
      yes:rows.filter(v=>v.choice==="yes").reduce((s,v)=>s+Number(v.seats_at_vote||0),0),
      no:rows.filter(v=>v.choice==="no").reduce((s,v)=>s+Number(v.seats_at_vote||0),0),
      abstain:rows.filter(v=>v.choice==="abstain").reduce((s,v)=>s+Number(v.seats_at_vote||0),0)
    };
  }

  function renderPolicies() {
    const root = $("policyList");
    const rows = policies || [];
    if (!rows.length) {
      root.innerHTML = "";
      $("policyEmpty").hidden = false;
      return;
    }
    $("policyEmpty").hidden = true;
    root.innerHTML = rows.map(row =>
      '<article class="notice">'+
      '<div class="split-actions"><div><strong style="color:var(--text)">'+esc(row.title)+'</strong><div class="section-code">'+esc(String(row.policy_type || "LEGISLATION").toUpperCase())+' // ENACTED '+esc(new Date(row.enacted_at).toLocaleDateString())+'</div></div>'+
      '<span class="status-chip '+(row.status==="active"?"":"muted")+'">'+esc(row.status)+'</span></div>'+
      (row.description?'<div style="margin-top:10px">'+esc(row.description)+'</div>':"")+
      '</article>'
    ).join("");
  }

  function renderOffices() {
    const root=$("officeList");
    const rows=offices || [];
    if (!rows.length) {
      root.innerHTML="";
      $("officeEmpty").hidden=false;
      return;
    }
    $("officeEmpty").hidden=true;
    root.innerHTML=rows.map(office => {
      const holderName=office.current_holder_name ||
        (office.code==="FIRST_CONSUL" && republic?.first_consul_name && republic.first_consul_name!=="Vacant"
          ? republic.first_consul_name
          : characterById(office.current_holder_character_id)?.name || null);
      const term=office.holder_until_world_hour ? worldTimeLabel(office.holder_until_world_hour) : "NO FIXED TERM";
      return '<article class="notice">'+
        '<div class="split-actions"><div><strong style="color:var(--text)">'+esc(office.name)+'</strong><div class="section-code">'+esc(String(office.selection_method).toUpperCase().replaceAll("_"," "))+'</div></div>'+
        '<span class="status-chip '+(holderName?"":"muted")+'">'+esc(holderName || "VACANT")+'</span></div>'+
        (office.description?'<div style="margin-top:9px">'+esc(office.description)+'</div>':"")+
        '<div class="section-code" style="margin-top:9px">TERM // '+esc(term)+' // CANDIDATE MINIMUM '+esc(fmt(office.candidate_influence_min))+' INF</div>'+
        '</article>';
    }).join("");
  }

  function renderElections() {
    const root=$("electionList");
    const rows=elections || [];
    if (!rows.length) {
      root.innerHTML="";
      $("electionEmpty").hidden=false;
      return;
    }
    $("electionEmpty").hidden=true;

    const activeChar=activeCharacters()[0] || null;
    const faction=ownFaction();
    const politics=canPolitics();
    const seatsHeld=ownSeatCount();

    root.innerHTML=rows.map(election => {
      const office=offices.find(row=>row.id===election.office_id);
      const candidates=electionCandidates.filter(row=>row.election_id===election.id);
      const ownCandidate=activeChar ? candidates.find(row=>row.character_id===activeChar.id && row.status==="declared") : null;
      const ownVote=electionVotes.find(row=>row.election_id===election.id && row.voter_user_id===session.user.id);
      const open=election.status==="open";
      const canDeclare=open && activeChar && election.selection_method!=="appointment" && !ownCandidate;
      const canVote=open && activeChar && candidates.some(row=>row.status==="declared") &&
        (election.selection_method==="character_vote" ||
          (election.selection_method==="senate_seats" && politics && seatsHeld>0 && faction));

      const candidateRows=candidates.length
        ? candidates.map(candidate => {
            const publicWeight=election.status==="resolved"
              ? electionVotes.filter(v=>v.election_id===election.id && v.candidate_character_id===candidate.character_id)
                  .reduce((sum,v)=>sum+Number(v.weight||0),0)
              : null;
            return '<div class="resource-row"><div><strong>'+esc(candidate.candidate_name)+'</strong><div class="section-code">'+esc(candidate.faction_name || "NO FACTION")+' // '+esc(candidate.status.toUpperCase())+'</div></div><span>'+
              (publicWeight===null ? (ownVote?.candidate_character_id===candidate.character_id ? "YOUR VOTE" : "CANDIDATE") : esc(fmt(publicWeight))+" VOTE WEIGHT")+
              '</span></div>';
          }).join("")
        : '<div class="empty-state">NO CANDIDATES DECLARED.</div>';

      const characterOptions=activeChar ? '<option value="'+esc(activeChar.id)+'">'+esc(activeChar.name)+'</option>' : "";
      const candidateOptions=candidates.filter(row=>row.status==="declared").map(row =>
        '<option value="'+esc(row.character_id)+'">'+esc(row.candidate_name)+'</option>'
      ).join("");

      return '<article class="notice election-card" data-election="'+esc(election.id)+'">'+
        '<div class="split-actions"><div><strong style="color:var(--text)">'+esc(election.title)+'</strong><div class="section-code">'+esc(office?.name || "OFFICE")+' // '+esc(String(election.selection_method).toUpperCase().replaceAll("_"," "))+'</div></div>'+
        '<span class="status-chip '+(open?"amber":"")+'">'+esc(election.status==="resolved" ? election.result : election.status)+'</span></div>'+
        '<div class="section-code" style="margin-top:9px">OPENS '+esc(worldTimeLabel(election.opens_world_hour))+' // CLOSES '+esc(worldTimeLabel(election.closes_world_hour))+'</div>'+
        (election.winner_name?'<div class="section-code" style="margin-top:6px">WINNER // '+esc(election.winner_name)+'</div>':"")+
        '<div class="resource-list" style="margin-top:10px">'+candidateRows+'</div>'+
        (canDeclare?'<button class="hud-button secondary declare-candidate" type="button" style="margin-top:10px">DECLARE CANDIDACY</button>':"")+
        (canVote?'<div class="senate-vote-controls election-vote-controls" style="margin-top:10px">'+
          '<select class="election-vote-character">'+characterOptions+'</select>'+
          '<select class="election-vote-candidate">'+candidateOptions+'</select>'+
          '<button class="hud-button secondary cast-election-vote" type="button">'+(ownVote?"UPDATE VOTE":"CAST VOTE")+'</button></div>':"")+
        '</article>';
    }).join("");

    root.querySelectorAll(".declare-candidate").forEach(button => {
      button.addEventListener("click",async () => {
        const card=button.closest(".election-card");
        const char=activeCharacters()[0];
        const statement=prompt("Candidate statement (optional):","");
        if (statement===null || !char) return;
        try {
          await GMAuth.api("rpc/declare_election_candidacy",{
            method:"POST",
            body:JSON.stringify({
              p_election_id:card.dataset.election,
              p_character_id:char.id,
              p_statement:statement.trim() || null
            })
          });
          await refreshPolitics("CANDIDACY DECLARED",$("electionState"));
        } catch (error) {
          setState($("electionState"),"CANDIDACY FAILED // "+error.message,"error");
        }
      });
    });

    root.querySelectorAll(".cast-election-vote").forEach(button => {
      button.addEventListener("click",async () => {
        const card=button.closest(".election-card");
        const characterId=card.querySelector(".election-vote-character").value;
        const candidateId=card.querySelector(".election-vote-candidate").value;
        try {
          await GMAuth.api("rpc/cast_election_vote",{
            method:"POST",
            body:JSON.stringify({
              p_election_id:card.dataset.election,
              p_candidate_character_id:candidateId,
              p_character_id:characterId
            })
          });
          await refreshPolitics("VOTE RECORDED",$("electionState"));
        } catch (error) {
          setState($("electionState"),"VOTE FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderBills() {
    const root = $("billList");
    if (!bills.length) {
      root.innerHTML = "";
      $("billEmpty").hidden = false;
      return;
    }
    $("billEmpty").hidden = true;
    const faction = ownFaction();
    const authority = canPolitics();
    const characters = eligibleCharacters();
    const mySeats = ownSeatCount();

    root.innerHTML = bills.map(bill => {
      const sponsor = factionById(bill.sponsor_faction_id);
      const tally = billTally(bill.id);
      const existing = faction ? votes.find(v=>v.bill_id===bill.id && v.faction_id===faction.id) : null;
      const closed = bill.status !== "open" || (bill.closes_at && new Date(bill.closes_at)<new Date());
      const characterOptions = characters.map(char=>'<option value="'+esc(char.id)+'">'+esc(char.name)+'</option>').join("");
      const voteControls = !closed && authority && mySeats>0 && characters.length
        ? '<div class="senate-vote-controls" data-bill="'+esc(bill.id)+'">'+
          '<select class="vote-character">'+characterOptions+'</select>'+
          '<select class="vote-choice"><option value="yes" '+(existing?.choice==="yes"?"selected":"")+'>YES</option><option value="no" '+(existing?.choice==="no"?"selected":"")+'>NO</option><option value="abstain" '+(existing?.choice==="abstain"?"selected":"")+'>ABSTAIN</option></select>'+
          '<button class="hud-button secondary cast-vote" type="button">CAST '+esc(String(mySeats))+'-SEAT VOTE</button></div>'
        : '<div class="section-code" style="margin-top:12px">'+
          (closed ? "VOTING CLOSED" : mySeats<=0 ? "YOUR FACTION HOLDS NO SENATE SEATS" : !authority ? "POLITICS AUTHORITY REQUIRED TO CAST THE FACTION VOTE" : "A FACTION-ALIGNED CHARACTER IS REQUIRED")+
          '</div>';

      return '<article class="notice senate-bill">'+
        '<div class="split-actions"><div><strong style="color:var(--text)">'+esc(bill.title)+'</strong><div class="section-code">'+esc(String(bill.bill_type || "LEGISLATION").toUpperCase())+' // '+esc(sponsor?.name || "SENATE")+' // SPONSOR: '+esc(bill.sponsor_character_name || "UNLISTED")+'</div></div>'+
        '<span class="status-chip '+(bill.status==="open"?"amber":"")+'">'+esc(bill.status==="resolved" ? bill.result : bill.status)+'</span></div>'+
        (bill.description?'<div style="margin-top:10px">'+esc(bill.description)+'</div>':"")+
        '<div class="senate-tally" style="margin-top:12px"><span>YES <b>'+esc(String(bill.status==="resolved" ? bill.final_yes ?? tally.yes : tally.yes))+'</b></span><span>NO <b>'+esc(String(bill.status==="resolved" ? bill.final_no ?? tally.no : tally.no))+'</b></span><span>ABSTAIN <b>'+esc(String(bill.status==="resolved" ? bill.final_abstain ?? tally.abstain : tally.abstain))+'</b></span></div>'+
        (bill.closes_at?'<div class="section-code" style="margin-top:10px">VOTING CLOSES // '+esc(new Date(bill.closes_at).toLocaleString())+'</div>':"")+
        voteControls+
        '</article>';
    }).join("");

    root.querySelectorAll(".cast-vote").forEach(button => {
      button.addEventListener("click",async () => {
        const wrap = button.closest(".senate-vote-controls");
        try {
          setState($("voteState"),"TRANSMITTING FACTION VOTE...");
          await GMAuth.api("rpc/cast_senate_vote",{
            method:"POST",
            body:JSON.stringify({
              p_bill_id:wrap.dataset.bill,
              p_character_id:wrap.querySelector(".vote-character").value,
              p_choice:wrap.querySelector(".vote-choice").value
            })
          });
          await refreshPolitics("FACTION VOTE RECORDED",$("voteState"));
        } catch (error) {
          setState($("voteState"),"VOTE FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderBillForm() {
    const form = $("billForm");
    const locked = $("billFormLocked");
    const chars = eligibleCharacters();
    const allowed = canPolitics() && ownSeatCount()>0 && chars.length>0;
    form.hidden = !allowed;
    locked.hidden = allowed;
    $("billCharacter").innerHTML = chars.map(char => {
      const wallet = influenceByCharacter(char.id);
      return '<option value="'+esc(char.id)+'">'+esc(char.name)+' // '+esc(fmt(wallet.balance))+' Influence</option>';
    }).join("");
  }

  function renderTaxAssessments() {
    const root = $("taxAssessmentList");
    if (!taxAssessments.length) {
      root.innerHTML = "";
      $("taxAssessmentEmpty").hidden = false;
      return;
    }
    $("taxAssessmentEmpty").hidden = true;
    root.innerHTML = taxAssessments.map(row =>
      '<article class="notice"><div class="split-actions"><div><strong style="color:var(--text)">'+esc(row.cycle_key)+'</strong><div class="section-code">'+esc(new Date(row.assessed_at).toLocaleDateString())+' // '+esc(String(row.status).toUpperCase())+'</div></div><span class="status-chip '+(Number(row.arrears)>0?"amber":"")+'">'+esc(fmt(row.tax_paid))+' / '+esc(fmt(row.tax_due))+' A</span></div>'+
      '<div class="telemetry-stack" style="margin-top:10px"><div class="telemetry-row"><span>Taxable Revenue</span><strong>'+esc(fmt(row.taxable_revenue))+' A</strong></div><div class="telemetry-row"><span>Rate</span><strong>'+esc(fmt(row.tax_rate))+'%</strong></div><div class="telemetry-row"><span>Arrears</span><strong>'+esc(fmt(row.arrears))+' A</strong></div></div></article>'
    ).join("");
  }

  async function refreshPolitics(message="",target=null) {
    await loadPolitics();
    renderAll();
    if (target && message) setState(target,message,"success");
  }

  function renderAll() {
    renderSummary();
    renderChamber();
    renderInfluence();
    renderPoliticalActivity();
    renderPolicies();
    renderOffices();
    renderElections();
    renderBills();
    renderBillForm();
    renderTaxAssessments();
  }

  $("politicalActivityCharacter")?.addEventListener("change",renderPoliticalActivity);
  $("politicalActivityType")?.addEventListener("change",renderPoliticalActivity);

  $("politicalActivityForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      setState($("politicalActivityState"),"POLITICAL ACTIVITY IN PROGRESS...");
      const result=await GMAuth.api("rpc/perform_political_action",{
        method:"POST",
        body:JSON.stringify({
          p_character_id:d.character_id,
          p_action_code:d.action_code
        })
      });
      await refreshPolitics(
        "ACTIVITY COMPLETE // +"+fmt(result.influence_gained)+" INFLUENCE",
        $("politicalActivityState")
      );
    } catch (error) {
      setState($("politicalActivityState"),"ACTIVITY FAILED // "+error.message,"error");
    }
  });

  $("billForm").addEventListener("submit",async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = Object.fromEntries(new FormData(form));
    try {
      setState($("billState"),"FILING LEGISLATION...");
      await GMAuth.api("rpc/submit_senate_bill",{
        method:"POST",
        body:JSON.stringify({
          p_character_id:d.character_id,
          p_title:d.title.trim(),
          p_description:d.description.trim() || null,
          p_bill_type:d.bill_type,
          p_closes_at:d.closes_at ? new Date(d.closes_at).toISOString() : null
        })
      });
      form.reset();
      await refreshPolitics("BILL FILED WITH THE SENATE",$("billState"));
    } catch (error) {
      setState($("billState"),"BILL FILING FAILED // "+error.message,"error");
    }
  });

  (async () => {
    session = await GMUI.initProtected();
    if (!session) return;
    try {
      player = await GMPlayerData.load(session);
      initPoliticsCommandPanel();
      await loadPolitics();
      renderAll();
    } catch (error) {
      document.body.classList.remove("auth-pending");
      const root = document.querySelector(".page-content");
      if (root) root.insertAdjacentHTML("afterbegin",'<div class="notice">POLITICAL SYSTEM ERROR // '+esc(error.message)+'</div>');
    }
  })();
})();