(() => {
  const RELEASE_STAGE = "ALPHA";
  const RELEASE_VERSION = "0.02";

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[ch]));

  function setState(el, message, type = "") {
    if (!el) return;
    el.textContent = message || "";
    el.classList.remove("success", "error");
    if (type) el.classList.add(type);
  }

  function ensureModal() {
    let root=document.getElementById("gmUiModal");
    if(root) return root;
    root=document.createElement("div");
    root.id="gmUiModal";
    root.className="gm-modal-backdrop";
    root.hidden=true;
    root.innerHTML='<section class="gm-modal" role="dialog" aria-modal="true" aria-labelledby="gmModalTitle">'+
      '<div class="section-code" id="gmModalCode">SYSTEM / CONFIRMATION</div>'+
      '<h2 id="gmModalTitle">Confirm Action</h2>'+
      '<p id="gmModalMessage"></p>'+
      '<label id="gmModalInputWrap" hidden><span id="gmModalInputLabel">Value</span><input id="gmModalInput" type="text"></label>'+
      '<div class="gm-modal-actions"><button class="hud-button secondary" id="gmModalCancel" type="button">CANCEL</button><button class="hud-button amber" id="gmModalConfirm" type="button">CONFIRM</button></div>'+
      '</section>';
    document.body.appendChild(root);
    return root;
  }

  function modal(options={}) {
    const root=ensureModal();
    const title=root.querySelector("#gmModalTitle"),message=root.querySelector("#gmModalMessage");
    const code=root.querySelector("#gmModalCode"),inputWrap=root.querySelector("#gmModalInputWrap");
    const input=root.querySelector("#gmModalInput"),inputLabel=root.querySelector("#gmModalInputLabel");
    const cancel=root.querySelector("#gmModalCancel"),confirm=root.querySelector("#gmModalConfirm");
    title.textContent=options.title || "Confirm Action";
    message.textContent=options.message || "";
    code.textContent=options.code || "SYSTEM / CONFIRMATION";
    confirm.textContent=options.confirmText || "CONFIRM";
    confirm.classList.toggle("danger",Boolean(options.danger));
    confirm.classList.toggle("amber",!options.danger);
    inputWrap.hidden=!options.input;
    inputLabel.textContent=options.inputLabel || "Value";
    input.value=options.defaultValue || "";
    input.placeholder=options.placeholder || "";
    root.hidden=false;
    document.body.classList.add("gm-modal-open");
    if(options.input) setTimeout(()=>input.focus(),0); else setTimeout(()=>confirm.focus(),0);
    return new Promise(resolve=>{
      const close=value=>{
        root.hidden=true; document.body.classList.remove("gm-modal-open");
        confirm.onclick=null; cancel.onclick=null; root.onclick=null; document.onkeydown=null; resolve(value);
      };
      confirm.onclick=()=>close(options.input ? input.value : true);
      cancel.onclick=()=>close(options.input ? null : false);
      root.onclick=e=>{if(e.target===root) close(options.input ? null : false);};
      document.onkeydown=e=>{if(e.key==="Escape") close(options.input ? null : false); if(e.key==="Enter" && options.input) close(input.value);};
    });
  }

  const confirmAction=(message,options={})=>modal({...options,message});
  const promptAction=(message,defaultValue="",options={})=>modal({...options,message,input:true,defaultValue});


  function initBuildBadge() {
    document.querySelectorAll(".topbar").forEach(topbar => {
      if (topbar.querySelector("[data-build-status]")) return;
      const badge = document.createElement("div");
      badge.className = "build-status";
      badge.dataset.buildStatus = "";
      badge.setAttribute("aria-label", RELEASE_STAGE + " version " + RELEASE_VERSION);
      badge.innerHTML = '<span>' + esc(RELEASE_STAGE + " BUILD") + '</span><strong>v' + esc(RELEASE_VERSION) + '</strong>';
      const telemetry = topbar.querySelector(".top-telemetry");
      if (telemetry) topbar.insertBefore(badge, telemetry);
      else topbar.appendChild(badge);
    });
  }

  function startClock() {
    const targets = document.querySelectorAll("[data-system-time]");
    if (!targets.length) return;
    const tick = () => {
      const now = new Date();
      const value = now.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
      targets.forEach(el => el.textContent = value);
    };
    tick();
    setInterval(tick, 1000);
  }

  function startWorldClock() {
    const hosts = document.querySelectorAll(".top-telemetry");
    if (!hosts.length || !window.GMAuth) return;

    let snapshot = null;
    let fetchedAt = 0;

    const ensureReadout = () => {
      hosts.forEach(host => {
        if (host.querySelector("[data-world-clock]")) return;
        const el = document.createElement("span");
        el.dataset.worldClock = "";
        el.className = "world-clock-readout";
        el.textContent = "WORLD TIME // --";
        host.insertBefore(el, host.firstChild);
      });
    };

    const format = data => {
      const state = data.running ? "" : " // PAUSED";
      return "A" + data.aevum +
        " // C" + String(data.cycle).padStart(2,"0") +
        " // W" + data.week +
        " // D" + data.day +
        " // H" + String(data.hour).padStart(2,"0") +
        state;
    };

    const refresh = async () => {
      try {
        snapshot = await GMAuth.api("rpc/get_world_clock",{method:"POST",body:"{}"});
        fetchedAt = Date.now();
        document.querySelectorAll("[data-world-clock]").forEach(el => el.textContent = format(snapshot));
      } catch {
        document.querySelectorAll("[data-world-clock]").forEach(el => el.textContent = "WORLD TIME // OFFLINE");
      }
    };

    ensureReadout();
    refresh();
    setInterval(() => {
      if (!snapshot || Date.now()-fetchedAt > 60000) refresh();
    },12000);
  }

  function initTabs() {
    document.querySelectorAll("[data-tabs]").forEach(group => {
      const buttons = group.querySelectorAll("[data-tab-target]");
      buttons.forEach(button => {
        button.addEventListener("click", () => {
          const id = button.dataset.tabTarget;
          buttons.forEach(x => x.classList.toggle("active", x === button));
          document.querySelectorAll("[data-tab-panel]").forEach(panel => {
            if (panel.closest("[data-tab-scope]") === group.closest("[data-tab-scope]")) {
              panel.classList.toggle("active", panel.id === id);
            }
          });
        });
      });
    });
  }

  function initNotifications(session) {
    if (!session?.user?.id || document.getElementById("gmNotifications")) return;
    const uid=session.user.id;
    const esc=GMUI.esc;
    const icon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
    const footer=document.querySelector(".sidebar-footer");
    if(!footer) return;
    const signout=footer.querySelector("[data-signout]");
    const button=document.createElement("button");
    button.type="button"; button.id="gmNotificationButton"; button.className="notification-btn";
    button.setAttribute("aria-label","Open notifications");
    button.innerHTML=icon+'<span class="notification-badge" id="gmNotificationBadge" hidden>0</span>';
    if(signout) signout.parentNode.insertBefore(button,signout); else footer.appendChild(button);

    const panel=document.createElement("aside");
    panel.id="gmNotifications"; panel.className="notifications-panel"; panel.hidden=true;
    panel.innerHTML='<div class="notifications-head"><div><div class="section-code">COMMAND / NOTIFICATIONS</div><strong>INFORMATION FEED</strong></div><button type="button" class="notifications-close" id="gmNotificationsClose" aria-label="Close notifications">×</button></div>'+
      '<div class="notifications-toolbar"><div class="notifications-tabs"><button type="button" class="active" data-notification-filter="all">ALL</button><button type="button" data-notification-filter="message">MESSAGES</button><button type="button" data-notification-filter="event">EVENTS</button><button type="button" data-notification-filter="news">NEWS</button><button type="button" data-notification-filter="world">WORLD</button></div><button type="button" class="notifications-mark-read" id="gmNotificationsMarkRead">MARK ALL READ</button></div>'+
      '<div class="notifications-list" id="gmNotificationsList"></div><div class="notifications-empty" id="gmNotificationsEmpty" hidden>NO NEW INFORMATION.</div>';
    document.body.appendChild(panel);

    let items=[], filter="all", refreshTimer=null;
    const api=(path,options)=>GMAuth.api(path,options);
    const badge=document.getElementById("gmNotificationBadge"), list=document.getElementById("gmNotificationsList"), empty=document.getElementById("gmNotificationsEmpty");
    const fmtDate=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?"":d.toLocaleDateString(undefined,{month:"short",day:"numeric"})+" // "+d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});};
    const readKey=item=>item.type+"::"+String(item.id);

    function setOpen(open){panel.hidden=!open;button.classList.toggle("active",open);if(open) refresh();}
    function render(){
      const visible=filter==="all"?items:items.filter(item=>filter==="world"?(item.type==="world"||item.type==="friend_request"):item.type===filter);
      list.innerHTML=visible.map(item=>'<button type="button" class="notification-item '+(item.read?"":"unread")+'" data-notification-key="'+esc(readKey(item))+'">'+
        '<span class="notification-item-type">'+(item.type==="message"?"COMMS":item.type==="event"?"EVENT":item.type==="world"?"WORLD":item.type==="friend_request"?"SOCIAL":"NEWS")+'</span>'+
        '<span class="notification-item-body"><strong>'+esc(item.title)+'</strong><span>'+esc(item.summary)+'</span><small>'+esc(fmtDate(item.date))+'</small></span>'+
        (item.read?"":'<i class="notification-unread-dot" aria-hidden="true"></i>')+'</button>').join("");
      empty.hidden=visible.length>0;
      const unreadCount=items.filter(item=>!item.read).length;
      badge.textContent=unreadCount>99?"99+":String(unreadCount); badge.hidden=unreadCount===0;
    }
    async function refresh(){
      try{
        const [news,events,messages,world,friendRequests,reads]=await Promise.all([
          api("game_news?select=id,title,body,published_at,created_at&order=published_at.desc&limit=30"),
          api("game_events?select=id,title,description,event_type,status,created_at,starts_at&status=neq.draft&order=created_at.desc&limit=30"),
          api("game_chat_messages?channel=eq.direct&recipient_user_id=eq."+encodeURIComponent(uid)+"&select=id,sender_user_id,body,created_at&order=created_at.desc&limit=30"),
          api("world_state?player_visible=eq.true&select=key,label,category,value,updated_at&order=updated_at.desc&limit=20"),
          api("friend_requests?receiver_user_id=eq."+encodeURIComponent(uid)+"&status=eq.pending&select=id,sender_user_id,created_at&order=created_at.desc&limit=30"),
          api("game_notification_reads?user_id=eq."+encodeURIComponent(uid)+"&select=notification_type,source_id,read_at&order=read_at.desc&limit=300")
        ]);
        const readSet=new Set((reads||[]).map(row=>row.notification_type+"::"+row.source_id));
        const profileIds=[...new Set([...(messages||[]).map(row=>row.sender_user_id),...(friendRequests||[]).map(row=>row.sender_user_id)].filter(Boolean))];
        let profiles=[]; if(profileIds.length) profiles=await api("player_profiles?user_id=in.("+profileIds.map(encodeURIComponent).join(",")+")&select=user_id,display_name");
        const names=new Map((profiles||[]).map(row=>[row.user_id,row.display_name||"PLAYER"]));
        items=[
          ...(messages||[]).map(row=>({type:"message",id:row.id,friendId:row.sender_user_id,title:names.get(row.sender_user_id)||"DIRECT MESSAGE",summary:String(row.body||"").slice(0,120),date:row.created_at})),
          ...(friendRequests||[]).map(row=>({type:"friend_request",id:row.id,title:"FRIEND REQUEST",summary:(names.get(row.sender_user_id)||"PLAYER")+" sent you a friend request.",date:row.created_at})),
          ...(events||[]).map(row=>({type:"event",id:row.id,title:row.title||"NEW EVENT",summary:row.description||String(row.event_type||"EVENT").toUpperCase(),date:row.created_at})),
          ...(news||[]).map(row=>({type:"news",id:row.id,title:row.title||"ADMIN BULLETIN",summary:String(row.body||"NEW WORLD BULLETIN").slice(0,120),date:row.published_at||row.created_at})),
          ...(world||[]).filter(row=>row.updated_at && Date.now()-new Date(row.updated_at).getTime()<1000*60*60*24*14).map(row=>({type:"world",id:String(row.key)+"::"+String(row.updated_at),title:row.label||"WORLD STATE UPDATED",summary:typeof row.value==="string"?row.value:"MACRO WORLD STATE UPDATED",date:row.updated_at}))
        ].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,60).map(item=>({...item,read:readSet.has(readKey(item))}));
        render();
      }catch(error){list.innerHTML='<div class="notifications-error">NOTIFICATION FEED OFFLINE.</div>';empty.hidden=true;badge.hidden=true;}
    }
    async function markRead(selected){
      if(!selected.length) return;
      try{
        await api("game_notification_reads",{method:"POST",headers:{"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(selected.map(item=>({user_id:uid,notification_type:item.type,source_id:String(item.id),read_at:new Date().toISOString()})))});
        const keys=new Set(selected.map(readKey)); items=items.map(item=>keys.has(readKey(item))?{...item,read:true}:item); render();
      }catch{}
    }
    button.addEventListener("click",e=>{e.stopPropagation();setOpen(panel.hidden);});
    document.getElementById("gmNotificationsClose").addEventListener("click",()=>setOpen(false));
    document.getElementById("gmNotificationsMarkRead").addEventListener("click",()=>markRead(items.filter(item=>!item.read)));
    panel.querySelectorAll("[data-notification-filter]").forEach(tab=>tab.addEventListener("click",()=>{filter=tab.dataset.notificationFilter;panel.querySelectorAll("[data-notification-filter]").forEach(x=>x.classList.toggle("active",x===tab));render();}));
    list.addEventListener("click",async e=>{
      const target=e.target.closest("[data-notification-key]"); if(!target) return;
      const selected=items.find(item=>readKey(item)===target.dataset.notificationKey); if(!selected) return;
      await markRead([selected]);
      if(selected.type==="message"){window.dispatchEvent(new CustomEvent("gm:open-chat",{detail:{friendId:selected.friendId,messageId:selected.id}}));setOpen(false);}
      else if(selected.type==="friend_request") window.location.href=GMAuth.siteHref("player-suite/#friends");
      else if(selected.type==="news") window.location.href=GMAuth.siteHref("news/#news");
      else if(selected.type==="event"||selected.type==="world") window.location.href=GMAuth.siteHref("home/");
    });
    document.addEventListener("click",e=>{if(!panel.hidden&&!panel.contains(e.target)&&e.target!==button&&!button.contains(e.target))setOpen(false);});
    refresh(); refreshTimer=setInterval(refresh,30000);
    window.addEventListener("beforeunload",()=>{if(refreshTimer)clearInterval(refreshTimer);});
  }

  async function initProtected() {
    const session = await GMAuth.requireAuth();
    if (!session) return null;

    document.querySelectorAll("[data-user-email]").forEach(el => {
      el.textContent = session.user?.email || "Authenticated Player";
    });

    try {
      const admin = await GMAuth.api("rpc/is_admin",{method:"POST",body:"{}"});
      if (admin === true) {
        document.querySelectorAll(".sidebar-footer").forEach(footer => {
          if (footer.querySelector("[data-admin-link]")) return;
          const link = document.createElement("a");
          link.href = GMAuth.siteHref("admin/");
          link.className = "admin-access-btn";
          link.dataset.adminLink = "";
          link.textContent = "ADMIN CONSOLE";
          const signout = footer.querySelector("[data-signout]");
          if (signout) footer.insertBefore(link, signout);
          else footer.appendChild(link);
        });
      }
    } catch {
      // Player interface remains available if the optional admin check fails.
    }

    document.querySelectorAll("[data-signout]").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "SIGNING OUT...";
        await GMAuth.signOut();
        window.location.replace(GMAuth.siteHref("login/"));
      });
    });

    initBuildBadge();
    startClock();
    startWorldClock();
    initNotifications(session);
    initTabs();
    return session;
  }

  window.GMUI = { esc, setState, modal, confirmAction, promptAction, startClock, startWorldClock, initTabs, initBuildBadge, initProtected };
})();