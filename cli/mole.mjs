#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCaptureFileName, resolveCapturedBy } from '../lib/capture.mjs';
import {
  claimInboxProcessing,
  completeInboxProcessing,
  heartbeatInboxProcessing,
  checkpointInboxProcessing,
  overrideStaleInboxProcessing
} from '../lib/inbox-processing.mjs';
import { auditInbox } from '../lib/inbox-audit.mjs';
import { backfillProcessedInboxMetrics, recordProcessedInboxItems } from '../lib/metrics.mjs';

const args = process.argv.slice(2);
const [command, subcommand, ...rest] = args;
const cwd = process.cwd();
const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '..');
const isDirectRun = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(thisFile);
const PACKAGE_SOURCE = 'github:simplybenuk/product-mole#main';
const HELP_URL = 'https://github.com/simplybenuk/product-mole#readme';
const CRITIQUE_TARGETS = Object.freeze([
  'idea',
  'strategy',
  'roadmap',
  'spec',
  'decision-brief'
]);

const WORKSPACE_SCAFFOLD_DIRS = Object.freeze([
  '0-bootstrap',
  '1-routing',
  '2-summaries',
  '3-indexes',
  '4-context',
  '5-evidence',
  '6-raw'
]);

const WORKSPACE_SCAFFOLD_FILES = Object.freeze([
  ['agents.md', 'agents.md'],
  ['governance/change-log.md', 'governance/change-log.md'],
  ['governance/input-queue.md', 'governance/input-queue.md'],
  ['governance/metrics/daily.json', 'governance/metrics/daily.json'],
  ['governance/metrics/weekly.json', 'governance/metrics/weekly.json'],
  ['governance/metrics/monthly.json', 'governance/metrics/monthly.json'],
  ['governance/metrics/seen-today.json', 'governance/metrics/seen-today.json'],
  ['governance/metrics/dashboard.html', 'governance/metrics/dashboard.html'],
  ['governance/quality-checklist.md', 'governance/quality-checklist.md'],
  ['governance/run-receipts/README.md', 'governance/run-receipts/README.md'],
  ['mole.instance-template.yaml', 'mole.instance.yaml']
]);

export function getHelpOutput() {
  return `Mole CLI v${getSourceVersion()}

Usage:
  mole new <workspace-name>            Create a clean Mole workspace scaffold.
  mole init [target-dir]               Alias for "mole new" for older docs/scripts.
  mole create <artifact> [output-path] Create a draft artifact from a Mole template.
  mole insight [options] <text>        Capture a raw product insight into the inbox.
  mole note [options] <text>           Alias for "mole insight".
  mole signal [options] <text>         Alias for "mole insight".
  mole product-update <audience> <timescale> [--format email|teams|blog|brief]
                                      Print an agent instruction for a stakeholder update.
  mole critique <target> [claim-or-path]
                                      Print a context-grounded critique instruction.
  mole bootstrap-context              Print an agent instruction for first-time top-layer setup.
  mole refresh top-layers             Print an agent instruction for summary/index refresh.
  mole synthesise <target>             Print an agent instruction for synthesis work.
  mole review <target>                 Print an agent instruction for review work.
  mole inbox claim [processor]         Claim a run with a leased, owned lock.
  mole inbox heartbeat --run-id id     Renew the matching active run lease.
  mole inbox checkpoint --run-id id [--processed path]
                                      Save restart-safe partial progress.
  mole inbox audit                    Audit live files, leases, conflicts, and receipts.
  mole inbox complete [options] [summary]
                                      Write an idempotent receipt and release the lock.
  mole inbox override-stale [options] Replace an expired lock with an audited override.
  mole metrics backfill               Rebuild metrics from inbox processing receipts.
  mole install skills                  Install Mole agent skills into ~/.agents/skills.
  mole check-updates                   Compare this CLI version with the workspace.
  mole upgrade                         Update the globally installed Mole CLI.
  mole doctor                          Check workspace metadata and required folders.

Artifacts:
  roadmap, spec, decision-brief, strategy-memo, prioritisation-draft, product-update

Examples:
  mole new my-mole
  mole init my-mole
  mole create roadmap
  mole create spec drafts/spec.md
  mole insight "Users trust CSV export more than dashboard totals"
  mole note "Support team heard onboarding confusion"
  mole signal "Trial users miss the export button"
  mole insight --stakeholder CEO "Asked whether enterprise onboarding is improving"
  mole product-update CEO 2-weeks --format email
  mole critique idea "Improve regulated-customer onboarding"
  mole critique spec drafts/spec.md
  mole bootstrap-context
  mole refresh top-layers
  mole install skills
  mole synthesise inbox
  mole review input-queue
  mole inbox claim "Your Name"
  mole inbox checkpoint --run-id <run-id> --processor "Your Name" --processed 6-raw/inbox/a.md
  mole inbox complete --run-id <run-id> --processor "Your Name" --processed 6-raw/inbox/a.md "Promoted one note"
  mole inbox override-stale --run-id <new-run-id> --processor "Your Name" --reason "Confirmed prior run stopped"
  mole metrics backfill

More help:
  ${HELP_URL}
`;
}

export function getInstallBanner() {
  return String.raw`
          ▄▄▄▄▄▄▄              Product Mole
       ▄███████████▄           Local-first product context
     ▄██▀         ▀██▄         for teams and AI agents
    ██               ██
   ██     ●     ●     ██
   ██                 ██
   ██       ▄█▄       ██
   ██                 ██
   ██   ▄██▄   ▄██▄   ██

Mole is a local-first product context system for teams and AI agents.
It helps you capture raw inputs, distil them into evidence, and generate
better roadmaps, specs, decisions, and prioritisation work from shared context.
`;
}

function printHelp() {
  process.stdout.write(getHelpOutput());
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function copyDirRecursive(from, to, options = {}) {
  const { excludeNames = new Set() } = options;
  ensureDir(to);

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (excludeNames.has(entry.name)) continue;

    const sourcePath = path.join(from, entry.name);
    const targetPath = path.join(to, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath, options);
    } else if (entry.isFile()) {
      copyFile(sourcePath, targetPath);
    }
  }
}

export function createWorkspaceScaffold(target) {
  ensureDir(target);

  for (const dir of WORKSPACE_SCAFFOLD_DIRS) {
    const sourcePath = path.join(repoRoot, dir);
    const targetPath = path.join(target, dir);

    if (exists(sourcePath)) {
      copyDirRecursive(sourcePath, targetPath);
    } else {
      ensureDir(targetPath);
    }
  }

  for (const [source, destination] of WORKSPACE_SCAFFOLD_FILES) {
    copyFile(path.join(repoRoot, source), path.join(target, destination));
  }
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'insight';
}

function nowUtc() {
  return new Date().toISOString();
}

function readTextIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readSimpleYamlField(file, field) {
  const content = readTextIfExists(file);
  if (!content) return null;

  const pattern = new RegExp(`^${field}:\\s*(.+?)\\s*$`, 'm');
  const match = content.match(pattern);
  if (!match) return null;

  return match[1].replace(/^['"]|['"]$/g, '');
}

function getSourceVersion() {
  return readTextIfExists(path.join(repoRoot, 'VERSION'))?.trim() || 'unknown';
}

function getInstanceVersion(instanceRoot = cwd) {
  const instanceFile = path.join(instanceRoot, 'mole.instance.yaml');
  return readSimpleYamlField(instanceFile, 'cascade_version') || readSimpleYamlField(instanceFile, 'mole_version');
}

function compareVersions(a, b) {
  const left = String(a).split('.').map(part => Number.parseInt(part, 10) || 0);
  const right = String(b).split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] || 0) - (right[index] || 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }

  return 0;
}

function getUpgradeOwnership() {
  const content = readTextIfExists(path.join(repoRoot, 'upgrade-ownership.json'));
  if (!content) return null;

  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function getAgentsHome() {
  const envHome = process.env.AGENTS_HOME?.trim();
  return path.resolve(envHome ? envHome : path.join(os.homedir(), '.agents'));
}

function initInstance(targetDir) {
  const target = path.resolve(cwd, targetDir || 'mole-instance');
  createWorkspaceScaffold(target);

  console.log(`Initialised Mole workspace at: ${target}`);
  console.log('Created a clean Mole workspace scaffold.');
  console.log('Next steps:');
  console.log('- customise 0-bootstrap/repo-purpose.md');
  console.log('- fill key summaries in 2-summaries/');
  console.log('- start capturing in 6-raw/inbox/ or with `mole insight "..."`');
  console.log('- open the new workspace folder in your editor');
  console.log('- optionally install agent skills with `mole install skills`');
}

function createArtifact(kind, outputPath) {
  const templateMap = {
    roadmap: 'roadmap-template.md',
    spec: 'spec-template.md',
    'decision-brief': 'decision-brief-template.md',
    'strategy-memo': 'strategy-memo-template.md',
    'prioritisation-draft': 'prioritisation-draft-template.md',
    'product-update': 'product-update-template.md'
  };

  const file = templateMap[kind];
  if (!file) {
    console.error(`Unknown artifact type: ${kind}`);
    process.exit(1);
  }

  const source = path.join(repoRoot, 'templates', 'artifacts', file);
  const defaultOutput = {
    roadmap: '4-context/product/roadmap-draft.md',
    spec: '4-context/product/spec-draft.md',
    'decision-brief': '4-context/decisions/decision-brief-draft.md',
    'strategy-memo': '4-context/strategy/strategy-memo-draft.md',
    'prioritisation-draft': '4-context/product/prioritisation-draft.md',
    'product-update': '4-context/product/product-update-draft.md'
  }[kind];

  const target = path.resolve(cwd, outputPath || defaultOutput);
  if (exists(target)) {
    console.error(`Refusing to overwrite existing file: ${target}`);
    process.exit(1);
  }

  copyFile(source, target);
  console.log(`Created ${kind} draft: ${target}`);
  console.log('\nSuggested next agent instruction:\n');
  outputDraftInstruction(kind);
}

function parseInsightArgs(values) {
  const metadata = {
    audience: [],
    interestAreas: []
  };
  const textParts = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];

    if (value === '--stakeholder' && next) {
      metadata.stakeholder = next;
      index += 1;
    } else if (value === '--requested-by' && next) {
      metadata.requestedBy = next;
      index += 1;
    } else if (value === '--audience' && next) {
      metadata.audience.push(next);
      index += 1;
    } else if (value === '--interest-area' && next) {
      metadata.interestAreas.push(next);
      index += 1;
    } else if (value === '--visibility' && next) {
      metadata.visibility = next;
      index += 1;
    } else if (value === '--follow-up-by' && next) {
      metadata.followUpBy = next;
      index += 1;
    } else {
      textParts.push(value);
    }
  }

  return { text: textParts.join(' ').trim(), metadata };
}

function captureInsight(values) {
  const { text, metadata } = parseInsightArgs(values);
  if (!text) {
    console.error('Missing insight text. Example: mole insight "Users trust CSV export more than dashboard totals"');
    process.exit(1);
  }

  const dir = path.join(cwd, '6-raw', 'inbox');
  ensureDir(dir);
  const fileName = createCaptureFileName(text);
  const target = path.join(dir, fileName);

  const content = buildInsightCaptureContent(text, metadata);

  try {
    fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      console.error(`Refusing to overwrite existing capture: ${target}`);
      process.exit(1);
    }
    throw err;
  }
  console.log(`Captured insight: ${target}`);
  console.log('\nSuggested next command:');
  console.log('mole synthesise inbox');
}

function yamlScalar(value) {
  const text = String(value || '').trim();
  return text ? JSON.stringify(text) : '';
}

function yamlInlineList(values = []) {
  const items = values.map(value => String(value || '').trim()).filter(Boolean);
  return `[${items.map(item => JSON.stringify(item)).join(', ')}]`;
}

export function buildInsightCaptureContent(text, options = {}) {
  const createdAt = options.createdAt || nowUtc();
  const capturedBy = resolveCapturedBy(options.capturedBy);

  return `---
title: Raw Insight
capture_type: insight
source: mole CLI
captured_by: ${capturedBy}
created_at: ${createdAt}
summary: ${text}
stakeholder: ${yamlScalar(options.stakeholder)}
requested_by: ${yamlScalar(options.requestedBy)}
audience: ${yamlInlineList(options.audience)}
interest_areas: ${yamlInlineList(options.interestAreas)}
visibility: ${yamlScalar(options.visibility || 'internal')}
follow_up_by: ${yamlScalar(options.followUpBy)}
tags: []
---

# Raw Insight

## Insight
${text}

## Context / why it matters

## Optional follow-up questions
-
`;
}

export function installMoleSkills(options = {}) {
  const { silent = false } = options;
  const agentsHome = getAgentsHome();
  const skillsDir = path.join(agentsHome, 'skills');
  const sourceDir = path.join(repoRoot, 'cli', 'skills');
  ensureDir(skillsDir);

  const skills = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && exists(path.join(sourceDir, entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();

  for (const skill of skills) {
    copyDirRecursive(path.join(sourceDir, skill), path.join(skillsDir, skill));
  }

  if (!silent) {
    console.log(getInstallBanner());
    console.log(`Installed ${skills.length} Mole agent skills to: ${skillsDir}`);
    console.log('Available skills should now include:');
    for (const skill of skills) {
      console.log(`- ${skill}`);
    }
  }

  return { skillsDir, skills };
}

function outputDraftInstruction(kind) {
  const map = {
    roadmap: 'Create a roadmap draft using 2-summaries/, 3-indexes/, relevant 4-context/ modules, and any needed 5-evidence/ summaries. Update the created markdown draft in place and list missing human inputs.',
    spec: 'Create a product spec draft using relevant summaries, indexes, context modules, and evidence. Update the created markdown draft in place and note assumptions, open questions, and missing human inputs.',
    'strategy-memo': 'Create a strategy memo using the highest-signal relevant context first, descending only as needed.',
    'decision-brief': 'Create a decision brief with recommendation, options, trade-offs, and missing inputs.',
    'prioritisation-draft': 'Create a prioritisation draft with criteria, ranked items, and uncertainties.',
    'product-update': 'Create a stakeholder-specific product update using stakeholder memory, relevant summaries, product context, and evidence. Tailor the format and include a retrieval receipt.'
  };
  const instruction = map[kind] || `Create a ${kind} draft from Mole using progressive retrieval.`;
  console.log(instruction);
}

function parseProductUpdateArgs(values) {
  const positional = [];
  let format = 'brief';

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const next = values[index + 1];

    if (value === '--format' && next) {
      format = next;
      index += 1;
    } else {
      positional.push(value);
    }
  }

  return {
    audience: positional[0] || '',
    timescale: positional[1] || '',
    format
  };
}

export function buildProductUpdateInstruction(audience, timescale, format = 'brief') {
  const targetAudience = String(audience || '').trim() || 'the requested stakeholder or group';
  const updateTimescale = String(timescale || '').trim() || 'the requested timescale';
  const outputFormat = String(format || '').trim() || 'brief';

  return `Suggested agent instruction:

Generate a product update for ${targetAudience} covering ${updateTimescale} in ${outputFormat} format. Use the Mole operating model: retrieve top-down, descend only as needed, and keep claims evidence-backed. Start with stakeholder memory in \`4-context/stakeholders.md\`, then read relevant \`2-summaries/\`, \`3-indexes/\`, product context in \`4-context/\`, evidence in \`5-evidence/\`, and recent raw or synthesised items matching ${updateTimescale}. Tailor the update to the audience's product interests, decision authority, communication preferences, known concerns, and likely asks. Separate headline summary, progress, what changed, risks or blockers, decisions needed, asks, and suggested follow-up. Include a concise retrieval receipt.`;
}

export function buildCritiqueInstruction(target, subject = '') {
  const normalizedTarget = String(target || '').trim().toLowerCase();

  if (!CRITIQUE_TARGETS.includes(normalizedTarget)) {
    throw new Error(
      `Unsupported critique target. Supported critique targets: ${CRITIQUE_TARGETS.join(', ')}.`
    );
  }

  const detail = String(subject || '').trim();
  const targetDescription = detail
    ? `the ${normalizedTarget}: ${detail}`
    : `the requested ${normalizedTarget}`;

  return `Suggested agent instruction:

Critique ${targetDescription} against the current Mole context. If the target names a file, read it before judging it. If it is a claim or proposal, treat the supplied text as the object to test. Start with \`0-bootstrap/\`, \`1-routing/\`, relevant \`2-summaries/\`, and \`3-indexes/\`; descend into \`4-context/\` and \`5-evidence/\` only as needed. Read \`governance/input-queue.md\` when missing human input affects the judgement. Separate facts and source-backed evidence from interpretation. Do not invent support, results, or certainty.

Return:
- Critique target
- What supports it
- What weakens it
- Assumptions
- What is missing, including missing evidence or human inputs
- Judgement and confidence
- Best next step
- Retrieval receipt with files read, deepest layer reached, why descent stopped, and uncertainties

Use \`templates/artifacts/critique-template.md\` when creating or updating a critique file. Keep pending or rejected context out of normal evidence unless the task explicitly asks to inspect it.`;
}

function critique(values) {
  const [target, ...subjectParts] = values;

  try {
    console.log(buildCritiqueInstruction(target, subjectParts.join(' ')));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

export function buildBootstrapContextInstruction() {
  return `Suggested agent instruction:

Bootstrap this Mole workspace context. Treat blank, placeholder, or starter-template files in \`2-summaries/\` and \`3-indexes/\` as missing top-layer context. Read \`0-bootstrap/\`, \`1-routing/\`, all existing \`4-context/\` modules, useful \`5-evidence/\` material, and current unprocessed inbox material in \`6-raw/inbox/\`. Populate the initial domain summaries and indexes with concise, evidence-backed context, preserving uncertainty and adding missing human questions to \`governance/input-queue.md\`. Do not invent product facts; mark low-confidence conclusions as hypotheses and link to supporting files.`;
}

export function buildRefreshTopLayersInstruction() {
  return `Suggested agent instruction:

Refresh the Mole top layers. Compare \`2-summaries/\` and \`3-indexes/\` with lower-layer context in \`4-context/\`, evidence in \`5-evidence/\`, recent processed inbox outputs, and any relevant unprocessed \`6-raw/inbox/\` material. Update blank, placeholder, stale, or incomplete summaries and indexes so they accurately route future retrieval. Keep changes compact and evidence-backed, avoid copying raw detail upward, and add missing human questions to \`governance/input-queue.md\` when the lower layers do not justify a confident summary.`;
}

function productUpdate(values) {
  const { audience, timescale, format } = parseProductUpdateArgs(values);

  if (!audience || !timescale) {
    console.error('Missing product update target. Example: mole product-update CEO 2-weeks --format email');
    process.exit(1);
  }

  console.log(buildProductUpdateInstruction(audience, timescale, format));
}

export function getDoctorOutput(instanceRoot = cwd) {
  const checks = [
    ['mole.instance.yaml', exists(path.join(instanceRoot, 'mole.instance.yaml'))],
    ['0-bootstrap/', exists(path.join(instanceRoot, '0-bootstrap'))],
    ['1-routing/', exists(path.join(instanceRoot, '1-routing'))],
    ['2-summaries/', exists(path.join(instanceRoot, '2-summaries'))],
    ['3-indexes/', exists(path.join(instanceRoot, '3-indexes'))],
    ['4-context/', exists(path.join(instanceRoot, '4-context'))],
    ['5-evidence/', exists(path.join(instanceRoot, '5-evidence'))],
    ['6-raw/inbox/', exists(path.join(instanceRoot, '6-raw', 'inbox'))]
  ];

  const instanceVersion = getInstanceVersion(instanceRoot);
  const lines = [
    'Mole doctor',
    '',
    `source version   ${getSourceVersion()}`,
    `instance version ${instanceVersion || 'not found'}`
  ];

  if (!instanceVersion) {
    lines.push('warning          missing instance metadata');
  }

  lines.push('');

  for (const [label, ok] of checks) {
    lines.push(`${ok ? '✓' : '✗'} ${label}`);
  }

  return `${lines.join('\n')}\n`;
}

function doctor() {
  process.stdout.write(getDoctorOutput());
}

export function getCheckUpdatesOutput(instanceRoot = cwd) {
  const sourceVersion = getSourceVersion();
  const instanceVersion = getInstanceVersion(instanceRoot);
  const ownership = getUpgradeOwnership();
  const comparison = instanceVersion ? compareVersions(sourceVersion, instanceVersion) : 1;
  const status = comparison > 0 ? 'update available' : comparison === 0 ? 'up to date' : 'instance ahead of source';
  const safeCopy = ownership?.classes?.['safe-copy']?.paths || [];
  const mergeCarefully = ownership?.classes?.['merge-carefully']?.paths || [];

  const lines = [
    'Mole update check',
    '',
    'read-only report',
    `source version   ${sourceVersion}`,
    `instance version ${instanceVersion || 'not found'}`,
    `status          ${status}`,
    '',
    'Safe additions'
  ];

  if (safeCopy.length) {
    for (const item of safeCopy) lines.push(`- ${item}`);
  } else {
    lines.push('- No safe-copy paths declared.');
  }

  lines.push('', 'Manual review');

  if (mergeCarefully.length) {
    for (const item of mergeCarefully) lines.push(`- ${item}`);
  } else {
    lines.push('- No merge-carefully paths declared.');
  }

  return `${lines.join('\n')}\n`;
}

function checkUpdates() {
  process.stdout.write(getCheckUpdatesOutput());
}

export function getUpgradeCommand() {
  return ['npm', 'install', '-g', PACKAGE_SOURCE];
}

function upgradeTool() {
  const command = getUpgradeCommand();
  console.log(`Updating Mole from ${PACKAGE_SOURCE}...`);

  const result = spawnSync(command[0], command.slice(1), {
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`Failed to run ${command.join(' ')}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`Mole upgrade failed. Run manually: ${command.join(' ')}`);
    process.exit(result.status || 1);
  }

  console.log('Mole upgrade complete. Run `mole --help` to confirm the installed version.');
}

function runInboxCommand(action, values = []) {
  if (action === 'audit') {
    const result = auditInbox(cwd);
    console.log('Mole inbox audit');
    console.log('workspace root  ' + result.workspaceRoot);
    console.log('live files      ' + result.candidates.length);
    console.log('processed files ' + result.processed.length);
    console.log('unprocessed     ' + result.unprocessed.length);
    for (const item of result.unprocessed) console.log('- ' + item);
    console.log('sync conflicts  ' + result.syncConflictFiles.length);
    for (const item of result.syncConflictFiles) console.log('- conflict: ' + item);
    console.log('duplicate receipts ' + result.duplicateReceipts.length);
    for (const item of result.duplicateReceipts) {
      console.log('- duplicate run ' + item.run_id + ': ' + item.paths.join(', '));
    }
    console.log('processed path conflicts ' + result.processedPathConflicts.length);
    for (const item of result.processedPathConflicts) {
      console.log('- split-brain path ' + item.path + ': '
        + item.runs.map((run) => run.run_id).join(', '));
    }
    console.log('override records ' + result.overrides.length);
    for (const item of result.overrides) {
      console.log('- ' + item.path + ': ' + (item.override.type || 'override')
        + ' by ' + (item.override.actor || 'unknown'));
    }
    console.log('invalid overrides ' + result.invalidOverrides.length);
    for (const item of result.invalidOverrides) {
      console.log('- invalid override ' + item.path + ': ' + item.error);
    }
    if (result.staleLock) {
      console.log('stale lease     ' + (result.staleLock.run_id || result.staleLock.lock_id || 'unknown'));
    }
    for (const issue of result.issues) {
      console.log('- ' + issue.code + ': ' + issue.message);
    }
    if (result.unprocessed.length || result.issues.length) process.exitCode = 1;
    return;
  }

  if (action === 'claim') {
    let parsed;
    try {
      parsed = parseInboxClaimValues(values);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    const result = parsed.overrideStale
      ? overrideStaleInboxProcessing(cwd, {
        runId: parsed.runId,
        processor: parsed.processor || undefined,
        host: parsed.host || undefined,
        leaseMs: parsed.leaseMs,
        claimedPaths: parsed.claimedPaths,
        reason: parsed.reason,
        allowConflictCopies: parsed.allowConflictCopies
      })
      : claimInboxProcessing(cwd, {
        runId: parsed.runId,
        processor: parsed.processor || undefined,
        host: parsed.host || undefined,
        leaseMs: parsed.leaseMs,
        claimedPaths: parsed.claimedPaths,
        allowConflictCopies: parsed.allowConflictCopies
      });
    const output = result.ok ? console.log : console.error;
    output(result.message);
    if (!result.ok) process.exit(1);
    if (result.run_id) console.log('run_id          ' + result.run_id);
    if (result.overridePath) console.log('override record ' + result.overridePath);
    if (result.lock?.processed_paths?.length) {
      console.log('already checkpointed ' + result.lock.processed_paths.join(', '));
    }
    return;
  }

  if (action === 'heartbeat') {
    let parsed;
    try {
      parsed = parseInboxClaimValues(values);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    const result = heartbeatInboxProcessing(cwd, {
      runId: parsed.runId,
      processor: parsed.processor || undefined,
      host: parsed.host || undefined,
      leaseMs: parsed.leaseMs,
      allowConflictCopies: parsed.allowConflictCopies
    });
    const output = result.ok ? console.log : console.error;
    output(result.message);
    if (!result.ok) process.exit(1);
    return;
  }

  if (action === 'checkpoint') {
    let parsed;
    try {
      parsed = parseInboxCompleteValues(values);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    const result = checkpointInboxProcessing(cwd, {
      runId: parsed.runId,
      processor: parsed.processor || undefined,
      host: parsed.host || undefined,
      leaseMs: parsed.leaseMs,
      processed: parsed.processed,
      allowConflictCopies: parsed.allowConflictCopies
    });
    const output = result.ok ? console.log : console.error;
    output(result.message);
    if (!result.ok) process.exit(1);
    return;
  }

  if (action === 'override-stale' || action === 'recover') {
    let parsed;
    try {
      parsed = parseInboxClaimValues(values);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    const result = overrideStaleInboxProcessing(cwd, {
      runId: parsed.runId,
      processor: parsed.processor || undefined,
      host: parsed.host || undefined,
      leaseMs: parsed.leaseMs,
      claimedPaths: parsed.claimedPaths,
      reason: parsed.reason,
      allowConflictCopies: parsed.allowConflictCopies
    });
    const output = result.ok ? console.log : console.error;
    output(result.message);
    if (!result.ok) process.exit(1);
    if (result.run_id) console.log('run_id          ' + result.run_id);
    if (result.overridePath) console.log('override record ' + result.overridePath);
    return;
  }

  if (action === 'complete') {
    let parsed;
    try {
      parsed = parseInboxCompleteValues(values);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    const result = parsed.partial
      ? checkpointInboxProcessing(cwd, {
        runId: parsed.runId,
        processor: parsed.processor || undefined,
        host: parsed.host || undefined,
        leaseMs: parsed.leaseMs,
        processed: parsed.processed,
        allowConflictCopies: parsed.allowConflictCopies
      })
      : completeInboxProcessing(cwd, {
        runId: parsed.runId,
        processor: parsed.processor || undefined,
        host: parsed.host || undefined,
        processed: parsed.processed,
        summary: parsed.summary || undefined,
        overrideMissingLock: parsed.overrideMissingLock,
        reason: parsed.reason,
        allowConflictCopies: parsed.allowConflictCopies
      });
    const output = result.ok ? console.log : console.error;
    output(result.message);
    if (!result.ok) process.exit(1);
    if (result.run_id) console.log('run_id          ' + result.run_id);

    if (result.receipt) {
      try {
        if (result.idempotent) {
          backfillProcessedInboxMetrics(cwd);
        } else {
          const completedAt = result.receipt.completed_at
            ? new Date(result.receipt.completed_at)
            : null;
          const metricsOptions = completedAt && !Number.isNaN(completedAt.getTime())
            ? { now: completedAt }
            : {};
          recordProcessedInboxItems(cwd, result.receipt.processed, metricsOptions);
        }
      } catch (err) {
        const action = result.idempotent ? 'reconciliation' : 'update';
        console.warn('Warning: inbox metrics ' + action + ' failed: ' + err.message);
      }
    }
    return;
  }

  console.error('Supported inbox commands: claim, heartbeat, checkpoint, audit, complete, override-stale');
  process.exit(1);
}

function runMetricsCommand(action) {
  if (action === 'backfill') {
    const result = backfillProcessedInboxMetrics(cwd);
    console.log('Mole metrics backfill complete.');
    console.log(`Receipts scanned: ${result.receipts_scanned}`);
    console.log(`Receipts counted: ${result.receipts_counted}`);
    console.log(`Receipts skipped: ${result.receipts_skipped}`);
    console.log(`Processed paths counted: ${result.processed_paths_counted}`);
    return;
  }

  console.error('Supported metrics commands: backfill');
  process.exit(1);
}

function readInboxOption(values, index, option) {
  const value = values[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('Missing value for ' + option + '.');
  }
  return value;
}

export function parseInboxClaimValues(values = []) {
  const processorParts = [];
  const claimedPaths = [];
  const result = {
    processor: '',
    runId: '',
    host: '',
    leaseMs: undefined,
    claimedPaths,
    reason: '',
    overrideStale: false,
    allowConflictCopies: false
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--run-id') {
      result.runId = readInboxOption(values, index, '--run-id');
      index += 1;
    } else if (value === '--processor' || value === '--claimed-by' || value === '--actor') {
      result.processor = readInboxOption(values, index, value);
      index += 1;
    } else if (value === '--host') {
      result.host = readInboxOption(values, index, '--host');
      index += 1;
    } else if (value === '--lease-ms') {
      result.leaseMs = Number(readInboxOption(values, index, '--lease-ms'));
      if (!Number.isFinite(result.leaseMs) || result.leaseMs <= 0) {
        throw new Error('--lease-ms must be a positive number.');
      }
      index += 1;
    } else if (value === '--claimed-path' || value === '--path') {
      claimedPaths.push(readInboxOption(values, index, value));
      index += 1;
    } else if (value === '--reason') {
      result.reason = readInboxOption(values, index, '--reason');
      index += 1;
    } else if (value === '--override-stale') {
      result.overrideStale = true;
    } else if (value === '--allow-conflict-copies') {
      result.allowConflictCopies = true;
    } else {
      processorParts.push(value);
    }
  }

  if (!result.processor) result.processor = processorParts.join(' ').trim();
  return result;
}

export function parseInboxCompleteValues(values = []) {
  const processed = [];
  const claimedPaths = [];
  const summaryParts = [];
  const result = {
    processed,
    claimedPaths,
    summary: '',
    runId: '',
    processor: '',
    host: '',
    leaseMs: undefined,
    partial: false,
    overrideMissingLock: false,
    reason: '',
    allowConflictCopies: false
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === '--processed') {
      processed.push(readInboxOption(values, index, '--processed'));
      index += 1;
    } else if (value === '--run-id') {
      result.runId = readInboxOption(values, index, '--run-id');
      index += 1;
    } else if (value === '--processor' || value === '--claimed-by' || value === '--actor') {
      result.processor = readInboxOption(values, index, value);
      index += 1;
    } else if (value === '--host') {
      result.host = readInboxOption(values, index, '--host');
      index += 1;
    } else if (value === '--lease-ms') {
      result.leaseMs = Number(readInboxOption(values, index, '--lease-ms'));
      if (!Number.isFinite(result.leaseMs) || result.leaseMs <= 0) {
        throw new Error('--lease-ms must be a positive number.');
      }
      index += 1;
    } else if (value === '--partial') {
      result.partial = true;
    } else if (value === '--override-missing-lock') {
      result.overrideMissingLock = true;
    } else if (value === '--reason') {
      result.reason = readInboxOption(values, index, '--reason');
      index += 1;
    } else if (value === '--allow-conflict-copies') {
      result.allowConflictCopies = true;
    } else {
      summaryParts.push(value);
    }
  }

  result.summary = summaryParts.join(' ').trim();
  return result;
}

if (isDirectRun) {
  switch (command) {
    case undefined:
    case '--help':
    case '-h':
      printHelp();
      break;
    case 'new':
    case 'init':
      initInstance(subcommand);
      break;
    case 'create':
      if (!subcommand) {
        console.error('Missing artifact type. Example: mole create roadmap');
        process.exit(1);
      }
      createArtifact(subcommand, rest[0]);
      break;
    case 'insight':
    case 'note':
    case 'signal':
      captureInsight([subcommand, ...rest].filter(Boolean));
      break;
    case 'product-update':
      productUpdate([subcommand, ...rest].filter(Boolean));
      break;
    case 'critique':
      critique([subcommand, ...rest].filter(Boolean));
      break;
    case 'bootstrap-context':
      console.log(buildBootstrapContextInstruction());
      break;
    case 'refresh':
      if (subcommand !== 'top-layers') {
        console.error('Supported refresh targets: top-layers');
        process.exit(1);
      }
      console.log(buildRefreshTopLayersInstruction());
      break;
    case 'synthesise': {
      const target = subcommand || 'the requested target';
      if (subcommand === 'inbox') console.log('Shared-folder runs must claim a run ID first, checkpoint promoted paths, and complete only with the active owned claim. Use an explicit stale-lock or missing-lock override with a reason only after checking sync history.');
      const personaInstruction = subcommand === 'inbox' ? ' Treat `6-raw/inbox/` as the flat capture/drop zone; legacy subfolders such as `quick-notes/`, `messages/`, `observations/`, or `new/` are still valid unprocessed input in existing workspaces. If user/customer signals are relevant to a durable user type, update or create evidence-backed personas in `4-context/personas.md`. If internal stakeholder signals, org-chart facts, leadership asks, or update preferences are relevant, update or create evidence-backed stakeholder memory in `4-context/stakeholders.md`. If relevant `2-summaries/` or `3-indexes/` files are blank, placeholder-only, or still contain starter-template content, treat that as a material top-layer gap and populate them from the synthesised durable context. Keep the returned run ID, checkpoint paths as they are safely promoted, and complete with `mole inbox complete --run-id <run-id> --processor "Your Name" --processed <path> ... "summary"`; normal completion requires the active owned claim.' : '';
      console.log(`Suggested agent instruction:\n\nBefore synthesis, validate the workspace root with \`mole doctor\` and run \`mole inbox audit\`. Treat every recursively discovered non-README file outside \`6-raw/inbox/archive/\` as a candidate. Reconcile the audit's candidate list against the paths you actually process, explicitly report skipped paths, and rerun \`mole inbox audit\` before finishing; do not declare a no-op while unexplained unprocessed files remain. Then synthesise ${target} using the Mole operating model: capture low, distil up, retrieve top-down.${personaInstruction}`);
      break;
    }
    case 'review':
      console.log(`Suggested agent instruction:\n\nReview ${subcommand || 'the requested target'} and return the highest-value next actions or missing human inputs.`);
      break;
    case 'inbox':
      runInboxCommand(subcommand, rest);
      break;
    case 'metrics':
      runMetricsCommand(subcommand);
      break;
    case 'install':
      if (subcommand === 'skills') {
        installMoleSkills();
      } else if (subcommand === 'codex') {
        console.warn('`mole install codex` is deprecated. Installing agent skills instead. Use `mole install skills` next time.');
        installMoleSkills();
      } else {
        console.error('Supported install targets: skills');
        process.exit(1);
      }
      break;
    case 'check-updates':
      checkUpdates();
      break;
    case 'upgrade':
      upgradeTool();
      break;
    case 'doctor':
      doctor();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}
