type BuildOpenClawPreSeedScriptOptions = {
  safeToken: string;
  gatewayPath?: string;
};

export function buildOpenClawAutoConnectScript(): string {
  return `(function(){
try{
  var MAX_WAIT=25000;
  var INTERVAL=300;
  var start=Date.now();
  var done=false;
  function tryConnect(){
    if(done)return;
    var el=document.querySelector("openclaw-app");
    if(el&&typeof el.connect==="function"&&el.settings&&el.settings.gatewayUrl){
      if(el.connected){
        done=true;
        console.log("[OC-AC] already connected");
        return;
      }
      if(el.settings.token){
        done=true;
        console.log("[OC-AC] calling connect() directly, url=",el.settings.gatewayUrl);
        el.connect();
        return;
      }
    }
    if(el&&el.settings&&!el.settings.token){
      var SK="openclaw.control.settings.v1";
      var keys=Object.keys(localStorage);
      for(var i=0;i<keys.length;i++){
        if(keys[i].indexOf(SK)===0){
          try{
            var s=JSON.parse(localStorage.getItem(keys[i]));
            if(s&&s.token&&s.gatewayUrl){
              el.applySettings({...el.settings,gatewayUrl:s.gatewayUrl,token:s.token});
              done=true;
              console.log("[OC-AC] applied settings from localStorage, calling connect()");
              setTimeout(function(){el.connect();},100);
              return;
            }
          }catch(e){}
        }
      }
    }
    if(Date.now()-start<MAX_WAIT){setTimeout(tryConnect,INTERVAL);}
    else{
      console.warn("[OC-AC] timed out");
      var btn=document.querySelector(".login-gate__connect");
      if(btn)btn.click();
    }
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){setTimeout(tryConnect,500);});
  }else{
    setTimeout(tryConnect,500);
  }
}catch(e){console.error("[OC-AC]",e)}
})()`;
}

export function buildOpenClawPreSeedScript({
  safeToken,
  gatewayPath = "/openclaw-ws",
}: BuildOpenClawPreSeedScriptOptions): string {
  const normalizedGatewayPath = gatewayPath.startsWith("/") ? gatewayPath : `/${gatewayPath}`;

  return `(function(){
try{
  var proto=(location.protocol==="https:"?"wss:":"ws:");
  var w=proto+"//"+location.host+"${normalizedGatewayPath}";
  var tk="${safeToken}";
  var SK="openclaw.control.settings.v1";
  var TK="openclaw.control.token.v1";
  function normalizeGatewayUrl(input){
    var raw=String(input||"").trim();
    if(!raw)return "default";
    try{
      var base=location.protocol+"//"+location.host+(location.pathname||"/");
      var parsed=new URL(raw,base);
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
  s.sessionKey=s.sessionKey||"main";
  s.lastActiveSessionKey=s.lastActiveSessionKey||"main";
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
  console.log("[OC-Pre] localStorage seeded for gateway:",w,"key:",gk,"token length:",tk.length);
}catch(e){console.error("[OC-Pre]",e)}
})()`;
}
