import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildContext,
  cleanOrcaResidue,
  HOME_SKILL_ROOTS,
  OFFICIAL_ORCA_SKILLS,
  PROJECT_SKILL_ROOTS,
  scanOrcaResidue,
} from '../scripts/orca-cleanup-core.mjs';

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
    customVoicePaths: extras.customVoicePaths || [],
    sharedStateCandidates: extras.sharedStateCandidates,
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
  write(path.join(home, '.hermes', 'plugins', 'orca-status', 'README.md'),
    'Managed by Orca. Do not edit; changes may be overwritten.');
  write(path.join(home, '.orca', 'openai-speech-token.enc'), 'secret');
  write(path.join(context.appDataCandidates[0], 'settings.json'), '{}');
  write(path.join(context.voiceCandidates[0], '0123456789abcdef', 'whisper-tiny', 'model.bin'), 'voice');
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
  assert(exists(path.join(home, '.orca')));
  assert(!exists(path.join(home, '.orca', 'openai-speech-token.enc')));
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

test('프로젝트 잠금 출처는 다른 프로젝트의 동명 스킬에 전파되지 않는다', () => {
  const root = makeSandbox('scoped-lock');
  const projectA = path.join(root, 'project-a');
  const projectB = path.join(root, 'project-b');
  writeJson(path.join(projectA, '.agents', '.skill-lock.json'), {
    skills: { 'computer-use': { source: 'stablyai/orca' } },
  });
  write(path.join(projectA, '.agents', 'skills', 'computer-use', 'SKILL.md'), '# lock-proven copy');
  write(path.join(projectB, '.agents', 'skills', 'computer-use', 'SKILL.md'), '# unrelated provider');
  const context = fakeContext(root, 'win32', { projects: [projectA, projectB] });
  const skills = scanOrcaResidue(context).filter((item) => item.kind === 'skill');
  assert.equal(skills.length, 1);
  assert.equal(skills[0].path, path.join(projectA, '.agents', 'skills', 'computer-use'));
  cleanOrcaResidue(context, {});
  assert(!exists(path.join(projectA, '.agents', 'skills', 'computer-use')));
  assert(exists(path.join(projectB, '.agents', 'skills', 'computer-use')));
});

test('유사한 출처 URL과 일반 ~/.orca 작업물은 자동 정리하지 않는다', () => {
  const root = makeSandbox('collisions');
  const context = fakeContext(root, 'win32');
  writeJson(path.join(context.home, '.agents', '.skill-lock.json'), {
    skills: { 'computer-use': { sourceUrl: 'https://example.test/stablyai/orca-evil' } },
  });
  const skill = path.join(context.home, '.agents', 'skills', 'computer-use');
  write(path.join(skill, 'SKILL.md'), '# unrelated computer use\nsource: https://example.test/stablyai/orca-evil');
  const worktree = path.join(context.home, '.orca', 'worktrees', 'important.txt');
  write(worktree, 'user work');
  const unrelatedHook = path.join(context.home, '.claude', 'settings.json');
  writeJson(unrelatedHook, { statusLine: { command: 'my-orca-status --safe' } });
  const unrelatedHermes = path.join(context.home, '.hermes', 'config.yaml');
  write(unrelatedHermes, 'plugins:\n  enabled:\n    - orca-status\n');

  const findings = scanOrcaResidue(context);
  assert(!findings.some((item) => item.path === skill));
  assert(!findings.some((item) => item.path === path.join(context.home, '.orca')));
  assert(!findings.some((item) => item.path === unrelatedHook));
  assert(!findings.some((item) => item.path === unrelatedHermes));
  cleanOrcaResidue(context, {});
  assert(exists(skill));
  assert(exists(worktree));
  assert(exists(unrelatedHook));
  assert(exists(unrelatedHermes));
});

test('서명이 없는 사용자 지정 음성 폴더와 홈 경로는 격리하지 않는다', () => {
  const root = makeSandbox('custom-voice');
  const custom = path.join(root, 'my-audio');
  write(path.join(custom, 'recording.wav'), 'user audio');
  const context = fakeContext(root, 'win32', { customVoicePaths: [custom] });
  const result = cleanOrcaResidue(context, { includeVoiceData: true });
  assert(exists(path.join(custom, 'recording.wav')));
  assert(result.actions.some((item) => item.kind === 'unverified' && item.action === 'skipped'));

  const dangerous = buildContext({
    platform: 'win32', home: path.join(root, 'danger-home'),
    customVoicePaths: [path.join(root, 'danger-home')], voiceCandidates: [],
    sharedStateCandidates: [], appDataCandidates: [], cliCandidates: [], userPath: '',
    backupRoot: path.join(root, 'backup-danger'),
  });
  write(path.join(dangerous.home, 'whisper-tiny', 'model.bin'), 'looks like a model');
  const refused = cleanOrcaResidue(dangerous, { includeVoiceData: true });
  assert.equal(refused.errors.length, 1);
  assert(exists(path.join(dangerous.home, 'whisper-tiny', 'model.bin')));
});

test('백업 폴더가 정리 대상 내부면 작업을 거부한다', () => {
  const root = makeSandbox('nested-backup');
  const home = path.join(root, 'home');
  const hooks = path.join(home, '.orca', 'agent-hooks');
  write(path.join(hooks, 'hook.cmd'), 'ORCA_AGENT_HOOK');
  const context = buildContext({
    platform: 'win32', home, sharedStateCandidates: [hooks],
    appDataCandidates: [], voiceCandidates: [], cliCandidates: [], userPath: '',
    backupRoot: path.join(hooks, 'backup'),
  });
  const result = cleanOrcaResidue(context, {});
  assert.equal(result.errors.length, 1);
  assert(exists(path.join(hooks, 'hook.cmd')));
});

test('macOS 앱 데이터와 검증된 CLI 런처를 격리한다', () => {
  const root = makeSandbox('mac');
  const home = path.join(root, 'home');
  const cli = path.join(home, '.local', 'bin', 'orca');
  const appData = [
    path.join(home, 'Library', 'Application Support', 'Orca'),
    path.join(home, 'Library', 'Caches', 'com.stablyai.orca'),
    path.join(home, 'Library', 'Caches', 'com.stablyai.orca.ShipIt'),
    path.join(home, 'Library', 'HTTPStorages', 'com.stablyai.orca'),
    path.join(home, 'Library', 'Preferences', 'com.stablyai.orca.plist'),
    path.join(home, 'Library', 'Saved Application State', 'com.stablyai.orca.savedState'),
  ];
  const context = buildContext({ platform: 'darwin', home, backupRoot: path.join(root, 'backup'), cliCandidates: [cli], appDataCandidates: appData });
  const fakeTarget = path.join(root, 'Applications', 'Orca.app', 'Contents', 'Resources', 'bin', 'orca');
  write(fakeTarget, '#!/bin/sh\n');
  write(cli, `#!/bin/sh\nexec "${fakeTarget}" "$@" # Managed by Orca\n`);
  write(path.join(appData[0], 'speech-models', 'model.bin'), 'voice');
  write(appData[4], 'plist');
  write(path.join(home, '.gemini', 'skills', 'orchestration', 'SKILL.md'), 'github.com/stablyai/orca');

  const result = cleanOrcaResidue(context, { includeAppData: true });
  assert.equal(result.errors.length, 0);
  assert(!exists(cli));
  assert(exists(fakeTarget));
  assert(!exists(appData[0]));
  assert(!exists(appData[4]));
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

test('Orca 공식 스킬 발견 루트를 모두 포함한다', () => {
  assert.deepEqual(HOME_SKILL_ROOTS, [
    '.codex/skills',
    '.agents/skills',
    '.claude/skills',
    '.grok/skills',
    '.config/opencode/skills',
    '.pi/agent/skills',
    '.omp/agent/skills',
    '.hermes/skills',
    '.prime/agent/skills',
    '.gemini/skills',
    '.gemini/antigravity/skills',
    '.cursor/skills',
    '.factory/skills',
    '.continue/skills',
    '.trae-cn/skills',
    '.augment/skills',
  ]);
  assert.deepEqual(PROJECT_SKILL_ROOTS, [
    '.agents/skills',
    '.claude/skills',
    '.factory/skills',
    '.continue/skills',
    '.trae/skills',
    '.grok/skills',
    '.augment/skills',
  ]);
});

test('새로 추가된 홈·프로젝트 스킬 루트의 공식 스킬을 격리한다', () => {
  const root = makeSandbox('new-skill-roots');
  const project = path.join(root, 'project');
  const context = fakeContext(root, 'linux', { projects: [project], appDataCandidates: [], voiceCandidates: [] });
  const hermesSkill = path.join(context.home, '.hermes', 'skills', 'orchestration', 'SKILL.md');
  const factorySkill = path.join(project, '.factory', 'skills', 'orca-cli', 'SKILL.md');
  write(hermesSkill, 'Use ORCA skills get orchestration\n');
  write(factorySkill, 'github.com/stablyai/orca\n');
  write(path.join(context.home, '.hermes', 'skills', 'unrelated', 'SKILL.md'), '# keep');

  const skills = scanOrcaResidue(context).filter((item) => item.kind === 'skill');
  assert.equal(skills.length, 2);
  cleanOrcaResidue(context, {});
  assert(!exists(path.dirname(hermesSkill)));
  assert(!exists(path.dirname(factorySkill)));
  assert(exists(path.join(context.home, '.hermes', 'skills', 'unrelated', 'SKILL.md')));
});

test('Linux orca-ide와 관리형 dispatcher만 격리하고 GNOME Orca는 보존한다', () => {
  const root = makeSandbox('linux-cli');
  const home = path.join(root, 'home');
  const orcaIde = path.join(home, '.local', 'bin', 'orca-ide');
  const dispatcher = path.join(home, '.local', 'bin', 'orca');
  const gnomeOrca = path.join(root, 'usr', 'bin', 'orca');
  const appData = path.join(home, '.config', 'Orca');
  write(orcaIde, '#!/bin/sh\nexec /opt/Orca/resources/bin/orca-ide "$@"\n# stablyai/orca\n');
  write(dispatcher, '#!/usr/bin/env bash\n# orca-serve-bare-orca-dispatcher\nexec orca-ide "$@"\n');
  write(gnomeOrca, '#!/bin/sh\necho GNOME screen reader\n');
  write(path.join(appData, 'orca-data.json'), '{}');

  const context = buildContext({
    platform: 'linux',
    home,
    backupRoot: path.join(root, 'backup'),
    cliCandidates: [orcaIde, dispatcher, gnomeOrca],
    appDataCandidates: [appData],
    voiceCandidates: [],
  });
  const findings = scanOrcaResidue(context);
  assert(findings.some((item) => item.path === orcaIde && item.kind === 'cli'));
  assert(findings.some((item) => item.path === dispatcher && item.kind === 'cli'));
  assert(!findings.some((item) => item.path === gnomeOrca));

  const result = cleanOrcaResidue(context, { includeAppData: true });
  assert.equal(result.errors.length, 0);
  assert(!exists(orcaIde));
  assert(!exists(dispatcher));
  assert(exists(gnomeOrca));
  assert(!exists(appData));
});

test('Linux orca-ide 심볼릭 링크가 공식 런처를 가리키면 격리한다', () => {
  const root = makeSandbox('linux-cli-link');
  const home = path.join(root, 'home');
  const orcaIde = path.join(home, '.local', 'bin', 'orca-ide');
  const launcher = path.join(root, 'opt', 'Orca', 'resources', 'bin', 'orca-ide');
  write(launcher, '#!/bin/sh\n');
  fs.mkdirSync(path.dirname(orcaIde), { recursive: true });
  try {
    fs.symlinkSync(launcher, orcaIde);
  } catch {
    return;
  }
  const context = buildContext({
    platform: 'linux',
    home,
    backupRoot: path.join(root, 'backup'),
    cliCandidates: [orcaIde],
    appDataCandidates: [],
    voiceCandidates: [],
  });
  const result = cleanOrcaResidue(context, {});
  assert.equal(result.errors.length, 0);
  assert(!exists(orcaIde));
  assert(exists(launcher));
});
