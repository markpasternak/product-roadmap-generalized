import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { selectPublication, artifactFallbackReason } from '../deploy/actions-publication.mjs';
import { releaseIdentity } from '../deploy/coordinate.mjs';

test('Actions selects reuse only for an exact trusted live application and preserves the pre-build token on fallback', async t => {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-actions-selection-'));
  const cwd = process.cwd(), fetch = globalThis.fetch, token = process.env.GH_TOKEN;
  t.after(async () => { process.chdir(cwd);globalThis.fetch=fetch;if(token===undefined)delete process.env.GH_TOKEN;else process.env.GH_TOKEN=token;await rm(root,{recursive:true,force:true}); });
  process.env.GH_TOKEN='fixture-github-token';
  const sha = b => createHash('sha256').update(b).digest('hex');
  for (const scenario of ['already-current', 'code-change', 'missing-artifact', 'profile-mismatch', 'download-failed', 'invalid-canvas']) {
    const dir=join(root,scenario);await mkdir(join(dir,'content/items'),{recursive:true});process.chdir(dir);
    const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:'pipe'}).trim();
    git('init','-q');git('config','user.email','fixture@example.test');git('config','user.name','Test');
    await writeFile('content/items/A.md','content');git('add','.');git('commit','-qm','approved application');
    const source=git('rev-parse','HEAD');
    if(scenario==='code-change'){await writeFile('code.mjs','new code');git('add','.');git('commit','-qm','unapproved code');}
    const commit=git('rev-parse','HEAD'),digest='b'.repeat(64),repo='example/roadmap';
    const profile={siteUrl:'https://example.test',base:'/',audience:'internal',editApi:'https://edit.example.test',canvasBackend:'true'};
    const config={repo,commit,profile,token:'fixture-canvas-token',api:'https://example.test/v1/canvases/test',latest:async()=>commit};
    const snapshot=Buffer.from('{"items":[]}');
    const release={commit,applicationCommit:source,applicationPackage:digest,profile:scenario==='profile-mismatch'?'wrong':sha(JSON.stringify(profile)),contentSchema:1,
      content:{path:`content/${sha(snapshot)}.json`,hash:sha(snapshot),size:snapshot.length}};
    const version=Buffer.from(JSON.stringify(release));
    const manifest=[{path:'version.json',hash:sha(version),size:version.length},{path:release.content.path,hash:sha(snapshot),size:snapshot.length}];
    const canvas={publicationState:'published',publicationToken:'captured-before-work',currentVersionId:'v1',currentVersion:{id:'v1',number:1,
      releaseId:scenario==='download-failed'?'previous':releaseIdentity({...config,application:{source,digest}})}};
    let downloads=0;
    globalThis.fetch=async(url,options)=>{
      const u=new URL(url);
      if(u.hostname==='example.test'){
        assert.equal(options.headers.Authorization,'Bearer fixture-canvas-token');
        if(u.searchParams.has('path'))return new Response(u.searchParams.get('path')==='version.json'?version:snapshot);
        if(u.pathname.endsWith('/files'))return Response.json({version:1,fileCount:manifest.length,files:manifest});
        return Response.json(scenario==='invalid-canvas'?{}:canvas);
      }
      assert.equal(u.hostname,'api.github.com');assert.equal(options.headers.Authorization,'Bearer fixture-github-token');
      if(u.pathname.endsWith('/deploy.yml'))return Response.json({id:10,path:'.github/workflows/deploy.yml'});
      if(u.pathname.endsWith('/artifacts'))return Response.json({artifacts:scenario==='missing-artifact'?[]:[{id:40,name:`roadmap-application-${digest}`,expired:false,size_in_bytes:100,digest:`sha256:${'c'.repeat(64)}`,workflow_run:{id:20,head_sha:source,head_branch:'main',repository_id:30,head_repository_id:30}}]});
      if(u.pathname.endsWith('/runs/20'))return Response.json({id:20,workflow_id:10,path:'.github/workflows/deploy.yml',head_sha:source,head_branch:'main',event:'push',status:'completed',conclusion:'success',repository:{id:30,full_name:repo},head_repository:{id:30,full_name:repo}});
      if(u.pathname.endsWith('/zip')){downloads++;return new Response(null,{status:410});}
      throw new Error('unexpected request');
    };
    if(scenario==='invalid-canvas'){await assert.rejects(selectPublication(config),/COORDINATION_UNAVAILABLE/);continue;}
    await selectPublication(config);
    const state=JSON.parse(await readFile('.publication-selection.json','utf8'));
    assert.equal(state.fullBuild,scenario!=='already-current');
    assert.equal(state.alreadyCurrent,scenario==='already-current');
    assert.equal(state.canvas.publicationToken,'captured-before-work');
    const expectedReason = { 'missing-artifact': 'UNTRUSTED_APPLICATION_ARTIFACT', 'profile-mismatch': 'PROFILE_MISMATCH', 'download-failed': 'ARTIFACT_HTTP_410' }[scenario] ?? '';
    assert.equal(state.fallbackReason, expectedReason);
    assert.equal(downloads,scenario==='download-failed'?1:0);
  }
});

test('fallback diagnostics never expose arbitrary exception text', () => {
  assert.equal(artifactFallbackReason(new Error('ARTIFACT_HTTP_404')), 'ARTIFACT_HTTP_404');
  assert.equal(artifactFallbackReason(new Error('SECRET_TOKEN_WITH_UPPERCASE')), 'ARTIFACT_UNAVAILABLE_OR_INVALID');
  assert.equal(artifactFallbackReason(new TypeError('secret https://signed.example/?token=private')), 'ARTIFACT_UNAVAILABLE_OR_INVALID');
});
