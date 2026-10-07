(() => {
  const esc=v=>GMUI.esc(v), api=(p,o)=>GMAuth.api(p,o), $=id=>document.getElementById(id);
  let catalog=[],holdings=[],data=null,editId=null,request=0;
  const form=()=>$('artifactCatalogForm');
  async function load(){
    if(!$('gmArtifactTools')||!data)return;const n=++request;
    try{
      const rows=await Promise.all([api('artifact_catalog?select=*&order=name.asc'),api('character_artifacts?select=*&order=granted_at.desc')]);if(n!==request)return;[catalog,holdings]=rows;
      const names=new Map((data.characters||[]).map(c=>[c.id,c.name]));
      $('artifactGrantCharacter').innerHTML='<option value="">Select character</option>'+(data.characters||[]).filter(c=>c.status==='active'&&c.life_status==='alive').map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
      $('artifactGrantCatalog').innerHTML='<option value="">Select artifact</option>'+catalog.filter(a=>a.active).map(a=>'<option value="'+esc(a.id)+'">'+esc(a.name)+'</option>').join('');
      $('artifactAdminCatalog').innerHTML=catalog.map(a=>'<article class="artifact-card"><h3>'+esc(a.name)+'</h3><p>'+esc(a.description)+'</p><p>'+esc(a.rarity)+' / +'+esc(a.influence_bonus_percent)+'% Influence / '+(a.active?'Available':'Retired')+'</p><p>'+esc(a.ability_name||'No activated ability')+(a.ability_influence>0?' / +'+esc(a.ability_influence)+' Influence / '+esc(a.cooldown_world_hours)+' world hours':'')+'</p><button class="hud-button secondary" type="button" data-artifact-edit="'+esc(a.id)+'">Edit</button></article>').join('')||'<p>No artifacts defined.</p>';
      const defs=new Map(catalog.map(a=>[a.id,a]));
      $('artifactAdminHoldings').innerHTML=holdings.map(h=>'<div class="resource-row"><div><strong>'+esc(names.get(h.character_id)||'Character')+'</strong><p>'+esc(defs.get(h.artifact_id)?.name||'Artifact')+' / '+(h.equipped_slot?'Equipped / Slot '+h.equipped_slot.slice(-1):'Unequipped')+'</p></div><button class="hud-button secondary" type="button" data-artifact-revoke="'+esc(h.id)+'">Revoke</button></div>').join('')||'<div class="empty-state">NO ARTIFACTS AWARDED.</div>';
    }catch(e){$('artifactAdminState').textContent=e.message;}
  }
  document.addEventListener('gm:admin-state',e=>{data=e.detail;load();});
  window.addEventListener('load',()=>{
    if(!form())return;if(window.GMAdminData){data=window.GMAdminData;load();}
    form().addEventListener('submit',async e=>{
      e.preventDefault();const button=form().querySelector('[type=submit]');button.disabled=true;
      const fields=Object.fromEntries(new FormData(form()));
      for(const name of ['influence_bonus_percent','ability_influence','cooldown_world_hours'])fields[name]=Number(fields[name]);
      fields.active=form().elements.active.checked;
      try{await api('artifact_catalog'+(editId?'?id=eq.'+encodeURIComponent(editId):''),{method:editId?'PATCH':'POST',body:JSON.stringify(fields)});editId=null;form().reset();$('artifactSaveLabel').textContent='Create artifact';await load();$('artifactAdminState').textContent='Artifact saved.';}catch(err){$('artifactAdminState').textContent=err.message;}finally{button.disabled=false;}
    });
    $('artifactNew').onclick=()=>{editId=null;form().reset();$('artifactSaveLabel').textContent='Create artifact';};
    $('artifactGrantForm').addEventListener('submit',async e=>{
      e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;
      try{await api('rpc/gm_assign_artifact',{method:'POST',body:JSON.stringify({p_character_id:$('artifactGrantCharacter').value,p_artifact_id:$('artifactGrantCatalog').value,p_grant:true})});await load();$('artifactAdminState').textContent='Artifact awarded. The character can now equip it.';}catch(err){$('artifactAdminState').textContent=err.message;}finally{button.disabled=false;}
    });
  });
  document.addEventListener('click',async e=>{
    const edit=e.target.closest('[data-artifact-edit]');if(edit){const a=catalog.find(a=>a.id===edit.dataset.artifactEdit);if(!a)return;editId=a.id;for(const key of Object.keys(a)){const field=form().elements[key];if(field){if(field.type==='checkbox')field.checked=a[key];else field.value=a[key];}}$('artifactSaveLabel').textContent='Save changes';form().scrollIntoView({block:'start'});return;}
    const button=e.target.closest('[data-artifact-revoke]');if(!button)return;const h=holdings.find(h=>h.id===button.dataset.artifactRevoke);if(!h)return;
    if(!await GMUI.confirmAction('Revoke this artifact from the character?'))return;
    button.disabled=true;try{await api('rpc/gm_assign_artifact',{method:'POST',body:JSON.stringify({p_character_id:h.character_id,p_artifact_id:h.artifact_id,p_grant:false})});await load();$('artifactAdminState').textContent='Artifact revoked.';}catch(err){$('artifactAdminState').textContent=err.message;button.disabled=false;}
  });
})();
