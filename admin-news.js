(() => {
  const $=id=>document.getElementById(id);
  const esc=value=>GMUI.esc(value);
  let posts=[];
  let sections=[{type:"body",text:""}];
  let editingId=null;

  function monthName(value){
    const d=new Date(value);
    return Number.isNaN(d.getTime())?"UNKNOWN":d.toLocaleDateString(undefined,{month:"long"});
  }

  function normalizeSections(value, fallback=""){
    const source=Array.isArray(value)?value:[];
    const clean=source
      .map(item=>({
        type:String(item?.type||"body").toLowerCase()==="header"?"header":"body",
        text:String(item?.text||"").trim()
      }))
      .filter(item=>item.text);
    if(clean.length) return clean;
    return fallback? [{type:"body",text:String(fallback)}] : [{type:"body",text:""}];
  }

  function plainBody(items){
    return items.map(item=>String(item.text||"").trim()).filter(Boolean).join("\n\n");
  }

  function renderSections(){
    const root=$("adminNewsSections");
    if(!root) return;
    root.innerHTML=sections.map((section,index)=>{
      const isHeader=section.type==="header";
      return '<div class="admin-news-section" data-news-section="'+index+'">'+
        '<div class="admin-news-section-head"><span class="section-code">'+(isHeader?"HEADER SECTION":"BODY SECTION")+'</span>'+
        '<button class="admin-news-remove" type="button" data-remove-section="'+index+'" aria-label="Remove section">REMOVE</button></div>'+
        (isHeader
          ? '<input data-section-input="'+index+'" maxlength="220" placeholder="Section header" value="'+esc(section.text)+'">'
          : '<textarea data-section-input="'+index+'" placeholder="Type section body here...">'+esc(section.text)+'</textarea>')+
      '</div>';
    }).join("");

    root.querySelectorAll("[data-section-input]").forEach(input=>{
      input.addEventListener("input",()=>{
        const index=Number(input.dataset.sectionInput);
        if(sections[index]) sections[index].text=input.value;
      });
    });

    root.querySelectorAll("[data-remove-section]").forEach(button=>{
      button.addEventListener("click",()=>{
        const index=Number(button.dataset.removeSection);
        sections.splice(index,1);
        if(!sections.length) sections.push({type:"body",text:""});
        renderSections();
      });
    });
  }

  function resetEditor(message=""){
    editingId=null;
    sections=[{type:"body",text:""}];
    $("adminNewsEditId").value="";
    $("adminNewsTitle").value="";
    $("adminNewsEditorTitle").textContent="New News Post";
    $("adminNewsSubmit").textContent="PUBLISH NEWS";
    $("adminNewsCancelEdit").hidden=true;
    renderSections();
    GMUI.setState($("adminNewsState"),message,message?"success":"");
  }

  function beginEdit(post){
    editingId=String(post.id);
    $("adminNewsEditId").value=editingId;
    $("adminNewsTitle").value=post.title||"";
    sections=normalizeSections(post.content_sections,post.body||"");
    $("adminNewsEditorTitle").textContent="Edit News Post";
    $("adminNewsSubmit").textContent="SAVE NEWS";
    $("adminNewsCancelEdit").hidden=false;
    renderSections();
    GMUI.setState($("adminNewsState"),"EDITING // "+String(post.title||"NEWS POST").toUpperCase());
    $("adminNewsTitle").focus();
  }

  function renderList(){
    const root=$("adminNewsList");
    const empty=$("adminNewsEmpty");
    if(!root||!empty) return;
    empty.hidden=posts.length>0;
    root.innerHTML=posts.map(post=>{
      const structured=normalizeSections(post.content_sections,post.body||"").filter(item=>item.text);
      const preview=plainBody(structured).slice(0,220);
      return '<article class="notice admin-news-post" data-news-id="'+esc(post.id)+'">'+
        '<div class="split-actions"><div><div class="section-code">'+esc(monthName(post.published_at))+'</div><strong>'+esc(post.title||"Untitled News")+'</strong></div>'+
        '<div class="form-actions"><button class="hud-button secondary admin-news-edit" type="button" data-id="'+esc(post.id)+'">EDIT</button>'+
        '<button class="hud-button danger admin-news-delete" type="button" data-id="'+esc(post.id)+'">DELETE</button></div></div>'+
        (preview?'<p>'+esc(preview)+(plainBody(structured).length>220?"...":"")+'</p>':'')+
      '</article>';
    }).join("");

    root.querySelectorAll(".admin-news-edit").forEach(button=>{
      button.addEventListener("click",()=>{
        const post=posts.find(row=>String(row.id)===String(button.dataset.id));
        if(post) beginEdit(post);
      });
    });

    root.querySelectorAll(".admin-news-delete").forEach(button=>{
      button.addEventListener("click",async()=>{
        const post=posts.find(row=>String(row.id)===String(button.dataset.id));
        if(!post) return;
        const confirmed=await GMUI.confirmAction(
          'Delete "'+String(post.title||"this news post")+'"? This removes it from the News page.',
          {code:"ADMIN / NEWS",title:"Delete News Post",confirmText:"DELETE"}
        );
        if(!confirmed) return;
        try{
          await GMAuth.api("game_news?id=eq."+encodeURIComponent(post.id),{
            method:"DELETE",
            headers:{Prefer:"return=minimal"}
          });
          if(editingId===String(post.id)) resetEditor();
          await loadNews();
          GMUI.setState($("adminNewsState"),"NEWS POST DELETED","success");
        }catch(error){
          GMUI.setState($("adminNewsState"),"NEWS DELETE FAILED // "+error.message,"error");
        }
      });
    });
  }

  async function loadNews(){
    try{
      posts=await GMAuth.api("game_news?select=id,title,body,content_sections,published_at,created_at,updated_at&order=published_at.desc&limit=100");
      posts=posts||[];
      renderList();
    }catch(error){
      GMUI.setState($("adminNewsState"),"NEWS DATA ERROR // "+error.message,"error");
    }
  }

  $("adminNewsAddHeader")?.addEventListener("click",()=>{
    sections.push({type:"header",text:""});
    renderSections();
    const inputs=$("adminNewsSections").querySelectorAll("[data-section-input]");
    inputs[inputs.length-1]?.focus();
  });

  $("adminNewsAddBody")?.addEventListener("click",()=>{
    sections.push({type:"body",text:""});
    renderSections();
    const inputs=$("adminNewsSections").querySelectorAll("[data-section-input]");
    inputs[inputs.length-1]?.focus();
  });

  $("adminNewsCancelEdit")?.addEventListener("click",()=>resetEditor());

  $("adminNewsForm")?.addEventListener("submit",async event=>{
    event.preventDefault();
    const title=$("adminNewsTitle").value.trim();
    const cleaned=sections.map(section=>({
      type:section.type==="header"?"header":"body",
      text:String(section.text||"").trim()
    })).filter(section=>section.text);

    if(!title){
      GMUI.setState($("adminNewsState"),"NEWS TITLE IS REQUIRED","error");
      return;
    }
    if(!cleaned.length){
      GMUI.setState($("adminNewsState"),"ADD AT LEAST ONE NEWS SECTION","error");
      return;
    }

    const payload={
      title,
      body:plainBody(cleaned),
      content_sections:cleaned,
      visibility:"public",
      faction_id:null,
      updated_at:new Date().toISOString()
    };

    const button=$("adminNewsSubmit");
    button.disabled=true;
    try{
      if(editingId){
        await GMAuth.api("game_news?id=eq."+encodeURIComponent(editingId),{
          method:"PATCH",
          headers:{"Content-Type":"application/json",Prefer:"return=minimal"},
          body:JSON.stringify(payload)
        });
        resetEditor("NEWS POST UPDATED");
      }else{
        await GMAuth.api("game_news",{
          method:"POST",
          headers:{"Content-Type":"application/json",Prefer:"return=minimal"},
          body:JSON.stringify(payload)
        });
        resetEditor("NEWS PUBLISHED // PLAYER NOTIFICATION CREATED");
      }
      await loadNews();
    }catch(error){
      GMUI.setState($("adminNewsState"),(editingId?"NEWS UPDATE FAILED // ":"NEWS PUBLISH FAILED // ")+error.message,"error");
    }finally{
      button.disabled=false;
    }
  });

  document.addEventListener("gm:admin-state",()=>loadNews());
  renderSections();
})();