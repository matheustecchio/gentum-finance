#!/usr/bin/env node
// Exercise the packaged IPC service against a disposable database, without HTTP.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = process.env.GENTUM_DESKTOP_BINARY ?? resolve(root, 'desktop/binaries/gentum-backend-x86_64-unknown-linux-gnu');
const postgres = process.env.GENTUM_POSTGRES_DIR ?? resolve(root, 'desktop/resources/postgres');
const directory = await mkdtemp(resolve(tmpdir(), 'gentum-desktop-check-'));
let child;
let nextID = 1;
let databaseID;
let closed;
let waiting = new Map();
let stderr = '';
function start() {
  return new Promise((resolveReady, rejectReady) => {
    child = spawn(binary, ['--data-dir', directory, '--postgres-dir', postgres], {stdio:['pipe','pipe','pipe']});
    stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
    const timer = setTimeout(() => { rejectReady(new Error(`Startup timed out: ${stderr}`)); }, 70000);
    child.on('error', error => { clearTimeout(timer); rejectReady(error); });
    closed = new Promise(resolveExit => child.once('exit', (code, signal) => {
      clearTimeout(timer); rejectReady(new Error(`Service exited ${code ?? signal}: ${stderr}`));
      for (const item of waiting.values()) item.reject(new Error(`Service exited: ${stderr}`));
      waiting.clear(); resolveExit({code,signal});
    }));
    const lines = createInterface({input:child.stdout});
    lines.on('line', line => {
      let packet;
      try { packet = JSON.parse(line); } catch { rejectReady(new Error('Non-JSON service stdout')); return; }
      if (packet.ready === true) { clearTimeout(timer); resolveReady(); return; }
      const item = waiting.get(packet.id);
      if (!item) { rejectReady(new Error(`Unexpected IPC response ${packet.id}`)); return; }
      waiting.delete(packet.id); clearTimeout(item.timer); item.resolve(packet);
    });
  });
}
function request(path, body, status = 200) {
  return new Promise((resolveReply,reject) => {
    const id = nextID++;
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`IPC request timed out: ${path}`)); }, 60000);
    waiting.set(id, {timer,reject,resolve: packet => {
      try {
        assert.equal(packet.status,status,`${path}: ${packet.body}`);
        assert(!Object.keys(packet.headers ?? {}).some(key => /^(set-cookie|cookie)$/i.test(key)), 'Authentication cookies must stay private');
        let body = packet.body;
        try { body = packet.body ? JSON.parse(packet.body) : undefined; } catch { /* Error responses can be plain text. */ }
        resolveReply(body);
      } catch(error) { reject(error); }
    }});
    child.stdin.write(JSON.stringify({id,method:body === undefined ? 'GET':'POST',path,headers:{'content-type':'application/json', ...(databaseID ? {'x-gentum-database':databaseID}: {})},...(body === undefined ? {} : {body:JSON.stringify(body)})})+'\n');
  });
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGKILL'),15000);
  try { const result = await closed; assert.equal(result.code,0,`Service should shut down cleanly: ${stderr}`); }
  finally { clearTimeout(timer); }
}
try {
  await start();
  const initial = await request('/auth/status');
  assert.equal(initial.setupRequired,true);
  databaseID = initial.databaseId;
  await request('/auth/setup',{source:'new',mode:'pin',pin:'0123'});
  let status = await request('/auth/status'); databaseID = status.databaseId;
  assert.equal(status.unlocked,true);
  const created = await request('/graphql',{query:'mutation{createAccount(input:{name:"Desktop persistence",type:CASH,currency:"EUR",initialBalance:"12345"}){id}}'});
  assert(!created.errors,JSON.stringify(created.errors));
  await stop();
  await start();
  status = await request('/auth/status'); databaseID = status.databaseId;
  assert.equal(status.unlocked,false,'PIN sessions must not persist across launches');
  await request('/graphql',{query:'{accounts{id}}'},401);
  await request('/auth/unlock',{pin:'0123'});
  const accounts = await request('/graphql',{query:'{accounts{id name}}'});
  assert(accounts.data.accounts.some(account => account.name === 'Desktop persistence'),'Ledger data must survive a restart');
  await request('/auth/lock',{});
  await request('/graphql',{query:'{accounts{id}}'},401);
  await stop();
  await start();
  const postgresPID = Number((await readFile(resolve(directory,'postgres-17/postmaster.pid'),'utf8')).split('\n')[0]);
  assert(postgresPID > 1,'Managed PostgreSQL must record its process ID');
  child.kill('SIGKILL');
  assert.equal((await closed).signal,'SIGKILL');
  let postgresStopped = false;
  const deadline = Date.now()+5000;
  while(Date.now()<deadline) {
    try {
      const stat = await readFile(`/proc/${postgresPID}/stat`,'utf8');
      if (/^\d+ \(.*\) [ZX] /.test(stat)) {postgresStopped=true;break;}
    } catch(error) {
      if(error.code === 'ENOENT') {postgresStopped=true;break;}
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve,50));
  }
  assert(postgresStopped,'Managed PostgreSQL must stop when its parent is killed');
  await start();
  status = await request('/auth/status'); databaseID = status.databaseId;
  assert.equal(status.unlocked,false,'A crash must not preserve an authentication session');
  await request('/auth/unlock',{pin:'0123'});
  const recovered = await request('/graphql',{query:'{accounts{id name}}'});
  assert(recovered.data.accounts.some(account => account.name === 'Desktop persistence'),'The same ledger must reopen after a parent crash');
  await stop();
  console.log('Desktop IPC check passed: setup, private authentication, persistence, PIN relock, parent-crash recovery and clean PostgreSQL shutdown.');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.stdin.end(); await Promise.race([closed,new Promise(resolve => setTimeout(resolve,15000))]); if(child.exitCode === null) child.kill('SIGKILL'); }
  for(const item of waiting.values()) clearTimeout(item.timer);
  await rm(directory,{recursive:true,force:true});
}
