(() => {
  let session=null, mode="global", friendId=null, friends=[], profiles=new Map(), timer=null;
  const esc=v=>GMUI.esc(v);
  const api=(p,o)=>GMAuth.api(p,o);
  function shell(){
    if(document.getElementById("gmGameChat")) return;
    document.body.insertAdjacentHTML("beforeend",`
      <aside class="game-chat minimized" id="gmGameChat" aria-label="Game chat">
        <div class="game-chat-head" id="gmChatHead"><div><span class="game-chat-expanded-label">COMMS</span><span class="game-chat-collapsed-label">CHAT</span><strong id="gmChatTitle">GLOBAL</strong></div><button id="gmChatMin" type="button" aria-label="Open chat">⌃</button></div>
        <div class="game-chat-tabs"><button class="active" data-chat-mode="global">GLOBAL</button><button data-chat-mode="direct">DIRECT</button></div>
        <select id="gmChatFriend" hidden><option value="">SELECT FRIEND</option></select>
        <div class="game-chat-log" id="gmChatLog"></div>
        <form class="game-chat-form" id="gmChatForm"><input id="gmChatInput" maxlength="500" autocomplete="off" placeholder="Press T or Enter to chat"><button type="submit">SEND</button></form>
      </aside>`);
  }
  async function loadFriends(){
    const uid=session.user.id;
    const [links,people]=await Promise.all([
      api("friendships?or=(user_a.eq."+encodeURIComponent(uid)+",user_b.eq."+encodeURIComponent(uid)+")&select=*"),
      api("player_profiles?is_discoverable=eq.true&select=user_id,display_name")
    ]);
    profiles=new Map((people||[]).map(p=>[p.user_id,p.display_name||"PLAYER"]));
    friends=(links||[]).map(f=>f.user_a===uid?f.user_b:f.user_a);
    const sel=document.getElementById("gmChatFriend");
    sel.innerHTML='<option value="">SELECT FRIEND</option>'+friends.map(id=>'<option value="'+esc(id)+'">'+esc(profiles.get(id)||"PLAYER")+'</option>').join("");
    if(friendId && friends.includes(friendId)) sel.value=friendId;
  }
  async function loadMessages(){
    const log=document.getElementById("gmChatLog"); if(!log) return;
    let rows=[];
    if(mode==="global") rows=await api("game_chat_messages?channel=eq.global&expires_at=gt."+encodeURIComponent(new Date().toISOString())+"&select=*&order=created_at.asc&limit=80");
    else if(friendId){
      const uid=session.user.id;
      rows=await api("game_chat_messages?channel=eq.direct&or=(and(sender_user_id.eq."+uid+",recipient_user_id.eq."+friendId+"),and(sender_user_id.eq."+friendId+",recipient_user_id.eq."+uid+"))&select=*&order=created_at.asc&limit=100");
    }
    log.innerHTML=(rows||[]).map(m=>{const sent=new Date(m.created_at);const stamp=sent.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})+" · "+sent.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});return '<div class="game-chat-line"><div class="game-chat-meta"><b>'+esc(profiles.get(m.sender_user_id)||(m.sender_user_id===session.user.id?"YOU":"PLAYER"))+'</b><small>'+esc(stamp)+'</small></div><span>'+esc(m.body)+'</span></div>'}).join("") || '<div class="game-chat-empty">'+(mode==="global"?"NO ACTIVE GLOBAL MESSAGES.":"SELECT A FRIEND TO OPEN DIRECT COMMS.")+'</div>';
    log.scrollTop=log.scrollHeight;
  }
  function setMode(next){
    mode=next;
    document.querySelectorAll("[data-chat-mode]").forEach(b=>b.classList.toggle("active",b.dataset.chatMode===mode));
    document.getElementById("gmChatFriend").hidden=mode!=="direct";
    document.getElementById("gmChatTitle").textContent=mode==="global"?"GLOBAL":"DIRECT";
    loadMessages().catch(()=>{});
  }
  function setMinimized(minimized){
    const chat=document.getElementById("gmGameChat");
    const button=document.getElementById("gmChatMin");
    if(!chat || !button) return;
    chat.classList.toggle("minimized",Boolean(minimized));
    button.textContent=minimized?"⌃":"−";
    button.setAttribute("aria-label",minimized?"Open chat":"Close chat");
    if(!minimized) loadMessages().catch(()=>{});
  }
  function focusChat(){
    setMinimized(false);
    document.getElementById("gmChatInput").focus();
  }
  async function init(){
    session=await GMAuth.getSession(); if(!session?.user) return;
    shell(); await loadFriends(); setMinimized(window.matchMedia("(max-width:760px)").matches);
    document.querySelectorAll("[data-chat-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.chatMode)));
    document.getElementById("gmChatFriend").addEventListener("change",e=>{friendId=e.target.value||null;loadMessages().catch(()=>{})});
    document.getElementById("gmChatMin").addEventListener("click",event=>{
      event.stopPropagation();
      const chat=document.getElementById("gmGameChat");
      setMinimized(!chat.classList.contains("minimized"));
    });
    document.getElementById("gmChatHead").addEventListener("click",()=>{
      const chat=document.getElementById("gmGameChat");
      if(chat.classList.contains("minimized")) setMinimized(false);
    });
    document.getElementById("gmChatForm").addEventListener("submit",async e=>{
      e.preventDefault(); const input=document.getElementById("gmChatInput"),body=input.value.trim(); if(!body)return;
      try{await api("rpc/send_game_chat_message",{method:"POST",body:JSON.stringify({p_channel:mode,p_body:body,p_recipient_user_id:mode==="direct"?friendId:null})});input.value="";await loadMessages()}catch(err){input.placeholder=err.message}
    });
    document.addEventListener("keydown",e=>{
      const input=document.getElementById("gmChatInput"); const typing=document.activeElement===input;
      if(e.key==="Escape"&&typing){e.preventDefault();input.blur();return}
      if(window.matchMedia("(max-width:760px)").matches) return;
      if((e.key==="t"||e.key==="T"||e.key==="Enter")&&!typing&&!["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)){e.preventDefault();focusChat()}
    });
    window.addEventListener("gm:open-chat",()=>{ setMinimized(false); loadMessages().catch(()=>{}); });
    document.addEventListener("gm:friends-updated",()=>loadFriends().then(loadMessages));
    timer=setInterval(()=>{
      const chat=document.getElementById("gmGameChat");
      if(chat && !chat.classList.contains("minimized")) loadMessages().catch(()=>{});
    },4000);
  }
  window.addEventListener("load",()=>init().catch(()=>{}));
})();