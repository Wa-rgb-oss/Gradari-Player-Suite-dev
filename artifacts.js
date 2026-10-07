(() => {
  const esc=v=>GMUI.esc(v), api=(p,o)=>GMAuth.api(p,o), $=id=>document.getElementById(id);
  const fmt=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const slotName=s=>'Slot '+String(s||'').slice(-1);
  const effects=a=>[a.influence_bonus_percent>0?'+'+fmt(a.influence_bonus_percent)+'% daily and political activity Influence':'',a.ability_influence>0?(a.ability_name||'Ability')+': +'+fmt(a.ability_influence)+' Influence; '+fmt(a.cooldown_world_hours)+' world-hour cooldown':''].filter(Boolean).join(' · ')||'No active effects.';
  let state=null,request=0,busy=false;
  async function render(){
    const root=$('characterArtifactList'),slots=$('characterArtifactSlots');if(!root||!slots||!state)return;
    const n=++request,character=state.characters.find(c=>c.status==='active'&&c.life_status==='alive');
    if(!character){
      root.innerHTML='<div class="empty-state">CREATE A LIVING CHARACTER TO COLLECT ARTIFACTS.</div>';
      slots.innerHTML=[1,2,3].map(i=>'<article class="artifact-slot is-empty"><div class="section-code">ARTIFACT SLOT '+i+'</div><h3>Empty slot</h3><p>Create a living character to equip artifacts.</p></article>').join('');
      $('artifactBonusSummary').textContent='No active character.';return;
    }
    try{
      const [catalog,holdings,clock]=await Promise.all([api('artifact_catalog?select=*&order=name.asc'),api('character_artifacts?character_id=eq.'+encodeURIComponent(character.id)+'&select=*&order=granted_at.asc'),api('rpc/get_world_clock',{method:'POST',body:'{}'})]);
      if(n!==request)return;
      const map=new Map(catalog.filter(a=>a.active).map(a=>[a.id,a]));
      const bonus=Math.min(100,holdings.reduce((sum,h)=>sum+(/^slot_[123]$/.test(h.equipped_slot)&&map.has(h.artifact_id)?Number(map.get(h.artifact_id).influence_bonus_percent||0):0),0));
      $('artifactBonusSummary').textContent='Daily Influence: '+fmt(5*(1+bonus/100))+' · Artifact bonus: +'+fmt(bonus)+'%';
      root.innerHTML=holdings.map(h=>{
        const a=map.get(h.artifact_id);
        return '<article class="artifact-owned-item"><div class="artifact-item-heading"><h3>'+esc(a?.name||'Unavailable Artifact')+'</h3><span class="status-chip">'+esc(h.equipped_slot?'EQUIPPED / '+slotName(h.equipped_slot):'UNEQUIPPED')+'</span></div>'+(a?'<p>'+esc(a.description)+'</p><p class="artifact-effects">'+esc(effects(a))+'</p>'+(a.ability_description?'<p>'+esc(a.ability_description)+'</p>':''):'<p>This artifact has been retired.</p>')+'</article>';
      }).join('')||'<div class="empty-state">NO ARTIFACTS OWNED. ARTIFACTS ARE AWARDED BY THE GAME MASTER.</div>';
      slots.innerHTML=[1,2,3].map(i=>{
        const h=holdings.find(h=>h.equipped_slot==='slot_'+i),a=h&&map.get(h.artifact_id),remaining=h?Math.max(0,Number(h.next_use_world_hour)-Number(clock.total_world_hours)):0;
        const choices=holdings.filter(row=>map.has(row.artifact_id));
        return '<article class="artifact-slot '+(!h?'is-empty':'')+'"><div class="section-code">ARTIFACT SLOT '+i+'</div><h3>'+esc(h?(a?.name||'Unavailable Artifact'):'Empty slot')+'</h3><p>'+esc(a?effects(a):h?'This artifact has been retired.':'Any owned artifact can be equipped here.')+'</p><form class="artifact-slot-form" data-artifact-slot="'+i+'"><label><span>Artifact</span><select name="holding" aria-label="Artifact for slot '+i+'" '+(!choices.length?'disabled':'')+'><option value="">Choose an artifact</option>'+choices.map(row=>'<option value="'+esc(row.id)+'" '+(h?.id===row.id?'selected':'')+'>'+esc(map.get(row.artifact_id).name+(row.equipped_slot?' / '+slotName(row.equipped_slot):''))+'</option>').join('')+'</select></label><div class="artifact-controls"><button type="submit" class="hud-button" '+(!choices.length?'disabled':'')+'>'+(h?'Replace':'Equip')+'</button>'+(h?'<button type="button" class="hud-button secondary" data-artifact-remove="'+esc(h.id)+'">Unequip</button>':'')+'</div></form>'+(a?.ability_influence>0?'<button type="button" class="hud-button artifact-ability" data-artifact-use="'+esc(h.id)+'" '+(remaining>0?'disabled':'')+'>'+esc(remaining>0?'Ready in '+fmt(remaining)+' world hours':a.ability_name||'Use ability')+'</button>':'')+'</article>';
      }).join('');
    }catch(e){if(n===request)$('characterArtifactState').textContent='Artifacts could not be loaded: '+e.message;}
  }
  async function mutate(path,args,message){
    if(busy)return;busy=true;++request;
    const status=$('characterArtifactState');status.textContent='Updating artifacts...';
    document.querySelectorAll('#characterArtifactSlots button,#characterArtifactSlots select').forEach(el=>el.disabled=true);
    try{
      await api('rpc/'+path,{method:'POST',body:JSON.stringify(args)});
      if(window.GMPlayerSuiteRefresh)await GMPlayerSuiteRefresh();
      await render();status.textContent=message;
    }catch(e){await render();status.textContent=e.message;}
    finally{busy=false;}
  }
  document.addEventListener('submit',e=>{
    const form=e.target.closest('.artifact-slot-form');if(!form)return;e.preventDefault();
    const id=form.elements.holding.value;if(!id){$('characterArtifactState').textContent='Choose an owned artifact first.';return;}
    mutate('equip_character_artifact',{p_holding_id:id,p_slot:Number(form.dataset.artifactSlot)},'Artifact equipped.');
  });
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-artifact-remove],[data-artifact-use]');if(!button||button.disabled)return;
    const use=button.hasAttribute('data-artifact-use');
    mutate(use?'use_character_artifact':'equip_character_artifact',use?{p_holding_id:button.dataset.artifactUse}:{p_holding_id:button.dataset.artifactRemove,p_slot:null},use?'Artifact ability used. Influence awarded.':'Artifact returned to your owned list.');
  });
  document.addEventListener('gm:player-state',e=>{state=e.detail;if(!busy)render();});
  window.addEventListener('load',()=>{if(window.GMPlayerSuiteState){state=window.GMPlayerSuiteState;render();}});
  setInterval(()=>{if(!busy&&state&&$('suite-characters')?.classList.contains('active'))render();},30000);
})();
