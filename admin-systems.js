(() => {
  let data = null;

  const $ = id => document.getElementById(id);
  const esc = value => GMUI.esc(value);
  const fmt = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const setState = (el,message,type="") => GMUI.setState(el,message,type);

  function profileName(userId) {
    const p = data?.profiles?.find(row => row.user_id === userId);
    const reg = data?.registrations?.find(row => row.user_id === userId);
    return p?.display_name || reg?.preferred || reg?.player || (userId ? userId.slice(0,8) : "Player");
  }

  function factionName(id) {
    return data?.factions?.find(row => row.id === id)?.name || "Unclaimed";
  }

  function assetName(id) {
    return data?.catalog?.find(row => row.id === id)?.name || "No output asset";
  }

  async function refresh(message="",target=null) {
    if (target && message) setState(target,message,"success");
    if (window.GMAdminRefresh) await window.GMAdminRefresh();
  }

  function renderMarkets() {
    const root = $("adminMarketList");
    if (!root) return;

    $("adminMarketSelect").innerHTML = '<option value="">Select market</option>' +
      (data.markets || []).map(m => '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>').join("");

    if (!(data.markets || []).length) {
      root.innerHTML = '<div class="empty-state">NO MARKETS CREATED.</div>';
      return;
    }

    root.innerHTML = data.markets.map(market => {
      const listings = (data.marketListings || []).filter(row => row.market_id === market.id);
      const listingHtml = listings.length ? listings.map(row => `
        <div class="resource-row">
          <div><strong>${esc(assetName(row.asset_id))}</strong><div class="section-code">STOCK: ${row.stock==null?"UNLIMITED":esc(fmt(row.stock))}</div></div>
          <span>${esc(fmt(row.price_per_unit))} A / UNIT</span>
        </div>`).join("") : '<div class="empty-state">NO LISTINGS.</div>';
      return `
        <article class="notice">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(market.name)}</strong><div class="section-code">${esc(String(market.market_type).toUpperCase())} // ${esc(market.location_ref || "NETWORK")}</div></div>
            <span class="status-chip">${esc(market.status)}</span>
          </div>
          ${market.faction_id?'<div class="section-code" style="margin-top:8px">OWNER // '+esc(factionName(market.faction_id))+'</div>':""}
          <div class="resource-list" style="margin-top:10px">${listingHtml}</div>
        </article>`;
    }).join("");
  }

  function renderEvents() {
    const root = $("adminEventList");
    if (!root) return;

    const eventOptions = '<option value="">Select event</option>' +
      (data.events || []).map(e => '<option value="' + esc(e.id) + '">' + esc(e.title) + '</option>').join("");
    $("adminEventSelect").innerHTML = eventOptions;
    $("rewardEventSelect").innerHTML = eventOptions;
    updateRewardSelectors($("rewardEventSelect").value);

    if (!(data.events || []).length) {
      root.innerHTML = '<div class="empty-state">NO EVENTS CREATED.</div>';
      return;
    }

    root.innerHTML = data.events.map(event => {
      const objectives = (data.eventObjectives || []).filter(x => x.event_id === event.id);
      const participants = (data.eventParticipants || []).filter(x => x.event_id === event.id);
      const objectiveHtml = objectives.length ? objectives.map(obj => `
        <div class="resource-row">
          <div><strong>${esc(obj.title)}</strong><div class="section-code">${esc(obj.description || "OBJECTIVE")}</div></div>
          <span>${esc(fmt(obj.points))} PTS // ${esc(fmt(obj.reward_aureum))} A</span>
        </div>`).join("") : '<div class="empty-state">NO OBJECTIVES.</div>';
      const participantHtml = participants.length ? participants
        .sort((a,b)=>Number(b.score||0)-Number(a.score||0))
        .map(p => `
          <div class="resource-row event-score-row" data-event="${esc(event.id)}" data-user="${esc(p.user_id)}">
            <div><strong>${esc(profileName(p.user_id))}</strong><div class="section-code">${esc(factionName(p.faction_id))} // ${esc(p.status)}</div></div>
            <div style="display:flex;gap:7px;align-items:center">
              <input class="event-score" type="number" step="0.01" value="${esc(p.score)}" style="width:100px">
              <button class="hud-button secondary save-event-score" type="button">SAVE</button>
            </div>
          </div>`).join("") : '<div class="empty-state">NO PARTICIPANTS.</div>';

      return `
        <article class="hud-panel compact">
          <div class="section-head">
            <div><div class="section-code">${esc(String(event.event_type).toUpperCase())} // ${event.competitive?"COMPETITIVE":"STANDARD"}</div><h2>${esc(event.title)}</h2></div>
            <select class="event-status" data-id="${esc(event.id)}" style="width:auto;min-width:140px">
              <option value="draft" ${event.status==="draft"?"selected":""}>Draft</option>
              <option value="active" ${event.status==="active"?"selected":""}>Active</option>
              <option value="completed" ${event.status==="completed"?"selected":""}>Completed</option>
              <option value="cancelled" ${event.status==="cancelled"?"selected":""}>Cancelled</option>
            </select>
          </div>
          <div>${esc(event.description)}</div>
          ${event.reward_summary?'<div class="section-code" style="margin-top:10px">REWARDS // '+esc(event.reward_summary)+'</div>':""}
          <div class="section-code" style="margin-top:14px">OBJECTIVES</div>
          <div class="resource-list">${objectiveHtml}</div>
          <div class="section-code" style="margin-top:14px">PARTICIPANTS / SCORE</div>
          <div class="resource-list">${participantHtml}</div>
        </article>`;
    }).join("");

    root.querySelectorAll(".event-status").forEach(select => {
      select.addEventListener("change",async () => {
        try {
          await GMAuth.api("game_events?id=eq." + encodeURIComponent(select.dataset.id),{
            method:"PATCH",
            headers:{Prefer:"return=minimal"},
            body:JSON.stringify({status:select.value})
          });
          await refresh();
        } catch (error) {
          setState($("adminState"),"EVENT STATUS FAILED // " + error.message,"error");
        }
      });
    });

    root.querySelectorAll(".save-event-score").forEach(button => {
      button.addEventListener("click",async () => {
        const row=button.closest(".event-score-row");
        try {
          await GMAuth.api(
            "event_participants?event_id=eq." + encodeURIComponent(row.dataset.event) +
            "&user_id=eq." + encodeURIComponent(row.dataset.user),
            {
              method:"PATCH",
              headers:{Prefer:"return=minimal"},
              body:JSON.stringify({score:Number(row.querySelector(".event-score").value || 0)})
            }
          );
          setState($("adminState"),"EVENT SCORE UPDATED","success");
          await refresh();
        } catch (error) {
          setState($("adminState"),"SCORE UPDATE FAILED // " + error.message,"error");
        }
      });
    });
  }

  function updateRewardSelectors(eventId) {
    const objectiveSelect=$("rewardObjectiveSelect");
    const participantSelect=$("rewardParticipantSelect");
    const objectives=(data?.eventObjectives||[]).filter(row=>row.event_id===eventId);
    const participants=(data?.eventParticipants||[]).filter(row=>row.event_id===eventId && row.status!=="withdrawn");
    objectiveSelect.innerHTML='<option value="">Select objective</option>' + objectives.map(row =>
      '<option value="'+esc(row.id)+'">'+esc(row.title)+'</option>'
    ).join("");
    participantSelect.innerHTML='<option value="">Select participant</option>' + participants.map(row =>
      '<option value="'+esc(row.user_id)+'">'+esc(profileName(row.user_id))+'</option>'
    ).join("");
  }

  function renderConfig() {
    const cfg = data.config?.[0];
    if (!cfg) return;
    const form=$("gameConfigForm");
    ["faction_min_founders","faction_creation_cost","faction_min_contribution","faction_default_tax_rate","faction_max_tax_rate"].forEach(key => {
      if (form.elements[key]) form.elements[key].value=cfg[key];
    });
  }

  function renderFacilityTypes() {
    const root=$("facilityTypeList");
    $("facilityTypeSelect").innerHTML='<option value="">Select facility type</option>' +
      (data.facilityTypes||[]).map(row => '<option value="'+esc(row.id)+'">'+esc(row.name)+'</option>').join("");
    if (!(data.facilityTypes||[]).length) {
      root.innerHTML='<div class="empty-state">NO FACILITY TYPES.</div>';
      return;
    }
    root.innerHTML=data.facilityTypes.map(row => `
      <div class="resource-row">
        <div><strong>${esc(row.name)}</strong><div class="section-code">${esc(row.code || "NO CODE")} // ${esc(row.category || "facility")} // OUTPUT: ${esc(assetName(row.output_asset_id))}</div></div>
        <span>${esc(fmt(row.build_cost_aureum))} BUILD // ${esc(fmt(row.upkeep_aureum_per_cycle))} UPKEEP</span>
      </div>`).join("");
  }

  function renderTerritories() {
    const root=$("territoryList");
    if (!(data.territories||[]).length) {
      root.innerHTML='<div class="empty-state">NO TERRITORY RECORDS YET. YOUR MAP FILE WILL EVENTUALLY POPULATE THIS LAYER.</div>';
      return;
    }
    root.innerHTML=data.territories.map(row => {
      const mods=(data.locationModifiers||[]).filter(m => m.location_ref===row.location_ref && (!m.expires_at || new Date(m.expires_at)>new Date()));
      return `
        <article class="notice">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(row.display_name || row.location_ref)}</strong><div class="section-code">${esc(row.location_ref)} // ${esc(row.status)}</div></div>
            <span class="status-chip">${esc(factionName(row.faction_id))}</span>
          </div>
          <div class="telemetry-stack" style="margin-top:10px">
            <div class="telemetry-row"><span>Production</span><strong>${esc(fmt(Number(row.production_modifier||1)*100))}%</strong></div>
            <div class="telemetry-row"><span>Active Modifiers</span><strong>${mods.length}</strong></div>
            <div class="telemetry-row"><span>Facilities</span><strong>${(data.facilities||[]).filter(f=>f.location_ref===row.location_ref).length}</strong></div>
          </div>
          ${mods.map(m=>'<div class="section-code" style="margin-top:8px">'+esc(m.label)+' // '+esc(fmt(Number(m.production_multiplier||1)*100))+'%'+(m.expires_at?' // UNTIL '+esc(new Date(m.expires_at).toLocaleString()):'')+'</div>').join("")}
        </article>`;
    }).join("");
  }

  function renderAll(nextData) {
    data=nextData;
    renderMarkets();
    renderEvents();
    renderConfig();
    renderFacilityTypes();
    renderTerritories();
  }

  $("marketCreateForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("markets",{
        method:"POST",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          name:d.name.trim(),
          market_type:d.market_type,
          faction_id:d.faction_id || null,
          location_ref:d.location_ref.trim() || null,
          description:d.description.trim() || null,
          status:"active"
        })
      });
      form.reset();
      await refresh("MARKET CREATED",$("marketCreateState"));
    } catch (error) {
      setState($("marketCreateState"),"MARKET CREATE FAILED // "+error.message,"error");
    }
  });

  $("marketListingForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    const existing=(data.marketListings||[]).find(row=>row.market_id===d.market_id && row.asset_id===d.asset_id);
    const payload={
      market_id:d.market_id,
      asset_id:d.asset_id,
      price_per_unit:Number(d.price_per_unit),
      stock:d.stock===""?null:Number(d.stock),
      active:true
    };
    try {
      if (existing) {
        await GMAuth.api("market_listings?id=eq."+encodeURIComponent(existing.id),{
          method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)
        });
      } else {
        await GMAuth.api("market_listings",{
          method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)
        });
      }
      await refresh("MARKET LISTING SAVED",$("marketListingState"));
    } catch (error) {
      setState($("marketListingState"),"LISTING SAVE FAILED // "+error.message,"error");
    }
  });

  $("eventCreateForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    const iso=value=>value?new Date(value).toISOString():null;
    try {
      await GMAuth.api("game_events",{
        method:"POST",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          title:d.title.trim(),
          description:d.description.trim(),
          event_type:d.event_type.trim() || "campaign",
          status:d.status,
          starts_at:iso(d.starts_at),
          ends_at:iso(d.ends_at),
          location_ref:d.location_ref.trim() || null,
          competitive:form.elements.competitive.checked,
          participation_mode:d.participation_mode,
          visibility:d.visibility,
          faction_id:d.faction_id || null,
          reward_summary:d.reward_summary.trim() || null
        })
      });
      form.reset();
      await refresh("EVENT CREATED",$("eventCreateState"));
    } catch (error) {
      setState($("eventCreateState"),"EVENT CREATE FAILED // "+error.message,"error");
    }
  });

  $("eventObjectiveForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("event_objectives",{
        method:"POST",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          event_id:d.event_id,
          title:d.title.trim(),
          description:d.description.trim() || null,
          points:Number(d.points || 0),
          reward_aureum:Number(d.reward_aureum || 0),
          reward_asset_id:d.reward_asset_id || null,
          reward_asset_quantity:Number(d.reward_asset_quantity || 0)
        })
      });
      form.reset();
      await refresh("EVENT OBJECTIVE ADDED",$("eventObjectiveState"));
    } catch (error) {
      setState($("eventObjectiveState"),"OBJECTIVE CREATE FAILED // "+error.message,"error");
    }
  });

  $("rewardEventSelect")?.addEventListener("change",event => {
    updateRewardSelectors(event.currentTarget.value);
  });

  $("eventRewardForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      const result=await GMAuth.api("rpc/award_event_objective",{
        method:"POST",
        body:JSON.stringify({
          p_objective_id:d.objective_id,
          p_user_id:d.user_id
        })
      });
      setState($("eventRewardState"),
        "OBJECTIVE AWARDED // " + fmt(result.points) + " POINTS // " +
        fmt(result.reward_aureum) + " AUREUM","success");
      await refresh();
    } catch (error) {
      setState($("eventRewardState"),"REWARD FAILED // "+error.message,"error");
    }
  });

  $("gameConfigForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const d=Object.fromEntries(new FormData(event.currentTarget));
    try {
      await GMAuth.api("game_config?singleton=eq.true",{
        method:"PATCH",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          faction_min_founders:Number(d.faction_min_founders),
          faction_creation_cost:Number(d.faction_creation_cost),
          faction_min_contribution:Number(d.faction_min_contribution),
          faction_default_tax_rate:Number(d.faction_default_tax_rate),
          faction_max_tax_rate:Number(d.faction_max_tax_rate)
        })
      });
      await refresh("GAME RULES UPDATED",$("gameConfigState"));
    } catch (error) {
      setState($("gameConfigState"),"RULE UPDATE FAILED // "+error.message,"error");
    }
  });

  $("productionCycleForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    try {
      const result=await GMAuth.api("rpc/process_facility_cycle",{
        method:"POST",
        body:JSON.stringify({p_cycle_key:form.elements.cycle_key.value.trim()})
      });
      setState($("productionCycleState"),
        "CYCLE COMPLETE // " + result.processed + " FACILITIES PROCESSED // " +
        result.deactivated_for_upkeep + " DEACTIVATED FOR UPKEEP","success");
      await refresh();
    } catch (error) {
      setState($("productionCycleState"),"PRODUCTION CYCLE FAILED // "+error.message,"error");
    }
  });

  $("facilityTypeForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("facility_types",{
        method:"POST",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          code:d.code.trim() || null,
          name:d.name.trim(),
          category:d.category.trim() || "industry",
          description:d.description.trim() || null,
          build_cost_aureum:Number(d.build_cost_aureum || 0),
          upkeep_aureum_per_cycle:Number(d.upkeep_aureum_per_cycle || 0),
          output_asset_id:d.output_asset_id || null,
          output_per_cycle:Number(d.output_per_cycle || 0),
          player_buildable:true
        })
      });
      form.reset();
      await refresh("FACILITY TYPE CREATED",$("facilityTypeState"));
    } catch (error) {
      setState($("facilityTypeState"),"FACILITY TYPE FAILED // "+error.message,"error");
    }
  });

  $("territoryForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    const existing=(data.territories||[]).find(row=>row.location_ref===d.location_ref.trim());
    const payload={
      location_ref:d.location_ref.trim(),
      display_name:d.display_name.trim() || null,
      faction_id:d.faction_id || null,
      production_modifier:Number(d.production_modifier || 1),
      status:d.status.trim() || "stable"
    };
    try {
      if(existing){
        await GMAuth.api("territories?location_ref=eq."+encodeURIComponent(existing.location_ref),{
          method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)
        });
      } else {
        await GMAuth.api("territories",{
          method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify(payload)
        });
      }
      await refresh("TERRITORY SAVED",$("territoryState"));
    } catch (error) {
      setState($("territoryState"),"TERRITORY SAVE FAILED // "+error.message,"error");
    }
  });

  $("locationModifierForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("location_modifiers",{
        method:"POST",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          location_ref:d.location_ref.trim(),
          modifier_type:d.modifier_type.trim() || "raid",
          label:d.label.trim(),
          production_multiplier:Number(d.production_multiplier || 1),
          expires_at:d.expires_at?new Date(d.expires_at).toISOString():null,
          player_visible:form.elements.player_visible.checked
        })
      });
      form.reset();
      await refresh("LOCATION MODIFIER ADDED",$("locationModifierState"));
    } catch (error) {
      setState($("locationModifierState"),"MODIFIER CREATE FAILED // "+error.message,"error");
    }
  });

  $("facilityAdminForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    const isPlayer=d.owner_type==="player";
    const ownerUser=isPlayer?d.owner_user_id:null;
    const ownerFaction=isPlayer?null:d.owner_faction_id;
    if(isPlayer && !ownerUser) return setState($("facilityAdminState"),"SELECT A PLAYER OWNER","error");
    if(!isPlayer && !ownerFaction) return setState($("facilityAdminState"),"SELECT A FACTION OWNER","error");
    try {
      await GMAuth.api("facilities",{
        method:"POST",headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          facility_type_id:d.facility_type_id,
          owner_user_id:ownerUser,
          owner_faction_id:ownerFaction,
          controlling_faction_id:d.controlling_faction_id || null,
          location_ref:d.location_ref.trim() || null,
          name:d.name.trim() || null,
          status:"active"
        })
      });
      form.reset();
      await refresh("FACILITY PLACED",$("facilityAdminState"));
    } catch (error) {
      setState($("facilityAdminState"),"FACILITY CREATE FAILED // "+error.message,"error");
    }
  });

  document.addEventListener("gm:admin-state",event => {
    renderAll(event.detail);
  });

  if(window.GMAdminData) renderAll(window.GMAdminData);
})();