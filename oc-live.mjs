import WebSocket from 'ws';
import { chromium } from 'playwright';

console.log('\n========================================');
console.log('TEST EN VIVO: OpenClaw dentro de iliagpt');
console.log('========================================\n');

const BASE='http://localhost:5050';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const pageLogs = [];
page.on('console', m => pageLogs.push(`[${m.type()}] ${m.text()}`));

console.log('1) Abriendo http://localhost:5050/openclaw-ui/chat?session=main ...');
await page.goto(`${BASE}/openclaw-ui/chat?session=main`, { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(4000);

const hijackLog = pageLogs.find(l => l.includes('OC-Hijack') && l.includes('Captured'));
console.log(`   Hijack log: ${hijackLog || 'NO ENCONTRADO'}`);

const gateGone = await page.evaluate(() => {
  const gate = document.querySelector('.login-gate');
  if (!gate) return true;
  const r = gate.getBoundingClientRect();
  return r.width === 0 && r.height === 0;
});
console.log(`   ¿Login-gate desaparecido? ${gateGone ? 'SÍ ✅' : 'NO ❌'}`);

const appMounted = await page.evaluate(() => {
  const chatRoot = document.querySelector('[class*="chat"], [class*="app"], main, textarea');
  return !!chatRoot;
});
console.log(`   ¿UI del chat montada? ${appMounted ? 'SÍ ✅' : 'NO ❌'}`);

await browser.close();

console.log('\n2) Probando chat.send con token via WebSocket directo...');
const html = await fetch(`${BASE}/openclaw-ui/chat?session=main`).then(r => r.text());
const tok = html.match(/tk="([a-f0-9]{32})"/)?.[1];
console.log(`   Token HMAC recibido: ${tok?.slice(0,12)}...`);

const ws = new WebSocket('ws://localhost:5050/openclaw-ws');
let finalResponse = '';
let runId = null;

await new Promise((resolve) => {
  const timeout = setTimeout(() => { ws.close(); resolve(); }, 45000);
  let id = 1;
  ws.on('open', () => {
    console.log('   WebSocket abierto, enviando connect...');
    ws.send(JSON.stringify({type:'request',id:id++,method:'connect',params:{client:{name:'live-test',role:'control'},auth:{token:tok}}}));
  });
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.type === 'res' && m.id === 1 && m.ok) {
      console.log('   ✅ Conectado, auth.accepted=true');
      console.log('   Enviando chat.send: "Di solo la palabra funciona"');
      ws.send(JSON.stringify({type:'request',id:id++,method:'chat.send',params:{sessionKey:'main',message:{role:'user',content:[{type:'text',text:'Di solo la palabra funciona'}]}}}));
    }
    if (m.type === 'res' && m.id === 2 && m.ok) {
      runId = m.payload?.runId;
      console.log(`   ✅ chat.send aceptado, runId=${runId?.slice(0,8)}...`);
    }
    if (m.type === 'event' && m.event === 'chat') {
      const state = m.payload?.state;
      const text = m.payload?.message?.content?.[0]?.text || '';
      if (state === 'delta') process.stdout.write(`   📝 streaming delta (${text.length} chars)\r`);
      if (state === 'final') {
        finalResponse = text;
        console.log(`\n   ✅ FINAL recibido: "${finalResponse}"`);
        clearTimeout(timeout); ws.close(); resolve();
      }
      if (state === 'error') {
        console.log('   ❌ ERROR:', JSON.stringify(m.payload).slice(0,200));
        clearTimeout(timeout); ws.close(); resolve();
      }
    }
  });
  ws.on('error', (e) => { console.log('   WS error:', e.message); clearTimeout(timeout); resolve(); });
});

console.log('\n========================================');
console.log('RESULTADO:');
console.log('========================================');
console.log(`  Hijack capturó click handler: ${hijackLog ? '✅' : '❌'}`);
console.log(`  Login-gate desapareció: ${gateGone ? '✅' : '❌'}`);
console.log(`  UI chat montada: ${appMounted ? '✅' : '❌'}`);
console.log(`  LLM respondió: ${finalResponse ? '✅ "' + finalResponse + '"' : '❌'}`);
console.log('========================================\n');

if (hijackLog) console.log('Hijack log completo:', hijackLog);
