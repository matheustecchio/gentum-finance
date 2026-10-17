import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, symlink, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, resolveConfig } from 'vite';

// Build disposable copies so metadata checks never modify the working package.
test('version comes from package metadata and stays embedded in built output', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'gentum-version-'));
  try {
    for (const path of ['src', 'index.html', 'vite.config.ts', 'package.json']) {
      await cp(resolve(path), join(fixture, path), { recursive: true });
    }
    await symlink(resolve('node_modules'), join(fixture, 'node_modules'));
    const packagePath = join(fixture, 'package.json');
    const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
    const setVersion = async (version) => writeFile(packagePath, JSON.stringify({ ...metadata, version }));
    const bundle = async () => {
      await build({ root: fixture, logLevel: 'silent' });
      const assets = join(fixture, 'dist/assets');
      return (await Promise.all((await readdir(assets)).filter(p => p.endsWith('.js')).map(p => readFile(join(assets, p), 'utf8')))).join('\n');
    };
    await setVersion('9.8.7');
    const first = await bundle();
    assert.ok(first.includes('9.8.7'));
    assert.ok(!first.includes(' (dev)'));
    const dev = await resolveConfig({ root: fixture, logLevel: 'silent' }, 'serve');
    assert.equal(dev.define.__APP_VERSION__, '"9.8.7"');
    await setVersion('9.8.8');
    assert.ok(first.includes('9.8.7'));
    assert.ok((await bundle()).includes('9.8.8'));
    for (const invalid of [undefined, '', 'broken', '01.2.3', '1.2.3-01', null]) {
      await setVersion(invalid);
      await assert.rejects(build({ root: fixture, logLevel: 'silent' }), /must contain a valid version/);
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
