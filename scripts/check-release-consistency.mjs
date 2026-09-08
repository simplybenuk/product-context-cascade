#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const COPYRIGHT_PLACEHOLDER_PATTERN = /(?:\[[^\]]*copyright holder|<[^>]*copyright holder|copyright holder to be confirmed|TODO)/i;

function readText(root, relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    return null;
  }
}

function readJson(root, relativePath) {
  const content = readText(root, relativePath);
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function firstMatch(text, pattern) {
  return text?.match(pattern)?.[1] || null;
}

export function getReleaseMetadata(root = repoRoot) {
  const packageJson = readJson(root, 'package.json') || {};
  const cliPackageJson = readJson(root, 'cli/package.json') || {};
  const changelogText = readText(root, 'CHANGELOG.md') || '';
  const readmeText = readText(root, 'README.md') || '';
  const licenseText = readText(root, 'LICENSE') || '';
  const changelogVersions = [...changelogText.matchAll(/^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]/gm)]
    .map((match) => match[1]);

  return {
    root,
    version: readText(root, 'VERSION')?.trim() || '',
    packageVersion: packageJson.version || '',
    cliPackageVersion: cliPackageJson.version || '',
    packageLicense: packageJson.license || '',
    cliPackageLicense: cliPackageJson.license || '',
    packageFiles: Array.isArray(packageJson.files) ? packageJson.files : [],
    readmeVersion: firstMatch(readmeText, /^Current version:\s+[^0-9]*([0-9]+\.[0-9]+\.[0-9]+)/m),
    latestChangelogVersion: changelogVersions[0] || null,
    readmeText,
    licenseText
  };
}

export function getReleaseConsistencyErrors(metadata, options = {}) {
  const errors = [];
  const versionFields = [
    ['VERSION', metadata.version],
    ['package.json', metadata.packageVersion],
    ['cli/package.json', metadata.cliPackageVersion],
    ['README.md', metadata.readmeVersion],
    ['CHANGELOG.md', metadata.latestChangelogVersion]
  ];

  if (!RELEASE_VERSION_PATTERN.test(metadata.version)) {
    errors.push('VERSION must contain a release SemVer value such as 0.2.8.');
  }

  for (const [source, value] of versionFields.slice(1)) {
    if (value !== metadata.version) {
      errors.push(source + ' does not match VERSION (' + metadata.version + ').');
    }
  }

  if (metadata.packageLicense !== 'MIT') {
    errors.push('package.json must declare license MIT.');
  }

  if (metadata.cliPackageLicense !== 'MIT') {
    errors.push('cli/package.json must declare license MIT.');
  }

  if (!metadata.packageFiles.includes('LICENSE')) {
    errors.push('package.json files must include LICENSE.');
  }

  if (!metadata.licenseText.includes('MIT License')) {
    errors.push('LICENSE must start with the MIT License text.');
  }

  if (!metadata.licenseText.includes('Permission is hereby granted')) {
    errors.push('LICENSE is missing the MIT permission grant.');
  }

  if (!metadata.licenseText.includes('THE SOFTWARE IS PROVIDED')) {
    errors.push('LICENSE is missing the MIT warranty disclaimer.');
  }

  const taggedInstall = 'github:simplybenuk/product-mole#v' + metadata.version;
  if (!metadata.readmeText.includes(taggedInstall)) {
    errors.push('README.md must show installation from the current release tag (' + taggedInstall + ').');
  }

  if (options.release) {
    const copyrightLine = metadata.licenseText
      .split('\n')
      .find((line) => /^Copyright \(c\) \d{4} .+$/i.test(line));

    if (!copyrightLine || COPYRIGHT_PLACEHOLDER_PATTERN.test(copyrightLine)) {
      errors.push('LICENSE needs a maintainer-confirmed copyright holder before release.');
    }
  }

  if (options.requireTag) {
    const result = spawnSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: metadata.root,
      encoding: 'utf8'
    });

    if (result.status !== 0 || !result.stdout.split(/\s+/).includes('v' + metadata.version)) {
      errors.push('HEAD must have the matching Git tag v' + metadata.version + ' before publication.');
    }
  }

  return errors;
}

export function checkReleaseConsistency(root = repoRoot, options = {}) {
  const metadata = getReleaseMetadata(root);
  const errors = getReleaseConsistencyErrors(metadata, options);

  if (errors.length) {
    throw new Error(['Release consistency check failed:', ...errors.map((error) => '- ' + error)].join('\n'));
  }

  return metadata;
}

function main() {
  const flags = new Set(process.argv.slice(2));
  const metadata = checkReleaseConsistency(repoRoot, {
    release: flags.has('--release'),
    requireTag: flags.has('--require-tag')
  });

  console.log('Release consistency checks passed for v' + metadata.version + '.');

  if (!flags.has('--release') && COPYRIGHT_PLACEHOLDER_PATTERN.test(metadata.licenseText)) {
    console.warn('Warning: the release check remains blocked until LICENSE has a confirmed copyright holder.');
  }
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
