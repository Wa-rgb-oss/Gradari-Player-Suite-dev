(() => {
  const root=document.getElementById("admin-map");
  if(!root)return;
  const editor=root.querySelector(".admin-map-editor-v2");
  const buttons=[...root.querySelectorAll("[data-map-ribbon]")];
  const syncActive=()=>{
    const selected=root.querySelector("[data-admin-map-tool].active");
    buttons.forEach(b=>b.classList.toggle("active",b.dataset.mapRibbon===selected?.dataset.adminMapTool));
  };
  buttons.forEach(btn=>btn.addEventListener("click",()=>{
    const original=root.querySelector('[data-admin-map-tool="'+btn.dataset.mapRibbon+'"]');
    if(original)original.click();
    syncActive();
  }));
  root.querySelectorAll("[data-admin-map-tool]").forEach(b=>b.addEventListener("click",syncActive));
  const toggle=document.getElementById("gmEditorTogglePanels");
  toggle?.addEventListener("click",()=>{
    const collapsed=editor.classList.toggle("gm-editor-collapsed");
    toggle.textContent=collapsed?"SHOW TOOLS":"HIDE TOOLS";
    window.dispatchEvent(new Event("resize"));
  });
  const pairs=[
    ["adminMapSystemRef","gmEditorInspectHex"],
    ["adminMapSystemName","gmEditorInspectName"],
    ["adminMapModeReadout","gmEditorInspectMode"],
    ["adminMapHexCount","gmEditorInspectCount"],
    ["adminMapClaimedCount","gmEditorInspectClaims"],
    ["adminMapLabelCount","gmEditorInspectLabels"],
    ["adminMapBuildingCount","gmEditorInspectBuildings"]
  ];
  const syncInspector=()=>{
    for(const [source,target] of pairs){
      const el=document.getElementById(source), out=document.getElementById(target);
      if(!el||!out)continue;
      const value=el instanceof HTMLInputElement ? el.value : el.textContent;
      out.textContent=value|| (target==="gmEditorInspectName"?"UNNAMED SYSTEM":"—");
    }
  };
  const observer=new MutationObserver(syncInspector);
  for(const [source] of pairs){const el=document.getElementById(source);if(el)observer.observe(el,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["value"]});}
  document.getElementById("adminMapSystemName")?.addEventListener("input",syncInspector);
  syncInspector();
})();