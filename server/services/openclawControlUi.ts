type BuildOpenClawPreSeedScriptOptions = {
  safeToken: string;
  gatewayPath?: string;
};

/**
 * Build a script that auto-clicks the Connect button once the Control UI renders.
 * The Control UI build does not support `autoConnect` natively — the pre-seed sets
 * the token + URL in localStorage, but the login gate still waits for the user to
 * click "Conectar".  This script observes the DOM and clicks it automatically.
 */
export function buildOpenClawAutoConnectScript(): string {
  return `(function(){
try{
  var MAX_WAIT=8000;
  var start=Date.now();
  function tryClick(){
    var btn=document.querySelector(".login-gate__connect");
    if(btn){btn.click();return;}
    if(Date.now()-start<MAX_WAIT){requestAnimationFrame(tryClick);}
  }
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){requestAnimationFrame(tryClick);});
  }else{
    requestAnimationFrame(tryClick);
  }
}catch(e){console.error("[OC-AutoConnect]",e)}
})()`;
}

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
  try{
    var hashVal="#gatewayUrl="+encodeURIComponent(w)+"&token="+encodeURIComponent(tk);
    history.replaceState(null,"",hashVal);
  }catch{}

  function tryAutoConnect(){
    var tried=0;
    var maxTries=40;
    function attempt(){
      tried++;
      var inputs=document.querySelectorAll("input");
      var wsInput=null;
      for(var k=0;k<inputs.length;k++){
        var v=inputs[k].value||inputs[k].placeholder||"";
        if(v.indexOf("ws")===0||v.indexOf("openclaw")>=0){wsInput=inputs[k];break;}
      }
      if(!wsInput&&tried<maxTries){setTimeout(attempt,150);return;}
      var nativeInputValueSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
      if(wsInput&&!wsInput.value){
        nativeInputValueSetter.call(wsInput,w);
        wsInput.dispatchEvent(new Event("input",{bubbles:true}));
      }
      var tokenInputs=document.querySelectorAll("input[type='password'],input[type='text']");
      for(var m=0;m<tokenInputs.length;m++){
        var ti=tokenInputs[m];
        var ph=ti.getAttribute("placeholder")||"";
        if(ph.indexOf("oken")>=0||ph.indexOf("TOKEN")>=0){
          if(!ti.value&&tk){
            nativeInputValueSetter.call(ti,tk);
            ti.dispatchEvent(new Event("input",{bubbles:true}));
          }
          break;
        }
      }
      setTimeout(function(){
        var btns=document.querySelectorAll("button");
        var connectBtn=null;
        for(var b=0;b<btns.length;b++){
          var txt=(btns[b].textContent||"").toLowerCase().trim();
          if(txt==="conectar"||txt==="connect"||txt==="connect gateway"){connectBtn=btns[b];break;}
        }
        if(connectBtn&&!connectBtn.disabled){
          connectBtn.click();
        } else if(tried<maxTries){
          setTimeout(attempt,200);
        }
      },100);
    }
    if(document.readyState==="loading"){
      document.addEventListener("DOMContentLoaded",function(){setTimeout(attempt,300);});
    } else {
      setTimeout(attempt,300);
    }
  }
  tryAutoConnect();
}catch(e){console.error("[OC-Pre]",e)}
})()`;
}
