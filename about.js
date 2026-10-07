(() => {
  const esc=value=>GMUI.esc(value);
  const $=id=>document.getElementById(id);

  function formatDate(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return "DATE UNAVAILABLE";
    return date.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});
  }

  async function loadNews(){
    const root=$("infoNewsFeed");
    const empty=$("infoNewsEmpty");
    const state=$("infoNewsState");
    if(!root||!empty||!state) return;

    state.textContent="LOADING NEWS...";
    try{
      const rows=await GMAuth.api("game_news?select=id,title,body,visibility,faction_id,published_at&order=published_at.desc&limit=50");
      if(!rows?.length){
        root.innerHTML="";
        empty.hidden=false;
        state.textContent="";
        return;
      }

      empty.hidden=true;
      root.innerHTML=rows.map(row=>{
        const visibility=String(row.visibility||"public").toUpperCase();
        return '<article class="notice info-news-card">'+
          '<div class="info-news-meta"><span class="section-code">'+esc(visibility)+'</span><time>'+esc(formatDate(row.published_at))+'</time></div>'+
          '<h2>'+esc(row.title||"Untitled Bulletin")+'</h2>'+
          '<p>'+esc(row.body||"")+'</p>'+
        '</article>';
      }).join("");
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