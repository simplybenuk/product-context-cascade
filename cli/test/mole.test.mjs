import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createCaptureFileName, resolveCapturedBy } from '../../lib/capture.mjs';
import {
  claimInboxProcessing,
  completeInboxProcessing,
  heartbeatInboxProcessing,
  checkpointInboxProcessing,
  inspectInboxProcessing,
  overrideStaleInboxProcessing
} from '../../lib/inbox-processing.mjs';
import { auditInbox, discoverInboxFiles, discoverInboxConflictFiles } from '../../lib/inbox-audit.mjs';
import { backfillProcessedInboxMetrics, getMetricsPaths, recordProcessedInboxItems } from '../../lib/metrics.mjs';
import {
  buildInsightCaptureContent,
  buildCritiqueInstruction,
  buildProductUpdateInstruction,
  createWorkspaceScaffold,
  getCheckUpdatesOutput,
  getDoctorOutput,
  getHelpOutput,
  getInstallBanner,
  getUpgradeCommand,
  installMoleSkills,
  parseInboxCompleteValues
} from '../mole.mjs';
import { buildUiCaptureContent, createCaptureRelPath } from '../../ui/server.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '..', '..');
const moleCliPath = path.join(repoRoot, 'cli', 'mole.mjs');

function withTempInstance(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mole-test-'));
  try {
    return callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runCli(args, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mole-cli-test-'));
  const stdoutPath = path.join(dir, 'stdout.txt');
  const stderrPath = path.join(dir, 'stderr.txt');
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');

  try {
    const result = spawnSync(process.execPath, [moleCliPath, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', stdoutFd, stderrFd]
    });

    return {
      ...result,
      stdout: fs.readFileSync(stdoutPath, 'utf8'),
      stderr: fs.readFileSync(stderrPath, 'utf8')
    };
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('doctor', () => {
  it('reports source and instance versions when mole.instance.yaml exists', () => {
    withTempInstance((dir) => {
      fs.writeFileSync(
        path.join(dir, 'mole.instance.yaml'),
        'instance_name: test-instance\ncascade_version: 0.1.0\n',
        'utf8'
      );

      const output = getDoctorOutput(dir);

      assert.match(output, /Mole doctor/);
      assert.match(output, /source version\s+0\.2\.8/);
      assert.match(output, /instance version\s+0\.1\.0/);
      assert.doesNotMatch(output, /missing instance metadata/i);
    });
  });

  it('warns when mole.instance.yaml is missing', () => {
    withTempInstance((dir) => {
      const output = getDoctorOutput(dir);

      assert.match(output, /source version\s+0\.2\.8/);
      assert.match(output, /instance version\s+not found/);
      assert.match(output, /missing instance metadata/i);
    });
  });
});

describe('help', () => {
  it('uses consistent Mole naming and documented command examples', () => {
    const output = getHelpOutput();

    assert.match(output, /^Mole CLI v0\.2\.8/m);
    assert.match(output, /mole new my-mole/);
    assert.match(output, /mole init my-mole/);
    assert.match(output, /mole create roadmap/);
    assert.match(output, /mole create spec drafts\/spec\.md/);
    assert.match(output, /mole insight "Users trust CSV export more than dashboard totals"/);
    assert.match(output, /mole note "Support team heard onboarding confusion"/);
    assert.match(output, /mole signal "Trial users miss the export button"/);
    assert.match(output, /mole product-update CEO 2-weeks --format email/);
    assert.match(output, /mole critique idea/);
    assert.match(output, /mole bootstrap-context/);
    assert.match(output, /mole refresh top-layers/);
    assert.match(output, /mole synthesise inbox/);
    assert.match(output, /mole review input-queue/);
    assert.match(output, /mole inbox claim/);
    assert.match(output, /mole inbox heartbeat/);
    assert.match(output, /mole inbox checkpoint/);
    assert.match(output, /mole inbox audit/);
    assert.match(output, /mole inbox complete --run-id/);
    assert.match(output, /mole inbox override-stale/);
    assert.match(output, /mole metrics backfill/);
    assert.match(output, /mole install skills\s+Install Mole agent skills into ~\/\.agents\/skills/);
    assert.match(output, /More help:\n  https:\/\/github\.com\/simplybenuk\/product-mole#readme/);
    assert.match(output, /mole check-updates/);
    assert.match(output, /mole upgrade/);
    assert.match(output, /mole doctor/);
    assert.doesNotMatch(output, /Cascade/);
    assert.doesNotMatch(output, /mole install codex/);
  });
});

describe('synthesise guidance', () => {
  it('requires root validation and a final recursive inbox audit', () => {
    const result = runCli(['synthesise', 'inbox']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /mole doctor/);
    assert.match(result.stdout, /mole inbox audit/);
    assert.match(result.stdout, /unexplained unprocessed files remain/);
  });

  it('points inbox synthesis at living personas', () => {
    const result = runCli(['synthesise', 'inbox']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /4-context\/personas\.md/);
    assert.match(result.stdout, /update or create evidence-backed personas/);
    assert.match(result.stdout, /4-context\/stakeholders\.md/);
    assert.match(result.stdout, /stakeholder memory/);
    assert.match(result.stdout, /blank, placeholder-only/);
    assert.match(result.stdout, /material top-layer gap/);
    assert.match(result.stdout, /flat capture\/drop zone/);
    assert.match(result.stdout, /complete with `mole inbox complete --run-id <run-id>/);
    assert.match(result.stdout, /mole inbox complete --run-id <run-id>/);
    assert.match(result.stdout, /active owned claim/);
  });

  it('prints first-time bootstrap guidance for blank top layers', () => {
    const result = runCli(['bootstrap-context']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Bootstrap this Mole workspace context/);
    assert.match(result.stdout, /starter-template files in `2-summaries\/` and `3-indexes\/`/);
    assert.match(result.stdout, /governance\/input-queue\.md/);
  });

  it('prints top-layer refresh guidance', () => {
    const result = runCli(['refresh', 'top-layers']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Refresh the Mole top layers/);
    assert.match(result.stdout, /blank, placeholder, stale, or incomplete summaries and indexes/);
    assert.match(result.stdout, /future retrieval/);
  });
});

describe('critique guidance', () => {
  it('builds a context-grounded instruction for a supported target', () => {
    const output = buildCritiqueInstruction('idea', 'Improve regulated-customer onboarding');

    assert.match(output, /Critique the idea: Improve regulated-customer onboarding/);
    assert.match(output, /0-bootstrap\//);
    assert.match(output, /1-routing\//);
    assert.match(output, /2-summaries\//);
    assert.match(output, /3-indexes\//);
    assert.match(output, /4-context\//);
    assert.match(output, /5-evidence\//);
    assert.match(output, /What supports it/);
    assert.match(output, /What weakens it/);
    assert.match(output, /Retrieval receipt/);
  });

  it('prints critique instructions from the CLI command', () => {
    const result = runCli(['critique', 'spec', 'drafts/spec.md']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Critique the spec: drafts\/spec\.md/);
    assert.match(result.stdout, /missing evidence or human inputs/);
  });

  it('accepts every documented critique target', () => {
    for (const target of ['idea', 'strategy', 'roadmap', 'spec', 'decision-brief']) {
      assert.doesNotThrow(() => buildCritiqueInstruction(target));
    }
  });

  it('rejects an unsupported critique target', () => {
    const result = runCli(['critique', 'release']);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Supported critique targets/);
  });
});


describe('product updates', () => {
  it('builds stakeholder-specific product update instructions', () => {
    const output = buildProductUpdateInstruction('CEO', '2-weeks', 'email');

    assert.match(output, /Generate a product update for CEO covering 2-weeks in email format/);
    assert.match(output, /4-context\/stakeholders\.md/);
    assert.match(output, /decision authority/);
    assert.match(output, /retrieval receipt/);
  });

  it('prints product update instructions from the CLI command', () => {
    const result = runCli(['product-update', 'CEO', '2-weeks', '--format', 'email']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /CEO/);
    assert.match(result.stdout, /2-weeks/);
    assert.match(result.stdout, /email format/);
    assert.match(result.stdout, /4-context\/stakeholders\.md/);
  });
});

describe('workspace scaffold', () => {
  it('creates a clean Mole workspace without source-repo files', () => {
    withTempInstance((dir) => {
      createWorkspaceScaffold(dir);

      for (const relPath of [
        '0-bootstrap',
        '1-routing',
        '2-summaries',
        '3-indexes',
        '4-context',
        path.join('4-context', 'personas.md'),
        path.join('4-context', 'stakeholders.md'),
        '5-evidence',
        '6-raw',
        path.join('governance', 'metrics', 'daily.json'),
        path.join('governance', 'metrics', 'weekly.json'),
        path.join('governance', 'metrics', 'monthly.json'),
        path.join('governance', 'metrics', 'seen-today.json'),
        path.join('governance', 'metrics', 'dashboard.html'),
        'mole.instance.yaml'
      ]) {
        assert.ok(fs.existsSync(path.join(dir, relPath)), `${relPath} should exist`);
      }

      for (const relPath of [
        'cli',
        'lib',
        'docs',
        '.agents',
        '.github',
        'node_modules',
        'package.json',
        'package-lock.json',
        'plans',
        'spec',
        'ui',
        'upgrade-ownership.json',
        'mole.instance-template.yaml',
        'governance/contribution-guide.md'
      ]) {
        assert.equal(fs.existsSync(path.join(dir, relPath)), false, `${relPath} should not exist`);
      }

      const personas = fs.readFileSync(path.join(dir, '4-context', 'personas.md'), 'utf8');
      assert.match(personas, /living set of living user personas|living user personas/i);
      assert.match(personas, /Inbox synthesis rules/);

      const stakeholders = fs.readFileSync(path.join(dir, '4-context', 'stakeholders.md'), 'utf8');
      assert.match(stakeholders, /Living stakeholder map/i);
      assert.match(stakeholders, /Inbox synthesis rules/);

      const metadata = fs.readFileSync(path.join(dir, 'mole.instance.yaml'), 'utf8');
      assert.doesNotMatch(metadata, /docs\//);
      assert.doesNotMatch(metadata, /templates\//);
      assert.doesNotMatch(metadata, /cli\//);
    });
  });
});

describe('install banner', () => {
  it('introduces Mole with an ASCII mascot and concise product description', () => {
    const output = getInstallBanner();

    assert.match(output, /Mole is a local-first product context system/);
    assert.match(output, /Product Mole/);
    assert.match(output, /●\s+●/);
    assert.match(output, /better roadmaps, specs, decisions/);
  });
});

describe('skills installer', () => {
  it('installs packaged Mole skills into the configured agents home', () => {
    withTempInstance((dir) => {
      const previousAgentsHome = process.env.AGENTS_HOME;
      process.env.AGENTS_HOME = path.join(dir, '.agents');

      try {
        installMoleSkills({ silent: true });
      } finally {
        if (previousAgentsHome === undefined) {
          delete process.env.AGENTS_HOME;
        } else {
          process.env.AGENTS_HOME = previousAgentsHome;
        }
      }

      for (const skill of [
        'mole-create-roadmap',
        'mole-create-spec',
        'mole-critique',
        'mole-insight',
        'mole-product-update',
        'mole-bootstrap-context',
        'mole-refresh-top-layers',
        'mole-review-input-queue',
        'mole-synthesise-inbox'
      ]) {
        assert.ok(
          fs.existsSync(path.join(dir, '.agents', 'skills', skill, 'SKILL.md')),
          `${skill} should be installed as a skill`
        );
      }
    });
  });
});

describe('upgrade command', () => {
  it('updates the installed Mole CLI from the GitHub main branch', () => {
    assert.deepEqual(getUpgradeCommand(), [
      'npm',
      'install',
      '-g',
      'github:simplybenuk/product-mole#main'
    ]);
  });
});

describe('upgrade ownership manifest', () => {
  it('defines parseable ownership classes for upgrade planning', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'upgrade-ownership.json'), 'utf8')
    );

    assert.equal(manifest.version, 1);
    assert.ok(manifest.classes['safe-copy']);
    assert.ok(manifest.classes['merge-carefully']);
    assert.ok(manifest.classes['never-overwrite']);
    assert.ok(manifest.classes['never-overwrite'].paths.includes('4-context/'));
    assert.ok(manifest.classes['never-overwrite'].paths.includes('5-evidence/'));
    assert.ok(manifest.classes['never-overwrite'].paths.includes('6-raw/'));
  });
});

describe('check-updates', () => {
  it('reports when an instance is up to date', () => {
    withTempInstance((dir) => {
      fs.writeFileSync(
        path.join(dir, 'mole.instance.yaml'),
        'instance_name: test-instance\ncascade_version: 0.2.8\n',
        'utf8'
      );

      const output = getCheckUpdatesOutput(dir);

      assert.match(output, /Mole update check/);
      assert.match(output, /source version\s+0\.2\.8/);
      assert.match(output, /instance version\s+0\.2\.8/);
      assert.match(output, /status\s+up to date/);
      assert.match(output, /read-only report/i);
    });
  });

  it('reports when the source is newer than the instance', () => {
    withTempInstance((dir) => {
      fs.writeFileSync(
        path.join(dir, 'mole.instance.yaml'),
        'instance_name: test-instance\ncascade_version: 0.1.0\n',
        'utf8'
      );

      const output = getCheckUpdatesOutput(dir);

      assert.match(output, /status\s+update available/);
      assert.match(output, /Safe additions/);
      assert.match(output, /Manual review/);
      assert.match(output, /0-bootstrap\//);
      assert.match(output, /README\.md/);
    });
  });
});

describe('team-safe capture filenames', () => {
  it('creates repeated similar note filenames with UTC timestamp and unique suffixes', () => {
    const now = new Date('2026-05-13T10:11:12.345Z');
    const first = createCaptureFileName('Repeated note', {
      now,
      uniqueSuffix: 'abc12345'
    });
    const second = createCaptureFileName('Repeated note', {
      now,
      uniqueSuffix: 'def67890'
    });

    assert.equal(first, '20260513T101112345Z-repeated-note-abc12345.md');
    assert.equal(second, '20260513T101112345Z-repeated-note-def67890.md');
    assert.notEqual(first, second);
  });

  it('uses the collision-resistant filename helper for UI capture paths', () => {
    const relPath = createCaptureRelPath('quick-notes', 'Repeated note', {
      now: new Date('2026-05-13T10:11:12.345Z'),
      uniqueSuffix: 'abc12345'
    });

    assert.equal(
      relPath,
      path.join('6-raw', 'inbox', '20260513T101112345Z-repeated-note-abc12345.md')
    );
  });
});

describe('capture attribution metadata', () => {
  it('resolves captured_by from explicit value or local environment defaults', () => {
    assert.equal(resolveCapturedBy('Ada'), 'Ada');
    assert.equal(resolveCapturedBy('', { MOLE_CAPTURED_BY: 'Grace' }), 'Grace');
    assert.equal(resolveCapturedBy('', { USER: 'hopper' }), 'hopper');
    assert.equal(resolveCapturedBy('', {}, 'unknown'), 'unknown');
  });

  it('emits captured_by in CLI capture frontmatter', () => {
    const content = buildInsightCaptureContent('Team note', {
      capturedBy: 'Ada',
      createdAt: '2026-05-13T10:11:12.345Z'
    });

    assert.match(content, /captured_by: Ada/);
    assert.match(content, /source: mole CLI/);
    assert.match(content, /visibility: \"internal\"/);
  });


  it('emits optional stakeholder metadata in CLI capture frontmatter', () => {
    const content = buildInsightCaptureContent('CEO asked about onboarding', {
      capturedBy: 'Ada',
      createdAt: '2026-05-13T10:11:12.345Z',
      stakeholder: 'CEO',
      requestedBy: 'CEO',
      audience: ['exec'],
      interestAreas: ['enterprise onboarding'],
      followUpBy: '2026-05-20'
    });

    assert.match(content, /stakeholder: "CEO"/);
    assert.match(content, /requested_by: "CEO"/);
    assert.match(content, /audience: \["exec"\]/);
    assert.match(content, /interest_areas: \["enterprise onboarding"\]/);
    assert.match(content, /follow_up_by: "2026-05-20"/);
  });

  it('emits captured_by in UI capture frontmatter', () => {
    const content = buildUiCaptureContent({
      source: 'customer',
      channel: 'call',
      confidence: 'medium',
      tags: ['research'],
      note: 'Team note',
      capturedBy: 'Ada'
    }, {
      date: '2026-05-13'
    });

    assert.match(content, /captured_by: Ada/);
    assert.match(content, /source: customer/);
  });
});

describe('inbox processing lock and receipt', () => {
  it('discovers nested live inbox files while excluding README and archive content', () => {
    withTempInstance((dir) => {
      fs.mkdirSync(path.join(dir, '6-raw', 'inbox', 'observations'), { recursive: true });
      fs.mkdirSync(path.join(dir, '6-raw', 'inbox', 'archive', 'old'), { recursive: true });
      fs.writeFileSync(path.join(dir, '6-raw', 'inbox', 'README.md'), 'instructions');
      fs.writeFileSync(path.join(dir, '6-raw', 'inbox', 'deck.pptx'), 'deck');
      fs.writeFileSync(path.join(dir, '6-raw', 'inbox', 'observations', 'note.md'), 'note');
      fs.writeFileSync(path.join(dir, '6-raw', 'inbox', 'archive', 'old', 'done.md'), 'done');

      assert.deepEqual(discoverInboxFiles(dir), [
        '6-raw/inbox/deck.pptx',
        '6-raw/inbox/observations/note.md'
      ]);
    });
  });

  it('filters files already recorded as processed and rejects a non-Mole root', () => {
    withTempInstance((dir) => {
      for (const relative of [
        'mole.instance.yaml',
        '0-bootstrap',
        '1-routing',
        '2-summaries',
        '3-indexes',
        '4-context',
        '5-evidence',
        '6-raw'
      ]) {
        const target = path.join(dir, relative);
        if (path.extname(target)) fs.writeFileSync(target, 'mole_version: 0.2.8\n');
        else fs.mkdirSync(target, { recursive: true });
      }
      fs.mkdirSync(path.join(dir, '6-raw', 'inbox'), { recursive: true });
      fs.writeFileSync(path.join(dir, '6-raw', 'inbox', 'done.md'), 'done');
      fs.writeFileSync(path.join(dir, '6-raw', 'inbox', 'new.md'), 'new');
      fs.mkdirSync(path.join(dir, 'governance', 'run-receipts', 'inbox-processing'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'governance', 'run-receipts', 'inbox-processing', 'receipt.json'),
        JSON.stringify({ completed_at: '2026-07-16T12:00:00.000Z', processed: ['6-raw/inbox/done.md'] })
      );

      const result = auditInbox(dir);
      assert.deepEqual(result.unprocessed, ['6-raw/inbox/new.md']);
      assert.deepEqual(result.processed, ['6-raw/inbox/done.md']);
      assert.throws(() => auditInbox(path.join(dir, 'missing')), /not a Mole workspace root/);
    });
  });

  it('allows one claim and fails concurrent claims safely', () => {
    withTempInstance((dir) => {
      const first = claimInboxProcessing(dir, {
        claimedBy: 'Ada',
        now: new Date('2026-05-13T10:11:12.345Z'),
        lockId: 'lock-1'
      });
      const second = claimInboxProcessing(dir, {
        claimedBy: 'Grace',
        now: new Date('2026-05-13T10:12:12.345Z'),
        lockId: 'lock-2'
      });

      assert.equal(first.ok, true);
      assert.equal(first.lock.claimed_by, 'Ada');
      assert.equal(second.ok, false);
      assert.match(second.message, /already belongs.*claimed by Ada/);
    });
  });

  it('writes a processing receipt and releases the lock on completion', () => {
    withTempInstance((dir) => {
      claimInboxProcessing(dir, {
        claimedBy: 'Ada',
        host: 'host-a',
        now: new Date('2026-05-13T10:11:12.345Z'),
        lockId: 'lock-1'
      });

      const result = completeInboxProcessing(dir, {
        runId: 'lock-1',
        processor: 'Ada',
        host: 'host-a',
        completedAt: new Date('2026-05-13T10:21:12.345Z'),
        processed: ['6-raw/inbox/a.md'],
        summary: 'Promoted one note.'
      });

      assert.equal(result.ok, true);
      assert.equal(result.receipt.lock_id, 'lock-1');
      assert.equal(result.receipt.claimed_by, 'Ada');
      assert.deepEqual(result.receipt.processed, ['6-raw/inbox/a.md']);
      assert.match(result.receiptPath, /governance[\\/]run-receipts[\\/]inbox-processing[\\/]/);

      const next = claimInboxProcessing(dir, {
        claimedBy: 'Grace',
        now: new Date('2026-05-13T10:22:12.345Z'),
        lockId: 'lock-2'
      });
      assert.equal(next.ok, true);
    });
  });

  it('fails closed without a claim and permits only an audited missing-lock override', () => {
    withTempInstance((dir) => {
      const refused = completeInboxProcessing(dir, {
        runId: 'missing-run',
        claimedBy: 'Ada',
        host: 'host-a',
        completedAt: new Date('2026-05-13T10:21:12.345Z'),
        processed: ['6-raw/inbox/a.md'],
        summary: 'Promoted one note.'
      });

      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'MISSING_LOCK');

      const result = completeInboxProcessing(dir, {
        runId: 'override-run',
        processor: 'Ada',
        host: 'host-a',
        overrideMissingLock: true,
        reason: 'Confirmed the prior local run left no lock behind.',
        completedAt: new Date('2026-05-13T10:21:12.345Z'),
        processed: ['6-raw/inbox/a.md'],
        summary: 'Promoted one note.'
      });

      assert.equal(result.ok, true);
      assert.equal(result.receipt.run_id, 'override-run');
      assert.equal(result.receipt.override.type, 'missing-lock');
      assert.equal(result.receipt.override.reason, 'Confirmed the prior local run left no lock behind.');
      assert.deepEqual(result.receipt.processed, ['6-raw/inbox/a.md']);
      assert.match(result.receiptPath, /governance[\\/]run-receipts[\\/]inbox-processing[\\/]/);
      assert.equal(fs.existsSync(path.join(dir, 'governance', 'inbox-processing.lock.json')), false);
      const overrides = fs.readdirSync(path.join(dir, 'governance', 'run-receipts', 'inbox-processing', 'overrides'));
      assert.equal(overrides.length, 1);
    });
  });

  it('does not persist a missing-lock override when a path is already covered', () => {
    withTempInstance((dir) => {
      const receipts = path.join(dir, 'governance', 'run-receipts', 'inbox-processing');
      fs.mkdirSync(receipts, { recursive: true });
      fs.writeFileSync(path.join(receipts, 'prior.json'), JSON.stringify({
        run_id: 'prior-run',
        completed_at: '2026-09-08T10:00:00.000Z',
        processed: ['6-raw/inbox/a.md']
      }));

      const result = completeInboxProcessing(dir, {
        runId: 'recovery-run',
        processor: 'Ada',
        host: 'laptop-a',
        overrideMissingLock: true,
        reason: 'The prior receipt already covers this path.',
        completedAt: new Date('2026-09-08T10:01:00.000Z'),
        processed: ['6-raw/inbox/a.md']
      });

      assert.equal(result.ok, false);
      assert.equal(result.code, 'ALREADY_PROCESSED');
      const overridesDir = path.join(receipts, 'overrides');
      assert.equal(fs.existsSync(overridesDir), false);
    });
  });

  it('parses repeated processed paths while preserving completion summary text', () => {
    const parsed = parseInboxCompleteValues([
      '--processed',
      '6-raw/inbox/a.md',
      '--processed',
      '6-raw/inbox/b.md',
      'Promoted',
      'two',
      'notes.'
    ]);

    assert.deepEqual(parsed.processed, [
      '6-raw/inbox/a.md',
      '6-raw/inbox/b.md'
    ]);
    assert.equal(parsed.summary, 'Promoted two notes.');
  });

  it('records processed paths in metrics when the CLI completes inbox processing', () => {
    withTempInstance((dir) => {
      const claim = runCli([
        'inbox',
        'claim',
        '--run-id',
        'cli-run-1',
        'Ada'
      ], {
        cwd: dir
      });
      const complete = runCli([
        'inbox',
        'complete',
        '--run-id',
        'cli-run-1',
        '--processor',
        'Ada',
        '--processed',
        '6-raw/inbox/a.md',
        '--processed',
        '6-raw/inbox/b.md',
        'Promoted',
        'two',
        'notes.'
      ], {
        cwd: dir
      });
      const retry = runCli([
        'inbox',
        'complete',
        '--run-id',
        'cli-run-1',
        '--processor',
        'Ada',
        '--processed',
        '6-raw/inbox/a.md',
        '--processed',
        '6-raw/inbox/b.md',
        'Retried',
        'completion.'
      ], {
        cwd: dir
      });

      const paths = getMetricsPaths(dir);
      const receiptsDir = path.join(dir, 'governance', 'run-receipts', 'inbox-processing');
      const receiptFile = fs.readdirSync(receiptsDir).find((file) => file.endsWith('.json'));
      const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, receiptFile), 'utf8'));
      const daily = JSON.parse(fs.readFileSync(paths.dailyPath, 'utf8'));

      assert.equal(claim.status, 0);
      assert.equal(complete.status, 0);
      assert.equal(retry.status, 0);
      assert.match(retry.stdout, /already exists/);
      assert.deepEqual(receipt.processed, [
        '6-raw/inbox/a.md',
        '6-raw/inbox/b.md'
      ]);
      assert.equal(daily.records.at(-1).count, 2);
    });
  });

  it('requires an explicit CLI override for completion without a prior claim', () => {
    withTempInstance((dir) => {
      const refused = runCli([
        'inbox',
        'complete',
        '--run-id',
        'missing-cli-run',
        '--processed',
        '6-raw/inbox/a.md',
        'Promoted',
        'one',
        'note.'
      ], {
        cwd: dir,
        env: { ...process.env, MOLE_CAPTURED_BY: 'Ada' }
      });

      assert.notEqual(refused.status, 0);
      assert.match(refused.stderr, /No active owned inbox processing claim/);

      const complete = runCli([
        'inbox',
        'complete',
        '--override-missing-lock',
        '--run-id',
        'cli-override-run',
        '--processor',
        'Ada',
        '--reason',
        'Confirmed the prior worker stopped before writing its lock.',
        '--processed',
        '6-raw/inbox/a.md',
        'Promoted',
        'one',
        'note.'
      ], {
        cwd: dir,
        env: { ...process.env, MOLE_CAPTURED_BY: 'Ada' }
      });

      const paths = getMetricsPaths(dir);
      const receiptsDir = path.join(dir, 'governance', 'run-receipts', 'inbox-processing');
      const receiptFile = fs.readdirSync(receiptsDir).find((file) => file.endsWith('.json'));
      const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, receiptFile), 'utf8'));
      const daily = JSON.parse(fs.readFileSync(paths.dailyPath, 'utf8'));

      assert.equal(complete.status, 0);
      assert.match(complete.stdout, /receipt written/);
      assert.equal(receipt.run_id, 'cli-override-run');
      assert.equal(receipt.override.type, 'missing-lock');
      assert.equal(receipt.claimed_by, 'Ada');
      assert.deepEqual(receipt.processed, ['6-raw/inbox/a.md']);
      assert.equal(daily.records.at(-1).count, 1);
    });
  });

  it('keeps inbox completion successful when metrics update fails', () => {
    withTempInstance((dir) => {
      claimInboxProcessing(dir, {
        claimedBy: 'Ada',
        now: new Date('2026-06-11T10:00:00.000Z'),
        lockId: 'metrics-failure-run',
        leaseMs: 365 * 24 * 60 * 60 * 1000
      });
      fs.mkdirSync(path.join(dir, 'governance', 'metrics'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'governance', 'metrics', 'daily.json'), '{broken', 'utf8');

      const result = runCli([
        'inbox',
        'complete',
        '--run-id',
        'metrics-failure-run',
        '--processor',
        'Ada',
        '--processed',
        '6-raw/inbox/a.md',
        'Promoted',
        'one',
        'note.'
      ], {
        cwd: dir
      });

      assert.equal(result.status, 0);
      assert.match(result.stdout, /receipt written/);
      assert.match(result.stderr, /metrics update failed/);
      assert.equal(fs.existsSync(path.join(dir, 'governance', 'inbox-processing.lock.json')), false);

      fs.writeFileSync(
        path.join(dir, 'governance', 'metrics', 'daily.json'),
        JSON.stringify({ records: [] }),
        'utf8'
      );
      const retry = runCli([
        'inbox',
        'complete',
        '--run-id',
        'metrics-failure-run',
        '--processor',
        'Ada',
        '--processed',
        '6-raw/inbox/a.md',
        'Retried',
        'completion.'
      ], {
        cwd: dir
      });
      const daily = JSON.parse(fs.readFileSync(
        path.join(dir, 'governance', 'metrics', 'daily.json'),
        'utf8'
      ));
      assert.equal(retry.status, 0);
      assert.match(retry.stdout, /already exists/);
      assert.doesNotMatch(retry.stderr, /metrics update failed/);
      assert.equal(daily.records.at(-1).count, 1);
    });
  });

  it('stores run and lease metadata and makes repeated claims idempotent', () => {
    withTempInstance((dir) => {
      const options = {
        runId: 'lease-run',
        processor: 'Ada',
        host: 'laptop-a',
        leaseMs: 60 * 60 * 1000,
        claimedPaths: ['6-raw/inbox/a.md', '6-raw/inbox/b.md'],
        now: new Date('2026-09-08T10:00:00.000Z')
      };
      const first = claimInboxProcessing(dir, options);
      const retry = claimInboxProcessing(dir, {
        ...options,
        now: new Date('2026-09-08T10:05:00.000Z')
      });

      assert.equal(first.ok, true);
      assert.equal(first.lock.run_id, 'lease-run');
      assert.equal(first.lock.lock_version, 1);
      assert.equal(first.lock.processor, 'Ada');
      assert.equal(first.lock.host, 'laptop-a');
      assert.equal(first.lock.started_at, '2026-09-08T10:00:00.000Z');
      assert.equal(first.lock.heartbeat_at, '2026-09-08T10:00:00.000Z');
      assert.equal(first.lock.expires_at, '2026-09-08T11:00:00.000Z');
      assert.deepEqual(first.lock.claimed_paths, ['6-raw/inbox/a.md', '6-raw/inbox/b.md']);
      assert.equal(retry.ok, true);
      assert.equal(retry.idempotent, true);
      assert.equal(retry.lock.run_id, 'lease-run');

      const foreign = claimInboxProcessing(dir, {
        ...options,
        processor: 'Grace',
        host: 'laptop-b',
        now: new Date('2026-09-08T10:06:00.000Z')
      });
      assert.equal(foreign.ok, false);
      assert.equal(foreign.code, 'FOREIGN_OWNER');

      const heartbeat = heartbeatInboxProcessing(dir, {
        runId: 'lease-run',
        processor: 'Ada',
        host: 'laptop-a',
        leaseMs: 60 * 60 * 1000,
        now: new Date('2026-09-08T10:30:00.000Z')
      });
      assert.equal(heartbeat.ok, true);
      assert.equal(heartbeat.lock.lock_version, 2);
      assert.equal(heartbeat.lock.heartbeat_at, '2026-09-08T10:30:00.000Z');
      assert.equal(heartbeat.lock.expires_at, '2026-09-08T11:30:00.000Z');
    });
  });

  it('requires an explicit matching run ID for every post-claim mutation', () => {
    withTempInstance((dir) => {
      claimInboxProcessing(dir, {
        runId: 'explicit-run',
        processor: 'Ada',
        host: 'laptop-a',
        now: new Date('2026-09-08T10:00:00.000Z')
      });

      const heartbeat = heartbeatInboxProcessing(dir, {
        processor: 'Ada',
        host: 'laptop-a',
        now: new Date('2026-09-08T10:01:00.000Z')
      });
      const checkpoint = checkpointInboxProcessing(dir, {
        processor: 'Ada',
        host: 'laptop-a',
        processed: ['6-raw/inbox/a.md'],
        now: new Date('2026-09-08T10:02:00.000Z')
      });
      const completion = completeInboxProcessing(dir, {
        processor: 'Ada',
        host: 'laptop-a',
        completedAt: new Date('2026-09-08T10:03:00.000Z')
      });

      assert.equal(heartbeat.code, 'RUN_ID_REQUIRED');
      assert.equal(checkpoint.code, 'RUN_ID_REQUIRED');
      assert.equal(completion.code, 'RUN_ID_REQUIRED');
      assert.equal(inspectInboxProcessing(dir).lock.run_id, 'explicit-run');
      assert.equal(inspectInboxProcessing(dir).lock.lock_version, 1);
    });
  });

  it('rejects missing, foreign, and expired normal completion', () => {
    withTempInstance((dir) => {
      const missing = completeInboxProcessing(dir, {
        runId: 'missing-run',
        processor: 'Ada',
        host: 'laptop-a',
        completedAt: new Date('2026-09-08T10:00:00.000Z')
      });
      assert.equal(missing.ok, false);
      assert.equal(missing.code, 'MISSING_LOCK');

      claimInboxProcessing(dir, {
        runId: 'owned-run',
        processor: 'Ada',
        host: 'laptop-a',
        leaseMs: 60 * 60 * 1000,
        now: new Date('2026-09-08T10:00:00.000Z')
      });

      const foreign = completeInboxProcessing(dir, {
        runId: 'owned-run',
        processor: 'Grace',
        host: 'laptop-b',
        completedAt: new Date('2026-09-08T10:05:00.000Z')
      });
      assert.equal(foreign.ok, false);
      assert.equal(foreign.code, 'FOREIGN_OWNER');

      const expired = completeInboxProcessing(dir, {
        runId: 'owned-run',
        processor: 'Ada',
        host: 'laptop-a',
        completedAt: new Date('2026-09-08T11:00:00.000Z')
      });
      assert.equal(expired.ok, false);
      assert.equal(expired.code, 'STALE_LOCK');
    });
  });

  it('fails closed when a synced lock is missing ownership or lease metadata', () => {
    withTempInstance((dir) => {
      createWorkspaceScaffold(dir);
      const lockPath = path.join(dir, 'governance', 'inbox-processing.lock.json');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        status: 'processing',
        run_id: 'incomplete-lock'
      }));

      const audit = auditInbox(dir);
      assert.equal(audit.ok, false);
      assert.equal(audit.issues.some((issue) => issue.code === 'INVALID_LOCK'), true);

      const completion = completeInboxProcessing(dir, {
        runId: 'incomplete-lock',
        processor: 'Ada',
        host: 'laptop-a',
        completedAt: new Date('2026-09-08T10:00:00.000Z')
      });
      assert.equal(completion.ok, false);
      assert.equal(completion.code, 'INVALID_LOCK');
    });
  });

  it('checkpoints partial progress and resumes without reprocessing completed paths', () => {
    withTempInstance((dir) => {
      claimInboxProcessing(dir, {
        runId: 'partial-run',
        processor: 'Ada',
        host: 'laptop-a',
        claimedPaths: ['6-raw/inbox/a.md', '6-raw/inbox/b.md', '6-raw/inbox/c.md'],
        now: new Date('2026-09-08T10:00:00.000Z')
      });

      const checkpoint = checkpointInboxProcessing(dir, {
        runId: 'partial-run',
        processor: 'Ada',
        host: 'laptop-a',
        processed: ['6-raw/inbox/a.md'],
        now: new Date('2026-09-08T10:10:00.000Z')
      });
      assert.equal(checkpoint.ok, true);
      assert.deepEqual(checkpoint.lock.processed_paths, ['6-raw/inbox/a.md']);
      assert.deepEqual(checkpoint.lock.unresolved_paths, [
        '6-raw/inbox/b.md',
        '6-raw/inbox/c.md'
      ]);
      assert.ok(fs.existsSync(path.join(dir, 'governance', 'inbox-processing.lock.json')));

      const completed = completeInboxProcessing(dir, {
        runId: 'partial-run',
        processor: 'Ada',
        host: 'laptop-a',
        processed: ['6-raw/inbox/b.md'],
        completedAt: new Date('2026-09-08T10:20:00.000Z')
      });
      assert.equal(completed.ok, true);
      assert.deepEqual(completed.receipt.processed, [
        '6-raw/inbox/a.md',
        '6-raw/inbox/b.md'
      ]);
      assert.deepEqual(completed.receipt.unresolved_paths, ['6-raw/inbox/c.md']);
      assert.equal(fs.existsSync(path.join(dir, 'governance', 'inbox-processing.lock.json')), false);

      const retry = completeInboxProcessing(dir, {
        runId: 'partial-run',
        processor: 'Ada',
        host: 'laptop-a',
        processed: ['6-raw/inbox/a.md', '6-raw/inbox/b.md'],
        completedAt: new Date('2026-09-09T10:20:00.000Z')
      });
      assert.equal(retry.ok, true);
      assert.equal(retry.idempotent, true);
      assert.equal(fs.readdirSync(path.join(dir, 'governance', 'run-receipts', 'inbox-processing'))
        .filter((file) => file.endsWith('.json')).length, 1);
    });
  });

  it('records a stale-lock override with the replaced lease and preserves its checkpoint', () => {
    withTempInstance((dir) => {
      createWorkspaceScaffold(dir);
      claimInboxProcessing(dir, {
        runId: 'stale-run',
        processor: 'Ada',
        host: 'laptop-a',
        leaseMs: 1000,
        claimedPaths: ['6-raw/inbox/a.md', '6-raw/inbox/b.md'],
        now: new Date('2026-09-08T10:00:00.000Z')
      });
      checkpointInboxProcessing(dir, {
        runId: 'stale-run',
        processor: 'Ada',
        host: 'laptop-a',
        leaseMs: 1000,
        processed: ['6-raw/inbox/a.md'],
        now: new Date('2026-09-08T10:00:00.500Z')
      });

      const missingRunId = overrideStaleInboxProcessing(dir, {
        processor: 'Grace',
        host: 'laptop-b',
        reason: 'A replacement must identify its run explicitly.',
        now: new Date('2026-09-08T10:00:02.000Z')
      });
      assert.equal(missingRunId.ok, false);
      assert.equal(missingRunId.code, 'RUN_ID_REQUIRED');

      const recovered = overrideStaleInboxProcessing(dir, {
        runId: 'resumed-run',
        processor: 'Grace',
        host: 'laptop-b',
        claimedPaths: ['6-raw/inbox/c.md'],
        reason: 'Confirmed the previous worker stopped and inspected sync history.',
        now: new Date('2026-09-08T10:00:02.000Z')
      });
      assert.equal(recovered.ok, true);
      assert.equal(recovered.override.actor, 'Grace');
      assert.equal(recovered.override.overridden_at, '2026-09-08T10:00:02.000Z');
      assert.equal(recovered.override.reason, 'Confirmed the previous worker stopped and inspected sync history.');
      assert.equal(recovered.override.replaced_lock.run_id, 'stale-run');
      assert.deepEqual(recovered.lock.claimed_paths, [
        '6-raw/inbox/a.md',
        '6-raw/inbox/b.md',
        '6-raw/inbox/c.md'
      ]);
      assert.deepEqual(recovered.lock.processed_paths, ['6-raw/inbox/a.md']);
      assert.deepEqual(recovered.lock.unresolved_paths, [
        '6-raw/inbox/b.md',
        '6-raw/inbox/c.md'
      ]);
      assert.equal(recovered.lock.resumed_from_run_id, 'stale-run');

      const resumedCompletion = completeInboxProcessing(dir, {
        runId: 'resumed-run',
        processor: 'Grace',
        host: 'laptop-b',
        processed: ['6-raw/inbox/b.md', '6-raw/inbox/c.md'],
        completedAt: new Date('2026-09-08T10:00:03.000Z')
      });
      assert.equal(resumedCompletion.ok, true);
      assert.deepEqual(resumedCompletion.receipt.processed, [
        '6-raw/inbox/a.md',
        '6-raw/inbox/b.md',
        '6-raw/inbox/c.md'
      ]);
      assert.deepEqual(resumedCompletion.receipt.unresolved_paths, []);

      const inspected = inspectInboxProcessing(dir);
      assert.equal(inspected.overrides.length, 1);
      assert.equal(inspected.overrides[0].override.replacement_run_id, 'resumed-run');
      const audit = auditInbox(dir, { now: new Date('2026-09-08T10:00:02.000Z') });
      assert.equal(audit.overrides.length, 1);
      assert.equal(audit.overrides[0].override.reason, recovered.override.reason);
    });
  });

  it('migrates an expired legacy lock only through an audited stale override', () => {
    withTempInstance((dir) => {
      createWorkspaceScaffold(dir);
      const lockPath = path.join(dir, 'governance', 'inbox-processing.lock.json');
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify({
        lock_id: 'legacy-run',
        status: 'processing',
        claimed_by: 'Ada',
        started_at: '2026-09-08T10:00:00.000Z',
        stale_after: '2026-09-08T10:00:01.000Z',
        inbox: '6-raw/inbox'
      }));

      const normal = completeInboxProcessing(dir, {
        runId: 'legacy-run',
        processor: 'Ada',
        host: 'laptop-a',
        completedAt: new Date('2026-09-08T10:00:02.000Z')
      });
      assert.equal(normal.ok, false);
      assert.equal(normal.code, 'INVALID_LOCK');

      const recovered = overrideStaleInboxProcessing(dir, {
        runId: 'migrated-run',
        processor: 'Grace',
        host: 'laptop-b',
        claimedPaths: ['6-raw/inbox/a.md'],
        reason: 'Inspected the expired legacy lock before migrating it.',
        now: new Date('2026-09-08T10:00:02.000Z')
      });

      assert.equal(recovered.ok, true);
      assert.equal(recovered.override.type, 'legacy-stale-lock');
      assert.equal(recovered.override.action, 'migrate-legacy-stale-lock');
      assert.equal(recovered.override.replaced_lock.lock_id, 'legacy-run');
      assert.equal(recovered.lock.schema_version, 2);
      assert.equal(recovered.lock.run_id, 'migrated-run');
      assert.equal(recovered.lock.host, 'laptop-b');
      assert.deepEqual(recovered.lock.claimed_paths, ['6-raw/inbox/a.md']);
    });
  });

  it('rejects stale recovery into a run that already has a completion receipt', () => {
    withTempInstance((dir) => {
      claimInboxProcessing(dir, {
        runId: 'completed-run',
        processor: 'Ada',
        host: 'laptop-a',
        now: new Date('2026-09-08T09:00:00.000Z')
      });
      completeInboxProcessing(dir, {
        runId: 'completed-run',
        processor: 'Ada',
        host: 'laptop-a',
        completedAt: new Date('2026-09-08T09:01:00.000Z')
      });

      claimInboxProcessing(dir, {
        runId: 'stale-run',
        processor: 'Ada',
        host: 'laptop-a',
        leaseMs: 1000,
        now: new Date('2026-09-08T10:00:00.000Z')
      });
      const recovered = overrideStaleInboxProcessing(dir, {
        runId: 'completed-run',
        processor: 'Grace',
        host: 'laptop-b',
        reason: 'Do not reuse a completed run ID.',
        now: new Date('2026-09-08T10:00:02.000Z')
      });

      assert.equal(recovered.ok, false);
      assert.equal(recovered.code, 'RUN_ALREADY_COMPLETED');
      assert.equal(inspectInboxProcessing(dir).lock.run_id, 'stale-run');
      assert.equal(inspectInboxProcessing(dir).overrides.length, 0);
    });
  });

  it('validates run IDs before using them as receipt filenames', () => {
    withTempInstance((dir) => {
      const invalid = claimInboxProcessing(dir, {
        runId: 'a/b',
        processor: 'Ada',
        host: 'laptop-a'
      });
      assert.equal(invalid.ok, false);
      assert.equal(invalid.code, 'INVALID_RUN_ID');

      const valid = claimInboxProcessing(dir, {
        runId: 'a_b',
        processor: 'Ada',
        host: 'laptop-a',
        now: new Date('2026-09-08T10:00:00.000Z')
      });
      const completed = completeInboxProcessing(dir, {
        runId: 'a_b',
        processor: 'Ada',
        host: 'laptop-a',
        completedAt: new Date('2026-09-08T10:01:00.000Z')
      });

      assert.equal(valid.ok, true);
      assert.equal(completed.ok, true);
      assert.match(completed.receiptPath, /[\\/]a_b-[0-9a-f]{16}\.json$/);
    });
  });

  it('detects sync conflict names and duplicate receipt runs without choosing a copy', () => {
    withTempInstance((dir) => {
      createWorkspaceScaffold(dir);
      const inbox = path.join(dir, '6-raw', 'inbox');
      fs.writeFileSync(path.join(inbox, 'source.md'), 'one');
      fs.writeFileSync(path.join(inbox, 'duplicate-orders.md'), 'ordinary name');
      fs.writeFileSync(path.join(inbox, 'source (conflicted copy).md'), 'two');
      assert.deepEqual(discoverInboxConflictFiles(dir), ['6-raw/inbox/source (conflicted copy).md']);
      const conflictAudit = auditInbox(dir);
      assert.deepEqual(conflictAudit.syncConflictFiles, ['6-raw/inbox/source (conflicted copy).md']);
      assert.equal(conflictAudit.issues.some((issue) => issue.code === 'SYNC_CONFLICT'), true);
      const claim = claimInboxProcessing(dir, {
        runId: 'conflict-run',
        processor: 'Ada',
        host: 'laptop-a'
      });
      assert.equal(claim.ok, false);
      assert.equal(claim.code, 'SYNC_CONFLICT');
      assert.equal(fs.readFileSync(path.join(inbox, 'source.md'), 'utf8'), 'one');
      assert.equal(fs.readFileSync(path.join(inbox, 'source (conflicted copy).md'), 'utf8'), 'two');

      fs.unlinkSync(path.join(inbox, 'source (conflicted copy).md'));
      const receipts = path.join(dir, 'governance', 'run-receipts', 'inbox-processing');
      fs.mkdirSync(receipts, { recursive: true });
      const first = {
        run_id: 'duplicate-run',
        receipt_id: 'duplicate-run',
        completed_at: '2026-09-08T10:00:00.000Z',
        processed: ['6-raw/inbox/source.md']
      };
      fs.writeFileSync(path.join(receipts, 'one.json'), JSON.stringify(first));
      fs.writeFileSync(path.join(receipts, 'two.json'), JSON.stringify(first));
      const duplicateAudit = auditInbox(dir);
      assert.equal(duplicateAudit.duplicateReceipts.length, 1);
      assert.equal(duplicateAudit.issues.some((issue) => issue.code === 'DUPLICATE_RECEIPT'), true);
    });
  });

  it('detects split-brain receipts that claim the same canonical path', () => {
    withTempInstance((dir) => {
      createWorkspaceScaffold(dir);
      const inbox = path.join(dir, '6-raw', 'inbox');
      fs.writeFileSync(path.join(inbox, 'a.md'), 'a');
      fs.writeFileSync(path.join(inbox, 'b.md'), 'b');
      const receipts = path.join(dir, 'governance', 'run-receipts', 'inbox-processing');
      fs.mkdirSync(receipts, { recursive: true });
      fs.writeFileSync(path.join(receipts, 'one.json'), JSON.stringify({
        run_id: 'offline-run-a',
        completed_at: '2026-09-08T10:00:00.000Z',
        processed: ['6-raw/inbox/a.md']
      }));
      fs.writeFileSync(path.join(receipts, 'two.json'), JSON.stringify({
        run_id: 'offline-run-b',
        completed_at: '2026-09-08T10:01:00.000Z',
        processed: [path.join(dir, '6-raw', 'inbox', 'a.md'), '6-raw/inbox/b.md']
      }));

      const inspected = inspectInboxProcessing(dir);
      assert.deepEqual(inspected.processedPathConflicts, [{
        path: '6-raw/inbox/a.md',
        runs: [
          { run_id: 'offline-run-a', receipt_paths: [
            'governance/run-receipts/inbox-processing/one.json'
          ] },
          { run_id: 'offline-run-b', receipt_paths: [
            'governance/run-receipts/inbox-processing/two.json'
          ] }
        ]
      }]);

      const audit = auditInbox(dir);
      assert.deepEqual(audit.processed, ['6-raw/inbox/b.md']);
      assert.deepEqual(audit.unprocessed, ['6-raw/inbox/a.md']);
      assert.equal(audit.issues.some((issue) => issue.code === 'PROCESSED_PATH_CONFLICT'), true);
      assert.equal(audit.ok, false);

      const claim = claimInboxProcessing(dir, {
        runId: 'blocked-run',
        processor: 'Ada',
        host: 'laptop-a'
      });
      assert.equal(claim.ok, false);
      assert.equal(claim.code, 'PROCESSED_PATH_CONFLICT');

      const metrics = backfillProcessedInboxMetrics(dir, {
        now: new Date('2026-09-08T12:00:00.000Z')
      });
      assert.equal(metrics.processed_paths_conflicted, 1);
      assert.equal(metrics.processed_paths_counted, 1);
      const daily = JSON.parse(fs.readFileSync(getMetricsPaths(dir).dailyPath, 'utf8'));
      assert.deepEqual(daily.records, [{ date: '2026-09-08', count: 1 }]);
    });
  });

  it('fails closed on malformed override JSON', () => {
    withTempInstance((dir) => {
      createWorkspaceScaffold(dir);
      const overrides = path.join(
        dir,
        'governance',
        'run-receipts',
        'inbox-processing',
        'overrides'
      );
      fs.mkdirSync(overrides, { recursive: true });
      fs.writeFileSync(path.join(overrides, 'truncated.json'), '{"override_id":"broken"');

      const inspected = inspectInboxProcessing(dir);
      assert.equal(inspected.overrides.length, 0);
      assert.equal(inspected.invalidOverrides.length, 1);
      assert.match(inspected.invalidOverrides[0].error, /Unexpected end|JSON/);

      const audit = auditInbox(dir);
      assert.equal(audit.issues.some((issue) => issue.code === 'INVALID_OVERRIDE'), true);
      assert.equal(audit.ok, false);

      const claim = claimInboxProcessing(dir, {
        runId: 'blocked-by-override',
        processor: 'Ada',
        host: 'laptop-a'
      });
      assert.equal(claim.ok, false);
      assert.equal(claim.code, 'INVALID_OVERRIDE');
    });
  });

  it('does not use receipt paths when completion metadata is missing', () => {
    withTempInstance((dir) => {
      createWorkspaceScaffold(dir);
      const inbox = path.join(dir, '6-raw', 'inbox');
      fs.writeFileSync(path.join(inbox, 'missing-time.md'), 'not complete');
      const receipts = path.join(dir, 'governance', 'run-receipts', 'inbox-processing');
      fs.mkdirSync(receipts, { recursive: true });
      fs.writeFileSync(path.join(receipts, 'missing-completed-at.json'), JSON.stringify({
        run_id: 'missing-time-run',
        processed: ['6-raw/inbox/missing-time.md']
      }));

      const inspected = inspectInboxProcessing(dir);
      assert.equal(inspected.receipts.length, 0);
      assert.equal(inspected.invalidReceipts.length, 1);
      assert.match(inspected.invalidReceipts[0].error, /completed_at/);

      const audit = auditInbox(dir);
      assert.deepEqual(audit.processed, []);
      assert.deepEqual(audit.unprocessed, ['6-raw/inbox/missing-time.md']);
      assert.equal(audit.issues.some((issue) => issue.code === 'INVALID_RECEIPT'), true);
      assert.equal(audit.ok, false);
    });
  });
});

describe('processed inbox metrics', () => {
  it('creates starter metric files and counts unique processed paths once per UTC day', () => {
    withTempInstance((dir) => {
      const first = recordProcessedInboxItems(dir, [
        '6-raw/inbox/a.md',
        './6-raw/inbox/a.md',
        path.join(dir, '6-raw', 'inbox', 'a.md'),
        '6-raw/inbox/a.md',
        '6-raw/inbox/b.md'
      ], {
        now: new Date('2026-06-11T10:00:00.000Z')
      });
      const second = recordProcessedInboxItems(dir, [
        '6-raw/inbox/a.md'
      ], {
        now: new Date('2026-06-11T11:00:00.000Z')
      });

      const paths = getMetricsPaths(dir);
      const daily = JSON.parse(fs.readFileSync(paths.dailyPath, 'utf8'));
      const weekly = JSON.parse(fs.readFileSync(paths.weeklyPath, 'utf8'));
      const monthly = JSON.parse(fs.readFileSync(paths.monthlyPath, 'utf8'));
      const seenToday = JSON.parse(fs.readFileSync(paths.seenTodayPath, 'utf8'));

      assert.equal(first.counted, 2);
      assert.equal(second.counted, 0);
      assert.deepEqual(daily.records, [{ date: '2026-06-11', count: 2 }]);
      assert.deepEqual(weekly.records, [{
        week_start: '2026-06-08',
        week_end: '2026-06-14',
        count: 2
      }]);
      assert.deepEqual(monthly.records, [{
        month: '2026-06',
        month_start: '2026-06-01',
        month_end: '2026-06-30',
        count: 2
      }]);
      assert.equal(seenToday.date, '2026-06-11');
      assert.equal(seenToday.seen.length, 2);
      assert.deepEqual(seenToday.seen.map((entry) => entry.key), [
        '6-raw/inbox/a.md',
        '6-raw/inbox/b.md'
      ]);
    });
  });

  it('resets same-day dedupe when the UTC date changes', () => {
    withTempInstance((dir) => {
      recordProcessedInboxItems(dir, ['6-raw/inbox/a.md'], {
        now: new Date('2026-06-11T23:55:00.000Z')
      });
      const result = recordProcessedInboxItems(dir, ['6-raw/inbox/a.md'], {
        now: new Date('2026-06-12T00:05:00.000Z')
      });

      const daily = JSON.parse(fs.readFileSync(getMetricsPaths(dir).dailyPath, 'utf8'));

      assert.equal(result.counted, 1);
      assert.deepEqual(daily.records, [
        { date: '2026-06-11', count: 1 },
        { date: '2026-06-12', count: 1 }
      ]);
    });
  });

  it('trims daily records while preserving older weekly and monthly rollups', () => {
    withTempInstance((dir) => {
      const paths = getMetricsPaths(dir);
      fs.mkdirSync(paths.metricsDir, { recursive: true });
      const oldDailyRecords = Array.from({ length: 100 }, (_, index) => {
        const date = new Date(Date.UTC(2026, 0, 1 + index));
        return {
          date: date.toISOString().slice(0, 10),
          count: 1
        };
      });
      fs.writeFileSync(paths.dailyPath, `${JSON.stringify({
        schema_version: 1,
        metric: 'processed_inbox_items',
        retention: { unit: 'day', limit: 100 },
        updated_at: '2026-06-11T00:00:00.000Z',
        records: oldDailyRecords
      }, null, 2)}\n`);
      fs.writeFileSync(paths.weeklyPath, `${JSON.stringify({
        schema_version: 1,
        metric: 'processed_inbox_items',
        retention: { unit: 'week', limit: 52 },
        week_start_day: 'monday',
        updated_at: '2026-06-11T00:00:00.000Z',
        records: [{ week_start: '2025-06-02', week_end: '2025-06-08', count: 9 }]
      }, null, 2)}\n`);
      fs.writeFileSync(paths.monthlyPath, `${JSON.stringify({
        schema_version: 1,
        metric: 'processed_inbox_items',
        retention: { unit: 'month', limit: 24 },
        updated_at: '2026-06-11T00:00:00.000Z',
        records: [{ month: '2025-06', month_start: '2025-06-01', month_end: '2025-06-30', count: 42 }]
      }, null, 2)}\n`);

      recordProcessedInboxItems(dir, ['6-raw/inbox/latest.md'], {
        now: new Date('2026-06-11T10:00:00.000Z')
      });

      const daily = JSON.parse(fs.readFileSync(paths.dailyPath, 'utf8'));
      const weekly = JSON.parse(fs.readFileSync(paths.weeklyPath, 'utf8'));
      const monthly = JSON.parse(fs.readFileSync(paths.monthlyPath, 'utf8'));

      assert.equal(daily.records.length, 100);
      assert.equal(daily.records.at(-1).date, '2026-06-11');
      assert.ok(weekly.records.some((record) => record.week_start === '2025-06-02' && record.count === 9));
      assert.ok(monthly.records.some((record) => record.month === '2025-06' && record.count === 42));
    });
  });

  it('trims weekly and monthly records to their retention limits', () => {
    withTempInstance((dir) => {
      const paths = getMetricsPaths(dir);
      fs.mkdirSync(paths.metricsDir, { recursive: true });
      fs.writeFileSync(paths.weeklyPath, `${JSON.stringify({
        schema_version: 1,
        metric: 'processed_inbox_items',
        retention: { unit: 'week', limit: 52 },
        week_start_day: 'monday',
        updated_at: '2026-06-11T00:00:00.000Z',
        records: Array.from({ length: 52 }, (_, index) => {
          const start = new Date(Date.UTC(2025, 0, 6 + index * 7));
          const end = new Date(start);
          end.setUTCDate(end.getUTCDate() + 6);
          return {
            week_start: start.toISOString().slice(0, 10),
            week_end: end.toISOString().slice(0, 10),
            count: 1
          };
        })
      }, null, 2)}\n`);
      fs.writeFileSync(paths.monthlyPath, `${JSON.stringify({
        schema_version: 1,
        metric: 'processed_inbox_items',
        retention: { unit: 'month', limit: 24 },
        updated_at: '2026-06-11T00:00:00.000Z',
        records: Array.from({ length: 24 }, (_, index) => {
          const month = new Date(Date.UTC(2024, index, 1)).toISOString().slice(0, 7);
          return {
            month,
            month_start: `${month}-01`,
            month_end: `${month}-28`,
            count: 1
          };
        })
      }, null, 2)}\n`);

      recordProcessedInboxItems(dir, ['6-raw/inbox/latest.md'], {
        now: new Date('2026-06-11T10:00:00.000Z')
      });

      const weekly = JSON.parse(fs.readFileSync(paths.weeklyPath, 'utf8'));
      const monthly = JSON.parse(fs.readFileSync(paths.monthlyPath, 'utf8'));

      assert.equal(weekly.records.length, 52);
      assert.equal(weekly.records.at(-1).week_start, '2026-06-08');
      assert.equal(monthly.records.length, 24);
      assert.equal(monthly.records.at(-1).month, '2026-06');
    });
  });

  it('includes a static dashboard wired to local metrics files', () => {
    const dashboard = fs.readFileSync(path.join(repoRoot, 'governance', 'metrics', 'dashboard.html'), 'utf8');

    assert.match(dashboard, /Molehill Metrics/);
    assert.match(dashboard, /daily\.json/);
    assert.match(dashboard, /weekly\.json/);
    assert.match(dashboard, /monthly\.json/);
    assert.match(dashboard, /viewSelect/);
    assert.match(dashboard, /fromDate/);
    assert.match(dashboard, /toDate/);
    assert.match(dashboard, /fileInput/);
  });

  it('backfills metrics from historical inbox processing receipts', () => {
    withTempInstance((dir) => {
      const receiptsDir = path.join(dir, 'governance', 'run-receipts', 'inbox-processing');
      fs.mkdirSync(receiptsDir, { recursive: true });
      fs.writeFileSync(path.join(receiptsDir, '20260610T100000000Z-a.json'), `${JSON.stringify({
        completed_at: '2026-06-10T10:00:00.000Z',
        processed: [
          '6-raw/inbox/a.md',
          './6-raw/inbox/a.md',
          path.join(dir, '6-raw', 'inbox', 'a.md'),
          '6-raw/inbox/a.md',
          '6-raw/inbox/b.md'
        ]
      }, null, 2)}\n`);
      fs.writeFileSync(path.join(receiptsDir, '20260611T100000000Z-b.json'), `${JSON.stringify({
        completed_at: '2026-06-11T10:00:00.000Z',
        processed: ['6-raw/inbox/c.md']
      }, null, 2)}\n`);
      fs.writeFileSync(path.join(receiptsDir, '20260611T110000000Z-empty.json'), `${JSON.stringify({
        completed_at: '2026-06-11T11:00:00.000Z',
        processed: []
      }, null, 2)}\n`);

      const result = backfillProcessedInboxMetrics(dir, {
        now: new Date('2026-06-11T12:00:00.000Z')
      });
      const paths = getMetricsPaths(dir);
      const daily = JSON.parse(fs.readFileSync(paths.dailyPath, 'utf8'));
      const weekly = JSON.parse(fs.readFileSync(paths.weeklyPath, 'utf8'));
      const monthly = JSON.parse(fs.readFileSync(paths.monthlyPath, 'utf8'));
      const seenToday = JSON.parse(fs.readFileSync(paths.seenTodayPath, 'utf8'));

      assert.equal(result.receipts_scanned, 3);
      assert.equal(result.receipts_counted, 2);
      assert.equal(result.receipts_skipped, 1);
      assert.equal(result.processed_paths_counted, 3);
      assert.deepEqual(daily.records, [
        { date: '2026-06-10', count: 2 },
        { date: '2026-06-11', count: 1 }
      ]);
      assert.deepEqual(weekly.records, [{
        week_start: '2026-06-08',
        week_end: '2026-06-14',
        count: 3
      }]);
      assert.deepEqual(monthly.records, [{
        month: '2026-06',
        month_start: '2026-06-01',
        month_end: '2026-06-30',
        count: 3
      }]);
      assert.deepEqual(seenToday.seen.map((entry) => entry.key), ['6-raw/inbox/c.md']);
    });
  });

  it('runs metrics backfill from the CLI', () => {
    withTempInstance((dir) => {
      const receiptsDir = path.join(dir, 'governance', 'run-receipts', 'inbox-processing');
      fs.mkdirSync(receiptsDir, { recursive: true });
      fs.writeFileSync(path.join(receiptsDir, 'receipt.json'), `${JSON.stringify({
        completed_at: '2026-06-11T10:00:00.000Z',
        processed: ['6-raw/inbox/a.md']
      }, null, 2)}\n`);

      const result = runCli([
        'metrics',
        'backfill'
      ], {
        cwd: dir
      });

      assert.equal(result.status, 0);
      assert.match(result.stdout, /Mole metrics backfill complete/);
      assert.match(result.stdout, /Receipts scanned: 1/);
      assert.match(result.stdout, /Processed paths counted: 1/);
    });
  });
});
