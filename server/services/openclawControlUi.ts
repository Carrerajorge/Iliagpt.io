type BuildOpenClawPreSeedScriptOptions = {
  safeToken: string;
  gatewayPath?: string;
};

/**
 * Build a script that auto-clicks the Connect button once the Control UI renders.
 * The Control UI build does not support `autoConnect` natively — the pre-seed sets
 * the token + URL in localStorage, but the login gate still waits for the user to
 * click "Conectar".  This script observes the DOM and clicks it automatically.
 *
 * Uses both polling AND MutationObserver to catch the button as soon as it appears.
 */
export function buildOpenClawAutoConnectScript(): string {
  return `(function(){
try{
  var MAX_WAIT=20000;
  var start=Date.now();
  var clicked=false;
  function doClick(btn,source){
    if(clicked)return;
    clicked=true;
    console.log("[OC-AutoConnect] Clicking connect via "+source);
    btn.click();
    setTimeout(function(){
      if(document.querySelector(".login-gate__connect")){
        console.log("[OC-AutoConnect] Button still visible after click, retrying...");
        clicked=false;
        tryClick();
      }
    },2000);
  }
  function tryClick(){
    if(clicked)return;
    var btn=document.querySelector(".login-gate__connect");
    if(btn){doClick(btn,"poll");return;}
    var btns=document.querySelectorAll("button");
    for(var i=0;i<btns.length;i++){
      var txt=(btns[i].textContent||"").toLowerCase().trim();
      if(txt==="conectar"||txt==="connect"||txt==="connect gateway"){
        doClick(btns[i],"text-match");return;
      }
    }
    if(Date.now()-start<MAX_WAIT){setTimeout(tryClick,200);}
    else{console.warn("[OC-AutoConnect] Timed out waiting for connect button");}
  }
  var observer=new MutationObserver(function(){
    if(clicked)return;
    var btn=document.querySelector(".login-gate__connect");
    if(btn){observer.disconnect();doClick(btn,"observer");}
  });
  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",function(){
      observer.observe(document.body||document.documentElement,{childList:true,subtree:true});
      setTimeout(tryClick,100);
    });
  }else{
    observer.observe(document.body||document.documentElement,{childList:true,subtree:true});
    setTimeout(tryClick,100);
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
    var maxTries=80;
    var connected=false;
    function fillAndClick(){
      if(connected)return;
      tried++;
      var inputs=document.querySelectorAll("input");
      var wsInput=null;
      for(var k=0;k<inputs.length;k++){
        var v=inputs[k].value||inputs[k].placeholder||"";
        if(v.indexOf("ws")===0||v.indexOf("openclaw")>=0){wsInput=inputs[k];break;}
      }
      if(!wsInput&&tried<maxTries){setTimeout(fillAndClick,200);return;}
      var nativeInputValueSetter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;
      if(wsInput){
        nativeInputValueSetter.call(wsInput,w);
        wsInput.dispatchEvent(new Event("input",{bubbles:true}));
        wsInput.dispatchEvent(new Event("change",{bubbles:true}));
      }
      var tokenInputs=document.querySelectorAll("input[type='password'],input[type='text']");
      for(var m=0;m<tokenInputs.length;m++){
        var ti=tokenInputs[m];
        var ph=ti.getAttribute("placeholder")||"";
        var label=(ti.closest("label")||ti.parentElement||{}).textContent||"";
        if(ph.indexOf("oken")>=0||ph.indexOf("TOKEN")>=0||label.indexOf("oken")>=0){
          nativeInputValueSetter.call(ti,tk);
          ti.dispatchEvent(new Event("input",{bubbles:true}));
          ti.dispatchEvent(new Event("change",{bubbles:true}));
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
        if(!connectBtn){connectBtn=document.querySelector(".login-gate__connect");}
        if(connectBtn&&!connectBtn.disabled){
          console.log("[OC-Pre] Auto-clicking connect button (attempt "+tried+")");
          connectBtn.click();
          connected=true;
          setTimeout(function(){
            var stillLogin=document.querySelector(".login-gate__connect")||document.querySelector(".login-gate");
            if(stillLogin){
              console.log("[OC-Pre] Still on login gate after click, retrying...");
              connected=false;
              if(tried<maxTries)setTimeout(fillAndClick,500);
            }
          },3000);
        } else if(tried<maxTries){
          setTimeout(fillAndClick,250);
        }
      },150);
    }
    if(document.readyState==="loading"){
      document.addEventListener("DOMContentLoaded",function(){setTimeout(fillAndClick,300);});
    } else {
      setTimeout(fillAndClick,300);
    }
  }
  tryAutoConnect();
}catch(e){console.error("[OC-Pre]",e)}
})()`;
}
