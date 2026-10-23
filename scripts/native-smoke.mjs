#!/usr/bin/env node
// Real packaged Tauri/WebKit smoke test. Requires tauri-driver, WebKitWebDriver and Xvfb on Linux.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
const nativeDriver = await resolveExecutable(process.env.WEBKIT_WEBDRIVER ?? 'WebKitWebDriver');
const temporary = await mkdtemp(resolve(tmpdir(),'gentum-native-smoke-'));
const screenshot = resolve(process.env.GENTUM_NATIVE_SCREENSHOT ?? resolve(root,'desktop/target/native-smoke.png'));
const deb = process.env.GENTUM_DESKTOP_DEB ?? resolve(root,'desktop/target/release/bundle/deb/Gentum Finance_0.0.1_amd64.deb');
const driverBinary = process.env.TAURI_DRIVER ?? 'tauri-driver';
const xvfbBinary = process.env.XVFB ?? 'Xvfb';
const port = Number(process.env.GENTUM_NATIVE_DRIVER_PORT ?? '4444');
const display = process.env.GENTUM_NATIVE_DISPLAY ?? ':97';
const endpoint = `http://127.0.0.1:${port}`;
let session;
let logs = '';
let driver;
let xvfb;
const children = [];
const pause = milliseconds => new Promise(resolve => setTimeout(resolve,milliseconds));
async function resolveExecutable(binary) {
  const candidates = isAbsolute(binary) || binary.includes('/')
    ? [resolve(binary)]
    : (process.env.PATH ?? '').split(delimiter).map(directory => resolve(directory || '.', binary));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch { /* Continue searching PATH entries that do not contain the executable. */ }
  }
  throw new Error(`Cannot find executable ${binary}. Install WebKitWebDriver or set WEBKIT_WEBDRIVER to its absolute path.`);
}
function launch(binary,args,env) {
  const process = spawn(binary,args,{env,stdio:['ignore','pipe','pipe']});
  process.on('error',error => { logs += String(error)+'\n'; });
  process.stdout.on('data',data => { logs += data; }); process.stderr.on('data',data => { logs += data; });
  children.push(process); return process;
}
async function api(method,path,body) {
  const response = await fetch(endpoint+path,{method,headers:{'Content-Type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:AbortSignal.timeout(90000)});
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(`${method} ${path}: ${JSON.stringify(result)}`);
  return result.value;
}
async function waitFor(check,label,wait=70000) {
  const end = Date.now()+wait; let last;
  while(Date.now()<end) { try { const result = await check(); if(result) return result; } catch(error) {last=error;} await pause(150); }
  throw new Error(`Timed out: ${label}. ${last ?? ''}\n${logs}`);
}
async function execute(script,args=[]) {return api('POST',`/session/${session}/execute/sync`,{script,args});}
async function textPresent(text) {return execute('return document.body.innerText.includes(arguments[0])',[text]);}
async function clickText(text,scope='') {
  await waitFor(() => execute(`const nodes = [...document.querySelectorAll(arguments[1] + 'button')]; const item = nodes.find(node => node.textContent.trim() === arguments[0] && !node.disabled); if (!item) return false; item.click(); return true;`,[text,scope]),`button ${text}`);
}
async function fillLabel(label,value) {
  const element = await execute(`const label = [...document.querySelectorAll('label')].find(label => label.textContent.trim() === arguments[0]); return label?.querySelector('input');`,[label]);
  assert(element,`Missing ${label}`);
  const id = element['element-6066-11e4-a52e-4f735466cecf'];
  await api('POST',`/session/${session}/element/${id}/clear`,{});
  await api('POST',`/session/${session}/element/${id}/value`,{text:value});
}
async function open() {
  const result = await api('POST','/session',{capabilities:{alwaysMatch:{'tauri:options':{application:resolve(temporary,'package/usr/bin/gentum-finance')}}}});
  session=result.sessionId;
  await waitFor(() => textPresent('Gentum Finance'),'React desktop startup');
}
async function close() {
  if (session) {await api('DELETE',`/session/${session}`);session=undefined;await pause(1000);}
}
try {
  const packageDir=resolve(temporary,'package');await mkdir(packageDir);
  execFileSync('dpkg-deb',['-x',deb,packageDir]);
  const dataDir=resolve(temporary,'data'); const runtimeDir=resolve(temporary,'runtime');
  await mkdir(dataDir,{mode:0o700}); await mkdir(runtimeDir,{mode:0o700});
  const environment={...process.env,DISPLAY:display,XDG_DATA_HOME:dataDir,XDG_RUNTIME_DIR:runtimeDir};
  xvfb=launch(xvfbBinary,[display,'-screen','0','1440x1000x24','-nolisten','tcp'],environment);
  await pause(500);
  driver=launch(driverBinary,['--port',String(port),'--native-port',String(port+1),'--native-driver',nativeDriver],environment);
  await waitFor(() => api('GET','/status'),'native WebDriver',15000);
  await open();
  console.log('Native app started through packaged resources.');
  const second = launch(resolve(temporary,'package/usr/bin/gentum-finance'),[],environment);
  const secondExit = await Promise.race([
    new Promise(resolve => second.once('exit',code => resolve(code))),
    pause(15000).then(() => { throw new Error('A second app instance did not exit'); }),
  ]);
  assert.equal(secondExit,0,'Only one native app instance should run');
  await waitFor(() => textPresent('Set up your local wallet'),'local wallet setup');
  await clickText('Open local wallet');
  await waitFor(() => textPresent('Analytics'),'wallet opens through private IPC');
  await clickText('Settings');
  await clickText('Create account');
  await fillLabel('Account name','Native smoke wallet');
  await fillLabel('Opening balance','123.45');
  await execute(`for (const [labelText,value] of [['Account type','CASH'],['Currency','EUR']]) { const label = [...document.querySelectorAll('label')].find(label => label.textContent.trim().startsWith(labelText)); const select = label.querySelector('select'); select.value=value; select.dispatchEvent(new Event('change',{bubbles:true})); }`);
  await clickText('Create account','dialog ');
  await waitFor(() => textPresent('Account created'),'native account creation');
  console.log('Native account created. Restarting the packaged app.');
  await close();
  await open();
  await waitFor(() => textPresent('Analytics'),'automatic local unlock after restart');
  await clickText('Settings');
  await waitFor(() => textPresent('Native smoke wallet'),'ledger persists after native restart');
  await waitFor(() => textPresent('123.45'),'exact account balance after restart');
  assert(!(await textPresent('could not start')),'Native startup should not show an error');
  const image=await api('GET',`/session/${session}/screenshot`);
  await mkdir(resolve(screenshot,'..'),{recursive:true});await writeFile(screenshot,Buffer.from(image,'base64'));
  await close();
  console.log(`Native packaged smoke passed: Tauri → React → private IPC → PostgreSQL, account creation and persistence. Screenshot: ${screenshot}`);
} catch(error) {
  if(session) {try {const image=await api('GET',`/session/${session}/screenshot`);await mkdir(resolve(screenshot,'..'),{recursive:true});await writeFile(screenshot,Buffer.from(image,'base64'));}catch{}}
  console.error(logs); throw error;
} finally {
  try {await close();}catch{}
  for (const child of children.reverse()) {child.kill('SIGTERM');}
  await pause(1000);
  for (const child of children) {if(child.exitCode === null) child.kill('SIGKILL');}
  await rm(temporary,{recursive:true,force:true});
}
