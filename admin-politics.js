(() => {
  let data = null;

  const $ = id => document.getElementById(id);
  const esc = value => GMUI.esc(value);
  const fmt = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const setState = (el,message,type="") => GMUI.setState(el,message,type);

  function factionById(id) {
    return data?.factions?.find(row => row.id === id) || null;
  }

  function characterById(id) {
    return data?.characters?.find(row => row.id === id) || null;
  }

  function influenceByCharacter(id) {
    return data?.characterInfluence?.find(row => row.character_id === id) || {balance:0,lifetime_earned:0,lifetime_spent:0};
  }

  function voteTally(billId) {
    const rows=(data?.senateVotes||[]).filter(v=>v.bill_id===billId);
    return {
      yes:rows.filter(v=>v.choice==="yes").reduce((s,v)=>s+Number(v.seats_at_vote||0),0),
      no:rows.filter(v=>v.choice==="no").reduce((s,v)=>s+Number(v.seats_at_vote||0),0),
      abstain:rows.filter(v=>v.choice==="abstain").reduce((s,v)=>s+Number(v.seats_at_vote||0),0)
    };
  }

  async function refresh(message="",target=null) {
    if (target && message) setState(target,message,"success");
    if (window.GMAdminRefresh) await window.GMAdminRefresh();
  }

  function renderSummary() {
    const republic=data?.republic?.[0] || {};
    const total=Number(republic.total_seats || data?.config?.[0]?.senate_total_seats || 120);
    const assigned=(data?.senateSeats||[]).reduce((s,row)=>s+Number(row.seats||0),0);
    const open=(data?.senateBills||[]).filter(row=>row.status==="open").length;
    $("adminFederalTreasury").textContent=fmt(republic.federal_treasury || 0);
    $("adminSenateTotal").textContent=total;
    $("adminSenateAssigned").textContent=assigned;
    $("adminOpenBills").textContent=open;
  }

  function fillCharacterSelects() {
    const options='<option value="">No linked character</option>' + (data?.characters||[]).map(char =>
      '<option value="'+esc(char.id)+'">'+esc(char.name)+' // '+esc(factionById(char.faction_id)?.name || "No faction")+'</option>'
    ).join("");
    $("firstConsulCharacter").innerHTML=options;

    $("influenceCharacter").innerHTML='<option value="">Select character</option>' + (data?.characters||[]).map(char => {
      const wallet=influenceByCharacter(char.id);
      return '<option value="'+esc(char.id)+'">'+esc(char.name)+' // '+esc(fmt(wallet.balance))+' Influence</option>';
    }).join("");
  }

  function renderRepublicForm() {
    const republic=data?.republic?.[0] || {};
    const config=data?.config?.[0] || {};
    const form=$("republicStateForm");
    form.elements.government_name.value=republic.government_name || "Gradari Mireris Empire";
    form.elements.chamber_name.value=republic.chamber_name || "Republic of Worlds Senate";
    form.elements.total_seats.value=republic.total_seats || config.senate_total_seats || 120;
    form.elements.current_session.value=republic.current_session || "";
    form.elements.first_consul_name.value=republic.first_consul_name === "Vacant" ? "" : (republic.first_consul_name || "");
    form.elements.first_consul_character_id.value=republic.first_consul_character_id || "";

    const rules=$("politicalRulesForm");
    rules.elements.bill_proposal_influence_cost.value=config.bill_proposal_influence_cost ?? 25;
    rules.elements.federal_faction_tax_rate.value=config.federal_faction_tax_rate ?? 10;
  }

  function renderFactionSeats() {
    const root=$("adminSenateFactionList");
    const total=Number(data?.republic?.[0]?.total_seats || 120);
    if (!(data?.factions||[]).length) {
      root.innerHTML='<div class="empty-state">NO FACTIONS CREATED.</div>';
      return;
    }

    root.innerHTML=data.factions.map(faction => {
      const seats=Number((data.senateSeats||[]).find(row=>row.faction_id===faction.id)?.seats || 0);
      const share=total ? (seats/total*100).toFixed(1) : "0.0";
      return `
        <form class="senate-faction-admin notice form-shell" data-id="${esc(faction.id)}">
          <div class="split-actions">
            <div style="display:flex;gap:10px;align-items:center">
              <i class="political-swatch" style="--faction-color:${esc(faction.color || "#4fa8c4")}"></i>
              <div><strong style="color:var(--text)">${esc(faction.name)}</strong><div class="section-code">${esc(faction.code || "NO CODE")} // ${share}% OF CHAMBER</div></div>
            </div>
            <button class="hud-button secondary" type="submit">SAVE</button>
          </div>
          <div class="form-grid">
            <label><span>Senate Seats</span><input name="seats" type="number" min="0" value="${esc(String(seats))}"></label>
            <label><span>Political Color</span><input name="color" type="color" value="${esc(faction.color || "#4fa8c4")}"></label>
          </div>
          <label class="checkbox-line"><input name="federal_member" type="checkbox" ${faction.federal_member ? "checked" : ""}><span>Imperial federal member</span></label>
          <label><span>Federal Tax Rate %</span><input name="federal_tax_rate" type="number" min="0" max="100" step="0.1" value="${esc(String(faction.federal_tax_rate ?? 10))}"></label>
        </form>`;
    }).join("");

    root.querySelectorAll(".senate-faction-admin").forEach(form => {
      form.addEventListener("submit",async event => {
        event.preventDefault();
        const d=Object.fromEntries(new FormData(form));
        try {
          const federalMember=form.elements.federal_member.checked;
          const requestedSeats=federalMember ? Number(d.seats || 0) : 0;
          if (federalMember) {
            await GMAuth.api("factions?id=eq."+encodeURIComponent(form.dataset.id),{
              method:"PATCH",
              headers:{Prefer:"return=minimal"},
              body:JSON.stringify({
                federal_member:true,
                color:d.color || "#4fa8c4",
                federal_tax_rate:Number(d.federal_tax_rate || 0)
              })
            });
            await GMAuth.api("rpc/set_senate_faction_seats",{
              method:"POST",
              body:JSON.stringify({
                p_faction_id:form.dataset.id,
                p_seats:requestedSeats
              })
            });
          } else {
            await GMAuth.api("rpc/set_senate_faction_seats",{
              method:"POST",
              body:JSON.stringify({
                p_faction_id:form.dataset.id,
                p_seats:0
              })
            });
            await GMAuth.api("factions?id=eq."+encodeURIComponent(form.dataset.id),{
              method:"PATCH",
              headers:{Prefer:"return=minimal"},
              body:JSON.stringify({
                federal_member:false,
                color:d.color || "#4fa8c4",
                federal_tax_rate:Number(d.federal_tax_rate || 0)
              })
            });
          }
          await refresh("FACTION POLITICAL STATE UPDATED",$("senateFactionState"));
        } catch (error) {
          setState($("senateFactionState"),"FACTION POLITICAL UPDATE FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderInfluence() {
    const root=$("adminInfluenceList");
    if (!(data?.characters||[]).length) {
      root.innerHTML='<div class="empty-state">NO CHARACTERS CREATED.</div>';
      return;
    }
    root.innerHTML=data.characters
      .slice()
      .sort((a,b)=>a.name.localeCompare(b.name))
      .map(char => {
        const wallet=influenceByCharacter(char.id);
        return '<div class="resource-row"><div><strong>'+esc(char.name)+'</strong><div class="section-code">'+esc(factionById(char.faction_id)?.name || "NO FACTION")+'</div></div><span>'+esc(fmt(wallet.balance))+' INF</span></div>';
      }).join("");
  }

  function renderBills() {
    const root=$("adminSenateBillList");
    if (!(data?.senateBills||[]).length) {
      root.innerHTML='<div class="empty-state">NO SENATE LEGISLATION.</div>';
      return;
    }

    root.innerHTML=data.senateBills.map(bill => {
      const tally=voteTally(bill.id);
      const sponsor=factionById(bill.sponsor_faction_id);
      const finalYes=bill.status==="resolved" ? (bill.final_yes ?? tally.yes) : tally.yes;
      const finalNo=bill.status==="resolved" ? (bill.final_no ?? tally.no) : tally.no;
      const finalAbstain=bill.status==="resolved" ? (bill.final_abstain ?? tally.abstain) : tally.abstain;
      const votes=(data.senateVotes||[]).filter(v=>v.bill_id===bill.id).map(v => {
        const faction=factionById(v.faction_id);
        return '<div class="resource-row"><div><strong>'+esc(faction?.name || "Unknown Faction")+'</strong><div class="section-code">'+esc(String(v.choice).toUpperCase())+'</div></div><span>'+esc(String(v.seats_at_vote))+' SEATS</span></div>';
      }).join("") || '<div class="empty-state">NO FACTION VOTES RECORDED.</div>';

      return `
        <article class="notice">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(bill.title)}</strong><div class="section-code">${esc(String(bill.bill_type || "LEGISLATION").toUpperCase())} // ${esc(sponsor?.name || "FEDERAL")} // ${esc(bill.sponsor_character_name || "NO CHARACTER")}</div></div>
            <span class="status-chip ${bill.status==="open"?"amber":""}">${esc(bill.status==="resolved" ? bill.result : bill.status)}</span>
          </div>
          ${bill.description?'<div style="margin-top:10px">'+esc(bill.description)+'</div>':""}
          <div class="senate-tally" style="margin-top:12px"><span>YES <b>${finalYes}</b></span><span>NO <b>${finalNo}</b></span><span>ABSTAIN <b>${finalAbstain}</b></span></div>
          <div class="resource-list" style="margin-top:10px">${votes}</div>
          ${bill.status==="open"?'<button class="hud-button amber resolve-senate-bill" data-id="'+esc(bill.id)+'" type="button" style="margin-top:12px">RESOLVE BILL</button>':""}
        </article>`;
    }).join("");

    root.querySelectorAll(".resolve-senate-bill").forEach(button => {
      button.addEventListener("click",async () => {
        try {
          const result=await GMAuth.api("rpc/resolve_senate_bill",{
            method:"POST",
            body:JSON.stringify({p_bill_id:button.dataset.id})
          });
          await refresh("BILL RESOLVED // "+String(result.result).toUpperCase(),$("senateBillState"));
        } catch (error) {
          setState($("senateBillState"),"BILL RESOLUTION FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderTaxAssessments() {
    const root=$("adminTaxAssessmentList");
    if (!(data?.federalTaxAssessments||[]).length) {
      root.innerHTML='<div class="empty-state">NO FEDERAL TAX ASSESSMENTS.</div>';
      return;
    }

    root.innerHTML=data.federalTaxAssessments.slice(0,30).map(row => {
      const faction=factionById(row.faction_id);
      return '<article class="notice"><div class="split-actions"><div><strong style="color:var(--text)">'+esc(faction?.name || "Unknown Faction")+'</strong><div class="section-code">'+esc(row.cycle_key)+' // '+esc(String(row.status).toUpperCase())+'</div></div><span class="status-chip '+(Number(row.arrears)>0?"amber":"")+'">'+esc(fmt(row.tax_paid))+' / '+esc(fmt(row.tax_due))+' A</span></div>'+
        '<div class="telemetry-stack" style="margin-top:10px"><div class="telemetry-row"><span>Taxable Revenue</span><strong>'+esc(fmt(row.taxable_revenue))+' A</strong></div><div class="telemetry-row"><span>Rate</span><strong>'+esc(fmt(row.tax_rate))+'%</strong></div><div class="telemetry-row"><span>Arrears</span><strong>'+esc(fmt(row.arrears))+' A</strong></div></div></article>';
    }).join("");
  }

  function renderAll(nextData) {
    data=nextData;
    fillCharacterSelects();
    renderSummary();
    renderRepublicForm();
    renderFactionSeats();
    renderInfluence();
    renderBills();
    renderTaxAssessments();
  }

  $("republicStateForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("rpc/set_republic_state",{
        method:"POST",
        body:JSON.stringify({
          p_government_name:d.government_name.trim(),
          p_chamber_name:d.chamber_name.trim(),
          p_total_seats:Number(d.total_seats || 120),
          p_current_session:d.current_session.trim() || null,
          p_first_consul_character_id:d.first_consul_character_id || null,
          p_first_consul_name:d.first_consul_name.trim() || null
        })
      });
      await refresh("FEDERAL STATE UPDATED",$("republicStateState"));
    } catch (error) {
      setState($("republicStateState"),"FEDERAL STATE UPDATE FAILED // "+error.message,"error");
    }
  });

  $("politicalRulesForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      await GMAuth.api("game_config?singleton=eq.true",{
        method:"PATCH",
        headers:{Prefer:"return=minimal"},
        body:JSON.stringify({
          bill_proposal_influence_cost:Number(d.bill_proposal_influence_cost || 0),
          federal_faction_tax_rate:Number(d.federal_faction_tax_rate || 0)
        })
      });
      await refresh("POLITICAL RULES UPDATED",$("politicalRulesState"));
    } catch (error) {
      setState($("politicalRulesState"),"POLITICAL RULE UPDATE FAILED // "+error.message,"error");
    }
  });

  $("influenceAdjustmentForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      const result=await GMAuth.api("rpc/adjust_character_influence",{
        method:"POST",
        body:JSON.stringify({
          p_character_id:d.character_id,
          p_amount:Number(d.amount || 0),
          p_kind:d.kind.trim() || "political_action",
          p_description:d.description.trim() || null
        })
      });
      form.elements.amount.value="";
      form.elements.description.value="";
      await refresh("INFLUENCE UPDATED // BALANCE "+fmt(result.balance),$("influenceAdjustmentState"));
    } catch (error) {
      setState($("influenceAdjustmentState"),"INFLUENCE UPDATE FAILED // "+error.message,"error");
    }
  });

  $("federalTaxForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    try {
      const result=await GMAuth.api("rpc/assess_federal_taxes",{
        method:"POST",
        body:JSON.stringify({p_cycle_key:form.elements.cycle_key.value.trim()})
      });
      await refresh("FEDERAL TAX ASSESSMENT COMPLETE // "+result.processed_factions+" FACTIONS",$("federalTaxState"));
    } catch (error) {
      setState($("federalTaxState"),"FEDERAL TAX ASSESSMENT FAILED // "+error.message,"error");
    }
  });

  document.addEventListener("gm:admin-state",event => renderAll(event.detail));
  if (window.GMAdminData) renderAll(window.GMAdminData);
})();