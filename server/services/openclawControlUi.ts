type BuildOpenClawPreSeedScriptOptions = {
  safeToken: string;
  gatewayPath?: string;
};

export function buildOpenClawAutoConnectScript(): string {
  return `(function(){
try{
  var MAX_WAIT=30000;
  var INTERVAL=250;
  var start=Date.now();
  var done=false;
  var connectAttempted=false;
  function tryConnect(){
    if(done)return;
    var el=document.querySelector("openclaw-app");
    if(el&&el.connected){
      done=true;
      return;
    }
    if(el&&typeof el.connect==="function"&&el.settings&&el.settings.gatewayUrl&&el.settings.token&&!connectAttempted){
      connectAttempted=true;
      el.connect();
    }
    if(!connectAttempted&&el){
      var SK="openclaw.control.settings.v1";
      var keys=Object.keys(localStorage);
      for(var i=0;i<keys.length;i++){
        if(keys[i].indexOf(SK)===0){
          try{
            var s=JSON.parse(localStorage.getItem(keys[i]));
            if(s&&s.token&&s.gatewayUrl&&typeof el.applySettings==="function"){
              el.applySettings(Object.assign({},el.settings||{},{ gatewayUrl:s.gatewayUrl, token:s.token }));
              connectAttempted=true;
              setTimeout(function(){if(typeof el.connect==="function")el.connect();},150);
            }
          }catch(e2){}
          break;
        }
      }
    }
    if(!done&&!connectAttempted){
      var btn=document.querySelector(".login-gate__connect");
      if(btn&&!btn.disabled){
        var inputs=document.querySelectorAll(".login-gate input");
        var hasUrl=false;var hasToken=false;
        for(var k=0;k<inputs.length;k++){
          if(inputs[k].value&&inputs[k].value.indexOf("ws")===0)hasUrl=true;
          if(inputs[k].type==="password"&&inputs[k].value)hasToken=true;
        }
        if(hasUrl&&hasToken){
          connectAttempted=true;
          btn.click();
        }
      }
    }
    if(!done&&Date.now()-start<MAX_WAIT){
      setTimeout(tryConnect,INTERVAL);
    }
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){setTimeout(tryConnect,300);});
  }else{
    setTimeout(tryConnect,300);
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
  window.__OPENCLAW_CONTROL_UI_BASE_PATH__="${normalizedGatewayPath}";
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
  var pageGk=normalizeGatewayUrl(proto+"//"+location.host+location.pathname);
  localStorage.setItem(SK+":"+gk,JSON.stringify(s));
  localStorage.setItem(SK+":default",JSON.stringify(s));
  localStorage.setItem(SK,JSON.stringify(s));
  if(pageGk&&pageGk!==gk){
    localStorage.setItem(SK+":"+pageGk,JSON.stringify(s));
  }
  localStorage.setItem(TK+":"+gk,tk);
  localStorage.setItem(TK,tk);
  if(pageGk&&pageGk!==gk){
    localStorage.setItem(TK+":"+pageGk,tk);
  }
  console.log("[OC-Pre] seeded gateway:",w,"wsKey:",gk,"pageKey:",pageGk,"token:",tk.length,"chars");
}catch(e){console.error("[OC-Pre]",e)}
})()`;
}
