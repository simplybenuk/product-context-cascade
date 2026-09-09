#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const REQUIRED_PACKAGED_FILES = Object.freeze([
  'LICENSE',
  'README.md',
  'VERSION',
  'package.json',
  'cli/mole.mjs',
  'cli/package.json',
  'lib/capture.mjs',
  'lib/inbox-audit.mjs',
  'lib/inbox-processing.mjs',
  'lib/metrics.mjs',
  'mole.instance-template.yaml',
  'upgrade-ownership.json'
]);

function parsePackMetadata(stdout) {
  const text = String(stdout || '').trim();

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('[');
    if (start < 0) return null;
    return JSON.parse(text.slice(start));
  }
}

function normaliseArchivePath(entry) {
  return entry.replace(/^package\//, '').replace(/\/$/, '');
}

export function assertRequiredPackagedFiles(entries, required = REQUIRED_PACKAGED_FILES) {
  const packagedFiles = new Set(entries.map(normaliseArchivePath));
  const missing = required.filter((file) => !packagedFiles.has(file));

  if (missing.length) {
    throw new Error('Packed artefact is missing required files: ' + missing.join(', '));
  }

  return packagedFiles;
}

function run(command, args, cwd, options = {}) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    ...options
  });
}

export function createGitSnapshot(root, ref, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const archivePath = path.join(destination, '.git-snapshot.tar');

  try {
    const archive = run('git', ['archive', '--format=tar', '--output', archivePath, ref], root);
    if (archive.status !== 0) {
      throw new Error('Unable to export ' + ref + ':\n' + (archive.stderr || archive.stdout));
    }

    const extract = run('tar', ['-xf', archivePath, '-C', destination], root);
    if (extract.status !== 0) {
      throw new Error('Unable to extract ' + ref + ':\n' + (extract.stderr || extract.stdout));
    }
  } finally {
    fs.rmSync(archivePath, { force: true });
  }

  return destination;
}

export function verifyPackage(root = repoRoot, options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'product-mole-package-'));

  try {
    const packageRoot = options.gitRef
      ? createGitSnapshot(root, options.gitRef, path.join(tempRoot, 'source'))
      : root;
    const pack = run('npm', ['pack', '--json', '--pack-destination', tempRoot], packageRoot);
    if (pack.status !== 0) {
      throw new Error('npm pack failed:\n' + (pack.stderr || pack.stdout));
    }

    const packMetadata = parsePackMetadata(pack.stdout);
    const archiveName = packMetadata?.[0]?.filename;
    if (!archiveName) {
      throw new Error('npm pack did not report an archive filename.');
    }

    const archivePath = path.join(tempRoot, path.basename(archiveName));
    if (!fs.existsSync(archivePath)) {
      throw new Error('npm pack reported a missing archive: ' + archivePath);
    }

    const listing = run('tar', ['-tzf', archivePath], packageRoot);
    if (listing.status !== 0) {
      throw new Error('Unable to inspect packed artefact:\n' + (listing.stderr || listing.stdout));
    }

    const archiveEntries = listing.stdout.split(/\r?\n/).filter(Boolean);
    const packagedFiles = assertRequiredPackagedFiles(archiveEntries);

    const installRoot = path.join(tempRoot, 'clean-install');
    fs.mkdirSync(installRoot);
    const install = run(
      'npm',
      ['install', '--prefix', installRoot, '--no-save', '--ignore-scripts', archivePath],
      packageRoot
    );

    if (install.status !== 0) {
      throw new Error('Clean install from packed artefact failed:\n' + (install.stderr || install.stdout));
    }

    const installedBin = path.join(
      installRoot,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'mole.cmd' : 'mole'
    );
    if (!fs.existsSync(installedBin)) {
      throw new Error('Clean install did not create the installed mole executable from the package bin mapping.');
    }

    const help = run(installedBin, ['--help'], packageRoot, {
      shell: process.platform === 'win32'
    });
    if (help.status !== 0 || !help.stdout.includes('Mole CLI v')) {
      throw new Error('The installed mole executable from the packed artefact did not run successfully:\n' + (help.stderr || help.stdout));
    }

    return {
      archivePath,
      packagedFiles,
      installedBin
    };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const fromHead = process.argv.includes('--from-head');
  const result = verifyPackage(repoRoot, fromHead ? { gitRef: 'HEAD' } : {});
  console.log('Packed artefact verified: ' + result.packagedFiles.size + ' files; clean install and CLI smoke check passed.');
}

const isDirectRun = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
