type BuildOpenClawPreSeedScriptOptions = {
  safeToken: string;
  gatewayPath?: string;
};

/**
 * Pre-seed the OpenClaw Control UI state so the login gate never needs to be
 * manually filled in:
 *   - Writes gatewayUrl + token + sessionKey into localStorage (all the keys
 *     the bundle reads: SK, SK+":default", SK+":"+gatewayKey).
 *   - Mirrors the same values into the URL hash so the bundle's hash parser
 *     picks them up on first mount.
 *   - Masks the login gate for 15s while the bundle completes its native
 *     iO(e).finally(YD) auto-connect handshake, then unmasks as a safety
 *     fallback if the WS never connects.
 *
 * The DOM-level auto-click/auto-submit logic that used to live here was
 * removed on purpose: it raced with the bundle's native auto-connect and
 * opened duplicate WebSockets that cancelled each other mid-handshake. The
 * single authoritative auto-connect now lives in the bundle patch (patch 5
 * in server/routes.ts).
 */
export function buildOpenClawPreSeedScript({
  safeToken,
  gatewayPath = "/openclaw-ws",
}: BuildOpenClawPreSeedScriptOptions): string {
  const normalizedGatewayPath = gatewayPath.startsWith("/") ? gatewayPath : `/${gatewayPath}`;

  return `(function(){
try{
  var w=(location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+"${normalizedGatewayPath}";
  var tk="${safeToken}";
  var SK="openclaw.control.settings.v1";
  var TK="openclaw.control.token.v1";
  function normalizeGatewayUrl(input){
    var raw=String(input||"").trim();
    if(!raw)return "default";
    try{
      var parsed=new URL(raw,window.location.href);
      var pathname=parsed.pathname==="/"
        ? ""
        : (parsed.pathname.replace(/\\/+$/,"")||parsed.pathname);
      return parsed.protocol+"//"+parsed.host+pathname;
    }catch{
      return raw;
    }
  }
  var existing=null;
  var keys=Object.keys(localStorage);
  for(var i=0;i<keys.length;i++){if(keys[i].indexOf(SK)===0){existing=localStorage.getItem(keys[i]);if(existing)break;}}
  var s={};try{if(existing)s=JSON.parse(existing)||{};}catch{}
  s.gatewayUrl=w;
  s.token=tk;
  s.autoConnect=true;
  s.version=s.version||1;
  s.sessionKey="agent:main:main";
  s.lastActiveSessionKey="agent:main:main";
  s.sidebarWidth=s.sidebarWidth||220;
  s.navGroupsCollapsed=s.navGroupsCollapsed||{};
  s.borderRadius=s.borderRadius!=null?s.borderRadius:50;
  s.theme=s.theme||"claw";
  s.themeMode=s.themeMode||"system";
  s.chatShowThinking=s.chatShowThinking!==false;
  s.chatShowToolCalls=s.chatShowToolCalls!==false;
  for(var j=0;j<keys.length;j++){
    var key=keys[j];
    if(key===SK||key===TK||key.indexOf(SK+":")===0||key.indexOf(TK+":")===0){
      localStorage.removeItem(key);
    }
  }
  var gk=normalizeGatewayUrl(w);
  localStorage.setItem(SK+":"+gk,JSON.stringify(s));
  localStorage.setItem(SK+":default",JSON.stringify(s));
  localStorage.setItem(SK,JSON.stringify(s));
  localStorage.setItem(TK+":"+gk,tk);
  localStorage.setItem(TK,tk);
  try{
    var hashVal="#gatewayUrl="+encodeURIComponent(w)+"&token="+encodeURIComponent(tk);
    history.replaceState(null,"",hashVal);
  }catch{}

  // Mask the login gate while the bundle's native auto-connect finishes.
  try{
    var style=document.createElement("style");
    style.id="oc-boot-mask";
    style.textContent=".login-gate{opacity:0;pointer-events:none;transition:opacity .3s}";
    (document.head||document.documentElement).appendChild(style);
    setTimeout(function(){
      var el=document.getElementById("oc-boot-mask");
      if(el){el.textContent=".login-gate{opacity:1;pointer-events:auto}";}
    },15000);
  }catch{}
}catch(e){console.error("[OC-Pre]",e)}
})()`;
}
