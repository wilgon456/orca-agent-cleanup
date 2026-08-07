import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildContext, cleanOrcaResidue, OFFICIAL_ORCA_SKILLS, scanOrcaResidue } from '../scripts/orca-cleanup-core.mjs';

function makeSandbox(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `orca-cleanup-${name}-`));
}

function write(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, 'utf8');
}

function writeJson(target, value) {
  write(target, `${JSON.stringify(value, null, 2)}\n`);
}

function exists(target) {
  return fs.existsSync(target);
}

function fakeContext(root, platform, extras = {}) {
  const home = path.join(root, 'home');
  const appData = path.join(root, 'AppData', 'Roaming');
  const localAppData = path.join(root, 'AppData', 'Local');
  const programData = path.join(root, 'ProgramData');
  const publicDir = path.join(root, 'Public');
  return buildContext({
    platform,
    home,
    env: { APPDATA: appData, LOCALAPPDATA: localAppData, PROGRAMDATA: programData, PUBLIC: publicDir },
    backupRoot: path.join(root, 'backup'),
    cliCandidates: extras.cliCandidates || [],
    appDataCandidates: extras.appDataCandidates,
    voiceCandidates: extras.voiceCandidates,
    userPath: extras.userPath || '',
    projects: extras.projects || [],
  });
}

test('공식 manifest의 8개 스킬 이름을 모두 포함한다', () => {
  assert.deepEqual(OFFICIAL_ORCA_SKILLS, [
    'computer-use', 'linear-tickets', 'orca-cli', 'orca-emulator',
    'orca-emulator-android', 'orca-linear', 'orca-per-workspace-env', 'orchestration',
  ]);
});

test('Windows 잔재를 출처 기반으로 찾아 격리하고 타사 설정은 보존한다', () => {
  const root = makeSandbox('windows');
  const context = fakeContext(root, 'win32');
  const home = context.home;
  const lock = path.join(home, '.agents', '.skill-lock.json');

  writeJson(lock, {
    skills: {
      'computer-use': { source: 'stablyai/orca' },
      'orca-cli': { sourceUrl: 'https://github.com/stablyai/orca' },
      paseo: { source: 'other/paseo' },
    },
  });
  write(path.join(home, '.agents', 'skills', 'computer-use', 'SKILL.md'), '# bundled copy');
  write(path.join(home, '.claude', 'skills', 'orca-cli', 'SKILL.md'), 'Use ORCA skills get');
  write(path.join(home, '.agents', 'skills', 'paseo', 'SKILL.md'), '# Paseo');
  write(path.join(home, '.codex', 'skills', 'computer-use', 'SKILL.md'), '# OpenAI computer use');

  const claudeSettings = path.join(home, '.claude', 'settings.json');
  writeJson(claudeSettings, {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: `${home}/.orca/agent-hooks/pre-tool.sh` }] },
        { matcher: 'Write', hooks: [{ type: 'command', command: 'echo keep-me' }] },
      ],
    },
    permissions: { allow: ['Read'] },
    statusLine: { type: 'command', command: `${home}/.orca/agent-hooks/status.sh` },
  });
  const kimi = path.join(home, '.kimi-code', 'config.toml');
  write(kimi, `[general]\nmodel = "keep"\n\n# >>> orca-managed-kimi-hooks (managed by Orca; do not edit) >>>\n[hooks]\ncommand = "orca-status"\n# <<< orca-managed-kimi-hooks <<<\n`);
  const amp = path.join(home, '.config', 'amp', 'plugins', 'orca-agent-status.ts');
  write(amp, '// Managed by Orca. Do not edit; changes may be overwritten.\n');
  const hermesConfig = path.join(home, '.hermes', 'config.yaml');
  write(hermesConfig, 'plugins:\n  enabled:\n    - keep-plugin\n    - orca-status\n');
  write(path.join(home, '.orca', 'openai-speech-token.enc'), 'secret');
  write(path.join(context.appDataCandidates[0], 'settings.json'), '{}');
  write(path.join(context.voiceCandidates[0], 'model.bin'), 'voice');
  write(path.join(home, 'orca', 'important-project.txt'), 'keep unless opted in');

  const findings = scanOrcaResidue(context);
  assert(findings.some((item) => item.kind === 'skill'));
  assert(findings.some((item) => item.kind === 'voice-data'));
  assert(!findings.some((item) => item.path.endsWith(path.join('skills', 'paseo'))));
  assert(!findings.some((item) => item.path === path.join(home, '.codex', 'skills', 'computer-use')));

  const preview = cleanOrcaResidue(context, { dryRun: true, includeAppData: true, includeVoiceData: true });
  assert(preview.actions.some((item) => item.action === 'would-quarantine'));
  assert(exists(path.join(home, '.orca')));

  const result = cleanOrcaResidue(context, { includeAppData: true, includeVoiceData: true });
  assert.equal(result.errors.length, 0);
  assert(!exists(path.join(home, '.agents', 'skills', 'computer-use')));
  assert(!exists(path.join(home, '.claude', 'skills', 'orca-cli')));
  assert(exists(path.join(home, '.agents', 'skills', 'paseo')));
  assert(exists(path.join(home, '.codex', 'skills', 'computer-use')));
  assert(exists(path.join(home, 'orca', 'important-project.txt')));
  assert(!exists(path.join(home, '.orca')));
  assert(!exists(context.voiceCandidates[0]));
  assert(exists(path.join(context.backupRoot, 'manifest.json')));

  const cleanedClaude = JSON.parse(fs.readFileSync(claudeSettings, 'utf8'));
  assert.equal(cleanedClaude.hooks.PreToolUse.length, 1);
  assert.equal(cleanedClaude.hooks.PreToolUse[0].matcher, 'Write');
  assert.equal(cleanedClaude.statusLine, undefined);
  assert.deepEqual(cleanedClaude.permissions, { allow: ['Read'] });
  assert.match(fs.readFileSync(kimi, 'utf8'), /model = "keep"/);
  assert.doesNotMatch(fs.readFileSync(kimi, 'utf8'), /orca-managed/);
  assert.match(fs.readFileSync(hermesConfig, 'utf8'), /keep-plugin/);
  assert.doesNotMatch(fs.readFileSync(hermesConfig, 'utf8'), /orca-status/);

  const second = cleanOrcaResidue(context, { includeAppData: true, includeVoiceData: true });
  assert.equal(second.errors.length, 0);
  assert(second.actions.every((item) => item.action === 'skipped'));
});

test('Windows 사용자 PATH에서는 공식 설치 경로만 식별한다', () => {
  const root = makeSandbox('windows-path');
  const localAppData = path.join(root, 'AppData', 'Local');
  const official = path.join(localAppData, 'Programs', 'orca', 'resources', 'bin');
  const unrelated = path.join(root, 'tools', 'orca');
  const context = buildContext({
    platform: 'win32', home: path.join(root, 'home'),
    env: { LOCALAPPDATA: localAppData }, userPath: `${unrelated};${official}`,
    backupRoot: path.join(root, 'backup'), cliCandidates: [], appDataCandidates: [], voiceCandidates: [],
  });
  const findings = scanOrcaResidue(context).filter((item) => item.kind === 'path-entry');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rawPathEntry, official);
  const preview = cleanOrcaResidue(context, { dryRun: true });
  assert(preview.actions.some((item) => item.kind === 'path-entry' && item.action === 'would-edit'));
});

test('macOS 앱 데이터와 검증된 CLI 런처를 격리한다', () => {
  const root = makeSandbox('mac');
  const home = path.join(root, 'home');
  const cli = path.join(home, '.local', 'bin', 'orca');
  const appData = [
    path.join(home, 'Library', 'Application Support', 'Orca'),
    path.join(home, 'Library', 'Caches', 'Orca'),
    path.join(home, 'Library', 'Logs', 'Orca'),
    path.join(home, 'Library', 'Preferences', 'com.stablyai.orca.plist'),
    path.join(home, 'Library', 'Saved Application State', 'com.stablyai.orca.savedState'),
  ];
  const context = buildContext({ platform: 'darwin', home, backupRoot: path.join(root, 'backup'), cliCandidates: [cli], appDataCandidates: appData });
  const fakeTarget = path.join(root, 'Applications', 'Orca.app', 'Contents', 'Resources', 'bin', 'orca');
  write(fakeTarget, '#!/bin/sh\n');
  write(cli, `#!/bin/sh\nexec "${fakeTarget}" "$@" # Managed by Orca\n`);
  write(path.join(appData[0], 'speech-models', 'model.bin'), 'voice');
  write(appData[3], 'plist');
  write(path.join(home, '.gemini', 'skills', 'orchestration', 'SKILL.md'), 'github.com/stablyai/orca');

  const result = cleanOrcaResidue(context, { includeAppData: true });
  assert.equal(result.errors.length, 0);
  assert(!exists(cli));
  assert(exists(fakeTarget));
  assert(!exists(appData[0]));
  assert(!exists(appData[3]));
  assert(!exists(path.join(home, '.gemini', 'skills', 'orchestration')));
});

test('macOS launcher 내용이 Orca를 가리키지 않으면 보존한다', () => {
  const root = makeSandbox('mac-unrelated-cli');
  const cli = path.join(root, 'home', '.local', 'bin', 'orca');
  write(cli, '#!/bin/sh\necho unrelated\n');
  const context = fakeContext(root, 'darwin', { cliCandidates: [cli], appDataCandidates: [], voiceCandidates: [] });
  assert(!scanOrcaResidue(context).some((item) => item.kind === 'cli'));
  cleanOrcaResidue(context, {});
  assert(exists(cli));
});
