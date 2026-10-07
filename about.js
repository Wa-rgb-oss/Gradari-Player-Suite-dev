(() => {
  const esc=value=>GMUI.esc(value);
  const $=id=>document.getElementById(id);

  function formatMonth(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return "Unknown";
    return date.toLocaleDateString(undefined,{month:"long"});
  }

  function normalizeSections(row){
    const source=Array.isArray(row?.content_sections)?row.content_sections:[];
    const clean=source.map(item=>({
      type:String(item?.type||"body").toLowerCase()==="header"?"header":"body",
      text:String(item?.text||"").trim()
    })).filter(item=>item.text);
    if(clean.length) return clean;
    const fallback=String(row?.body||"").trim();
    return fallback?[{type:"body",text:fallback}]:[];
  }

  function renderSections(row){
    return normalizeSections(row).map(section=>{
      if(section.type==="header") return '<h3 class="info-news-section-header">'+esc(section.text)+'</h3>';
      return '<p class="info-news-section-body">'+esc(section.text)+'</p>';
    }).join("");
  }

  async function loadNews(){
    const root=$("infoNewsFeed");
    const empty=$("infoNewsEmpty");
    const state=$("infoNewsState");
    if(!root||!empty||!state) return;

    state.textContent="LOADING NEWS...";
    try{
      const rows=await GMAuth.api("game_news?select=id,title,body,content_sections,published_at&order=published_at.desc&limit=50");
      if(!rows?.length){
        root.innerHTML="";
        empty.hidden=false;
        state.textContent="";
        return;
      }

      empty.hidden=true;
      root.innerHTML=rows.map(row=>
        '<article class="notice info-news-card">'+
          '<div class="info-news-month">'+esc(formatMonth(row.published_at))+'</div>'+
          '<h2>'+esc(row.title||"Untitled Bulletin")+'</h2>'+
          '<div class="info-news-content">'+renderSections(row)+'</div>'+
        '</article>'
      ).join("");
      state.textContent="";
    }catch(error){
      root.innerHTML="";
      empty.hidden=true;
      state.textContent="NEWS DATA ERROR // "+error.message;
    }
  }

  function selectHashTab(){
    const hash=String(location.hash||"").replace(/^#/,"").toLowerCase();
    const key=hash==="about"?"about":hash==="how-to-play"||hash==="howtoplay"?"how-to-play":"news";
    const button=document.querySelector('[data-info-hash="'+key+'"]');
    if(button && !button.classList.contains("active")) button.click();
  }

  async function init(){
    const session=await GMUI.initProtected();
    if(!session) return;

    document.querySelectorAll("[data-info-hash]").forEach(button=>{
      button.addEventListener("click",()=>{
        const next="#"+button.dataset.infoHash;
        if(location.hash!==next) history.replaceState(null,"",next);
      });
    });

    selectHashTab();
    window.addEventListener("hashchange",selectHashTab);
    await loadNews();
  }

  window.addEventListener("load",()=>init().catch(error=>{
    const state=$("infoNewsState");
    if(state) state.textContent="INFORMATION HUB ERROR // "+error.message;
  }));
})();