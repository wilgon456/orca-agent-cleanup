import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildContext,
  cleanOrcaResidue,
  HOME_SKILL_ROOTS,
  internals,
  OFFICIAL_ORCA_SKILLS,
  PROJECT_SKILL_ROOTS,
  restoreOrcaBackup,
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
  assert(findings.some((item) => item.path === path.join(context.home, '.orca')
    && item.kind === 'user-state' && item.requires === 'includeUserState'));
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

test('macOS 대소문자 별칭이 같은 실제 앱 데이터 경로면 한 번만 검사한다', () => {
  const root = makeSandbox('mac-case-alias');
  const upper = path.join(root, 'Library', 'Application Support', 'Orca');
  const lower = path.join(root, 'Library', 'Application Support', 'orca');
  write(path.join(upper, 'state.json'), '{}');
  write(path.join(lower, 'state.json'), '{}');
  const context = buildContext({
    platform: 'darwin', home: path.join(root, 'home'), backupRoot: path.join(root, 'backup'),
    cliCandidates: [], voiceCandidates: [], appDataCandidates: [upper, lower],
    filesystemIdentity: () => 'real:/same/Application Support/Orca',
  });
  const findings = scanOrcaResidue(context).filter((item) => item.kind === 'app-data');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, upper);
});

test('macOS 기본 대소문자 비구분 파일시스템에서 앱 데이터 별칭을 한 번만 격리한다', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('macOS 실제 파일시스템 검증');
    return;
  }
  const root = makeSandbox('mac-real-case-alias');
  const upper = path.join(root, 'Application Support', 'Orca');
  const lower = path.join(root, 'Application Support', 'orca');
  write(path.join(upper, 'state.json'), '{}');
  if (!exists(lower) || fs.realpathSync.native(upper) !== fs.realpathSync.native(lower)) {
    t.skip('대소문자 구분 볼륨');
    return;
  }
  const context = buildContext({
    platform: 'darwin', home: path.join(root, 'home'), backupRoot: path.join(root, 'backup'),
    cliCandidates: [], voiceCandidates: [], appDataCandidates: [upper, lower],
  });
  const result = cleanOrcaResidue(context, { includeAppData: true });
  assert.equal(result.errors.length, 0);
  assert.equal(result.actions.filter((item) => item.kind === 'app-data').length, 1);
  assert(!exists(upper));
  assert(!exists(lower));
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

test('Windows 사용자 지정 설치 PATH는 공식 launcher 쌍이 확인될 때만 식별한다', () => {
  const root = makeSandbox('windows-custom-path');
  const customBin = path.join(root, 'Custom Orca', 'resources', 'bin');
  const unrelatedBin = path.join(root, 'Unrelated', 'bin');
  write(path.join(customBin, 'orca.cmd'), [
    '@echo off',
    'REM native Orca CLI launcher',
    'echo orca.cmd cannot safely forward orchestration message bodies.',
  ].join('\n'));
  write(path.join(customBin, 'orca.exe'), 'binary');
  write(path.join(unrelatedBin, 'orca.cmd'), 'echo unrelated');
  write(path.join(unrelatedBin, 'orca.exe'), 'binary');
  const context = buildContext({
    platform: 'win32', home: path.join(root, 'home'), env: {},
    userPath: `${unrelatedBin};${customBin}`, backupRoot: path.join(root, 'backup'),
    cliCandidates: [], appDataCandidates: [], voiceCandidates: [],
  });
  const entries = scanOrcaResidue(context).filter((item) => item.kind === 'path-entry');
  assert.deepEqual(entries.map((item) => item.rawPathEntry), [customBin]);
});

test('Linux 소문자 앱 데이터와 updater 캐시는 include-app-data에서만 격리한다', () => {
  const root = makeSandbox('linux-new-app-data');
  const home = path.join(root, 'home');
  const lowerConfig = path.join(home, '.xdg-config', 'orca');
  const updater = path.join(home, '.xdg-cache', 'orca-updater');
  const context = buildContext({
    platform: 'linux',
    home,
    env: { XDG_CONFIG_HOME: path.join(home, '.xdg-config'), XDG_CACHE_HOME: path.join(home, '.xdg-cache') },
    backupRoot: path.join(root, 'backup'),
    cliCandidates: [],
    voiceCandidates: [],
    appDataCandidates: [lowerConfig, updater],
  });
  write(path.join(lowerConfig, 'runtime.json'), '{}');
  write(path.join(updater, 'pending', 'update'), 'binary');

  const findings = scanOrcaResidue(context);
  assert(findings.some((item) => item.path === lowerConfig && item.requires === 'includeAppData'));
  assert(findings.some((item) => item.path === updater && item.requires === 'includeAppData'));
  cleanOrcaResidue(context, {});
  assert(exists(lowerConfig));
  assert(exists(updater));
  cleanOrcaResidue(context, { includeAppData: true });
  assert(!exists(lowerConfig));
  assert(!exists(updater));
});

test('사용자 지정 에이전트 홈의 Skills와 Kimi·Hermes 훅을 정리한다', () => {
  const root = makeSandbox('custom-agent-homes');
  const home = path.join(root, 'home');
  const claudeHome = path.join(root, 'claude-profile');
  const grokHome = path.join(root, 'grok-profile');
  const hermesHome = path.join(root, 'hermes-profile');
  const kimiHome = path.join(root, 'kimi-profile');
  const context = buildContext({
    platform: 'linux', home,
    env: {
      CLAUDE_CONFIG_DIR: claudeHome,
      GROK_HOME: grokHome,
      HERMES_HOME: hermesHome,
      KIMI_CODE_HOME: kimiHome,
    },
    backupRoot: path.join(root, 'backup'), cliCandidates: [], appDataCandidates: [], voiceCandidates: [],
  });
  write(path.join(claudeHome, 'skills', 'orca-cli', 'SKILL.md'), 'github.com/stablyai/orca\n');
  write(path.join(grokHome, 'skills', 'orchestration', 'SKILL.md'), 'ORCA skills get orchestration\n');
  write(path.join(hermesHome, 'skills', 'orca-linear', 'SKILL.md'), 'github.com/stablyai/orca\n');
  write(path.join(hermesHome, 'plugins', 'orca-status', 'README.md'),
    'Managed by Orca. Do not edit; changes may be overwritten.\n');
  write(path.join(hermesHome, 'config.yaml'), 'plugins:\n  enabled:\n    - keep\n    - orca-status\n');
  write(path.join(kimiHome, 'config.toml'),
    `model = "keep"\n${'# >>> orca-managed-kimi-hooks (managed by Orca; do not edit) >>>'}\n[hooks]\ncommand="orca"\n# <<< orca-managed-kimi-hooks <<<\n`);

  const result = cleanOrcaResidue(context, {});
  assert.equal(result.errors.length, 0);
  assert(!exists(path.join(claudeHome, 'skills', 'orca-cli')));
  assert(!exists(path.join(grokHome, 'skills', 'orchestration')));
  assert(!exists(path.join(hermesHome, 'skills', 'orca-linear')));
  assert(!exists(path.join(hermesHome, 'plugins', 'orca-status')));
  assert.match(fs.readFileSync(path.join(hermesHome, 'config.yaml'), 'utf8'), /keep/);
  assert.doesNotMatch(fs.readFileSync(path.join(hermesHome, 'config.yaml'), 'utf8'), /orca-status/);
  assert.doesNotMatch(fs.readFileSync(path.join(kimiHome, 'config.toml'), 'utf8'), /orca-managed/);
});

test('마커가 확인된 Pi 계열 확장과 Orca 트랜잭션 잔재만 격리한다', () => {
  const root = makeSandbox('extensions-transactions');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const managedExtension = path.join(context.home, '.pi', 'agent', 'extensions', 'orca-agent-status.ts');
  const userExtension = path.join(context.home, '.omp', 'agent', 'extensions', 'orca-prefill.ts');
  const skillRoot = path.join(context.home, '.agents', 'skills');
  const transaction = path.join(skillRoot, '.orca-cli.orca-placement-staging-test');
  const unrelated = path.join(skillRoot, '.my-skill.backup-test');
  const staleLock = path.join(context.home, '.orca', 'managed-hook-install.owner-test.json');
  write(managedExtension, '// @orca-managed-pi-extension\n');
  write(userExtension, '// user-owned file with a colliding name\n');
  write(path.join(transaction, 'SKILL.md'), 'temporary');
  write(path.join(unrelated, 'data'), 'keep');
  write(staleLock, '{}');

  cleanOrcaResidue(context, {});
  assert(!exists(managedExtension));
  assert(exists(userExtension));
  assert(!exists(transaction));
  assert(!exists(staleLock));
  assert(exists(unrelated));
});

test('Codex 레거시 블록만 제거하고 다른 TOML 설정은 보존한다', () => {
  const root = makeSandbox('codex-legacy');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const mixed = path.join(context.home, '.codex', 'config.toml');
  const onlyManaged = path.join(context.home, '.codex', 'orca-agent-status.config.toml');
  write(mixed, 'model = "keep"\n\n# BEGIN ORCA AGENT STATUS HOOKS\n[hooks]\ncommand="orca"\n# END ORCA AGENT STATUS HOOKS\n');
  write(onlyManaged, '# BEGIN ORCA AGENT STATUS HOOKS\n[hooks]\ncommand="orca"\n# END ORCA AGENT STATUS HOOKS\n');

  const result = cleanOrcaResidue(context, {});
  assert.equal(result.errors.length, 0);
  assert.match(fs.readFileSync(mixed, 'utf8'), /model = "keep"/);
  assert.doesNotMatch(fs.readFileSync(mixed, 'utf8'), /ORCA AGENT STATUS/);
  assert(!exists(onlyManaged));
});

test('전체 사용자 상태는 명시적 옵션에서만 하나의 복구 단위로 격리한다', () => {
  const root = makeSandbox('full-user-state');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const state = path.join(context.home, '.orca');
  write(path.join(state, 'agent-hooks', 'hook.sh'), 'ORCA_AGENT_HOOK');
  write(path.join(state, 'sessions', 'session.json'), '{}');
  write(path.join(state, 'credentials.enc'), 'secret');

  cleanOrcaResidue(context, {});
  assert(exists(state));
  const preview = cleanOrcaResidue(context, { dryRun: true, includeUserState: true });
  assert(preview.actions.some((item) => item.path === state && item.action === 'would-quarantine'));
  assert(preview.actions.some((item) => item.kind === 'remote-state' && item.action === 'covered'));
  cleanOrcaResidue(context, { includeUserState: true });
  assert(!exists(state));
});

test('WSL과 원격 홈은 각각의 명시적 옵션 없이 정리하지 않는다', () => {
  const root = makeSandbox('scoped-homes');
  const wslHome = path.join(root, 'wsl-home');
  const remoteHome = path.join(root, 'remote-home');
  const context = buildContext({
    platform: 'win32', home: path.join(root, 'home'),
    wslHomes: [wslHome], remoteHomes: [remoteHome],
    env: {}, backupRoot: path.join(root, 'backup'),
    cliCandidates: [], appDataCandidates: [], voiceCandidates: [], userPath: '',
  });
  write(path.join(wslHome, '.orca-wsl', 'hook-relay', '1', 'relay'), 'binary');
  write(path.join(wslHome, '.agents', 'skills', 'orca-cli', 'SKILL.md'), 'github.com/stablyai/orca\n');
  writeJson(path.join(wslHome, '.claude', 'settings.json'), {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: `${wslHome}/.orca-wsl/agent-hooks/stop.sh` }] }] },
    model: 'keep',
  });
  write(path.join(remoteHome, '.orca-remote', 'relay-1', 'relay.js'), 'code');
  write(path.join(remoteHome, '.orca-relay', 'bin', 'orca'), '# Managed by Orca\n');

  let result = cleanOrcaResidue(context, {});
  assert(result.actions.some((item) => item.kind === 'wsl-state' && item.action === 'skipped'));
  assert(result.actions.some((item) => item.kind === 'remote-state' && item.action === 'skipped'));
  assert(exists(path.join(wslHome, '.orca-wsl')));
  assert(exists(path.join(remoteHome, '.orca-remote')));

  result = cleanOrcaResidue(context, { includeWsl: true, includeRemote: true });
  assert.equal(result.errors.length, 0);
  assert(!exists(path.join(wslHome, '.orca-wsl')));
  assert(!exists(path.join(wslHome, '.agents', 'skills', 'orca-cli')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(wslHome, '.claude', 'settings.json'), 'utf8')), { model: 'keep' });
  assert(!exists(path.join(remoteHome, '.orca-remote')));
  assert(!exists(path.join(remoteHome, '.orca-relay')));
});

test('프로젝트 Orca 상태는 project-state 옵션에서만 격리한다', () => {
  const root = makeSandbox('project-state');
  const project = path.join(root, 'workspace', 'project');
  const projectState = path.join(project, '.orca');
  const worktreeTrash = path.join(root, 'workspace', '.orca-worktree-trash');
  write(path.join(projectState, 'drops', 'note.md'), 'drop');
  write(path.join(worktreeTrash, 'old-worktree', 'file'), 'source');
  const context = fakeContext(root, 'linux', {
    projects: [project], appDataCandidates: [], voiceCandidates: [],
  });

  cleanOrcaResidue(context, {});
  assert(exists(projectState));
  assert(exists(worktreeTrash));
  cleanOrcaResidue(context, { includeProjectState: true });
  assert(!exists(projectState));
  assert(!exists(worktreeTrash));
});

test('restore는 격리 파일과 수정 전 설정을 manifest 기준으로 복원한다', () => {
  const root = makeSandbox('restore');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const skill = path.join(context.home, '.agents', 'skills', 'orca-cli');
  const settings = path.join(context.home, '.claude', 'settings.json');
  write(path.join(skill, 'SKILL.md'), 'github.com/stablyai/orca\noriginal skill\n');
  writeJson(settings, {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: `${context.home}/.orca/agent-hooks/stop.sh` }] }] },
    model: 'keep',
  });
  const cleaned = cleanOrcaResidue(context, {});
  assert.equal(cleaned.errors.length, 0);
  const manifest = path.join(context.backupRoot, 'manifest.json');
  assert(!exists(skill));
  assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { model: 'keep' });

  const preview = restoreOrcaBackup(manifest, { dryRun: true, home: context.home, platform: context.platform });
  assert(preview.actions.every((item) => ['would-restore', 'already-restored'].includes(item.action)));
  assert(!exists(skill));

  const restored = restoreOrcaBackup(manifest, { home: context.home, platform: context.platform });
  assert.equal(restored.errors.length, 0);
  assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /original skill/);
  assert.match(fs.readFileSync(settings, 'utf8'), /agent-hooks/);
  assert(exists(restored.reportPath));

  const second = restoreOrcaBackup(manifest, { home: context.home, platform: context.platform });
  assert.equal(second.errors.length, 0);
  assert(second.actions.every((item) => item.action === 'already-restored'));
});

test('restore는 복원 위치의 새 파일을 충돌 백업으로 보존한다', () => {
  const root = makeSandbox('restore-conflict');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const skill = path.join(context.home, '.agents', 'skills', 'orca-cli');
  write(path.join(skill, 'SKILL.md'), 'github.com/stablyai/orca\noriginal\n');
  cleanOrcaResidue(context, {});
  write(path.join(skill, 'SKILL.md'), 'new user copy\n');

  const result = restoreOrcaBackup(path.join(context.backupRoot, 'manifest.json'), {
    home: context.home, platform: context.platform,
  });
  assert.equal(result.errors.length, 0);
  const action = result.actions.find((item) => item.path === skill);
  assert.equal(action.action, 'restored');
  assert(action.conflictBackup);
  assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /original/);
  assert.match(fs.readFileSync(path.join(action.conflictBackup, 'SKILL.md'), 'utf8'), /new user copy/);
});

test('restore는 manifest 밖의 백업 경로를 거부한다', () => {
  const root = makeSandbox('restore-unsafe');
  const backupRoot = path.join(root, 'backup');
  const outside = path.join(root, 'outside.txt');
  const target = path.join(root, 'target.txt');
  const manifest = path.join(backupRoot, 'manifest.json');
  write(outside, 'do not restore');
  writeJson(manifest, internals.signedCleanupManifest({
    manifestVersion: 1,
    createdAt: new Date().toISOString(),
    platform: 'linux',
    backupRoot,
    actions: [{ action: 'quarantined', kind: 'cli', path: target, backup: outside }],
    errors: [],
  }));

  const result = restoreOrcaBackup(manifest, { home: path.join(root, 'home'), platform: 'linux' });
  assert.equal(result.errors.length, 1);
  assert(!exists(target));
  assert(exists(outside));
});

test('restore는 수정되거나 운영체제가 다른 manifest를 거부한다', () => {
  const root = makeSandbox('restore-integrity');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const skill = path.join(context.home, '.agents', 'skills', 'orca-cli');
  write(path.join(skill, 'SKILL.md'), 'github.com/stablyai/orca\n');
  cleanOrcaResidue(context, {});
  const manifestPath = path.join(context.backupRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.actions[0].path = path.join(root, 'tampered-target');
  writeJson(manifestPath, manifest);

  assert.throws(() => restoreOrcaBackup(manifestPath, {
    home: context.home, platform: context.platform,
  }), /무결성 검증/);
  manifest.actions[0].path = skill;
  const resigned = internals.signedCleanupManifest({
    manifestVersion: manifest.manifestVersion,
    createdAt: manifest.createdAt,
    platform: manifest.platform,
    backupRoot: manifest.backupRoot,
    actions: manifest.actions,
    errors: manifest.errors,
  });
  writeJson(manifestPath, resigned);
  assert.throws(() => restoreOrcaBackup(manifestPath, {
    home: context.home, platform: 'darwin',
  }), /운영체제가 현재 복원 환경과 다릅니다/);
});

test('restore는 서명되어도 대상과 맞지 않는 백업 매핑을 거부한다', () => {
  const root = makeSandbox('restore-mapping');
  const backupRoot = path.join(root, 'backup');
  const target = path.join(root, 'target', 'orca');
  const wrongBackup = path.join(backupRoot, 'cli', 'wrong-location');
  const manifestPath = path.join(backupRoot, 'manifest.json');
  write(wrongBackup, 'launcher');
  writeJson(manifestPath, internals.signedCleanupManifest({
    manifestVersion: 1,
    createdAt: new Date().toISOString(),
    platform: 'linux',
    backupRoot,
    actions: [{ action: 'quarantined', kind: 'cli', path: target, backup: wrongBackup }],
    errors: [],
  }));

  const result = restoreOrcaBackup(manifestPath, { home: path.join(root, 'home'), platform: 'linux' });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /매핑이 일치하지 않습니다/);
  assert(!exists(target));
});

test('restore는 Windows PATH 원본과 현재 값을 모두 보존한다', () => {
  const root = makeSandbox('restore-path');
  const backupRoot = path.join(root, 'backup');
  const pathBackup = path.join(backupRoot, 'config-original', 'windows-user-path.txt');
  const manifest = path.join(backupRoot, 'manifest.json');
  write(pathBackup, 'C:\\Original;C:\\Tools\n');
  writeJson(manifest, internals.signedCleanupManifest({
    manifestVersion: 1,
    createdAt: new Date().toISOString(),
    platform: 'win32',
    backupRoot,
    actions: [{
      action: 'edited', kind: 'path-entry', path: 'C:\\Orca\\resources\\bin', backup: pathBackup,
    }],
    errors: [],
  }));
  let currentPath = 'C:\\Current;C:\\Tools';
  const result = restoreOrcaBackup(manifest, {
    home: path.join(root, 'home'),
    platform: 'win32',
    readUserPath: () => currentPath,
    writeUserPath: (value) => { currentPath = value; },
  });
  assert.equal(result.errors.length, 0);
  assert.equal(currentPath, 'C:\\Original;C:\\Tools');
  assert.equal(fs.readFileSync(result.actions[0].conflictBackup, 'utf8').trim(), 'C:\\Current;C:\\Tools');
});
