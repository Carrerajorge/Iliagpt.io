type BuildOpenClawPreSeedScriptOptions = {
  safeToken: string;
  gatewayPath?: string;
};

export function buildOpenClawAutoConnectScript(): string {
  return `(function(){
try{
  var GW=window.__OPENCLAW_GATEWAY_URL__;
  var TK=window.__OPENCLAW_TOKEN__;
  if(!GW||!TK){return;}
  var start=Date.now();
  var acted=false;
  function check(){
    if(acted)return;
    var el=document.querySelector("openclaw-app");
    if(!el)return;
    if(el.connected){acted=true;return;}
    var elapsed=Date.now()-start;
    if(elapsed<5000)return;
    if(typeof el.connect!=="function")return;
    acted=true;
    console.log("[OC-AC] Safety-net connect at",elapsed,"ms");
    if(typeof el.applySettings==="function"){
      el.applySettings(Object.assign({},el.settings||{},{gatewayUrl:GW,token:TK}));
    }
    setTimeout(function(){
      if(!el.connected&&typeof el.connect==="function"){
        el.connect();
      }
    },300);
  }
  var iv=setInterval(function(){
    var el=document.querySelector("openclaw-app");
    if(el&&el.connected){clearInterval(iv);return;}
    if(Date.now()-start>30000){clearInterval(iv);return;}
    check();
  },500);
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
  window.__OPENCLAW_GATEWAY_URL__=w;
  window.__OPENCLAW_TOKEN__=tk;
  var SK="openclaw.control.settings.v1";
  var TK="openclaw.control.token.v1";
  function norm(input){
    var raw=String(input||"").trim();
    if(!raw)return "default";
    try{
      var base=location.protocol+"//"+location.host+(location.pathname||"/");
      var p=new URL(raw,base);
      var pn=p.pathname==="/"?"":p.pathname.replace(/\\/+$/,"")||p.pathname;
      return p.protocol+"//"+p.host+pn;
    }catch{return raw;}
  }
  var existing=null;
  var keys=Object.keys(localStorage);
  for(var i=0;i<keys.length;i++){if(keys[i].indexOf(SK)===0){existing=localStorage.getItem(keys[i]);if(existing)break;}}
  var s={};try{if(existing)s=JSON.parse(existing)||{};}catch{}
  s.gatewayUrl=w;
  s.token=tk;
  s.autoConnect=true;
  s.sessionKey=s.sessionKey||"main";
  s.lastActiveSessionKey=s.lastActiveSessionKey||"main";
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
  var gk=norm(w);
  var pk=norm(proto+"//"+location.host+location.pathname);
  var sj=JSON.stringify(s);
  localStorage.setItem(SK+":"+gk,sj);
  localStorage.setItem(SK+":default",sj);
  localStorage.setItem(SK,sj);
  localStorage.setItem(TK+":"+gk,tk);
  localStorage.setItem(TK,tk);
  if(pk&&pk!==gk){
    localStorage.setItem(SK+":"+pk,sj);
    localStorage.setItem(TK+":"+pk,tk);
  }
}catch(e){console.error("[OC-Pre]",e)}
})()`;
}
