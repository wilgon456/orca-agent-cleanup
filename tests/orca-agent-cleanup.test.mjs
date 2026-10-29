import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildContext,
  cleanOrcaResidue,
  HOME_SKILL_ROOTS,
  internals,
  OFFICIAL_ORCA_SKILLS,
  PROJECT_SKILL_ROOTS,
  restoreOrcaBackup,
  scanOrcaResidue,
  verifyOrcaBackup,
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

test('공식 manifest의 10개 스킬 이름을 모두 포함한다', () => {
  assert.deepEqual(OFFICIAL_ORCA_SKILLS, [
    'computer-use', 'jira-tickets', 'linear-tickets', 'orca-cli', 'orca-emulator',
    'orca-emulator-android', 'orca-jira', 'orca-linear', 'orca-per-workspace-env', 'orchestration',
  ]);
});

test('최신 Jira 스킬은 출처가 확인될 때만 격리하고 복원한다', () => {
  const root = makeSandbox('jira-skills');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const signed = path.join(context.home, '.claude', 'skills', 'jira-tickets');
  const locked = path.join(context.home, '.agents', 'skills', 'orca-jira');
  const unrelated = path.join(context.home, '.codex', 'skills', 'jira-tickets');
  write(path.join(signed, 'SKILL.md'), 'Use ORCA skills get jira-tickets.\n');
  write(path.join(locked, 'SKILL.md'), 'A bundled skill verified by its lock entry.\n');
  write(path.join(unrelated, 'SKILL.md'), 'Unrelated Jira skill by another provider.\n');
  writeJson(path.join(context.home, '.agents', '.skill-lock.json'), {
    skills: { 'orca-jira': { source: 'stablyai/orca' } },
  });

  const findings = scanOrcaResidue(context);
  assert(findings.some((item) => item.kind === 'skill' && item.path === signed));
  assert(findings.some((item) => item.kind === 'skill' && item.path === locked));
  assert(!findings.some((item) => item.path === unrelated));
  const preview = cleanOrcaResidue(context, { dryRun: true });
  assert(preview.actions.some((item) => item.path === signed && item.action === 'would-quarantine'));
  assert(exists(signed) && exists(locked) && exists(unrelated));
  const cleaned = cleanOrcaResidue(context, {});
  assert.equal(cleaned.errors.length, 0);
  assert(!exists(signed) && !exists(locked) && exists(unrelated));
  const manifest = path.join(context.backupRoot, 'manifest.json');
  assert.equal(verifyOrcaBackup(manifest, { platform: 'linux' }).valid, true);
  assert.equal(restoreOrcaBackup(manifest, { home: context.home, platform: 'linux' }).errors.length, 0);
  assert(exists(signed) && exists(locked) && exists(unrelated));
});

test('새 에이전트 스킬 경로와 지정 홈에서도 Orca 출처만 탐지한다', () => {
  const root = makeSandbox('provider-skill-roots');
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const kiroHome = path.join(root, 'kiro-custom');
  const openClaudeHome = path.join(root, 'openclaude-custom');
  const context = buildContext({
    platform: 'linux', home, projects: [project],
    env: { KIRO_HOME: kiroHome, OPENCLAUDE_CONFIG_DIR: openClaudeHome },
    backupRoot: path.join(root, 'backup'), cliCandidates: [], appDataCandidates: [], voiceCandidates: [],
  });
  const owned = [
    path.join(home, '.codebuddy', 'skills', 'jira-tickets'),
    path.join(home, '.kiro', 'skills', 'orca-jira'),
    path.join(home, '.openclaude', 'skills', 'jira-tickets'),
    path.join(project, '.codebuddy', 'skills', 'orca-jira'),
    path.join(project, '.kiro', 'skills', 'jira-tickets'),
    path.join(project, '.openclaude', 'skills', 'orca-jira'),
    path.join(kiroHome, 'skills', 'jira-tickets'),
    path.join(openClaudeHome, 'skills', 'orca-jira'),
  ];
  for (const target of owned) write(path.join(target, 'SKILL.md'), 'Run ORCA skills get jira-tickets.\n');
  const unrelated = path.join(home, '.openclaude', 'skills', 'orca-jira');
  write(path.join(unrelated, 'SKILL.md'), 'A different provider owns this skill.\n');

  const findings = scanOrcaResidue(context);
  for (const target of owned) assert(findings.some((item) => item.kind === 'skill' && item.path === target), target);
  assert(!findings.some((item) => item.path === unrelated));
  const cleaned = cleanOrcaResidue(context, {});
  assert.equal(cleaned.errors.length, 0);
  for (const target of owned) assert(!exists(target), target);
  assert(exists(unrelated));
  const manifest = path.join(context.backupRoot, 'manifest.json');
  assert.equal(verifyOrcaBackup(manifest, { platform: 'linux' }).valid, true);
  assert.equal(restoreOrcaBackup(manifest, { home, platform: 'linux' }).errors.length, 0);
  for (const target of owned) assert(exists(target), target);
  assert(exists(unrelated));
});

test('같은 밀리초에 생성한 복원 작업 ID도 충돌하지 않는다', () => {
  const now = new Date('2026-08-30T09:34:19.040Z');
  const ids = Array.from({ length: 128 }, () => internals.operationId(now));
  assert.equal(new Set(ids).size, ids.length);
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
  assert(!exists(context.backupRoot));
});

test('비어 있지 않은 백업 폴더는 원본과 기존 백업을 건드리지 않고 거부한다', () => {
  const root = makeSandbox('occupied-backup');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const skill = path.join(context.home, '.agents', 'skills', 'orca-cli');
  write(path.join(skill, 'SKILL.md'), 'github.com/stablyai/orca\n');
  write(path.join(context.backupRoot, 'keep.txt'), 'existing backup');

  const result = cleanOrcaResidue(context, {});
  assert.equal(result.errors.length, 1);
  assert(exists(skill));
  assert.equal(fs.readFileSync(path.join(context.backupRoot, 'keep.txt'), 'utf8'), 'existing backup');
  assert(!exists(path.join(context.backupRoot, 'manifest.json')));
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
    '.gemini/config/skills',
    '.gemini/antigravity/skills',
    '.cursor/skills',
    '.factory/skills',
    '.continue/skills',
    '.trae-cn/skills',
    '.augment/skills',
    '.config/muse/skills',
    '.zcode/skills',
    '.codebuddy/skills',
    '.kiro/skills',
    '.openclaude/skills',
  ]);
  assert.deepEqual(PROJECT_SKILL_ROOTS, [
    '.agents/skills',
    '.claude/skills',
    '.factory/skills',
    '.continue/skills',
    '.trae/skills',
    '.grok/skills',
    '.augment/skills',
    '.codebuddy/skills',
    '.kiro/skills',
    '.openclaude/skills',
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

test('Linux AppImage 추출 캐시는 include-app-data에서만 격리한다', () => {
  const root = makeSandbox('linux-appimage-cache');
  const context = fakeContext(root, 'linux');
  const appImageCache = path.join(context.home, '.cache', 'orca', 'appimage');
  write(path.join(appImageCache, 'launcher', 'orca-ide'), '# orca-appimage-stable-launcher\n');

  const finding = scanOrcaResidue(context).find((item) => item.path === appImageCache);
  assert(finding);
  assert.equal(finding.requires, 'includeAppData');
  cleanOrcaResidue(context, {});
  assert(exists(appImageCache));
  cleanOrcaResidue(context, { includeAppData: true });
  assert(!exists(appImageCache));
});

test('Codex 플러그인 캐시에서는 서명된 Orca 스킬만 격리한다', () => {
  const root = makeSandbox('codex-plugin-cache');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const pluginCache = path.join(context.home, '.codex', 'plugins', 'cache');
  context.pluginCacheRoots = [pluginCache];
  const orcaSkill = path.join(pluginCache, 'stablyai', 'orca', '1.0.0', 'skills', 'orca-cli');
  const orcaJira = path.join(pluginCache, 'stablyai', 'orca', '1.0.0', 'skills', 'jira-tickets');
  const unrelated = path.join(pluginCache, 'example', 'plugin', '1.0.0', 'skills', 'computer-use');
  const unrelatedJira = path.join(pluginCache, 'example', 'plugin', '1.0.0', 'skills', 'jira-tickets');
  write(path.join(orcaSkill, 'SKILL.md'), 'Use `ORCA skills get orca-cli` for the current guide.\n');
  write(path.join(orcaJira, 'SKILL.md'), 'Use `ORCA skills get jira-tickets` for the current guide.\n');
  write(path.join(unrelated, 'SKILL.md'), 'Generic computer automation skill.\n');
  write(path.join(unrelatedJira, 'SKILL.md'), 'A Jira skill from another provider.\n');

  const findings = scanOrcaResidue(context);
  const orcaSkillIdentity = context.filesystemIdentity(orcaSkill);
  const unrelatedIdentity = context.filesystemIdentity(unrelated);
  assert(findings.some((item) => (
    context.filesystemIdentity(item.path) === orcaSkillIdentity && item.kind === 'skill'
  )));
  assert(!findings.some((item) => context.filesystemIdentity(item.path) === unrelatedIdentity));
  assert(findings.some((item) => item.kind === 'skill'
    && context.filesystemIdentity(item.path) === context.filesystemIdentity(orcaJira)));
  assert(!findings.some((item) => context.filesystemIdentity(item.path) === context.filesystemIdentity(unrelatedJira)));
  cleanOrcaResidue(context, {});
  assert(!exists(orcaSkill));
  assert(!exists(orcaJira));
  assert(exists(unrelated));
  assert(exists(unrelatedJira));
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
  context.backupRoot = path.join(root, 'backup-full-state');
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
  const manifestValue = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  assert.equal(manifestValue.manifestVersion, 2);
  assert.equal(manifestValue.cleanupStatus, 'complete');
  assert(manifestValue.actions.filter((item) => ['quarantined', 'edited'].includes(item.action))
    .every((item) => item.backupIntegrity?.algorithm === 'sha256'));
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

test('verify는 백업 내용 변경을 감지하고 restore가 손상 백업을 거부한다', () => {
  const root = makeSandbox('verify-integrity');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const skill = path.join(context.home, '.agents', 'skills', 'orca-cli');
  write(path.join(skill, 'SKILL.md'), 'github.com/stablyai/orca\noriginal\n');
  cleanOrcaResidue(context, {});
  const manifestPath = path.join(context.backupRoot, 'manifest.json');
  const verified = verifyOrcaBackup(manifestPath, { platform: 'linux' });
  assert.equal(verified.valid, true);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const backup = manifest.actions.find((item) => item.path === skill).backup;
  write(path.join(backup, 'SKILL.md'), 'tampered backup\n');

  const invalid = verifyOrcaBackup(manifestPath, { platform: 'linux' });
  assert.equal(invalid.valid, false);
  const restored = restoreOrcaBackup(manifestPath, { home: context.home, platform: 'linux' });
  assert.equal(restored.errors.length, 1);
  assert(!exists(skill));
});

test('중단 상태의 pending quarantine도 manifest로 안전하게 복구한다', () => {
  const root = makeSandbox('pending-recovery');
  const context = fakeContext(root, 'linux', { appDataCandidates: [], voiceCandidates: [] });
  const skill = path.join(context.home, '.agents', 'skills', 'orca-cli');
  write(path.join(skill, 'SKILL.md'), 'github.com/stablyai/orca\nrecover me\n');
  cleanOrcaResidue(context, {});
  const manifestPath = path.join(context.backupRoot, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.cleanupStatus = 'in-progress';
  manifest.actions = manifest.actions.map((item) => item.path === skill
    ? { ...item, action: 'pending-quarantine', backupIntegrity: undefined }
    : item);
  writeJson(manifestPath, internals.signedCleanupManifest({
    manifestVersion: manifest.manifestVersion,
    createdAt: manifest.createdAt,
    platform: manifest.platform,
    backupRoot: manifest.backupRoot,
    cleanupStatus: manifest.cleanupStatus,
    actions: manifest.actions,
    errors: manifest.errors,
  }));

  const restored = restoreOrcaBackup(manifestPath, { home: context.home, platform: 'linux' });
  assert.equal(restored.errors.length, 0);
  assert.match(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8'), /recover me/);
});

test('기본 백업 경로는 같은 초에 만들어도 서로 다르다', () => {
  const root = makeSandbox('unique-backup-root');
  const first = buildContext({ platform: 'linux', home: path.join(root, 'home'), env: {} });
  const second = buildContext({ platform: 'linux', home: path.join(root, 'home'), env: {} });
  assert.notEqual(first.backupRoot, second.backupRoot);
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

// Orca 1.4.214 src/main/claude/hook-settings.ts getWindowsPowerShellLifecycleCommand와 같은 모양.
function windowsPowerShellHook(scriptFileName) {
  return `$scriptPath = Join-Path $env:USERPROFILE '.orca\\agent-hooks\\${scriptFileName}'; `
    + 'if (Test-Path -LiteralPath $scriptPath -PathType Leaf) { & $scriptPath; exit $LASTEXITCODE }; '
    + "[Console]::In.ReadToEnd() | Out-Null; Write-Output '{}'; exit 0";
}

function encodedPowerShell(command) {
  const encoded = Buffer.from(command, 'utf16le').toString('base64');
  return `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
}

function isolatedContext(root, platform, extras = {}) {
  return buildContext({
    platform,
    home: path.join(root, 'home'),
    env: { XDG_CONFIG_HOME: '', CODEX_HOME: '', KIRO_HOME: '', JCODE_HOME: '', DSH_HOME: '', ...extras.env },
    backupRoot: path.join(root, extras.backupName || 'backup'),
    cliCandidates: [],
    appDataCandidates: [],
    voiceCandidates: [],
    userPath: '',
    runtime: extras.runtime,
    stopProcess: extras.stopProcess,
  });
}

test('PowerShell·base64로 감싼 Windows 훅 명령도 Orca 훅으로 식별한다', () => {
  const powershell = windowsPowerShellHook('qwen-code-hook.cmd');
  assert.equal(internals.isOrcaHookString(powershell), true);
  assert.equal(internals.isOrcaHookString(encodedPowerShell(powershell)), true);
  assert.equal(internals.isOrcaHookString('C:/Users/me/.orca/agent-hooks/orca-agent-hook.exe claude'), true);
  assert.equal(internals.isOrcaHookString('if [ -f "${HOME-}/.orca/agent-hooks/codebuddy-hook.sh" ]; then :; fi'), true);
  assert.equal(internals.isOrcaHookString(encodedPowerShell("Write-Output 'my hook'")), false);
  assert.equal(internals.isOrcaHookString('C:/tools/my.orca/agent-hooks/run.cmd'), false);
  assert.equal(internals.isOrcaHookString('C:/tools/agent-hooks/run.cmd'), false);
});

test('Orca 1.4.214의 새 에이전트 훅에서 Orca 항목만 지우고 복원할 수 있다', () => {
  const root = makeSandbox('new-agents');
  const context = isolatedContext(root, 'win32');
  const home = context.home;
  const userHook = { matcher: '*', hooks: [{ type: 'command', command: 'node C:/tools/audit.js' }] };
  const qwen = path.join(home, '.qwen', 'settings.json');
  const codebuddy = path.join(home, '.codebuddy', 'settings.json');
  const qoderCn = path.join(home, '.qoder-cn', 'settings.json');
  const zcode = path.join(home, '.zcode', 'cli', 'config.json');
  const kiroAgent = path.join(home, '.kiro', 'agents', 'reviewer.json');
  const kiroPlain = path.join(home, '.kiro', 'agents', 'plain.json');
  const muse = path.join(home, '.config', 'muse', 'settings.json');
  const jcode = path.join(home, '.jcode', 'config.toml');
  const dshOnly = path.join(home, '.dsh', 'cordis.patch.yml');
  const openCode = path.join(home, '.config', 'opencode');
  const tui = path.join(openCode, 'tui.json');
  const statusPlugin = path.join(openCode, 'plugins', 'orca-opencode-status.js');
  const tuiPlugin = path.join(openCode, 'plugins', 'orca-opencode-status-tui');
  const userPlugin = path.join(openCode, 'plugins', 'my-plugin.js');
  const credentials = ['linear-token.enc', 'jira-tokens', 'zcode-plan-api-key.enc', 'opencode-go-api-key.enc']
    .map((name) => path.join(home, '.orca', name));
  const keybindings = path.join(home, '.orca', 'keybindings.json');

  writeJson(qwen, {
    model: { name: 'qwen3-coder' },
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: windowsPowerShellHook('qwen-code-hook.cmd'), shell: 'powershell', timeout: 30 }] },
        userHook,
      ],
    },
  });
  writeJson(codebuddy, {
    hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: encodedPowerShell(windowsPowerShellHook('codebuddy-hook.cmd')) }] }] },
    theme: 'dark',
  });
  writeJson(qoderCn, {
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${home.replaceAll('\\', '/')}/.orca/agent-hooks/qoder-cn-hook.cmd` }] }] },
  });
  writeJson(zcode, {
    hooks: { enabled: true, events: { Stop: [{ type: 'command', command: 'C:/Users/me/.orca/agent-hooks/zcode-hook.cmd' }] } },
    provider: 'keep',
  });
  writeJson(kiroAgent, {
    name: 'reviewer',
    hooks: { agentSpawn: [{ command: 'C:/Users/me/.orca/agent-hooks/kiro-hook.cmd' }, { command: 'echo mine' }] },
  });
  writeJson(kiroPlain, { name: 'plain', hooks: { stop: [{ command: 'echo mine' }] } });
  writeJson(muse, {
    schema_version: 1,
    managed_hooks_path: path.join(home, '.orca', 'agent-hooks', 'muse-hooks.json'),
    managed_hooks_env_vars: ['ORCA_AGENT_HOOK_PORT', 'ORCA_PANE_KEY', 'USERPROFILE', 'MY_VAR'],
    editor: 'vim',
  });
  write(jcode, [
    '[model]',
    'name = "jcode-pro"',
    '',
    '[hooks]',
    `session_start = "${path.join(home, '.orca', 'agent-hooks', 'jcode-hook.cmd').replaceAll('\\', '\\\\')}"`,
    'turn_end = "C:\\\\tools\\\\notify.cmd"',
    '',
    '[ui]',
    'theme = "dark"',
    '',
  ].join('\r\n'));
  write(dshOnly, [
    '# >>> orca-managed-dsh-hooks (managed by Orca; do not edit) >>>',
    '- insert:',
    '    - id: orca-agent-hooks',
    "      name: '@deepseek-ai/dsh-hooks-claude-code'",
    '      config:',
    "        configPath: 'C:\\Users\\me\\.orca\\agent-hooks\\dsh-hooks.json'",
    '# <<< orca-managed-dsh-hooks <<<',
    '',
  ].join('\n'));
  write(statusPlugin, 'if (process.env.ORCA_OPENCODE_AGENT && process.env.ORCA_OPENCODE_AGENT !== "opencode") return {};\n');
  write(path.join(tuiPlugin, 'tui.js'), 'const ORCA_STATUS_AGENT = "opencode";\n');
  write(userPlugin, 'export default {};\n');
  writeJson(tui, {
    theme: 'tokyonight',
    plugin: [`file:///${tuiPlugin.replaceAll('\\', '/').replaceAll(' ', '%20')}/tui.js`, 'my-tui-plugin'],
  });
  for (const credential of credentials) write(credential, 'secret');
  writeJson(keybindings, { 'ctrl+k': 'palette' });

  const scanned = scanOrcaResidue(context);
  const hookPaths = scanned.filter((item) => item.kind === 'hook').map((item) => item.path);
  for (const target of [qwen, codebuddy, qoderCn, zcode, kiroAgent, muse, jcode, dshOnly, tui, statusPlugin, tuiPlugin]) {
    assert(hookPaths.includes(path.resolve(target)), `탐지 누락: ${target}`);
  }
  assert(!hookPaths.includes(path.resolve(kiroPlain)));
  assert(!hookPaths.includes(path.resolve(userPlugin)));
  const sharedPaths = scanned.filter((item) => item.kind === 'shared-state').map((item) => item.path);
  for (const credential of credentials) assert(sharedPaths.includes(path.resolve(credential)));
  assert(!sharedPaths.includes(path.resolve(keybindings)));

  const before = Object.fromEntries([qwen, jcode, dshOnly, muse, tui].map((file) => [file, fs.readFileSync(file, 'utf8')]));
  const result = cleanOrcaResidue(context, {});
  assert.deepEqual(result.errors, []);

  assert.deepEqual(JSON.parse(fs.readFileSync(qwen, 'utf8')), { model: { name: 'qwen3-coder' }, hooks: { Stop: [userHook] } });
  assert.deepEqual(JSON.parse(fs.readFileSync(codebuddy, 'utf8')), { theme: 'dark' });
  assert.deepEqual(JSON.parse(fs.readFileSync(qoderCn, 'utf8')), {});
  assert.deepEqual(JSON.parse(fs.readFileSync(zcode, 'utf8')), { hooks: { enabled: true }, provider: 'keep' });
  assert.deepEqual(JSON.parse(fs.readFileSync(kiroAgent, 'utf8')).hooks, { agentSpawn: [{ command: 'echo mine' }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(muse, 'utf8')), {
    schema_version: 1, managed_hooks_env_vars: ['USERPROFILE', 'MY_VAR'], editor: 'vim',
  });
  const jcodeAfter = fs.readFileSync(jcode, 'utf8');
  assert.doesNotMatch(jcodeAfter, /jcode-hook/);
  assert.match(jcodeAfter, /turn_end = "C:\\\\tools\\\\notify\.cmd"\r\n/);
  assert.match(jcodeAfter, /\[ui\]\r\ntheme = "dark"/);
  assert.equal(fs.readFileSync(dshOnly, 'utf8'), '[]\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(tui, 'utf8')), { theme: 'tokyonight', plugin: ['my-tui-plugin'] });
  assert(!exists(statusPlugin) && !exists(tuiPlugin) && exists(userPlugin));
  assert(credentials.every((credential) => !exists(credential)));
  assert(exists(keybindings));

  const second = cleanOrcaResidue(isolatedContext(root, 'win32', { backupName: 'backup-2' }), { dryRun: true });
  assert.deepEqual(second.findings.filter((item) => item.kind === 'hook'), []);

  const restored = restoreOrcaBackup(path.join(context.backupRoot, 'manifest.json'), { home, platform: 'win32' });
  assert.deepEqual(restored.errors, []);
  for (const [file, text] of Object.entries(before)) assert.equal(fs.readFileSync(file, 'utf8'), text);
  assert(exists(statusPlugin) && exists(path.join(tuiPlugin, 'tui.js')));
  assert(credentials.every((credential) => exists(credential)));
});

test('dsh 블록 밖의 사용자 패치와 짝 없는 시작 표식은 보존한다', () => {
  const root = makeSandbox('dsh');
  const context = isolatedContext(root, 'linux');
  const patch = path.join(context.home, '.dsh', 'cordis.patch.yml');
  write(patch, [
    '# >>> orca-managed-dsh-hooks (managed by Orca; do not edit) >>>',
    '- insert:',
    '    - id: mine-before',
    '# >>> orca-managed-dsh-hooks (managed by Orca; do not edit) >>>',
    '- insert:',
    '    - id: orca-agent-hooks',
    '# <<< orca-managed-dsh-hooks <<<',
    '- insert:',
    '    - id: mine-after',
    '',
  ].join('\n'));
  const result = cleanOrcaResidue(context, {});
  assert.deepEqual(result.errors, []);
  assert.equal(fs.readFileSync(patch, 'utf8'), [
    '# >>> orca-managed-dsh-hooks (managed by Orca; do not edit) >>>',
    '- insert:',
    '    - id: mine-before',
    '- insert:',
    '    - id: mine-after',
    '',
  ].join('\n'));
});

test('jcode는 [hooks] 표 밖이나 여러 줄 문자열 속 Orca 경로를 지우지 않는다', () => {
  const text = [
    '[notes]',
    'body = """',
    '[hooks]',
    'session_start = "/home/me/.orca/agent-hooks/jcode-hook.sh"',
    '"""',
    'other = "/home/me/.orca/agent-hooks/jcode-hook.sh"',
    '[hooks.extra]',
    'turn_end = "/home/me/.orca/agent-hooks/jcode-hook.sh"',
    '[hooks]',
    "pre_tool = '/home/me/.orca/agent-hooks/jcode-hook.sh' # managed",
    'post_tool = "/usr/local/bin/mine"',
  ].join('\n');
  assert.deepEqual([...internals.jcodeManagedHookLines(text)], [9]);
});

test('Muse·OpenCode는 사용자 설정만 있으면 손대지 않는다', () => {
  const root = makeSandbox('muse-opencode');
  const context = isolatedContext(root, 'darwin');
  const muse = path.join(context.home, '.config', 'muse', 'settings.json');
  const tui = path.join(context.home, '.config', 'opencode', 'tui.json');
  const lookalike = path.join(context.home, '.config', 'opencode', 'plugins', 'orca-opencode-status.js');
  writeJson(muse, { schema_version: 1, managed_hooks_path: '/home/me/hooks/muse.json', managed_hooks_env_vars: ['ORCA_PANE_KEY'] });
  writeJson(tui, { plugin: ['file:///home/me/plugins/orca-opencode-status-tui-fork/tui.js'] });
  write(lookalike, 'export default {}; // 사용자가 같은 이름으로 만든 파일\n');
  const findings = scanOrcaResidue(context).filter((item) => item.kind === 'hook');
  assert.deepEqual(findings, []);
});

function windowsRuntimeSandbox(name) {
  const root = makeSandbox(name);
  const env = {
    LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
    APPDATA: path.join(root, 'AppData', 'Roaming'),
  };
  return { root, env };
}

test('Orca 앱이 설치·실행 중이면 clean을 멈추고 --force로만 진행한다', () => {
  const { root, env } = windowsRuntimeSandbox('installed');
  const installDir = path.join(env.LOCALAPPDATA, 'Programs', 'orca');
  const runtime = {
    installations: [installDir],
    processes: [{ pid: 4242, name: 'Orca.exe', path: path.join(installDir, 'Orca.exe') }],
  };
  const context = isolatedContext(root, 'win32', { env, runtime });
  const settings = path.join(context.home, '.claude', 'settings.json');
  writeJson(settings, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'C:/Users/me/.orca/agent-hooks/claude-hook.cmd' }] }] } });

  const kinds = scanOrcaResidue(context).map((item) => item.kind);
  assert(kinds.includes('app-installed') && kinds.includes('app-running'));

  const blocked = cleanOrcaResidue(context, {});
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.errors.length, 1);
  assert.match(fs.readFileSync(settings, 'utf8'), /agent-hooks/);
  assert(!exists(context.backupRoot));

  const preview = cleanOrcaResidue(context, { dryRun: true });
  assert.equal(preview.blocked, true);
  assert(preview.actions.some((item) => item.action === 'would-edit'));

  const forced = cleanOrcaResidue(isolatedContext(root, 'win32', { env, runtime, backupName: 'forced' }), { force: true });
  assert.equal(forced.blocked, false);
  assert.deepEqual(forced.errors, []);
  assert.doesNotMatch(fs.readFileSync(settings, 'utf8'), /agent-hooks/);
});

test('앱 없이 남은 Orca 데몬만 골라 --stop-processes일 때 끈다', () => {
  const { root, env } = windowsRuntimeSandbox('daemon');
  const daemon = path.join(env.LOCALAPPDATA, 'Orca', 'daemon-host', 'abc123', 'Orca.exe');
  const runtime = {
    installations: [],
    processes: [
      { pid: 101, name: 'Orca.exe', path: daemon },
      { pid: 102, name: 'orca-terminal-daemon.exe', path: 'D:/old/orca-terminal-daemon.exe' },
      { pid: 103, name: 'Code.exe', path: path.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe') },
      { pid: 104, name: 'orca.exe', path: 'C:/tools/orca-screen-reader/orca.exe' },
      { pid: process.pid, name: 'node.exe', path: path.join(env.LOCALAPPDATA, 'Orca', 'node.exe') },
    ],
  };
  const stopped = [];
  const context = isolatedContext(root, 'win32', { env, runtime, stopProcess: (pid) => stopped.push(pid) });

  const processes = scanOrcaResidue(context).filter((item) => item.kind === 'process');
  assert.deepEqual(processes.map((item) => item.pid).sort(), [101, 102]);
  assert(processes.every((item) => item.requires === 'stopProcesses'));

  const skipped = cleanOrcaResidue(context, {});
  assert.deepEqual(stopped, []);
  assert(skipped.actions.filter((item) => item.kind === 'process').every((item) => item.action === 'skipped'));

  const preview = cleanOrcaResidue(context, { dryRun: true, stopProcesses: true });
  assert.deepEqual(stopped, []);
  assert.equal(preview.actions.filter((item) => item.action === 'would-stop').length, 2);

  const result = cleanOrcaResidue(isolatedContext(root, 'win32', {
    env, runtime, backupName: 'stop', stopProcess: (pid) => stopped.push(pid),
  }), { stopProcesses: true });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(stopped.sort(), [101, 102]);
  assert.equal(result.actions.filter((item) => item.action === 'stopped').length, 2);
});

test('Orca 항목만 있던 Copilot·Grok 훅 파일은 껍데기 없이 격리하고 복원한다', () => {
  const root = makeSandbox('owned-files');
  const context = isolatedContext(root, 'linux', { env: { COPILOT_HOME: '', GROK_HOME: '' } });
  const copilot = path.join(context.home, '.copilot', 'hooks', 'orca.json');
  const grok = path.join(context.home, '.grok', 'hooks', 'orca-status.json');
  const orcaHook = (script) => ({ type: 'command', bash: `/home/me/.orca/agent-hooks/${script}` });
  writeJson(copilot, { version: 1, hooks: { sessionStart: [orcaHook('copilot-hook.sh')] } });
  writeJson(grok, {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: '/home/me/.orca/agent-hooks/grok-hook.sh' }] }],
      Stop: [{ hooks: [{ type: 'command', command: '/usr/local/bin/my-notify' }] }],
    },
  });
  const copilotBefore = fs.readFileSync(copilot, 'utf8');

  const findings = scanOrcaResidue(context).filter((item) => item.kind === 'hook');
  assert.equal(findings.find((item) => item.path === path.resolve(copilot)).removeWhole, true);
  assert.equal(findings.find((item) => item.path === path.resolve(grok)).removeWhole, false);

  const result = cleanOrcaResidue(context, {});
  assert.deepEqual(result.errors, []);
  assert(!exists(copilot));
  assert.deepEqual(JSON.parse(fs.readFileSync(grok, 'utf8')), {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: '/usr/local/bin/my-notify' }] }] },
  });

  const restored = restoreOrcaBackup(path.join(context.backupRoot, 'manifest.json'), { home: context.home, platform: 'linux' });
  assert.deepEqual(restored.errors, []);
  assert.equal(fs.readFileSync(copilot, 'utf8'), copilotBefore);
  assert.match(fs.readFileSync(grok, 'utf8'), /grok-hook\.sh/);
});

test('CLI 버전과 npm 패키지 정보가 일치하고 배포 파일이 모두 있다', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const cli = spawnSync(process.execPath, [path.join(root, pkg.bin['orca-agent-cleanup']), '--version'], { encoding: 'utf8' });
  assert.equal(cli.status, 0);
  assert.equal(cli.stdout.trim(), pkg.version);
  for (const file of pkg.files) assert(exists(path.join(root, file)), `배포 파일 없음: ${file}`);
  assert.match(fs.readFileSync(path.join(root, pkg.bin['orca-agent-cleanup']), 'utf8'), /^#!\/usr\/bin\/env node/);
});
