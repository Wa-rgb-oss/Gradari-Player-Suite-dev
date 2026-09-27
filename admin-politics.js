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
    const living=(data?.characters||[]).filter(char => char.status==="active" && char.life_status==="alive");
    const options='<option value="">No linked character</option>' + living.map(char =>
      '<option value="'+esc(char.id)+'">'+esc(char.name)+' // '+esc(factionById(char.faction_id)?.name || "No faction")+'</option>'
    ).join("");
    $("firstConsulCharacter").innerHTML=options;

    $("influenceCharacter").innerHTML='<option value="">Select character</option>' + (data?.characters||[]).map(char => {
      const wallet=influenceByCharacter(char.id);
      const status=char.status==="active" && char.life_status==="alive" ? "ALIVE" : "DECEASED";
      return '<option value="'+esc(char.id)+'">'+esc(char.name)+' // '+status+' // '+esc(fmt(wallet.balance))+' Influence</option>';
    }).join("");
  }

  function renderRepublicForm() {
    const republic=data?.republic?.[0] || {};
    const config=data?.config?.[0] || {};
    const form=$("republicStateForm");
    form.elements.government_name.value=republic.government_name || "Gradari Mireris Empire";
    form.elements.chamber_name.value=republic.chamber_name || "Senate";
    form.elements.total_seats.value=republic.total_seats || config.senate_total_seats || 120;
    form.elements.current_session.value=republic.current_session || "";
    form.elements.first_consul_name.value=republic.first_consul_name === "Vacant" ? "" : (republic.first_consul_name || "");
    form.elements.first_consul_character_id.value=republic.first_consul_character_id || "";

    const rules=$("politicalRulesForm");
    rules.elements.bill_proposal_influence_cost.value=config.bill_proposal_influence_cost ?? 25;
    rules.elements.federal_faction_tax_rate.value=config.federal_faction_tax_rate ?? 10;
    rules.elements.succession_influence_percent.value=config.succession_influence_percent ?? 0;
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
          <label class="checkbox-line"><input name="federal_member" type="checkbox" ${faction.federal_member ? "checked" : ""}><span>Imperial faction</span></label>
          <label><span>Imperial Tax Rate %</span><input name="federal_tax_rate" type="number" min="0" max="100" step="0.1" value="${esc(String(faction.federal_tax_rate ?? 10))}"></label>
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
            <div><strong style="color:var(--text)">${esc(bill.title)}</strong><div class="section-code">${esc(String(bill.bill_type || "LEGISLATION").toUpperCase())} // ${esc(sponsor?.name || "SENATE")} // ${esc(bill.sponsor_character_name || "NO CHARACTER")}</div></div>
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

  function renderPolicies() {
    const root=$("adminFederalPolicyList");
    const rows=data?.federalPolicies || [];
    if (!rows.length) {
      root.innerHTML='<div class="empty-state">NO POLICIES HAVE BEEN ENACTED.</div>';
      return;
    }

    root.innerHTML=rows.map(row => `
      <form class="federal-policy-form notice form-shell" data-id="${esc(row.id)}">
        <div class="split-actions">
          <div><strong style="color:var(--text)">${esc(row.title)}</strong><div class="section-code">${esc(String(row.policy_type || "LEGISLATION").toUpperCase())} // ENACTED ${esc(new Date(row.enacted_at).toLocaleDateString())}</div></div>
          <button class="hud-button secondary" type="submit">SAVE POLICY</button>
        </div>
        ${row.description?'<div style="margin-top:10px">'+esc(row.description)+'</div>':""}
        <label><span>Status</span><select name="status">
          <option value="active" ${row.status==="active"?"selected":""}>Active</option>
          <option value="suspended" ${row.status==="suspended"?"selected":""}>Suspended</option>
          <option value="repealed" ${row.status==="repealed"?"selected":""}>Repealed</option>
          <option value="expired" ${row.status==="expired"?"selected":""}>Expired</option>
        </select></label>
        <label><span>Structured Effects JSON</span><textarea name="effects">${esc(JSON.stringify(row.effects || {},null,2))}</textarea></label>
      </form>`).join("");

    root.querySelectorAll(".federal-policy-form").forEach(form => {
      form.addEventListener("submit",async event => {
        event.preventDefault();
        let effects;
        try {
          effects=JSON.parse(form.elements.effects.value || "{}");
        } catch {
          setState($("federalPolicyState"),"POLICY EFFECTS MUST BE VALID JSON","error");
          return;
        }
        try {
          const status=form.elements.status.value;
          await GMAuth.api("federal_policies?id=eq."+encodeURIComponent(form.dataset.id),{
            method:"PATCH",
            headers:{Prefer:"return=minimal"},
            body:JSON.stringify({
              status,
              effects,
              repealed_at:status==="repealed" ? new Date().toISOString() : null
            })
          });
          await refresh("POLICY UPDATED",$("federalPolicyState"));
        } catch (error) {
          setState($("federalPolicyState"),"POLICY UPDATE FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderOffices() {
    const root=$("adminOfficeList");
    const offices=data?.imperialOffices || [];
    const living=(data?.characters||[]).filter(char=>char.status==="active" && char.life_status==="alive");

    if (!offices.length) {
      root.innerHTML='<div class="empty-state">NO POLITICAL OFFICES CONFIGURED.</div>';
      return;
    }

    root.innerHTML=offices.map(office => {
      const holder=characterById(office.current_holder_character_id);
      const candidateOptions='<option value="">Vacant</option>' + living.map(char =>
        '<option value="'+esc(char.id)+'" '+(char.id===office.current_holder_character_id?"selected":"")+'>'+esc(char.name)+'</option>'
      ).join("");
      return `
        <form class="office-admin-form notice form-shell" data-id="${esc(office.id)}">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(office.name)}</strong><div class="section-code">${esc(office.code)} // ${holder ? "HELD BY "+esc(holder.name) : "VACANT"}</div></div>
            <button class="hud-button secondary" type="submit">SAVE OFFICE</button>
          </div>
          <label><span>Description</span><textarea name="description">${esc(office.description || "")}</textarea></label>
          <div class="form-grid">
            <label><span>Selection Method</span><select name="selection_method">
              <option value="senate_seats" ${office.selection_method==="senate_seats"?"selected":""}>Senate Seat Vote</option>
              <option value="character_vote" ${office.selection_method==="character_vote"?"selected":""}>One Player Vote</option>
              <option value="appointment" ${office.selection_method==="appointment"?"selected":""}>Appointment</option>
            </select></label>
            <label><span>Candidate Influence Minimum</span><input name="candidate_influence_min" type="number" min="0" step="0.01" value="${esc(String(office.candidate_influence_min || 0))}"></label>
          </div>
          <div class="form-grid">
            <label><span>Term World Hours</span><input name="term_world_hours" type="number" min="0.01" step="0.01" value="${office.term_world_hours==null?"":esc(String(office.term_world_hours))}" placeholder="Blank = no automatic expiry"></label>
            <label><span>Office Holder</span><select name="holder_character_id">${candidateOptions}</select></label>
          </div>
        </form>`;
    }).join("");

    root.querySelectorAll(".office-admin-form").forEach(form => {
      form.addEventListener("submit",async event => {
        event.preventDefault();
        const d=Object.fromEntries(new FormData(form));
        try {
          await GMAuth.api("imperial_offices?id=eq."+encodeURIComponent(form.dataset.id),{
            method:"PATCH",
            headers:{Prefer:"return=minimal"},
            body:JSON.stringify({
              description:d.description.trim() || null,
              selection_method:d.selection_method,
              candidate_influence_min:Number(d.candidate_influence_min || 0),
              term_world_hours:d.term_world_hours ? Number(d.term_world_hours) : null
            })
          });

          const office=(data.imperialOffices||[]).find(row=>row.id===form.dataset.id);
          const nextHolder=d.holder_character_id || null;
          if (nextHolder && nextHolder!==office?.current_holder_character_id) {
            await GMAuth.api("rpc/appoint_political_office",{
              method:"POST",
              body:JSON.stringify({p_office_id:form.dataset.id,p_character_id:nextHolder})
            });
          } else if (!nextHolder && office?.current_holder_character_id) {
            await GMAuth.api("imperial_offices?id=eq."+encodeURIComponent(form.dataset.id),{
              method:"PATCH",
              headers:{Prefer:"return=minimal"},
              body:JSON.stringify({
                current_holder_character_id:null,
                current_holder_name:null,
                holder_since_world_hour:null,
                holder_until_world_hour:null
              })
            });
            if (office.code==="FIRST_CONSUL") {
              await GMAuth.api("republic_state?singleton=eq.true",{
                method:"PATCH",
                headers:{Prefer:"return=minimal"},
                body:JSON.stringify({
                  first_consul_character_id:null,
                  first_consul_name:"Vacant"
                })
              });
            }
          }
          await refresh("OFFICE UPDATED",$("adminOfficeState"));
        } catch (error) {
          setState($("adminOfficeState"),"OFFICE UPDATE FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderElections() {
    const root=$("adminElectionList");
    const rows=data?.politicalElections || [];

    $("electionOffice").innerHTML=(data?.imperialOffices||[]).map(office =>
      '<option value="'+esc(office.id)+'">'+esc(office.name)+'</option>'
    ).join("");

    if (!rows.length) {
      root.innerHTML='<div class="empty-state">NO ELECTIONS CREATED.</div>';
      return;
    }

    root.innerHTML=rows.map(row => {
      const office=(data.imperialOffices||[]).find(x=>x.id===row.office_id);
      const candidates=(data.electionCandidates||[]).filter(x=>x.election_id===row.id);
      const votes=(data.electionVotes||[]).filter(x=>x.election_id===row.id);
      const tally=candidates.map(candidate => ({
        ...candidate,
        weight:votes.filter(v=>v.candidate_character_id===candidate.character_id)
          .reduce((sum,v)=>sum+Number(v.weight||0),0)
      })).sort((a,b)=>b.weight-a.weight);

      const candidateHtml=tally.length
        ? tally.map(candidate =>
          '<div class="resource-row"><div><strong>'+esc(candidate.candidate_name)+'</strong><div class="section-code">'+esc(candidate.faction_name || "NO FACTION")+' // '+esc(candidate.status.toUpperCase())+'</div></div><span>'+esc(fmt(candidate.weight))+' VOTE WEIGHT</span></div>'
        ).join("")
        : '<div class="empty-state">NO CANDIDATES DECLARED.</div>';

      return `
        <article class="notice">
          <div class="split-actions">
            <div><strong style="color:var(--text)">${esc(row.title)}</strong><div class="section-code">${esc(office?.name || "OFFICE")} // ${esc(row.selection_method.toUpperCase().replaceAll("_"," "))}</div></div>
            <span class="status-chip ${row.status==="open"?"amber":""}">${esc(row.status==="resolved" ? row.result : row.status)}</span>
          </div>
          <div class="telemetry-stack" style="margin-top:10px">
            <div class="telemetry-row"><span>Opens</span><strong>${esc(fmt(row.opens_world_hour))}</strong></div>
            <div class="telemetry-row"><span>Closes</span><strong>${esc(fmt(row.closes_world_hour))}</strong></div>
            <div class="telemetry-row"><span>Winner</span><strong>${esc(row.winner_name || "—")}</strong></div>
          </div>
          <div class="resource-list" style="margin-top:10px">${candidateHtml}</div>
          ${!["resolved","cancelled"].includes(row.status) && row.selection_method!=="appointment"
            ? '<button class="hud-button amber resolve-election" type="button" data-id="'+esc(row.id)+'" style="margin-top:12px">RESOLVE ELECTION</button>'
            : ""}
        </article>`;
    }).join("");

    root.querySelectorAll(".resolve-election").forEach(button => {
      button.addEventListener("click",async () => {
        try {
          const result=await GMAuth.api("rpc/resolve_political_election",{
            method:"POST",
            body:JSON.stringify({p_election_id:button.dataset.id})
          });
          await refresh("ELECTION RESOLVED // "+String(result.result).toUpperCase(),$("adminElectionState"));
        } catch (error) {
          setState($("adminElectionState"),"ELECTION RESOLUTION FAILED // "+error.message,"error");
        }
      });
    });
  }

  function renderTaxAssessments() {
    const root=$("adminTaxAssessmentList");
    if (!(data?.federalTaxAssessments||[]).length) {
      root.innerHTML='<div class="empty-state">NO IMPERIAL TAX ASSESSMENTS.</div>';
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
    renderOffices();
    renderElections();
    renderTaxAssessments();
    renderPolicies();
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
      await refresh("SENATE UPDATED",$("republicStateState"));
    } catch (error) {
      setState($("republicStateState"),"SENATE UPDATE FAILED // "+error.message,"error");
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
          federal_faction_tax_rate:Number(d.federal_faction_tax_rate || 0),
          succession_influence_percent:Number(d.succession_influence_percent || 0)
        })
      });
      await refresh("POLITICAL RULES UPDATED",$("politicalRulesState"));
    } catch (error) {
      setState($("politicalRulesState"),"POLITICAL RULE UPDATE FAILED // "+error.message,"error");
    }
  });

  $("electionCreateForm")?.addEventListener("submit",async event => {
    event.preventDefault();
    const form=event.currentTarget;
    const d=Object.fromEntries(new FormData(form));
    try {
      const clock=await GMAuth.api("rpc/get_world_clock",{method:"POST",body:"{}"});
      const opensAt=Number(clock.total_world_hours || 0)+Number(d.opens_in_world_hours || 0);
      const closesAt=opensAt+Number(d.duration_world_hours || 0);
      const result=await GMAuth.api("rpc/create_political_election",{
        method:"POST",
        body:JSON.stringify({
          p_office_id:d.office_id,
          p_title:d.title.trim(),
          p_selection_method:d.selection_method,
          p_opens_world_hour:opensAt,
          p_closes_world_hour:closesAt,
          p_results_public:form.elements.results_public.checked
        })
      });
      form.reset();
      await refresh("ELECTION CREATED // "+String(result.status).toUpperCase(),$("electionCreateState"));
    } catch (error) {
      setState($("electionCreateState"),"ELECTION CREATE FAILED // "+error.message,"error");
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
      await refresh("IMPERIAL TAX ASSESSMENT COMPLETE // "+result.processed_factions+" FACTIONS",$("federalTaxState"));
    } catch (error) {
      setState($("federalTaxState"),"IMPERIAL TAX ASSESSMENT FAILED // "+error.message,"error");
    }
  });

  document.addEventListener("gm:admin-state",event => renderAll(event.detail));
  if (window.GMAdminData) renderAll(window.GMAdminData);
})();