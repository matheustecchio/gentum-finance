#!/usr/bin/env node
// Test-only HTTP fixture. The distributed app always uses private Tauri IPC.
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import net from 'node:net';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=await mkdtemp(resolve(tmpdir(),'gentum-browser-fixture-'));
const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;await new Promise(resolve=>server.close(resolve));
const origin=`http://127.0.0.1:${port}`;
let fixture;
const run=(cmd,args,env={})=>new Promise((yes,no)=>{const process=spawn(cmd,args,{cwd:root,stdio:'inherit',env:{...globalThis.process.env,...env}});process.on('error',no);process.on('exit',code=>code===0?yes():no(new Error(`${cmd} failed (${code})`)));});
try{
 await run('npm',['--prefix','frontend','run','build','--','--mode','test','--outDir','test-dist']);
 await run(process.env.GO??'go',['-C','backend','build','-buildvcs=false','-o',resolve(dir,'fixture'),'./cmd/test-server']);
}catch(error){await rm(dir,{recursive:true,force:true});throw error;}
try{
 fixture=spawn(resolve(dir,'fixture'),[],{cwd:root,stdio:['ignore','inherit','inherit'],env:{...process.env,GENTUM_VERIFICATION_FIXTURE:'1',GENTUM_TEST_PORT:String(port),GENTUM_TEST_DATA_DIR:resolve(dir,'data'),GENTUM_DESKTOP_POSTGRES_DIR:resolve(root,'desktop/resources/postgres'),GENTUM_TEST_FRONTEND_DIR:resolve(root,'frontend/test-dist'),GENTUM_TEST_LEGACY_PROFILE:'1'}});
 const end=Date.now()+65000;
 for(;;){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}if(fixture.exitCode!==null)throw new Error('Fixture exited before readiness');if(Date.now()>end)throw new Error('Fixture readiness timed out');await new Promise(resolve=>setTimeout(resolve,150));}
 await run('npm',['--prefix','frontend','run','test:e2e'],{GENTUM_VERIFICATION_FIXTURE:'1',GENTUM_E2E_URL:origin});
}finally{
 if(fixture&&fixture.exitCode===null){fixture.kill('SIGTERM');await Promise.race([new Promise(resolve=>fixture.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,15000))]);if(fixture.exitCode===null){fixture.kill('SIGKILL');throw new Error('Fixture did not stop cleanly; retained data at '+dir);}}
 await rm(dir,{recursive:true,force:true});
}
