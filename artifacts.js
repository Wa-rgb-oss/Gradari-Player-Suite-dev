(() => {
  const esc=v=>GMUI.esc(v), api=(p,o)=>GMAuth.api(p,o);
  let state=null, request=0;
  const fmt=v=>Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const effects=a=>[a.influence_bonus_percent>0?'+'+fmt(a.influence_bonus_percent)+'% Influence from political activities':'',a.ability_influence>0?a.ability_name+': +'+fmt(a.ability_influence)+' Influence; '+fmt(a.cooldown_world_hours)+' world-hour cooldown':''].filter(Boolean).join(' · ')||'No mechanical effects configured.';
  async function render(){
    const root=document.getElementById('characterArtifactList');if(!root||!state)return;
    const n=++request, character=state.characters.find(c=>c.status==='active'&&c.life_status==='alive');
    const status=document.getElementById('characterArtifactState');
    if(!character){root.innerHTML='<div class="empty-state">CREATE A LIVING CHARACTER TO COLLECT ARTIFACTS.</div>';document.getElementById('artifactBonusSummary').textContent='No active character.';return;}
    try{
      const [catalog,holdings,clock]=await Promise.all([api('artifact_catalog?select=*&order=name.asc'),api('character_artifacts?character_id=eq.'+encodeURIComponent(character.id)+'&select=*&order=granted_at.asc'),api('rpc/get_world_clock',{method:'POST',body:'{}'})]);
      if(n!==request)return;
      const map=new Map(catalog.map(a=>[a.id,a]));
      const bonus=Math.min(100,holdings.reduce((sum,h)=>sum+(h.equipped_slot&&map.get(h.artifact_id)?.slot===h.equipped_slot?Number(map.get(h.artifact_id)?.influence_bonus_percent||0):0),0));
      document.getElementById('artifactBonusSummary').textContent='Active bonus: +'+fmt(bonus)+'% Influence from political activities. One artifact per slot: cloak, signet, relic. Bonuses add together, up to 100%.';
      root.innerHTML=holdings.map(h=>{
        const a=map.get(h.artifact_id);if(!a)return '<article class="artifact-card"><h3>Unavailable Artifact</h3><p>This artifact has been retired.</p>'+(h.equipped_slot?'<button type="button" class="hud-button secondary" data-artifact-equip="'+esc(h.id)+'" data-equipped="true">Unequip</button>':'')+'</article>';
        const remaining=Math.max(0,Number(h.next_use_world_hour)-Number(clock.total_world_hours));
        return '<article class="artifact-card"><div class="split-actions"><span class="status-chip">'+esc(a.rarity)+' / '+esc(a.slot)+'</span><span class="status-chip">'+(h.equipped_slot?'EQUIPPED':'CARRIED')+'</span></div><h3>'+esc(a.name)+'</h3><p>'+esc(a.description)+'</p><p class="artifact-effects">'+esc(effects(a))+'</p>'+(a.ability_description?'<p>'+esc(a.ability_description)+'</p>':'')+'<div class="artifact-controls"><button type="button" class="hud-button secondary" data-artifact-equip="'+esc(h.id)+'" data-equipped="'+Boolean(h.equipped_slot)+'">'+(h.equipped_slot?'Unequip':'Equip')+'</button>'+(a.ability_influence>0?'<button type="button" class="hud-button" data-artifact-use="'+esc(h.id)+'" '+(!h.equipped_slot||remaining>0?'disabled':'')+'>'+esc(remaining>0?'Ready in '+fmt(remaining)+' world hours':a.ability_name||'Use ability')+'</button>':'')+'</div></article>';
      }).join('')||'<div class="empty-state">NO ARTIFACTS OWNED. ARTIFACTS ARE AWARDED BY THE GAME MASTER.</div>';
      status.textContent='';
    }catch(e){if(n===request)status.textContent='Artifacts could not be loaded: '+e.message;}
  }
  document.addEventListener('gm:player-state',e=>{state=e.detail;render();});
  document.addEventListener('click',async e=>{
    const button=e.target.closest('[data-artifact-equip],[data-artifact-use]');if(!button||button.disabled)return;
    const status=document.getElementById('characterArtifactState');button.disabled=true;
    try{
      const use=button.hasAttribute('data-artifact-use');
      await api('rpc/'+(use?'use_character_artifact':'set_character_artifact'),{method:'POST',body:JSON.stringify(use?{p_holding_id:button.dataset.artifactUse}:{p_holding_id:button.dataset.artifactEquip,p_equipped:button.dataset.equipped!=='true'})});
      if(window.GMPlayerSuiteRefresh)await GMPlayerSuiteRefresh();
      await render();status.textContent=use?'Artifact ability used. Influence awarded.':'Equipment updated.';
    }catch(err){status.textContent=err.message;button.disabled=false;}
  });
  window.addEventListener('load',()=>{if(window.GMPlayerSuiteState){state=window.GMPlayerSuiteState;render();}});
  setInterval(()=>{if(state&&document.getElementById('suite-characters')?.classList.contains('active'))render();},30000);
})();
