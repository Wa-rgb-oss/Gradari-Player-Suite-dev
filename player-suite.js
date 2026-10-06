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

  function renderProductionPanel(ownedFacilities,typeMap){
    const root=$("productionList");
    const empty=$("productionEmpty");
    if(!root || !empty) return;

    const depositsByLocation=new Map();
    (state.resourceDeposits || []).forEach(row=>{
      const key=String(row.location_ref || "");
      if(!depositsByLocation.has(key)) depositsByLocation.set(key,[]);
      depositsByLocation.get(key).push(row);
    });

    const facilityById=new Map(ownedFacilities.map(row=>[row.id,row]));
    const connectionsByRefinery=new Map();
    (state.facilityConnections || []).forEach(connection=>{
      if(!connectionsByRefinery.has(connection.refinery_facility_id)) connectionsByRefinery.set(connection.refinery_facility_id,[]);
      connectionsByRefinery.get(connection.refinery_facility_id).push(connection);
    });

    const resourceMap=new Map((state.resourceCatalog || []).map(row=>[String(row.code),row]));
    const activeFacilities=ownedFacilities.filter(row=>String(row.status || "active").toLowerCase()==="active");

    const outputsForFacility=facility=>{
      const type=typeMap.get(facility.facility_type_id);
      const code=String(type?.code || "").toUpperCase();
      const health=Math.max(0,Math.min(100,Number(facility.health ?? 100)))/100;
      const modifier=Number(facility.production_modifier ?? 1);
      const results=[];

      if(code==="AGRI_COMPLEX"){
        results.push({code:"food",quantity:360*modifier*health});
      }else if(code==="MINE"){
        for(const deposit of depositsByLocation.get(String(facility.location_ref || "")) || []){
          const richness=Number(deposit.richness ?? 1);
          results.push({
            code:String(deposit.resource_code),
            quantity:360*richness*modifier*health
          });
        }
      }else if(code==="REFINERY"){
        const connections=connectionsByRefinery.get(facility.id) || [];
        const seen=new Set();
        for(const connection of connections){
          const extractor=facilityById.get(connection.extractor_facility_id);
          if(!extractor) continue;
          for(const deposit of depositsByLocation.get(String(extractor.location_ref || "")) || []){
            if(seen.has(deposit.resource_code)) continue;
            const outputCode={
              gold_ore:"refined_gold",
              vyr_ore:"vyrsteel",
              aetherite:"refined_aetherite"
            }[deposit.resource_code];
            if(!outputCode) continue;
            seen.add(deposit.resource_code);
            results.push({
              code:outputCode,
              quantity:288*Number(deposit.richness ?? 1)*modifier*health
            });
          }
        }
      }

      return results;
    };

    if(!activeFacilities.length){
      root.innerHTML="";
      empty.textContent=ownedFacilities.length
        ? "ALL OWNED FACILITIES ARE CURRENTLY INACTIVE."
        : "BUILD A FACTORY TO BEGIN MANUFACTURING.";
      empty.hidden=false;
      return;
    }

    const cards=activeFacilities.map(facility=>{
      const type=typeMap.get(facility.facility_type_id);
      const outputs=outputsForFacility(facility);
      const health=Math.max(0,Math.min(100,Number(facility.health ?? 100)));
      const code=String(type?.code || "").toUpperCase();
      const passive=code==="MINE" || code==="AGRI_COMPLEX" || code==="REFINERY";

      let outputHtml;
      if(!passive){
        const orders=(state.factoryOrders || []).filter(order=>order.facility_id===facility.id);
        const activeOrder=orders.find(order=>String(order.status || "").toLowerCase()==="producing")
          || orders.find(order=>["queued","active","in_progress"].includes(String(order.status || "").toLowerCase()));
        if(activeOrder){
          const recipe=(state.factoryRecipes || []).find(row=>row.code===activeOrder.recipe_code);
          const resource=resourceMap.get(String(recipe?.output_resource_code || ""));
          const outputName=resource?.name || recipe?.name || activeOrder.recipe_code || "Factory Output";
          const quantity=Number(activeOrder.quantity || 1)*Number(recipe?.output_quantity || 1);
          const completion=activeOrder.completes_at ? new Date(activeOrder.completes_at).toLocaleString() : "IN PROGRESS";
          outputHtml='<div class="production-output-row">'+
            '<div><strong>'+esc(outputName)+'</strong><span>ACTIVE FACTORY ORDER</span></div>'+
            '<strong>'+esc(fmt(quantity))+' '+esc(resource?.unit || "UNITS")+'</strong>'+
            '</div>'+
            '<div class="production-output-row">'+
            '<div><strong>COMPLETION</strong><span>PRODUCTION SCHEDULE</span></div>'+
            '<strong>'+esc(completion)+'</strong>'+
            '</div>';
        }else{
          const selected=(state.factoryOrders || []).find(order=>order.facility_id===facility.id);
          const recipe=(state.factoryRecipes || []).find(row=>row.code===selected?.recipe_code);
          outputHtml='<div class="production-output-empty">'+
            (recipe ? 'PRODUCTION LINE // '+esc(recipe.name || recipe.code) : 'NO ACTIVE FACTORY PRODUCTION')+
            '<br><span>SET FACTORY PRODUCTION FROM MAP // LOCATION ACTIONS</span></div>';
        }
      }else if(!outputs.length){
        outputHtml='<div class="production-output-empty">'+
          (code==="MINE" ? "NO RESOURCE DEPOSIT CONNECTED." : "NO ACTIVE OUTPUT.")+
          '</div>';
      }else{
        outputHtml=outputs.map(output=>{
          const item=resourceMap.get(output.code);
          const unit=item?.unit || "units";
          const name=item?.name || output.code.replace(/_/g," ");
          return '<div class="production-output-row">'+
            '<div><strong>'+esc(name)+'</strong><span>'+esc(String(output.code).toUpperCase())+'</span></div>'+
            '<strong>+'+esc(fmt(output.quantity))+' '+esc(unit)+' / DAY</strong>'+
            '</div>';
        }).join("");
      }

      return '<article class="notice production-facility-row">'+
        '<div class="production-facility-head">'+
          '<div><strong>'+esc(facility.name || type?.name || "Facility")+'</strong>'+
          '<div class="section-code">'+esc(type?.name || "FACILITY")+' // '+esc(facility.location_ref || "LOCATION UNSET")+'</div></div>'+
          '<span class="status-chip">'+esc(fmt(health))+'% EFFECTIVENESS</span>'+
        '</div>'+
        '<div class="production-output-list">'+outputHtml+'</div>'+
        '</article>';
    }).join("");

    root.innerHTML=cards;
    empty.hidden=true;
  }

  function facilityDailyOutputs(facility,typeMap,ownedFacilities){
    const type=typeMap.get(facility.facility_type_id);
    const code=String(type?.code || "").toUpperCase();
    const health=Math.max(0,Math.min(100,Number(facility.health ?? 100)))/100;
    const modifier=Number(facility.production_modifier ?? 1);
    const outputs=[];
    if(code==="AGRI_COMPLEX") outputs.push({code:"food",quantity:360*modifier*health});
    else if(code==="RESEARCH_SITE") outputs.push({code:"research_points",quantity:36*modifier*health});
    else if(code==="MINE"){
      (state.resourceDeposits||[]).filter(d=>d.location_ref===facility.location_ref).forEach(d=>outputs.push({code:String(d.resource_code),quantity:360*Number(d.richness??1)*modifier*health}));
    }else if(code==="REFINERY"){
      const seen=new Set();
      (state.facilityConnections||[]).filter(x=>x.refinery_facility_id===facility.id).forEach(link=>{
        const extractor=ownedFacilities.find(x=>x.id===link.extractor_facility_id) || (state.facilities||[]).find(x=>x.id===link.extractor_facility_id);
        if(!extractor) return;
        (state.resourceDeposits||[]).filter(d=>d.location_ref===extractor.location_ref).forEach(d=>{
          const out={gold_ore:"refined_gold",vyr_ore:"vyrsteel",aetherite:"refined_aetherite"}[d.resource_code];
          if(!out||seen.has(d.resource_code)) return; seen.add(d.resource_code);
          outputs.push({code:out,quantity:288*Number(d.richness??1)*modifier*health});
        });
      });
    }else if(code==="FACTORY"){
      const order=(state.factoryOrders||[]).find(x=>x.facility_id===facility.id&&["producing","storage_blocked"].includes(String(x.status||"").toLowerCase()));
      const recipe=(state.factoryRecipes||[]).find(x=>x.code===order?.recipe_code);
      if(recipe){
        const hours=Math.max(1,Number(recipe.production_world_hours||1));
        outputs.push({code:String(recipe.output_resource_code),quantity:(36/hours)*Number(recipe.output_quantity||1)*modifier*health});
      }
    }
    return outputs;
  }

  function facilityProductionRateHtml(facility,typeMap,ownedFacilities){
    const resourceMap=new Map((state.resourceCatalog||[]).map(x=>[String(x.code),x]));
    const outputs=facilityDailyOutputs(facility,typeMap,ownedFacilities);
    if(!outputs.length) return '<div class="section-code">PRODUCTION // NO ACTIVE DAILY OUTPUT</div>';
    return '<div class="section-code">PRODUCTION // '+outputs.map(o=>{
      const resource=resourceMap.get(o.code);
      const label=o.code==="research_points"?"RESEARCH POINTS":String(resource?.name||o.code).toUpperCase();
      return '+'+fmt(o.quantity)+' '+label+' / DAY';
    }).join(' // ')+'</div>';
  }

  function renderEconomy() {
    $("economyBalance").textContent = fmt(state.wallet?.balance);
    $("economyCurrency").textContent = String(state.wallet?.currency || "Aureum").toUpperCase();

    const ownedFacilities=(state.facilities || []).filter(row => row.owner_user_id === session.user.id);
    const facilityNet=$("economyFacilityNet");
    const facilityList=$("ownedFacilityList");
    const facilityEmpty=$("ownedFacilityEmpty");
    const facilityCount=$("ownedFacilityCount");
    const typeMap=new Map((state.facilityTypes || []).map(row => [row.id,row]));

    const storageFacilities=ownedFacilities.filter(row=>String(typeMap.get(row.facility_type_id)?.code||"").toUpperCase()==="STORAGE"&&String(row.status||"active").toLowerCase()==="active");
    const storageCapacity=storageFacilities.length*5000;
    const storageUsed=(state.playerResources||state.resources||[]).reduce((sum,row)=>sum+Math.max(0,Number(row.quantity||0)),0);
    const storageAvailable=Math.max(0,storageCapacity-storageUsed);
    const storagePct=storageCapacity>0?Math.min(100,(storageUsed/storageCapacity)*100):0;
    if($("storageStatus")) $("storageStatus").textContent=fmt(storageUsed)+" / "+fmt(storageCapacity);
    if($("storageUsed")) $("storageUsed").textContent=fmt(storageUsed)+" UNITS";
    if($("storageCapacity")) $("storageCapacity").textContent=fmt(storageCapacity)+" UNITS";
    if($("storageAvailable")) $("storageAvailable").textContent=fmt(storageAvailable)+" UNITS";
    if($("storageFill")) $("storageFill").style.width=storagePct+"%";
    if($("storageWarning")){
      $("storageWarning").textContent=storageCapacity<=0?"NO STORAGE CAPACITY // RESOURCE PRODUCTION HALTED":storageAvailable<=0?"STORAGE FULL // RESOURCE PRODUCTION HALTED":"";
      $("storageWarning").classList.toggle("error",storageCapacity<=0||storageAvailable<=0);
    }

    facilityCount.textContent=ownedFacilities.length+"/20 FACILITIES";
    if(ownedFacilities.length){
      // Player-owned facilities currently debit Aureum upkeep each in-game day. Resource production
      // remains a strategic output, so it is not falsely converted into Aureum profit here.
      const netAureum=-ownedFacilities
        .filter(row => String(row.status || "active").toLowerCase() !== "inactive")
        .reduce((sum,row) => sum + Number(typeMap.get(row.facility_type_id)?.upkeep_aureum_per_cycle || 0),0);
      facilityNet.hidden=false;
      facilityNet.classList.toggle("positive",netAureum>0);
      facilityNet.classList.toggle("negative",netAureum<0);
      facilityNet.textContent=(netAureum>=0?"+":"")+fmt(netAureum)+" AUREUM / DAY // FACILITY NET";

      facilityEmpty.hidden=true;
      facilityList.innerHTML=ownedFacilities.map(row=>{
        const type=typeMap.get(row.facility_type_id);
        const upkeep=Number(type?.upkeep_aureum_per_cycle || 0);
        const status=String(row.status || "active").toUpperCase();
        const health=Math.max(0,Math.min(100,Number(row.health ?? 100)));
        const healthLabel=health>=75?"GOOD":health>=40?"DAMAGED":health>0?"CRITICAL":"OFFLINE";
        return '<article class="notice economy-facility-row">'+
          '<div><strong>'+esc(row.name || type?.name || "Facility")+'</strong>'+
          '<div class="section-code">'+esc(type?.name || "FACILITY")+' // '+esc(row.location_ref || "LOCATION UNSET")+'</div>'+facilityProductionRateHtml(row,typeMap,ownedFacilities)+
          '<div class="facility-health"><span>FACILITY HEALTH</span><strong>'+esc(fmt(health))+'% // '+healthLabel+'</strong><div class="facility-health-track"><i style="width:'+health+'%"></i></div><small>'+esc(fmt(health))+'% PRODUCTION EFFECTIVENESS</small></div></div>'+
          '<div class="economy-facility-meta"><span class="status-chip '+(status==="ACTIVE"?"":"muted")+'">'+esc(status)+'</span>'+
          '<strong class="economy-facility-cost">'+(upkeep?'-'+esc(fmt(upkeep)):'0')+' AUREUM / DAY</strong>'+
          '<div class="facility-edit-actions"><button class="hud-button secondary edit-owned-facility" type="button" data-id="'+esc(row.id)+'">EDIT</button><button class="hud-button danger scrap-owned-facility" type="button" data-id="'+esc(row.id)+'">SCRAP</button></div></div>'+
          '</article>';
      }).join("");
    }else{
      facilityNet.hidden=true;
      facilityNet.textContent="";
      facilityList.innerHTML="";
      facilityEmpty.hidden=false;
    }

    facilityList.querySelectorAll(".edit-owned-facility").forEach(button=>button.addEventListener("click",async()=>{
      const facility=ownedFacilities.find(row=>row.id===button.dataset.id);
      if(!facility) return;
      const type=typeMap.get(facility.facility_type_id);
      const choice=await GMUI.modal({
        code:"FACILITY / EDIT",
        title:facility.name || type?.name || "Facility",
        message:"Rename this facility or scrap it permanently.",
        input:true,
        inputLabel:"Facility Name",
        defaultValue:facility.name || "",
        confirmText:"SAVE NAME"
      });
      if(choice===null) return;
      try{
        await GMAuth.api("rpc/update_owned_facility",{method:"POST",body:JSON.stringify({p_facility_id:facility.id,p_name:choice})});
        await refreshState();
      await loadFriends();
      }catch(error){
        await GMUI.modal({code:"FACILITY / ERROR",title:"Update Failed",message:error.message,confirmText:"CLOSE"});
      }
    }));

    facilityList.querySelectorAll(".scrap-owned-facility").forEach(button=>button.addEventListener("click",async()=>{
      const facility=ownedFacilities.find(row=>row.id===button.dataset.id);
      if(!facility) return;
      const ok=await GMUI.confirmAction("Scrap "+(facility.name || "this facility")+"? This permanently removes the facility and does not refund its construction cost.",{
        code:"FACILITY / SCRAP",title:"Scrap Facility",confirmText:"SCRAP FACILITY",danger:true
      });
      if(!ok) return;
      try{
        await GMAuth.api("rpc/scrap_owned_facility",{method:"POST",body:JSON.stringify({p_facility_id:facility.id})});
        await refreshState();
      }catch(error){
        await GMUI.modal({code:"FACILITY / ERROR",title:"Scrap Failed",message:error.message,confirmText:"CLOSE"});
      }
    }));

    const body = $("transactionRows");
    if (!state.transactions.length) {
      body.innerHTML = "";
      $("transactionEmpty").hidden = false;
      return;
    }
    $("transactionEmpty").hidden = true;
    body.innerHTML = state.transactions.map(row => {
      const typeLabel=String(row.kind || "Transaction")
        .replace(/_/g," ")
        .replace(/\b\w/g,char=>char.toUpperCase());
      return `
      <tr>
        <td>${esc(new Date(row.created_at).toLocaleDateString())}</td>
        <td>${esc(typeLabel)}</td>
        <td>${esc(row.description || "—")}</td>
        <td>${row.amount >= 0 ? "+" : ""}${esc(fmt(row.amount))} ${esc(row.currency || "Aureum")}</td>
        <td>${row.balance_after == null ? "—" : esc(fmt(row.balance_after))}</td>
      </tr>`;
    }).join("");
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
      $("factionTerritoryCount").textContent = "--";
      $("factionSystemCount").textContent = "--";
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
    const factionTerritory=(state.territories || []).filter(row=>row.faction_id===faction.id);
    const territoryRefs=new Set(factionTerritory.map(row=>row.location_ref));
    const factionSystems=(state.systemEconomies || []).filter(row=>territoryRefs.has(row.location_ref));
    $("factionTerritoryCount").textContent=fmt(factionTerritory.length)+" HEX"+(factionTerritory.length===1?"":"ES");
    $("factionSystemCount").textContent=fmt(factionSystems.length);

    const permissions = membership.permissions || [];
    $("permissionList").innerHTML = permissions.length
      ? permissions.map(p => '<span class="status-chip">' + esc(p) + '</span>').join("")
      : '<span class="status-chip muted">STANDARD MEMBER</span>';

    const ownFactionAssets = factionAssets.filter(row => row.faction_id === faction.id);
    const resourceNames = new Map((state.resourceCatalog || []).map(row => [row.code,row]));
    const strategicResources = (state.factionResources || []).filter(row => row.faction_id===faction.id && Number(row.quantity)!==0);
    const resourceHtml = strategicResources.map(row => {
      const item=resourceNames.get(row.resource_code);
      return `<div class="resource-row">
        <div><strong>${esc(item?.name || row.resource_code)}</strong><div class="section-code">${esc(String(item?.category || "resource").toUpperCase())}</div></div>
        <span>${esc(fmt(row.quantity))} ${esc(item?.unit || "units")}</span>
      </div>`;
    }).join("");
    const assetHtml = ownFactionAssets.map(row => `
      <div class="resource-row">
        <div><strong>${esc(row.asset?.name || "Unknown Asset")}</strong><div class="section-code">${esc((row.asset?.kind || "asset").toUpperCase())}</div></div>
        <span>${esc(fmt(row.quantity))} ${esc(row.asset?.unit || "unit")}</span>
      </div>`).join("");
    $("factionAssetList").innerHTML = resourceHtml + assetHtml;
    $("factionAssetEmpty").hidden = Boolean(strategicResources.length || ownFactionAssets.length);
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

  let friendData={requests:[],friendships:[],profiles:new Map()};

  async function loadFriends(){
    const uid=session.user.id;
    const [requests,friendships,profiles]=await Promise.all([
      GMAuth.api("friend_requests?or=(sender_user_id.eq."+uid+",receiver_user_id.eq."+uid+")&select=*&order=created_at.desc"),
      GMAuth.api("friendships?or=(user_a.eq."+uid+",user_b.eq."+uid+")&select=*&order=created_at.desc"),
      GMAuth.api("player_profiles?is_discoverable=eq.true&select=user_id,display_name&order=display_name.asc")
    ]);
    friendData={requests:requests||[],friendships:friendships||[],profiles:new Map((profiles||[]).map(p=>[p.user_id,p]))};
    renderFriends();
    document.dispatchEvent(new CustomEvent("gm:friends-updated"));
  }

  function renderFriends(){
    const uid=session.user.id,root=$("friendList"),reqRoot=$("friendRequestList");
    const ids=friendData.friendships.map(f=>f.user_a===uid?f.user_b:f.user_a);
    $("friendListEmpty").hidden=ids.length>0;
    root.innerHTML=ids.map(id=>{const p=friendData.profiles.get(id);return '<article class="notice friend-row"><div><strong>'+esc(p?.display_name||"PLAYER")+'</strong><div class="section-code">FRIEND</div></div><div class="form-actions"><button class="hud-button secondary friend-message" data-user="'+esc(id)+'" type="button">MESSAGE</button><button class="hud-button danger friend-remove" data-user="'+esc(id)+'" type="button">REMOVE</button></div></article>'}).join("");
    const pending=friendData.requests.filter(r=>r.status==="pending");
    $("friendRequestEmpty").hidden=pending.length>0;
    reqRoot.innerHTML=pending.map(r=>{const incoming=r.receiver_user_id===uid,other=incoming?r.sender_user_id:r.receiver_user_id,p=friendData.profiles.get(other);return '<article class="notice friend-row"><div><strong>'+esc(p?.display_name||"PLAYER")+'</strong><div class="section-code">'+(incoming?"INCOMING REQUEST":"REQUEST SENT")+'</div></div><div class="form-actions">'+(incoming?'<button class="hud-button friend-accept" data-request="'+esc(r.id)+'" type="button">ACCEPT</button><button class="hud-button secondary friend-decline" data-request="'+esc(r.id)+'" type="button">DECLINE</button>':'')+'</div></article>'}).join("");
    root.querySelectorAll(".friend-remove").forEach(b=>b.onclick=async()=>{if(!await GMUI.confirmAction("Remove this player from your friends?",{title:"Remove Friend",confirmText:"REMOVE",danger:true}))return;await GMAuth.api("rpc/remove_friend",{method:"POST",body:JSON.stringify({p_user_id:b.dataset.user})});await loadFriends()});
    root.querySelectorAll(".friend-message").forEach(b=>b.onclick=()=>{const chat=$("gmGameChat");if(chat){chat.classList.remove("minimized");$("[data-chat-mode=\"direct\"]")?.click();const sel=$("gmChatFriend");sel.value=b.dataset.user;sel.dispatchEvent(new Event("change"));$("gmChatInput")?.focus()}});
    reqRoot.querySelectorAll(".friend-accept,.friend-decline").forEach(b=>b.onclick=async()=>{await GMAuth.api("rpc/respond_friend_request",{method:"POST",body:JSON.stringify({p_request_id:b.dataset.request,p_accept:b.classList.contains("friend-accept")})});await loadFriends()});
  }

  $("friendSearchButton")?.addEventListener("click", async () => {
    const query=$("friendSearchInput")?.value.trim(),root=$("friendSearchResults"),empty=$("friendSearchEmpty");
    if(!query){root.innerHTML="";empty.textContent="ENTER A PROFILE NAME.";empty.hidden=false;return}
    try{
      const rows=await GMAuth.api("player_profiles?is_discoverable=eq.true&display_name=ilike."+encodeURIComponent("*"+query+"*")+"&select=user_id,display_name&limit=20");
      const own=session.user.id,friendIds=new Set(friendData.friendships.flatMap(f=>[f.user_a,f.user_b]));
      const found=(rows||[]).filter(p=>p.user_id!==own);
      empty.hidden=found.length>0;empty.textContent="NO PLAYERS FOUND.";
      root.innerHTML=found.map(p=>'<article class="notice friend-row"><div><strong>'+esc(p.display_name||"PLAYER")+'</strong><div class="section-code">PLAYER NETWORK</div></div><button class="hud-button secondary friend-add" data-user="'+esc(p.user_id)+'" type="button" '+(friendIds.has(p.user_id)?"disabled":"")+'>'+(friendIds.has(p.user_id)?"FRIENDS":"ADD FRIEND")+'</button></article>').join("");
      root.querySelectorAll(".friend-add:not([disabled])").forEach(b=>b.onclick=async()=>{try{await GMAuth.api("rpc/send_friend_request",{method:"POST",body:JSON.stringify({p_user_id:b.dataset.user})});await loadFriends();b.textContent="REQUEST SENT";b.disabled=true}catch(err){empty.textContent=err.message;empty.hidden=false}});
    }catch(err){empty.textContent="SEARCH FAILED // "+err.message;empty.hidden=false}
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
  profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    const data = formObject(profileForm);
    setState(profileState, "SAVING PLAYER PROFILE...");
    try {
      await GMAuth.api("player_profiles?user_id=eq." + encodeURIComponent(session.user.id), {
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          display_name:data.display_name?.trim() || null
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
      await loadFriends();
    } catch (error) {
      $("suiteNotice").textContent = "PLAYER SUITE DATA ERROR // " + error.message;
    }
  })();
})();