(() => {
let session=null;
window.GMPlayerSuiteRefresh=async()=>{ if(!session) return; const state=await GMPlayerData.load(session); window.dispatchEvent(new CustomEvent("gm:player-state",{detail:state})); };
async function init(){ session=await GMUI.initProtected(); if(!session)return; const state=await GMPlayerData.load(session); window.dispatchEvent(new CustomEvent("gm:player-state",{detail:state})); }
init().catch(error=>{const el=document.getElementById("marketState"); if(el) GMUI.setState(el,"EXCHANGE LOAD FAILED // "+error.message,"error");});
})();