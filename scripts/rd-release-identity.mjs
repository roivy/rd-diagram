#!/usr/bin/env node
// Roivy fork identity contract: replaces the upstream release-identity check.
// Validates the package's OWN identity coherence (no external repository or
// update manifest is referenced or required).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgRoot = path.join(repoRoot, 'rd-diagram');
const failures = [];

function fail(message) { failures.push(message); }
function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(pkgRoot, rel), 'utf8'));
}

const pkg = readJson('package.json');
if (pkg.name !== 'rd-diagram') fail(`package.json name must be "rd-diagram", found ${JSON.stringify(pkg.name)}`);
if (!/^\d+\.\d+\.\d+$/.test(pkg.version || '')) fail(`package.json version must be plain semver, found ${JSON.stringify(pkg.version)}`);

const release = readJson('skill-release.json');
if (release.skillId !== pkg.name) fail(`skill-release.json skillId must equal package name, found ${JSON.stringify(release.skillId)}`);
if (release.version !== pkg.version) fail(`skill-release.json version ${release.version} must equal package.json version ${pkg.version}`);
if (release.channel !== 'stable') fail(`skill-release.json channel must be "stable", found ${JSON.stringify(release.channel)}`);

const skill = fs.readFileSync(path.join(pkgRoot, 'SKILL.md'), 'utf8');
const versionMatch = skill.match(/^\s+version:\s*"([^"]+)"/m);
const expectedSkillVersion = pkg.version.split('.').slice(0, 2).join('.');
if (!versionMatch) fail('SKILL.md metadata.version is missing');
else if (versionMatch[1] !== expectedSkillVersion) fail(`SKILL.md metadata.version ${versionMatch[1]} must equal package.json major.minor ${expectedSkillVersion}`);

const cli = path.join(pkgRoot, 'bin', 'rd.mjs');
if (!fs.existsSync(cli)) fail('bin/rd.mjs CLI entry is missing');

if (failures.length) {
  console.error('rd-release-identity FAILED:');
  for (const message of failures) console.error('  ' + message);
  process.exit(1);
}
console.log(`rd-release-identity OK — rd-diagram ${pkg.version} coherent`);
