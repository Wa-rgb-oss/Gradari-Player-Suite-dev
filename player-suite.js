(() => {
  const REG_DRAFT = "gm_dev_registration_draft";
  const ACTION_DRAFT = "gm_dev_action_draft";
  let session = null;
  let profile = null;

  const registrationForm = document.getElementById("registrationForm");
  const actionForm = document.getElementById("actionForm");
  const registrationState = document.getElementById("registrationState");
  const actionState = document.getElementById("actionState");
  const commitList = document.getElementById("commitList");
  const preview = document.getElementById("recordPreview");
  const previewBody = document.getElementById("previewBody");
  const secretAction = document.getElementById("secretAction");
  const actionCategory = document.getElementById("actionCategory");
  const coverWrap = document.getElementById("coverWrap");
  const ordersWrap = document.getElementById("ordersWrap");

  function setState(el, message, type = "") {
    GMUI.setState(el, message, type);
  }

  function currentCommitments() {
    return [...commitList.querySelectorAll(".commit-row")].map(row => ({
      item: row.querySelector("[data-commit-item]").value.trim(),
      detail: row.querySelector("[data-commit-detail]").value.trim()
    })).filter(x => x.item || x.detail);
  }

  function addCommitment(item = "", detail = "") {
    const row = document.createElement("div");
    row.className = "form-grid commit-row";
    row.innerHTML = `
      <input data-commit-item aria-label="Committed asset or resource" placeholder="Asset / resource / personnel">
      <div style="display:flex;gap:8px">
        <input data-commit-detail aria-label="Commitment amount or detail" placeholder="Amount / detail">
        <button class="hud-button danger" type="button" style="padding-inline:12px">REMOVE</button>
      </div>`;
    row.querySelector("[data-commit-item]").value = item;
    row.querySelector("[data-commit-detail]").value = detail;
    row.querySelector("button").addEventListener("click", () => {
      row.remove();
      if (!commitList.children.length) addCommitment();
      saveActionDraft();
    });
    row.addEventListener("input", saveActionDraft);
    commitList.appendChild(row);
  }

  function formObject(form) {
    const data = Object.fromEntries(new FormData(form));
    form.querySelectorAll('input[type="checkbox"]').forEach(input => data[input.name] = input.checked);
    return data;
  }

  function saveDraft(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function loadDraft(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; }
  }

  function restoreForm(form, data) {
    if (!data) return;
    Object.entries(data).forEach(([key, value]) => {
      if (key === "commitments") return;
      const field = form.elements[key];
      if (!field) return;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = value ?? "";
    });
  }

  function saveRegistrationDraft() {
    if (profile) return;
    saveDraft(REG_DRAFT, formObject(registrationForm));
    setState(registrationState, "DRAFT SAVED LOCALLY");
  }

  function saveActionDraft() {
    const data = formObject(actionForm);
    data.commitments = currentCommitments();
    saveDraft(ACTION_DRAFT, data);
    setState(actionState, "DRAFT SAVED LOCALLY");
  }

  function conditionalFields() {
    coverWrap.hidden = !secretAction.checked;
    ordersWrap.hidden = actionCategory.value !== "Military";
  }

  function openTab(id) {
    document.querySelectorAll("[data-tab-target]").forEach(button => button.classList.toggle("active", button.dataset.tabTarget === id));
    document.querySelectorAll("[data-tab-panel]").forEach(panel => panel.classList.toggle("active", panel.id === id));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function recordText(form) {
    const data = formObject(form);
    const lines = [
      "GRADARI MIRERIS // PLAYER RECORD",
      "Generated: " + new Date().toLocaleString(),
      ""
    ];

    if (form === actionForm) data.commitments = currentCommitments();

    Object.entries(data).forEach(([key, value]) => {
      if (key === "commitments") {
        lines.push("COMMITTED RESOURCES");
        if (!value.length) lines.push("None specified");
        value.forEach((entry, index) => lines.push((index + 1) + ". " + (entry.item || "Unspecified") + (entry.detail ? " // " + entry.detail : "")));
        lines.push("");
        return;
      }
      lines.push(key.replace(/_/g, " ").toUpperCase());
      lines.push(typeof value === "boolean" ? (value ? "YES" : "NO") : (value || "Not specified"));
      lines.push("");
    });

    return lines.join("\n");
  }

  async function loadAccountData() {
    const uid = encodeURIComponent(session.user.id);
    try {
      const [profiles, actions] = await Promise.all([
        GMAuth.api("players_tab?user_id=eq." + uid + "&select=player,preferred,interests,playstyle,faction,role,goals,notes,status&limit=1"),
        GMAuth.api("actions_tab?user_id=eq." + uid + "&select=id")
      ]);

      profile = profiles?.[0] || null;
      document.getElementById("suiteActionCount").textContent = String(actions?.length || 0).padStart(2, "0");

      if (profile) {
        document.getElementById("suiteProfileStatus").textContent = (profile.status || "LINKED").toUpperCase();
        document.getElementById("suiteNotice").textContent = "A PLAYER REGISTRATION IS ALREADY LINKED TO THIS ACCOUNT.";
        restoreForm(registrationForm, profile);
        registrationForm.querySelectorAll("input,textarea,select,button").forEach(control => control.disabled = true);
        setState(registrationState, "PLAYER REGISTRATION ALREADY EXISTS FOR THIS ACCOUNT", "success");
        if (!actionForm.elements.player.value) actionForm.elements.player.value = profile.player || profile.preferred || "";
      } else {
        document.getElementById("suiteProfileStatus").textContent = "NOT LINKED";
        document.getElementById("suiteNotice").textContent = "NO PLAYER REGISTRATION IS LINKED TO THIS ACCOUNT.";
        restoreForm(registrationForm, loadDraft(REG_DRAFT));
      }
    } catch (error) {
      document.getElementById("suiteProfileStatus").textContent = "ERROR";
      document.getElementById("suiteNotice").textContent = "PLAYER DATA ERROR // " + error.message;
    }

    const actionDraft = loadDraft(ACTION_DRAFT);
    restoreForm(actionForm, actionDraft);
    commitList.innerHTML = "";
    if (actionDraft?.commitments?.length) actionDraft.commitments.forEach(x => addCommitment(x.item, x.detail));
    else addCommitment();
    conditionalFields();
  }

  registrationForm.addEventListener("input", saveRegistrationDraft);
  registrationForm.addEventListener("change", saveRegistrationDraft);
  actionForm.addEventListener("input", saveActionDraft);
  actionForm.addEventListener("change", saveActionDraft);

  document.getElementById("addCommit").addEventListener("click", () => {
    addCommitment();
    saveActionDraft();
  });

  secretAction.addEventListener("change", conditionalFields);
  actionCategory.addEventListener("change", conditionalFields);

  document.querySelectorAll("[data-open-tab]").forEach(button => {
    button.addEventListener("click", () => openTab(button.dataset.openTab));
  });

  document.querySelectorAll("[data-preview-form]").forEach(button => {
    button.addEventListener("click", () => {
      const form = document.getElementById(button.dataset.previewForm);
      previewBody.textContent = recordText(form);
      preview.showModal();
    });
  });

  document.querySelectorAll("[data-clear-form]").forEach(button => {
    button.addEventListener("click", () => {
      const form = document.getElementById(button.dataset.clearForm);
      if (!window.confirm("Clear this locally saved draft?")) return;
      form.reset();
      if (form === registrationForm) {
        localStorage.removeItem(REG_DRAFT);
        setState(registrationState, "LOCAL REGISTRATION DRAFT CLEARED");
      } else {
        localStorage.removeItem(ACTION_DRAFT);
        commitList.innerHTML = "";
        addCommitment();
        if (profile) actionForm.elements.player.value = profile.player || profile.preferred || "";
        conditionalFields();
        setState(actionState, "LOCAL ACTION DRAFT CLEARED");
      }
    });
  });

  document.getElementById("closePreview").addEventListener("click", () => preview.close());

  registrationForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (profile || !registrationForm.reportValidity()) return;

    const data = formObject(registrationForm);
    const payload = {
      user_id: session.user.id,
      player: data.player?.trim() || null,
      preferred: data.preferred?.trim() || null,
      interests: data.interests?.trim() || null,
      playstyle: data.playstyle?.trim() || null,
      faction: data.faction?.trim() || null,
      role: data.role?.trim() || null,
      goals: data.goals?.trim() || null,
      notes: data.notes?.trim() || null
    };

    const submit = registrationForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    setState(registrationState, "SUBMITTING PLAYER REGISTRATION...");

    try {
      const rows = await GMAuth.api("players_tab", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload)
      });
      profile = rows?.[0] || payload;
      localStorage.removeItem(REG_DRAFT);
      document.getElementById("suiteProfileStatus").textContent = (profile.status || "PENDING").toUpperCase();
      document.getElementById("suiteNotice").textContent = "PLAYER REGISTRATION SUBMITTED AND LINKED TO THIS ACCOUNT.";
      registrationForm.querySelectorAll("input,textarea,select,button").forEach(control => control.disabled = true);
      if (!actionForm.elements.player.value) actionForm.elements.player.value = profile.player || profile.preferred || "";
      setState(registrationState, "PLAYER REGISTRATION SUBMITTED", "success");
    } catch (error) {
      submit.disabled = false;
      setState(registrationState, "REGISTRATION FAILED // " + error.message, "error");
    }
  });

  actionForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!actionForm.reportValidity()) return;

    const data = formObject(actionForm);
    const commitments = currentCommitments();
    if (!commitments.length) {
      setState(actionState, "ADD AT LEAST ONE COMMITTED RESOURCE OR PERSONNEL ENTRY", "error");
      return;
    }

    const payload = {
      user_id: session.user.id,
      player: data.player?.trim() || null,
      action_title: data.action_title?.trim() || null,
      category: data.category || null,
      target: data.target?.trim() || null,
      objective: data.objective?.trim() || null,
      method: data.method?.trim() || null,
      commitments: JSON.stringify(commitments),
      intent: data.intent?.trim() || null,
      secret: Boolean(data.secret),
      cover_story: data.cover_story?.trim() || null,
      orders: data.orders?.trim() || null,
      notes: data.notes?.trim() || null
    };

    const submit = actionForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    setState(actionState, "SUBMITTING ACTION...");

    try {
      await GMAuth.api("actions_tab", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload)
      });
      localStorage.removeItem(ACTION_DRAFT);
      actionForm.reset();
      commitList.innerHTML = "";
      addCommitment();
      if (profile) actionForm.elements.player.value = profile.player || profile.preferred || "";
      conditionalFields();
      const current = Number(document.getElementById("suiteActionCount").textContent || 0) + 1;
      document.getElementById("suiteActionCount").textContent = String(current).padStart(2, "0");
      setState(actionState, "ACTION SUBMITTED FOR GAME MASTER REVIEW", "success");
    } catch (error) {
      setState(actionState, "ACTION SUBMISSION FAILED // " + error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });

  (async () => {
    session = await GMUI.initProtected();
    if (!session) return;
    await loadAccountData();
  })();
})();