(() => {
  "use strict";
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const categories = [["all","ALL"],["general","GENERAL"],["character","CHARACTER"],["economy","ECONOMY"],["politics","POLITICS"],["military","MILITARY"],["social","SOCIAL"]];
  const categoriesById = Object.fromEntries(categories);
  const ctx = { requestId:0, current:null, category:"all", mount:null, onAction:null };
  const icons={inspect:"◈",travel:"➤",market:"◇",build:"+",facilities:"▣",politics:"⚖",military:"⚑",manage:"⚙",economy:"▤",faction:"♙",character:"♙",social:"✉"};
  const render = () => {
    if(!ctx.mount) return;
    if(!ctx.current){ctx.mount.innerHTML='<p class="gm-context-empty">SELECT A LOCATION OR OBJECT TO VIEW AVAILABLE ACTIONS.</p>';return;}
    const items=ctx.current.actions || [];
    const filters=categories.filter(([id])=>id==="all"||items.some(a=>a.category===id));
    ctx.mount.innerHTML='<div class="gm-context-head"><span>CONTEXT / '+escapeHtml(ctx.current.kind).toUpperCase()+'</span><strong>'+escapeHtml(ctx.current.title)+'</strong></div>'+
      '<div class="gm-context-filters" role="group" aria-label="Filter actions">'+
      filters.map(([id,label])=>'<button type="button" data-context-filter="'+id+'" aria-pressed="'+(ctx.category===id)+'" class="'+(ctx.category===id?'active':'')+'">'+label+'</button>').join('')+'</div>'+
      '<div class="gm-context-grid">'+items.filter(a=>ctx.category==="all"||a.category===ctx.category).map(a=>
      '<button type="button" class="gm-context-action" data-context-action="'+escapeHtml(a.id)+'" '+(!a.enabled?'disabled':'')+' title="'+escapeHtml(a.reason||a.label)+'">'+
      '<span class="gm-context-icon" aria-hidden="true">'+(icons[a.id]||"◈")+'</span><span><strong>'+escapeHtml(a.label)+'</strong>'+
      '<small>'+escapeHtml(!a.enabled?(a.reason||"RESTRICTED"):(categoriesById[a.category]||"ACTION")+' / AVAILABLE')+'</small></span>'+
      '<span class="gm-context-state">'+(a.enabled?"›":"🔒")+'</span></button>').join('')+'</div>';
  };
  const initialize = (mount, onAction) => {
    ctx.mount=typeof mount==="string"?document.getElementById(mount):mount;
    ctx.onAction=onAction;
    if(!ctx.mount)return;
    ctx.mount.addEventListener("click",event=>{
      const filter=event.target.closest("[data-context-filter]");
      if(filter){ctx.category=filter.dataset.contextFilter;render();return;}
      const trigger=event.target.closest("[data-context-action]");
      if(trigger&&!trigger.disabled&&ctx.current&&ctx.onAction){
        const action=ctx.current.actions.find(a=>a.id===trigger.dataset.contextAction);
        if(action?.enabled) ctx.onAction(action,ctx.current);
      }
    });
    render();
  };
  async function select(kind,locationRef=null,targetId=null){
    const id=++ctx.requestId;
    ctx.category="all";
    ctx.current=null;
    if(ctx.mount)ctx.mount.innerHTML='<p class="gm-context-empty">RESOLVING AVAILABLE ACTIONS...</p>';
    if(!kind){render();return;}
    try {
      const result=await GMAuth.api("rpc/get_contextual_actions",{
        method:"POST",body:JSON.stringify({p_kind:kind,p_location_ref:locationRef,p_target_id:targetId})
      });
      if(id!==ctx.requestId)return;
      ctx.current=typeof result==="string"?JSON.parse(result):result;
      render();
    }catch(error){
      if(id!==ctx.requestId)return;
      if(ctx.mount)ctx.mount.textContent="ACTION DISCOVERY UNAVAILABLE // "+(error.message||"TRY AGAIN");
    }
  }
  window.GMContext={initialize,select};
})();