import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contentCache } from './content-cache.mjs';
test('cache survives process instances, keys all inputs, rejects corruption and prunes obsolete data', async t => {
 const root = await mkdtemp(join(tmpdir(), 'content-cache-test-')); t.after(() => rm(root,{recursive:true,force:true}));
 let calls=0; const make=async()=>({html:`result-${++calls}`}); const ns='a'.repeat(64);
 const first=await contentCache(root,ns); assert.deepEqual(await first.get('doc',['body','internal'],make),{html:'result-1'});
 const next=await contentCache(root,ns); assert.deepEqual(await next.get('doc',['body','internal'],make),{html:'result-1'});
 assert.equal(calls,1); await next.get('doc',['body','public'],make); assert.equal(calls,2);
 const files=await readdir(join(root,ns));for(const f of files)await writeFile(join(root,ns,f),'corrupt');
 const repaired=await contentCache(root,ns);assert.deepEqual(await repaired.get('doc',['body','internal'],make),{html:'result-3'});
 await repaired.prune();assert.equal((await readdir(join(root,ns))).length,1);
 const changedApp=await contentCache(root,'b'.repeat(64));await changedApp.get('doc',['body','internal'],make);assert.equal(calls,4);
});
test('warm string entries stay isolated across application namespaces and corrupted disk is recomputed after restart', async t => {
 const root=await mkdtemp(join(tmpdir(),'content-cache-string-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const a=await contentCache(root,'a'.repeat(64));
 const html='<p>å\n"content"</p>';assert.equal(await a.get('page',['same'],async()=>html),html);
 const b=await contentCache(root,'b'.repeat(64));assert.equal(await b.get('page',['same'],async()=>'different app'),'different app');
 assert.equal(await a.get('page',['same'],async()=>{throw Error('warm entry lost')}),html);
 for(const f of await readdir(join(root,'a'.repeat(64))))await writeFile(join(root,'a'.repeat(64),f),'corrupt');
 const restarted=await contentCache(root,'a'.repeat(64));assert.equal(await restarted.get('page',['same'],async()=>html),html);
 assert.equal(restarted.stats.misses,1);
 const reused=await contentCache(root,'a'.repeat(64));assert.equal(await reused.get('page',['same'],async()=>{throw Error('miss')}),html);
 assert.equal(reused.stats.hits,1);
});
