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

  function previewText(row){
    const body=normalizeSections(row).find(section=>section.type==="body")?.text||"";
    const opening=body.split(/\n\s*\n/)[0].replace(/\s+/g," ").trim();
    if(opening.length<=240) return opening;
    return opening.slice(0,240).replace(/\s+\S*$/,"").trimEnd()+"…";
  }

  function renderNewsFeed(root,rows){
      root.innerHTML=rows.map((row,index)=>
        '<article class="notice info-news-card">'+
          '<div class="info-news-month">'+esc(formatMonth(row.published_at))+'</div>'+
          '<h2>'+esc(row.title||"Untitled Bulletin")+'</h2>'+
          '<p class="info-news-preview">'+esc(previewText(row))+'</p>'+
          '<div class="info-news-content" id="newsContent-'+esc(root.id)+'-'+index+'" hidden>'+renderSections(row)+'</div>'+
          '<button class="hud-button secondary info-news-toggle" type="button" aria-expanded="false" aria-controls="newsContent-'+esc(root.id)+'-'+index+'" style="margin-top:14px">Read more</button>'+
        '</article>'
      ).join("");
      root.querySelectorAll(".info-news-toggle").forEach(button=>{
        button.addEventListener("click",()=>{
          const card=button.closest(".info-news-card");
          const content=card.querySelector(".info-news-content");
          const expanded=button.getAttribute("aria-expanded")!=="true";
          content.hidden=!expanded;
          card.querySelector(".info-news-preview").hidden=expanded;
          button.setAttribute("aria-expanded",String(expanded));
          button.textContent=expanded?"Show less":"Read more";
          if(!expanded && card.getBoundingClientRect().top<0){
            card.scrollIntoView({block:"start"});
          }
        });
      });
  }

  window.GMNews={render:renderNewsFeed};

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
      renderNewsFeed(root,rows);
      state.textContent="";
    }catch(error){
      root.innerHTML="";
      empty.hidden=true;
      state.textContent="NEWS DATA ERROR // "+error.message;
    }
  }

  function selectHashTab(){
    const hash=String(location.hash||"").replace(/^#/,"").toLowerCase();
    let key="news";
    if(hash==="about") key="about";
    else if(hash==="how-to-play"||hash==="howtoplay") key="how-to-play";
    else if(hash==="terms"||hash==="terms-of-use"||hash==="termsofuse") key="terms-of-use";
    else if(hash==="privacy"||hash==="privacy-policy"||hash==="privacypolicy") key="privacy-policy";
    const button=document.querySelector('[data-info-hash="'+key+'"]');
    if(button && !button.classList.contains("active")) button.click();
  }

  async function init(){
    if(!$("infoNewsFeed")) return;
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
