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

  const $ = id => document.getElementById(id);
  const esc = value => GMUI.esc(value);
  const fmt = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const setState = (el,message,type="") => GMUI.setState(el,message,type);

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

  function eligibleCharacters() {
    const faction = ownFaction();
    if (!faction) return [];
    return (player.characters || []).filter(char => char.status === "active" && char.faction_id === faction.id);
  }

  async function loadPolitics() {
    const [republicRows,seatRows,billRows,voteRows,influenceRows,txRows,taxRows,policyRows] = await Promise.all([
      GMAuth.api("republic_state?select=*&limit=1"),
      GMAuth.api("senate_faction_seats?select=*&order=seats.desc"),
      GMAuth.api("senate_bills?select=*&order=created_at.desc"),
      GMAuth.api("senate_votes?select=*&order=updated_at.desc"),
      GMAuth.api("character_influence?select=*&order=updated_at.desc"),
      GMAuth.api("influence_transactions?select=*&order=created_at.desc&limit=50"),
      GMAuth.api("federal_tax_assessments?select=*&order=assessed_at.desc&limit=20"),
      GMAuth.api("federal_policies?select=*&order=enacted_at.desc")
    ]);
    republic = republicRows?.[0] || null;
    seats = seatRows || [];
    bills = billRows || [];
    votes = voteRows || [];
    influence = influenceRows || [];
    influenceTransactions = txRows || [];
    taxAssessments = taxRows || [];
    policies = policyRows || [];
  }

  function seatColor(factionId) {
    return factionById(factionId)?.color || "#4fa8c4";
  }

  function buildSeatOwners(total) {
    const owners = [];
    seats
      .filter(row => Number(row.seats || 0) > 0)
      .sort((a,b) => Number(b.seats)-Number(a.seats))
      .forEach(row => {
        for (let i=0;i<Number(row.seats || 0) && owners.length<total;i++) owners.push(row.faction_id);
      });
    while (owners.length < total) owners.push(null);
    return owners.slice(0,total);
  }

  function rowCounts(total) {
    if (total === 120) return [12,16,20,22,24,26];
    const rows = Math.min(7,Math.max(4,Math.round(Math.sqrt(total)/2)));
    const weights = Array.from({length:rows},(_,i)=>1+i*.18);
    const sum = weights.reduce((a,b)=>a+b,0);
    const counts = weights.map(w => Math.max(1,Math.floor(total*w/sum)));
    let used = counts.reduce((a,b)=>a+b,0);
    let i = counts.length-1;
    while (used < total) { counts[i]++; used++; i=(i-1+counts.length)%counts.length; }
    while (used > total) {
      const j = counts.findIndex(x=>x>1);
      if (j<0) break;
      counts[j]--; used--;
    }
    return counts;
  }

  function renderChamber() {
    const total = Number(republic?.total_seats || player?.config?.senate_total_seats || 120);
    const owners = buildSeatOwners(total);
    const rows = rowCounts(total);
    const chamber = $("senateChamber");
    chamber.innerHTML = "";
    let index = 0;

    rows.forEach((count,rowIndex) => {
      const radius = 28 + rowIndex * (58 / Math.max(1,rows.length-1));
      for (let i=0;i<count && index<owners.length;i++,index++) {
        const t = count===1 ? .5 : i/(count-1);
        const angle = Math.PI * (1.08 + .84*t);
        const x = 50 + Math.cos(angle) * radius;
        const y = 84 + Math.sin(angle) * radius * .52;
        const factionId = owners[index];
        const seat = document.createElement("span");
        seat.className = "senate-seat" + (factionId ? " assigned" : "");
        seat.style.left = x + "%";
        seat.style.top = y + "%";
        if (factionId) {
          seat.style.setProperty("--seat-color",seatColor(factionId));
          seat.title = factionById(factionId)?.name || "Assigned seat";
        } else {
          seat.title = "Unassigned seat";
        }
        chamber.appendChild(seat);
      }
    });

    $("daisConsul").textContent = republic?.first_consul_name || "Vacant";
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
    $("chamberName").textContent = republic?.chamber_name || "Republic of Worlds Senate";
    $("firstConsul").textContent = republic?.first_consul_name || "Vacant";
    $("politicsAuthority").textContent = authority ? "POLITICS AUTHORIZED" : "VIEW ONLY";
    $("totalSeats").textContent = total;
    $("assignedSeats").textContent = assigned;
    $("federalTreasury").textContent = fmt(republic?.federal_treasury || 0);
    $("yourFactionSeats").textContent = faction ? ownSeats : "--";
    $("yourFactionSeatShare").textContent = faction && total ? ((ownSeats/total)*100).toFixed(1)+"% OF CHAMBER" : "NO REPRESENTATION";

    $("politicalFactionName").textContent = faction?.name || "No Active Faction";
    $("politicalFactionCode").textContent = faction?.code || "UNASSIGNED";
    $("factionSeatCount").textContent = faction ? ownSeats : "--";
    $("factionSeatPercent").textContent = faction && total ? ((ownSeats/total)*100).toFixed(1)+"%" : "--";
    $("factionFederalStatus").textContent = faction ? (faction.federal_member ? "IMPERIAL MEMBER" : "EXTERNAL / NON-FEDERAL") : "--";
    $("factionFederalTax").textContent = faction && faction.federal_member ? fmt(faction.federal_tax_rate)+"%" : "--";

    const arrears = taxAssessments.reduce((sum,row)=>sum+Number(row.arrears || 0),0);
    $("factionTaxArrears").textContent = faction ? fmt(arrears)+" A" : "--";

    const permissions = [];
    if (faction?.leader_user_id === session.user.id) permissions.push("FACTION LEADER");
    if ((ownMembership()?.permissions || []).includes("politics")) permissions.push("POLITICS");
    $("politicsPermissionList").innerHTML = permissions.length
      ? permissions.map(p=>'<span class="status-chip">'+esc(p)+'</span>').join("")
      : '<span class="status-chip muted">VIEW ONLY</span>';

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
      const recent = influenceTransactions.filter(tx=>tx.character_id===char.id).slice(0,3);
      const history = recent.length
        ? recent.map(tx=>'<div class="section-code">'+esc(new Date(tx.created_at).toLocaleDateString())+' // '+(Number(tx.amount)>=0?"+":"")+esc(fmt(tx.amount))+' // '+esc(tx.description || tx.kind)+'</div>').join("")
        : '<div class="section-code">NO INFLUENCE LEDGER ACTIVITY</div>';
      return '<article class="notice">'+
        '<div class="split-actions"><div><strong style="color:var(--text)">'+esc(char.name)+'</strong><div class="section-code">'+esc(char.title || "NO TITLE")+'</div></div>'+
        '<span class="influence-badge"><b>'+esc(fmt(wallet.balance))+'</b> INFLUENCE</span></div>'+
        '<div class="telemetry-stack" style="margin-top:10px">'+
        '<div class="telemetry-row"><span>Lifetime Earned</span><strong>'+esc(fmt(wallet.lifetime_earned))+'</strong></div>'+
        '<div class="telemetry-row"><span>Lifetime Spent</span><strong>'+esc(fmt(wallet.lifetime_spent))+'</strong></div>'+
        '</div><div style="margin-top:10px">'+history+'</div></article>';
    }).join("");
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
        '<div class="split-actions"><div><strong style="color:var(--text)">'+esc(bill.title)+'</strong><div class="section-code">'+esc(String(bill.bill_type || "LEGISLATION").toUpperCase())+' // '+esc(sponsor?.name || "FEDERAL")+' // SPONSOR: '+esc(bill.sponsor_character_name || "UNLISTED")+'</div></div>'+
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
    renderPolicies();
    renderBills();
    renderBillForm();
    renderTaxAssessments();
  }

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
      await refreshPolitics("BILL FILED WITH THE REPUBLIC OF WORLDS SENATE",$("billState"));
    } catch (error) {
      setState($("billState"),"BILL FILING FAILED // "+error.message,"error");
    }
  });

  (async () => {
    session = await GMUI.initProtected();
    if (!session) return;
    try {
      player = await GMPlayerData.load(session);
      await loadPolitics();
      renderAll();
    } catch (error) {
      document.body.classList.remove("auth-pending");
      const root = document.querySelector(".page-content");
      if (root) root.insertAdjacentHTML("afterbegin",'<div class="notice">POLITICAL SYSTEM ERROR // '+esc(error.message)+'</div>');
    }
  })();
})();