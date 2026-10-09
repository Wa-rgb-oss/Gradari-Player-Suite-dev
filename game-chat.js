(() => {
  let session=null;
  let mode="global";
  let friendId=null;
  let friends=[];
  let profiles=new Map();
  let timer=null;
  let messageRequest=0;
  let targetMessageId=null;
  let pickerOpen=false;

  const esc=v=>GMUI.esc(v);
  const api=(p,o)=>GMAuth.api(p,o);
  const uid=()=>session?.user?.id||null;
  const friendName=id=>profiles.get(id)||"PLAYER";

  function shell(){
    if(document.getElementById("gmGameChat")) return;
    document.body.insertAdjacentHTML("beforeend",`
      <aside class="game-chat minimized" id="gmGameChat" aria-label="Game chat">
        <div class="game-chat-head" id="gmChatHead">
          <div>
            <span class="game-chat-expanded-label">COMMS</span>
            <span class="game-chat-collapsed-label">CHAT</span>
            <strong id="gmChatTitle">GLOBAL</strong>
          </div>
          <button id="gmChatMin" type="button" aria-label="Open chat">⌃</button>
        </div>

        <div class="game-chat-tabs">
          <button class="active" data-chat-mode="global">GLOBAL</button>
          <button data-chat-mode="direct">DIRECT</button>
        </div>

        <div class="game-chat-direct-bar" id="gmChatDirectBar" hidden>
          <button class="game-chat-back" id="gmChatBack" type="button" hidden>‹ CHATS</button>
          <strong id="gmChatDirectTitle">CHATS</strong>
          <button class="game-chat-new" id="gmChatNew" type="button">NEW CHAT</button>
        </div>

        <div class="game-chat-log" id="gmChatLog"></div>

        <form class="game-chat-form" id="gmChatForm">
          <input id="gmChatInput" maxlength="500" autocomplete="off" placeholder="Press T or Enter to chat">
          <button type="submit">SEND</button>
        </form>
      </aside>

      <div class="game-chat-picker-backdrop" id="gmChatPicker" hidden>
        <section class="game-chat-picker" role="dialog" aria-modal="true" aria-labelledby="gmChatPickerTitle">
          <div class="game-chat-picker-head">
            <div>
              <span>DIRECT COMMS</span>
              <strong id="gmChatPickerTitle">NEW CHAT</strong>
            </div>
            <button id="gmChatPickerClose" type="button" aria-label="Close new chat">×</button>
          </div>
          <div class="game-chat-picker-list" id="gmChatPickerList"></div>
        </section>
      </div>
    `);
  }

  async function loadFriends(){
    const userId=uid();
    if(!userId) return;

    const [friendRows,discoverableProfiles]=await Promise.all([
      api("rpc/get_my_chat_friends",{method:"POST",body:"{}"}),
      api("player_profiles?is_discoverable=eq.true&select=user_id,display_name").catch(()=>[])
    ]);

    friends=(friendRows||[]).map(row=>row.user_id);
    profiles=new Map((discoverableProfiles||[]).map(row=>[row.user_id,row.display_name||"PLAYER"]));
    (friendRows||[]).forEach(row=>profiles.set(row.user_id,row.display_name||"PLAYER"));

    if(friendId && !friends.includes(friendId)) friendId=null;
    renderPicker();
  }

  function renderPicker(){
    const root=document.getElementById("gmChatPickerList");
    if(!root) return;
    const sorted=[...friends].sort((a,b)=>friendName(a).localeCompare(friendName(b)));
    root.innerHTML=sorted.length
      ? sorted.map(id=>
          '<button class="game-chat-picker-friend" type="button" data-chat-friend="'+esc(id)+'">'+
            '<span class="game-chat-avatar">'+esc(friendName(id).slice(0,1).toUpperCase())+'</span>'+
            '<span><strong>'+esc(friendName(id))+'</strong><small>OPEN DIRECT MESSAGE</small></span>'+
            '<i>›</i>'+
          '</button>'
        ).join("")
      : '<div class="game-chat-empty">NO FRIENDS AVAILABLE FOR DIRECT CHAT.</div>';

    root.querySelectorAll("[data-chat-friend]").forEach(button=>{
      button.addEventListener("click",()=>{
        closePicker();
        openConversation(button.dataset.chatFriend);
      });
    });
  }

  function openPicker(){
    pickerOpen=true;
    const picker=document.getElementById("gmChatPicker");
    if(picker) picker.hidden=false;
    renderPicker();
  }

  function closePicker(){
    pickerOpen=false;
    const picker=document.getElementById("gmChatPicker");
    if(picker) picker.hidden=true;
  }

  function setDirectChrome(){
    const direct=mode==="direct";
    const inThread=direct && Boolean(friendId);
    const bar=document.getElementById("gmChatDirectBar");
    const back=document.getElementById("gmChatBack");
    const title=document.getElementById("gmChatDirectTitle");
    const form=document.getElementById("gmChatForm");
    const input=document.getElementById("gmChatInput");

    if(bar) bar.hidden=!direct;
    if(back) back.hidden=!inThread;
    if(title) title.textContent=inThread?friendName(friendId):"CHATS";
    if(form) form.hidden=direct&&!inThread;
    if(input){
      input.placeholder=inThread
        ?"Message "+friendName(friendId)
        :(direct?"Open a chat to send a message":"Press T or Enter to chat");
    }
    const mainTitle=document.getElementById("gmChatTitle");
    if(mainTitle) mainTitle.textContent=mode==="global"?"GLOBAL":"DIRECT";
  }

  function formatMessageStamp(value){
    const sent=new Date(value);
    if(Number.isNaN(sent.getTime())) return "";
    return sent.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})+
      " · "+sent.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  }

  async function renderDirectInbox(request){
    const log=document.getElementById("gmChatLog");
    const userId=uid();
    if(!log||!userId) return;

    const rows=await api("rpc/get_my_direct_chat_threads",{method:"POST",body:"{}"});

    if(request!==messageRequest || mode!=="direct" || friendId) return;

    const chats=(rows||[]).filter(row=>friends.includes(row.friend_id));

    if(!chats.length){
      log.innerHTML=
        '<div class="game-chat-inbox-empty">'+
          '<strong>NO DIRECT CHATS YET</strong>'+
          '<span>Start a conversation with someone on your friends list.</span>'+
          '<button type="button" id="gmChatEmptyNew">NEW CHAT</button>'+
        '</div>';
      document.getElementById("gmChatEmptyNew")?.addEventListener("click",openPicker);
      return;
    }

    log.innerHTML=
      '<div class="game-chat-inbox">'+
      chats.map(message=>{
        const other=message.friend_id;
        profiles.set(other,message.display_name||friendName(other));
        const mine=message.latest_sender_user_id===userId;
        const snippet=(mine?"You: ":"")+String(message.latest_message||"").replace(/\s+/g," ").trim();
        return '<button class="game-chat-thread-row" type="button" data-thread-friend="'+esc(other)+'">'+
          '<span class="game-chat-avatar">'+esc(friendName(other).slice(0,1).toUpperCase())+'</span>'+
          '<span class="game-chat-thread-copy">'+
            '<strong>'+esc(friendName(other))+'</strong>'+
            '<small>'+esc(snippet||"No message text")+'</small>'+
          '</span>'+
          '<i>›</i>'+
        '</button>';
      }).join("")+
      '</div>';

    log.querySelectorAll("[data-thread-friend]").forEach(button=>{
      button.addEventListener("click",()=>openConversation(button.dataset.threadFriend));
    });
    log.scrollTop=0;
  }

  async function loadMessages(){
    const log=document.getElementById("gmChatLog");
    if(!log) return;
    const request=++messageRequest;
    const requestedMode=mode;
    const requestedFriend=friendId;
    const current=()=>request===messageRequest && mode===requestedMode && friendId===requestedFriend;

    setDirectChrome();

    if(requestedMode==="direct" && !requestedFriend){
      await renderDirectInbox(request);
      return;
    }

    let rows=[];
    if(requestedMode==="global"){
      rows=await api(
        "game_chat_messages?channel=eq.global&expires_at=gt."+
        encodeURIComponent(new Date().toISOString())+
        "&select=*&order=created_at.asc&limit=80"
      );
    }else{
      const userId=uid();
      rows=await api(
        "game_chat_messages?channel=eq.direct&or=(and(sender_user_id.eq."+encodeURIComponent(userId)+
        ",recipient_user_id.eq."+encodeURIComponent(requestedFriend)+
        "),and(sender_user_id.eq."+encodeURIComponent(requestedFriend)+
        ",recipient_user_id.eq."+encodeURIComponent(userId)+
        "))&select=*&order=created_at.desc&limit=100"
      );
    }

    if(!current()) return;

    const ordered=requestedMode==="direct"?(rows||[]).slice().reverse():(rows||[]);
    log.innerHTML=ordered.map(m=>{
      const stamp=formatMessageStamp(m.created_at);
      return '<div class="game-chat-line '+(requestedMode==="direct"&&m.sender_user_id===uid()?"mine":"")+'" data-message-id="'+esc(m.id)+'">'+
        '<div class="game-chat-meta"><b>'+esc(profiles.get(m.sender_user_id)||(m.sender_user_id===uid()?"YOU":"PLAYER"))+'</b><small>'+esc(stamp)+'</small></div>'+
        '<span>'+esc(m.body)+'</span>'+
      '</div>';
    }).join("") || '<div class="game-chat-empty">'+(
      requestedMode==="global"
        ?"NO ACTIVE GLOBAL MESSAGES."
        :"NO MESSAGES YET. START THE CONVERSATION."
    )+'</div>';

    log.scrollTop=log.scrollHeight;

    if(targetMessageId && requestedMode==="direct"){
      const target=Array.from(log.querySelectorAll("[data-message-id]"))
        .find(line=>line.dataset.messageId===String(targetMessageId));
      if(target){
        target.scrollIntoView({block:"nearest"});
        if(target.animate){
          target.animate(
            [{backgroundColor:"rgba(92,211,232,.3)"},{backgroundColor:"transparent"}],
            {duration:2500}
          );
        }
        targetMessageId=null;
      }
    }
  }

  function openConversation(id,{messageId=null}={}){
    if(!id || !friends.includes(id)) return;
    mode="direct";
    friendId=id;
    targetMessageId=messageId;
    document.querySelectorAll("[data-chat-mode]").forEach(button=>
      button.classList.toggle("active",button.dataset.chatMode==="direct")
    );
    setDirectChrome();
    loadMessages().catch(()=>{});
  }

  function openInbox(){
    mode="direct";
    friendId=null;
    targetMessageId=null;
    document.querySelectorAll("[data-chat-mode]").forEach(button=>
      button.classList.toggle("active",button.dataset.chatMode==="direct")
    );
    setDirectChrome();
    loadMessages().catch(()=>{});
  }

  function setMode(next){
    mode=next;
    if(next==="direct") friendId=null;
    document.querySelectorAll("[data-chat-mode]").forEach(button=>
      button.classList.toggle("active",button.dataset.chatMode===mode)
    );
    setDirectChrome();
    loadMessages().catch(()=>{});
  }

  function setMinimized(minimized){
    const chat=document.getElementById("gmGameChat");
    const button=document.getElementById("gmChatMin");
    if(!chat||!button) return;
    chat.classList.toggle("minimized",Boolean(minimized));
    button.textContent=minimized?"⌃":"−";
    button.setAttribute("aria-label",minimized?"Open chat":"Close chat");
    if(minimized) closePicker();
    if(!minimized) loadMessages().catch(()=>{});
  }

  function focusChat(){
    setMinimized(false);
    if(mode==="direct"&&!friendId) return;
    document.getElementById("gmChatInput")?.focus();
  }

  async function init(){
    session=await GMAuth.getSession();
    if(!session?.user) return;

    shell();
    await loadFriends();
    setDirectChrome();
    setMinimized(window.matchMedia("(max-width:760px)").matches);

    document.querySelectorAll("[data-chat-mode]").forEach(button=>
      button.addEventListener("click",()=>setMode(button.dataset.chatMode))
    );

    document.getElementById("gmChatBack").addEventListener("click",openInbox);
    document.getElementById("gmChatNew").addEventListener("click",openPicker);
    document.getElementById("gmChatPickerClose").addEventListener("click",closePicker);
    document.getElementById("gmChatPicker").addEventListener("click",event=>{
      if(event.target===event.currentTarget) closePicker();
    });

    document.getElementById("gmChatMin").addEventListener("click",event=>{
      event.stopPropagation();
      const chat=document.getElementById("gmGameChat");
      setMinimized(!chat.classList.contains("minimized"));
    });

    document.getElementById("gmChatHead").addEventListener("click",()=>{
      const chat=document.getElementById("gmGameChat");
      if(chat.classList.contains("minimized")) setMinimized(false);
    });

    document.getElementById("gmChatForm").addEventListener("submit",async event=>{
      event.preventDefault();
      const input=document.getElementById("gmChatInput");
      const body=input.value.trim();
      if(!body) return;
      if(mode==="direct"&&!friendId) return;

      try{
        await api("rpc/send_game_chat_message",{
          method:"POST",
          body:JSON.stringify({
            p_channel:mode,
            p_body:body,
            p_recipient_user_id:mode==="direct"?friendId:null
          })
        });
        input.value="";
        await loadMessages();
      }catch(error){
        input.placeholder=error.message;
      }
    });

    document.addEventListener("keydown",event=>{
      const input=document.getElementById("gmChatInput");
      const typing=document.activeElement===input;

      if(event.key==="Escape"&&pickerOpen){
        event.preventDefault();
        closePicker();
        return;
      }
      if(event.key==="Escape"&&typing){
        event.preventDefault();
        input.blur();
        return;
      }
      if(window.matchMedia("(max-width:760px)").matches) return;
      if(
        (event.key==="t"||event.key==="T"||event.key==="Enter")&&
        !typing&&
        !["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName)
      ){
        event.preventDefault();
        focusChat();
      }
    });

    window.addEventListener("gm:open-chat",event=>{
      const sender=event.detail?.friendId;
      if(sender&&friends.includes(sender)){
        openConversation(sender,{messageId:event.detail?.messageId||null});
      }
      setMinimized(false);
    });

    document.addEventListener("gm:friends-updated",async()=>{
      await loadFriends();
      if(mode==="direct"){
        if(friendId&&!friends.includes(friendId)) friendId=null;
        await loadMessages();
      }
    });

    timer=setInterval(()=>{
      const chat=document.getElementById("gmGameChat");
      if(chat&&!chat.classList.contains("minimized")) loadMessages().catch(()=>{});
    },4000);
  }

  window.addEventListener("load",()=>init().catch(()=>{}));
})();