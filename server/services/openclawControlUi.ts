type BuildOpenClawPreSeedScriptOptions = {
  safeToken: string;
  gatewayPath?: string;
};

export function buildOpenClawAutoConnectScript(): string {
  return `(function(){
try{
  var MAX_WAIT=30000;
  var INTERVAL=200;
  var start=Date.now();
  var done=false;
  var phase=0;
  var GW=window.__OPENCLAW_GATEWAY_URL__;
  var TK=window.__OPENCLAW_TOKEN__;
  if(!GW||!TK){console.error("[OC-AC] Missing gateway creds");return;}
  function tryConnect(){
    if(done)return;
    if(Date.now()-start>MAX_WAIT){console.warn("[OC-AC] Gave up after",MAX_WAIT,"ms");return;}
    var el=document.querySelector("openclaw-app");
    if(!el){setTimeout(tryConnect,INTERVAL);return;}
    if(el.connected){done=true;console.log("[OC-AC] Already connected");return;}
    if(typeof el.connect!=="function"){
      setTimeout(tryConnect,INTERVAL);return;
    }
    if(phase===0){
      console.log("[OC-AC] Phase 1: applySettings + connect");
      if(typeof el.applySettings==="function"){
        var cur=el.settings||{};
        el.applySettings(Object.assign({},cur,{gatewayUrl:GW,token:TK}));
      }
      setTimeout(function(){
        if(!el.connected&&typeof el.connect==="function"){
          el.connect();
        }
      },100);
      phase=1;
    }
    if(phase>=1&&!el.connected){
      var elapsed=Date.now()-start;
      if(elapsed>3000&&phase===1){
        console.log("[OC-AC] Phase 2: retry connect @",elapsed,"ms");
        if(typeof el.applySettings==="function"){
          el.applySettings(Object.assign({},el.settings||{},{gatewayUrl:GW,token:TK}));
        }
        el.connect();
        phase=2;
      }
      if(elapsed>6000&&phase===2){
        console.log("[OC-AC] Phase 3: login gate fallback @",elapsed,"ms");
        var btn=document.querySelector(".login-gate__connect");
        if(btn){
          var inputs=document.querySelectorAll(".login-gate input");
          for(var k=0;k<inputs.length;k++){
            var inp=inputs[k];
            if(inp.type==="password"||inp.placeholder&&inp.placeholder.indexOf("TOKEN")>=0){
              var nv=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
              if(nv&&nv.set){nv.set.call(inp,TK);inp.dispatchEvent(new Event("input",{bubbles:true}));}
              else{inp.value=TK;inp.dispatchEvent(new Event("input",{bubbles:true}));}
            }
            if(!inp.type||inp.type==="text"||inp.type==="url"){
              var nv2=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
              if(nv2&&nv2.set){nv2.set.call(inp,GW);inp.dispatchEvent(new Event("input",{bubbles:true}));}
              else{inp.value=GW;inp.dispatchEvent(new Event("input",{bubbles:true}));}
            }
          }
          setTimeout(function(){
            var btn2=document.querySelector(".login-gate__connect");
            if(btn2&&!btn2.disabled)btn2.click();
          },200);
        }
        phase=3;
      }
      if(elapsed>10000&&phase===3){
        console.log("[OC-AC] Phase 4: final retry @",elapsed,"ms");
        el.connect();
        phase=4;
      }
    }
    if(!done){setTimeout(tryConnect,INTERVAL);}
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){setTimeout(tryConnect,200);});
  }else{
    setTimeout(tryConnect,200);
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
  console.log("[OC-Pre] seeded:",w,"tk:",tk.length,"ch, wsKey:",gk,"pageKey:",pk);
}catch(e){console.error("[OC-Pre]",e)}
})()`;
}
