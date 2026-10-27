/* Alpha 0.5.0 Phase 1: Contracts & Assignments.
 * Uses existing protected Player Suite session and Supabase RLS.
 * Server accepts assignments; reward completion will be implemented later.
 */
(() => {
  const list = document.getElementById("civilianContractList");
  const active = document.getElementById("civilianAssignmentList");
  const notice = document.getElementById("civilianContractState");
  if (!list || !active || !notice) return;

  const esc = value => GMUI.esc(String(value ?? ""));
  const credits = value => Number(value || 0).toLocaleString(undefined,{maximumFractionDigits:2});
  const label = {
    economic:"ECONOMIC",
    political:"POLITICAL",
    exploration:"EXPLORATION"
  };
  let busy = false;

  function message(text, error = false) {
    notice.textContent = text;
    notice.className = "form-state" + (error ? " error" : "");
  }

  async function loadBoard() {
    if (busy || !window.GMPlayerSuiteState?.session?.user?.id) return;
    try {
      const [contracts, assignments] = await Promise.all([
        GMAuth.api("civilian_contracts?select=id,title,description,career_path,difficulty,min_party_size,max_party_size,reward_aureum,reward_reputation,reward_research_points,location_ref&status=eq.active&order=created_at.desc"),
        GMAuth.api("civilian_assignments?select=id,contract_id,status,accepted_at&order=accepted_at.desc")
      ]);
      const activeContracts = new Set((assignments || [])
        .filter(a => a.status === "accepted" || a.status === "in_progress")
        .map(a => a.contract_id));

      list.innerHTML = contracts?.length ? contracts.map(contract => {
        const alreadyAssigned = activeContracts.has(contract.id);
        const requiresParty = Number(contract.min_party_size) > 1;
        const disabled = alreadyAssigned || requiresParty;
        const buttonText = alreadyAssigned ? "ALREADY ACCEPTED" :
          requiresParty ? "PARTY REQUIRED" : "ACCEPT CONTRACT";
        return '<article class="hud-panel compact" style="margin-bottom:12px">' +
          '<div class="section-head"><div><div class="section-code">' +
          esc(label[contract.career_path] || contract.career_path) + ' / DIFFICULTY ' +
          esc(contract.difficulty) + '/5</div><h3>' + esc(contract.title) +
          '</h3></div></div>' +
          '<p class="hero-copy">' + esc(contract.description) + '</p>' +
          '<div class="telemetry-stack">' +
          '<div class="telemetry-row"><span>Team requirement</span><strong>' +
          esc(contract.min_party_size) + '–' + esc(contract.max_party_size) + ' PLAYERS</strong></div>' +
          '<div class="telemetry-row"><span>Rewards</span><strong>' + credits(contract.reward_aureum) +
          ' AUREUM / ' + esc(contract.reward_reputation) + ' REP / ' +
          esc(contract.reward_research_points) + ' RP</strong></div>' +
          (contract.location_ref ?
            '<div class="telemetry-row"><span>Location</span><strong>' + esc(contract.location_ref) + '</strong></div>' : '') +
          '</div><div class="form-actions" style="margin-top:12px">' +
          '<button class="hud-button secondary" type="button" data-accept-civilian-contract="' +
          esc(contract.id) + '"' + (disabled ? ' disabled' : '') + '>' +
          buttonText + '</button></div></article>';
      }).join("") : '<div class="empty-state">NO AVAILABLE CIVILIAN CONTRACTS.</div>';

      active.innerHTML = assignments?.length ? assignments.map(a => {
        const title = (contracts || []).find(c => c.id === a.contract_id)?.title || "CONTRACT ASSIGNMENT";
        return '<div class="telemetry-row"><span>' + esc(title) +
          '</span><strong>' + esc(String(a.status).toUpperCase().replaceAll("_"," ")) +
          '</strong></div>';
      }).join("") : '<div class="empty-state">NO CONTRACT ASSIGNMENTS YET.</div>';
      message("");
    } catch (error) {
      list.innerHTML = '<div class="empty-state">CONTRACT BOARD UNAVAILABLE.</div>';
      active.innerHTML = "";
      message("CONTRACT FOUNDATION NOT READY // THE GRADARI DATABASE MIGRATION MUST BE APPLIED BEFORE USING THIS FEATURE.",true);
      console.warn("Civilian contracts unavailable",error);
    }
  }

  list.addEventListener("click", async event => {
    const button = event.target.closest("[data-accept-civilian-contract]");
    if (!button || busy) return;
    busy = true;
    button.disabled = true;
    message("ACCEPTING CONTRACT...");
    try {
      await GMAuth.api("rpc/accept_civilian_contract", {
        method:"POST",
        body:JSON.stringify({p_contract_id:button.dataset.acceptCivilianContract})
      });
      message("CONTRACT ACCEPTED");
      busy = false;
      await loadBoard();
    } catch (error) {
      busy = false;
      message("CONTRACT ACCEPTANCE FAILED // " + (error.message || "REQUEST FAILED"),true);
      button.disabled = false;
    }
  });

  document.addEventListener("gm:player-state", loadBoard);
  if (window.GMPlayerSuiteState) loadBoard();
})();
