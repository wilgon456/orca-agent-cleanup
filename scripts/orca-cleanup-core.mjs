import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

export const OFFICIAL_ORCA_SKILLS = Object.freeze([
  'computer-use',
  'linear-tickets',
  'orca-cli',
  'orca-emulator',
  'orca-emulator-android',
  'orca-linear',
  'orca-per-workspace-env',
  'orchestration',
]);

// Orca src/main/skills/skill-discovery-sources.ts 기준 사용자 홈 스킬 루트.
export const HOME_SKILL_ROOTS = Object.freeze([
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

// Orca가 프로젝트에서 추가로 검사하는 스킬 루트.
export const PROJECT_SKILL_ROOTS = Object.freeze([
  '.agents/skills',
  '.claude/skills',
  '.factory/skills',
  '.continue/skills',
  '.trae/skills',
  '.grok/skills',
  '.augment/skills',
]);

const LINUX_CLI_DISPATCHER_MARKER = '# orca-serve-bare-orca-dispatcher';
const LINUX_CLI_COMMAND_NAME = 'orca-ide';
const PI_EXTENSION_MARKER = '@orca-managed-pi-extension';
const CODEX_LEGACY_START = '# BEGIN ORCA AGENT STATUS HOOKS';
const CODEX_LEGACY_END = '# END ORCA AGENT STATUS HOOKS';

const ORCA_SOURCE_PATTERN = /(?:^|[\s/:])stablyai\/orca(?:\.git)?(?:$|[\s/#?])/i;
const ORCA_SKILL_SIGNATURES = [
  ORCA_SOURCE_PATTERN,
  /\bORCA\s+skills\s+get\b/i,
  /\bEngage\s+Orca\b/i,
  /Use Orca(?:'s|’s)? computer-use CLI/i,
];
const ORCA_HOOK_PATTERN = /(?:[\\/]\.orca(?:-wsl|-relay)?[\\/]agent-hooks[\\/]|ORCA_AGENT_HOOK)/i;
const MANAGED_FILE_PATTERN = /Managed by Orca\. Do not edit; changes may be overwritten\./i;
const KIMI_START = '# >>> orca-managed-kimi-hooks (managed by Orca; do not edit) >>>';
const KIMI_END = '# <<< orca-managed-kimi-hooks <<<';
const ORCA_VOICE_MODEL_IDS = new Set([
  'parakeet-tdt-0.6b-v3-int8',
  'parakeet-tdt-0.6b-v2-int8',
  'zipformer-bilingual-zh-en',
  'paraformer-bilingual-zh-en',
  'zipformer-streaming-en-20m',
  'zipformer-streaming-zh-14m',
  'zipformer-streaming-korean',
  'parakeet-tdt-ctc-0.6b-ja-int8',
  'whisper-tiny',
  'sense-voice-zh-en-ja-ko-yue',
]);

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => path.resolve(value)))];
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function readText(target) {
  try {
    return fs.readFileSync(target, 'utf8');
  } catch {
    return '';
  }
}

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

function defaultHomeSkillRoots(home) {
  return HOME_SKILL_ROOTS.map((relative) => path.join(home, ...relative.split('/')));
}

function existingFilesystemIdentity(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return `link:${path.resolve(target)}`;
    const real = fs.realpathSync.native(target);
    return `real:${process.platform === 'win32' ? real.toLowerCase() : real}`;
  } catch {
    return `path:${path.resolve(target)}`;
  }
}

function environmentSkillRoots(platform, home, env) {
  const roots = [
    env.CLAUDE_CONFIG_DIR && path.join(env.CLAUDE_CONFIG_DIR, 'skills'),
    env.GROK_HOME && path.join(env.GROK_HOME, 'skills'),
    env.HERMES_HOME && path.join(env.HERMES_HOME, 'skills'),
  ];
  if (platform === 'win32' && env.LOCALAPPDATA) {
    roots.push(path.join(env.LOCALAPPDATA, 'hermes', 'skills'));
  }
  return unique(roots);
}

function defaultProjectSkillRoots(projects) {
  return projects.flatMap((project) => PROJECT_SKILL_ROOTS.map((relative) => path.join(project, ...relative.split('/'))));
}

function defaultHookCandidates(home, env) {
  const kimiHome = env.KIMI_CODE_HOME || path.join(home, '.kimi-code');
  const hermesHomes = unique([
    env.HERMES_HOME,
    path.join(home, '.hermes'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'hermes'),
  ]);
  const candidates = [
    ['json', path.join(home, '.claude', 'settings.json')],
    ['json', path.join(home, '.openclaude', 'settings.json')],
    ['json', path.join(home, '.codex', 'hooks.json')],
    ['json', path.join(home, '.gemini', 'settings.json')],
    ['json', path.join(home, '.gemini', 'config', 'hooks.json')],
    ['json', path.join(home, '.cursor', 'hooks.json')],
    ['json', path.join(home, '.commandcode', 'settings.json')],
    ['json', path.join(home, '.factory', 'settings.json')],
    ['json', path.join(env.COPILOT_HOME || path.join(home, '.copilot'), 'hooks', 'orca.json')],
    ['json', path.join(env.GROK_HOME || path.join(home, '.grok'), 'hooks', 'orca-status.json')],
    ['json', path.join(home, '.config', 'devin', 'config.json')],
    ['kimi', path.join(kimiHome, 'config.toml')],
    ['amp', path.join(home, '.config', 'amp', 'plugins', 'orca-agent-status.ts')],
    ['codex-legacy', path.join(home, '.codex', 'orca-agent-status.config.toml')],
    ['codex-legacy', path.join(home, '.codex', 'config.toml')],
  ];
  for (const hermesHome of hermesHomes) {
    candidates.push(['hermes', path.join(hermesHome, 'plugins', 'orca-status')]);
    candidates.push(['hermes-config', path.join(hermesHome, 'config.yaml')]);
  }
  if (env.APPDATA) candidates.push(['json', path.join(env.APPDATA, 'Devin', 'config.json')]);
  return candidates.map(([type, filePath]) => ({ type, path: filePath }));
}

function defaultExtensionCandidates(home) {
  const files = [
    ['.pi', 'orca-agent-status.ts'],
    ['.pi', 'orca-prefill.ts'],
    ['.pi', 'orca-titlebar-spinner.ts'],
    ['.omp', 'orca-agent-status.ts'],
    ['.omp', 'orca-prefill.ts'],
    ['.omp', 'orca-titlebar-spinner.ts'],
    ['.prime', 'orca-agent-status.ts'],
  ];
  return files.map(([agent, name]) => path.join(home, agent, 'agent', 'extensions', name));
}

function defaultAppDataCandidates(platform, home, env) {
  if (platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Orca'),
      path.join(home, 'Library', 'Application Support', 'orca'),
      path.join(home, 'Library', 'Caches', 'com.stablyai.orca'),
      path.join(home, 'Library', 'Caches', 'com.stablyai.orca.ShipIt'),
      path.join(home, 'Library', 'Caches', 'orca-updater'),
      path.join(home, 'Library', 'HTTPStorages', 'com.stablyai.orca'),
      path.join(home, 'Library', 'Preferences', 'com.stablyai.orca.plist'),
      path.join(home, 'Library', 'Saved Application State', 'com.stablyai.orca.savedState'),
    ];
  }
  if (platform === 'win32') {
    return [
      env.APPDATA && path.join(env.APPDATA, 'Orca'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Orca'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'orca-updater'),
    ].filter(Boolean);
  }
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const cacheHome = env.XDG_CACHE_HOME || path.join(home, '.cache');
  return unique([
    path.join(configHome, 'Orca'),
    path.join(configHome, 'orca'),
    path.join(cacheHome, 'Orca'),
    path.join(cacheHome, 'orca-updater'),
    path.join(home, '.config', 'Orca'),
    path.join(home, '.config', 'orca'),
    path.join(home, '.cache', 'Orca'),
    path.join(home, '.cache', 'orca-updater'),
  ]);
}

function defaultVoiceCandidates(platform, env) {
  if (platform !== 'win32') return [];
  const roots = [
    env.PROGRAMDATA,
    env.ProgramData,
    env.ALLUSERSPROFILE,
    env.PUBLIC && path.join(env.PUBLIC, 'Documents'),
    env.PUBLIC,
    env.SystemDrive && path.join(env.SystemDrive, 'ProgramData'),
    'C:\\ProgramData',
  ];
  return unique(roots.map((root) => root && path.join(root, 'Orca', 'speech-models')));
}

function readWindowsUserPath(platform) {
  if (platform !== 'win32' || process.platform !== 'win32') return '';
  const script = "[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); [Environment]::GetEnvironmentVariable('Path','User')";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function decodeProcessOutput(value) {
  if (!value) return '';
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const hasNul = buffer.subarray(0, Math.min(buffer.length, 256)).includes(0);
  return buffer.toString(hasNul ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
}

function discoverRunningWslHomes(platform) {
  if (platform !== 'win32' || process.platform !== 'win32') return [];
  try {
    const listed = spawnSync('wsl.exe', ['--list', '--running', '--quiet'], {
      windowsHide: true,
      timeout: 8000,
    });
    if (listed.status !== 0) return [];
    const distros = decodeProcessOutput(listed.stdout).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    const homes = [];
    for (const distro of distros) {
      const probed = spawnSync('wsl.exe', ['-d', distro, '--', 'sh', '-lc', 'printf %s "$HOME"'], {
        windowsHide: true,
        timeout: 8000,
      });
      const linuxHome = decodeProcessOutput(probed.stdout).trim();
      if (probed.status !== 0 || !/^\/(?:[^\0\\]+)$/.test(linuxHome) || linuxHome.includes('..')) continue;
      const relative = linuxHome.replace(/^\/+/, '').split('/');
      homes.push(path.join(`\\\\wsl.localhost\\${distro}`, ...relative));
    }
    return unique(homes);
  } catch {
    return [];
  }
}

function isWindowsOrcaPathEntry(entry, context) {
  if (context.platform !== 'win32') return false;
  const expanded = entry.replace(/%([^%]+)%/g, (_, name) => context.env[name] || context.env[name.toUpperCase()] || `%${name}%`);
  const candidate = path.normalize(expanded.replace(/^"|"$/g, '')).replace(/[\\/]+$/, '');
  const normalized = candidate.toLowerCase();
  const expected = context.env.LOCALAPPDATA
    ? path.normalize(path.join(context.env.LOCALAPPDATA, 'Programs', 'orca', 'resources', 'bin')).toLowerCase()
    : '';
  if (expected && normalized === expected) return true;
  const wrapper = path.join(candidate, 'orca.cmd');
  const launcher = path.join(candidate, 'orca.exe');
  const wrapperText = readText(wrapper);
  return pathExists(launcher)
    && /native Orca CLI launcher/i.test(wrapperText)
    && /orca\.cmd cannot safely forward orchestration message bodies/i.test(wrapperText);
}

export function buildContext(overrides = {}) {
  const platform = overrides.platform || process.platform;
  const home = path.resolve(overrides.home || os.homedir());
  const env = { ...process.env, ...(overrides.env || {}) };
  const projects = unique(overrides.projects || []);
  const explicitWslHomes = unique(overrides.wslHomes || []);
  const wslHomes = unique([
    ...explicitWslHomes,
    ...(overrides.includeWsl && explicitWslHomes.length === 0 ? discoverRunningWslHomes(platform) : []),
  ]);
  const remoteHomes = unique(overrides.remoteHomes || []);
  const scopedHomes = [
    ...wslHomes.map((scopedHome) => ({ home: scopedHome, requires: 'includeWsl' })),
    ...remoteHomes.map((scopedHome) => ({ home: scopedHome, requires: 'includeRemote' })),
  ];
  const homeSkillRoots = overrides.homeSkillRoots || unique([
    ...defaultHomeSkillRoots(home),
    ...environmentSkillRoots(platform, home, env),
  ]);
  const projectSkillRoots = defaultProjectSkillRoots(projects);
  const scopedSkillRoots = scopedHomes.flatMap((scope) => defaultHomeSkillRoots(scope.home)
    .map((root) => ({ root, requires: scope.requires })));
  const skillRootRequirements = new Map(scopedSkillRoots.map((item) => [path.resolve(item.root), item.requires]));
  const lockFiles = overrides.lockFiles || unique([
    path.join(home, '.agents', '.skill-lock.json'),
    ...projects.map((project) => path.join(project, '.agents', '.skill-lock.json')),
    ...scopedHomes.map((scope) => path.join(scope.home, '.agents', '.skill-lock.json')),
  ]);
  const lockFileRequirements = new Map(scopedHomes.map((scope) => [
    path.resolve(path.join(scope.home, '.agents', '.skill-lock.json')),
    scope.requires,
  ]));
  const hookCandidates = [
    ...defaultHookCandidates(home, env),
    ...scopedHomes.flatMap((scope) => defaultHookCandidates(scope.home, {})
      .map((candidate) => ({ ...candidate, requires: scope.requires }))),
  ];
  const extensionCandidates = [
    ...defaultExtensionCandidates(home).map((target) => ({ path: target, requires: null })),
    ...scopedHomes.flatMap((scope) => defaultExtensionCandidates(scope.home)
      .map((target) => ({ path: target, requires: scope.requires }))),
  ];
  const grokHome = env.GROK_HOME || path.join(home, '.grok');

  return {
    platform,
    home,
    env,
    projects,
    wslHomes,
    remoteHomes,
    skillRoots: unique([...homeSkillRoots, ...projectSkillRoots, ...scopedSkillRoots.map((item) => item.root)]),
    skillRootRequirements,
    lockFiles,
    lockFileRequirements,
    hookCandidates: overrides.hookCandidates || hookCandidates,
    extensionCandidates: overrides.extensionCandidates || extensionCandidates,
    filesystemIdentity: overrides.filesystemIdentity || existingFilesystemIdentity,
    sharedStateCandidates: unique(overrides.sharedStateCandidates || [
      path.join(home, '.orca', 'agent-hooks'),
      path.join(home, '.orca', 'claude-agent-teams-bin'),
      path.join(home, '.orca', 'managed-hook-install.lock'),
      path.join(home, '.orca', 'openai-speech-token.enc'),
      path.join(grokHome, 'hooks', 'orca-status.json.orca-cleaned-symlink'),
    ]),
    conditionalStateCandidates: overrides.conditionalStateCandidates || [
      ...projects.flatMap((project) => [
        { kind: 'project-state', path: path.join(project, '.orca'), requires: 'includeProjectState', reason: '프로젝트 Orca issue-command·drop 상태' },
        { kind: 'project-state', path: path.join(path.dirname(project), '.orca-worktree-trash'), requires: 'includeProjectState', reason: '프로젝트 인접 Orca worktree 휴지통' },
      ]),
      ...wslHomes.flatMap((scopedHome) => [
        { kind: 'wsl-state', path: path.join(scopedHome, '.orca-wsl'), requires: 'includeWsl', reason: 'WSL Orca 릴레이·훅 상태' },
        { kind: 'wsl-state', path: path.join(scopedHome, '.local', 'share', 'orca'), requires: 'includeWsl', reason: 'WSL Orca 브리지·관리형 계정 상태' },
      ]),
      ...unique([home, ...remoteHomes]).flatMap((scopedHome) => [
        { kind: 'remote-state', path: path.join(scopedHome, '.orca-remote'), requires: 'includeRemote', reason: 'SSH Orca 버전별 릴레이·업로드 상태' },
        { kind: 'remote-state', path: path.join(scopedHome, '.orca-relay'), requires: 'includeRemote', reason: 'SSH Orca CLI·훅 오버레이' },
        { kind: 'remote-state', path: path.join(scopedHome, '.orca', 'sessions'), requires: 'includeRemote', reason: '원격 Orca 세션 상태' },
        { kind: 'remote-state', path: path.join(scopedHome, '.orca', 'skill-installs'), requires: 'includeRemote', reason: '원격 Orca Skills 설치 상태' },
      ]),
      ...remoteHomes.map((scopedHome) => (
        { kind: 'remote-state', path: path.join(scopedHome, '.orca', 'agent-hooks'), requires: 'includeRemote', reason: '원격 Orca 관리형 에이전트 훅' }
      )),
    ],
    userStateCandidates: unique(overrides.userStateCandidates || [path.join(home, '.orca')]),
    appDataCandidates: unique(overrides.appDataCandidates || defaultAppDataCandidates(platform, home, env)),
    voiceCandidates: unique([...(overrides.voiceCandidates || defaultVoiceCandidates(platform, env)), ...(overrides.customVoicePaths || [])]),
    customVoicePaths: unique(overrides.customVoicePaths || []),
    cliCandidates: unique(overrides.cliCandidates || defaultCliCandidates(platform, home)),
    conditionalCliCandidates: overrides.conditionalCliCandidates || [
      ...wslHomes.flatMap((scopedHome) => defaultCliCandidates('linux', scopedHome)
        .map((target) => ({ path: target, requires: 'includeWsl' }))),
      ...remoteHomes.flatMap((scopedHome) => defaultCliCandidates('linux', scopedHome)
        .map((target) => ({ path: target, requires: 'includeRemote' }))),
    ],
    userPath: overrides.userPath ?? readWindowsUserPath(platform),
    backupRoot: path.resolve(overrides.backupRoot || path.join(home, 'OrcaAgentCleanupBackups', timestamp())),
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').replace(/\..+/, '');
}

function operationId() {
  return `${new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').replace(/Z$/, '').replace('.', '-')}-${process.pid}-${randomUUID()}`;
}

function cleanupManifestPayload(manifest) {
  return {
    manifestVersion: manifest.manifestVersion,
    createdAt: manifest.createdAt,
    platform: manifest.platform,
    backupRoot: manifest.backupRoot,
    actions: manifest.actions,
    errors: manifest.errors,
  };
}

function cleanupManifestDigest(manifest) {
  return createHash('sha256').update(JSON.stringify(cleanupManifestPayload(manifest))).digest('hex');
}

function signedCleanupManifest(value) {
  return {
    ...value,
    integrity: { algorithm: 'sha256', digest: cleanupManifestDigest(value) },
  };
}

function entriesFromLock(lock) {
  if (!lock || typeof lock !== 'object') return [];
  const containers = [lock.skills, lock.installed, lock.dependencies, lock];
  const result = [];
  for (const container of containers) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    for (const [name, value] of Object.entries(container)) {
      if (name === 'skills' || name === 'installed' || name === 'dependencies') continue;
      const details = typeof value === 'string' ? { source: value } : (value || {});
      const source = [details.source, details.sourceUrl, details.repository, details.repo, details.url]
        .filter(Boolean).join(' ');
      result.push({ name, source });
    }
  }
  return result;
}

function lockedOrcaSkillNamesByRoot(context) {
  const namesByRoot = new Map();
  for (const lockFile of context.lockFiles) {
    const skillRoot = path.resolve(path.dirname(lockFile), 'skills');
    const names = namesByRoot.get(skillRoot) || new Set();
    for (const entry of entriesFromLock(readJson(lockFile))) {
      if (ORCA_SOURCE_PATTERN.test(entry.source)) names.add(entry.name);
    }
    namesByRoot.set(skillRoot, names);
  }
  return namesByRoot;
}

function hasOrcaSkillSignature(skillPath) {
  const text = [
    readText(path.join(skillPath, 'SKILL.md')),
    readText(path.join(skillPath, 'README.md')),
    readText(path.join(skillPath, 'package.json')),
  ].join('\n');
  return ORCA_SKILL_SIGNATURES.some((pattern) => pattern.test(text));
}

function defaultCliCandidates(platform, home) {
  if (platform === 'darwin') {
    return ['/usr/local/bin/orca', path.join(home, '.local', 'bin', 'orca')];
  }
  if (platform === 'linux') {
    // Linux 공식 명령은 orca-ide다. /usr/bin/orca는 GNOME 스크린 리더라 건드리지 않는다.
    return [
      path.join(home, '.local', 'bin', LINUX_CLI_COMMAND_NAME),
      path.join(home, '.local', 'bin', 'orca'),
    ];
  }
  return [];
}

function isOrcaCli(candidate) {
  if (!pathExists(candidate)) return false;
  let linkTarget = '';
  try {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) linkTarget = fs.readlinkSync(candidate);
  } catch {
    return false;
  }
  const text = readText(candidate);
  const haystack = `${linkTarget}\n${text}`;
  if (/Orca\.app[\\/]Contents[\\/]Resources[\\/]bin/i.test(haystack)) return true;
  if (haystack.includes(LINUX_CLI_DISPATCHER_MARKER)) return true;
  if (/stablyai\/orca|Managed by Orca/i.test(haystack)) return true;
  if (/[\\/]resources[\\/]bin[\\/]orca-ide(?:\.exe)?$/i.test(linkTarget)) return true;
  return false;
}

function stripDelimitedBlock(content, startMarker, endMarker) {
  const start = content.indexOf(startMarker);
  if (start < 0) return content;
  const endMarkerIndex = content.indexOf(endMarker, start + startMarker.length);
  const end = endMarkerIndex < 0 ? content.length : endMarkerIndex + endMarker.length;
  const before = content.slice(0, start).replace(/[ \t]*(?:\r?\n)*$/, '');
  const after = content.slice(end).replace(/^(?:\r?\n)+/, '');
  if (!before) return after;
  if (!after) return before.endsWith('\n') ? before : `${before}\n`;
  return `${before}\n\n${after}`;
}

function hasHookMarker(candidate) {
  if (!pathExists(candidate.path)) return false;
  if (candidate.type === 'hermes') {
    const markerFiles = ['plugin.json', 'README.md', '__init__.py', 'orca-status.py'];
    return markerFiles.some((name) => {
      const text = readText(path.join(candidate.path, name));
      return MANAGED_FILE_PATTERN.test(text) || ORCA_HOOK_PATTERN.test(text);
    });
  }
  const text = readText(candidate.path);
  if (candidate.type === 'kimi') return text.includes(KIMI_START) && text.includes(KIMI_END);
  if (candidate.type === 'codex-legacy') return text.includes(CODEX_LEGACY_START);
  if (candidate.type === 'amp') return MANAGED_FILE_PATTERN.test(text);
  if (candidate.type === 'hermes-config') return /^\s*-\s*orca-status\s*$/m.test(text);
  return ORCA_HOOK_PATTERN.test(text) || MANAGED_FILE_PATTERN.test(text);
}

function hasManagedExtensionMarker(target) {
  return pathExists(target) && readText(target).includes(PI_EXTENSION_MARKER);
}

function listMatchingChildren(directory, pattern) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => pattern.test(entry.name))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function managedHookLockResidues(home) {
  return listMatchingChildren(path.join(home, '.orca'),
    /^managed-hook-install\.(?:owner(?:-draft)?|claimed|claim)-.+\.json$/u);
}

function managedSkillTransactionResidues(root) {
  return listMatchingChildren(root,
    /^(?:\.orca-skill-extract-.+|\..+\.orca-(?:staging|backup|copy|skill-delete|remove-backup|placement-backup|placement-staging)-.+)$/u);
}

function hasOrcaVoiceModelSignature(target) {
  const containsKnownModel = (directory) => {
    try {
      return fs.readdirSync(directory, { withFileTypes: true }).some((entry) => {
        const normalized = entry.name.replace(/(?:\.partial|\.tar\.bz2)$/i, '');
        return ORCA_VOICE_MODEL_IDS.has(normalized);
      });
    } catch {
      return false;
    }
  };
  if (containsKnownModel(target)) return true;
  try {
    return fs.readdirSync(target, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[a-f0-9]{16}$/i.test(entry.name))
      .some((entry) => containsKnownModel(path.join(target, entry.name)));
  } catch {
    return false;
  }
}

function finding(kind, target, reason, requires = null, meta = {}) {
  return { kind, path: path.resolve(target), reason, requires, ...meta };
}

export function scanOrcaResidue(context) {
  const findings = [];
  const lockedNamesByRoot = lockedOrcaSkillNamesByRoot(context);

  for (const root of context.skillRoots) {
    const requirement = context.skillRootRequirements?.get(path.resolve(root)) || null;
    const lockedNames = lockedNamesByRoot.get(path.resolve(root)) || new Set();
    for (const name of OFFICIAL_ORCA_SKILLS) {
      const skillPath = path.join(root, name);
      if (!pathExists(skillPath)) continue;
      const isAgentsSkillRoot = path.basename(root) === 'skills' && path.basename(path.dirname(root)) === '.agents';
      if ((isAgentsSkillRoot && lockedNames.has(name)) || hasOrcaSkillSignature(skillPath)) {
        findings.push(finding('skill', skillPath, `Orca 공식 스킬(${name}) 출처 확인`, requirement));
      }
    }
    for (const target of managedSkillTransactionResidues(root)) {
      findings.push(finding('skill-transaction', target, '중단된 Orca Skills 설치·삭제 트랜잭션', requirement));
    }
  }

  for (const lockFile of context.lockFiles) {
    const entries = entriesFromLock(readJson(lockFile)).filter((entry) => ORCA_SOURCE_PATTERN.test(entry.source));
    if (entries.length) {
      const requirement = context.lockFileRequirements?.get(path.resolve(lockFile)) || null;
      findings.push(finding('skill-lock', lockFile, 'stablyai/orca 잠금 항목', requirement, { names: entries.map((entry) => entry.name) }));
    }
  }

  for (const candidate of context.hookCandidates) {
    if (candidate.type === 'hermes-config') {
      const plugin = context.hookCandidates.find((item) => item.type === 'hermes'
        && path.dirname(path.dirname(item.path)) === path.dirname(candidate.path));
      if (!plugin || !hasHookMarker(plugin)) continue;
    }
    if (hasHookMarker(candidate)) {
      const removeWhole = candidate.type === 'codex-legacy'
        && stripDelimitedBlock(readText(candidate.path), CODEX_LEGACY_START, CODEX_LEGACY_END).trim() === '';
      findings.push(finding('hook', candidate.path, `Orca 관리형 ${candidate.type} 훅`, candidate.requires || null,
        { hookType: candidate.type, removeWhole }));
    }
  }

  for (const candidate of context.extensionCandidates || []) {
    if (hasManagedExtensionMarker(candidate.path)) {
      findings.push(finding('extension', candidate.path, 'Orca 관리형 Pi·OMP·Prime 확장', candidate.requires || null));
    }
  }

  for (const target of context.sharedStateCandidates) {
    if (pathExists(target)) {
      findings.push(finding('shared-state', target, '경로가 고정된 Orca 훅·음성 토큰·관리 파일'));
    }
  }
  for (const target of managedHookLockResidues(context.home)) {
    findings.push(finding('shared-state', target, '중단된 Orca 관리형 훅 잠금 복구 파일'));
  }
  for (const candidate of context.conditionalStateCandidates || []) {
    if (pathExists(candidate.path)) {
      findings.push(finding(candidate.kind, candidate.path, candidate.reason, candidate.requires));
    }
  }
  for (const target of context.userStateCandidates || []) {
    if (pathExists(target)) {
      findings.push(finding('user-state', target, 'Orca 자격증명·세션·키 설정을 포함한 전체 사용자 상태', 'includeUserState'));
    }
  }

  const seenAppData = new Set();
  for (const target of context.appDataCandidates) {
    if (!pathExists(target)) continue;
    const identity = context.filesystemIdentity(target);
    if (seenAppData.has(identity)) continue;
    seenAppData.add(identity);
    findings.push(finding('app-data', target, 'Orca 애플리케이션 데이터', 'includeAppData'));
  }
  for (const target of context.voiceCandidates) {
    if (!pathExists(target)) continue;
    if (hasOrcaVoiceModelSignature(target)) {
      findings.push(finding('voice-data', target, 'Orca 음성 모델 캐시', 'includeVoiceData'));
    } else {
      findings.push(finding('unverified', target, 'Orca 음성 모델 서명을 확인할 수 없어 자동 정리하지 않음', 'never'));
    }
  }
  for (const target of context.cliCandidates) {
    if (isOrcaCli(target)) findings.push(finding('cli', target, 'Orca 앱 또는 공식 런처를 가리키는 CLI'));
  }
  for (const candidate of context.conditionalCliCandidates || []) {
    if (isOrcaCli(candidate.path)) {
      findings.push(finding('cli', candidate.path, 'Orca 앱 또는 공식 런처를 가리키는 CLI', candidate.requires));
    }
  }
  for (const entry of (context.userPath || '').split(';').filter(Boolean)) {
    if (isWindowsOrcaPathEntry(entry, context)) {
      findings.push(finding('path-entry', entry, 'Windows 사용자 PATH의 Orca CLI 경로', null, { rawPathEntry: entry }));
    }
  }

  const uniqueFindings = new Map();
  for (const item of findings) uniqueFindings.set(`${item.kind}\0${item.path}`, item);
  return [...uniqueFindings.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function safeRelative(target) {
  const parsed = path.parse(target);
  const withoutRoot = target.slice(parsed.root.length).replace(/:/g, '_');
  const rootLabel = parsed.root.replace(/[\\/:]+/g, '_') || 'root';
  return path.join(rootLabel, withoutRoot);
}

function isSameOrDescendant(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeQuarantineSource(source, context) {
  const resolved = path.resolve(source);
  if (resolved === path.parse(resolved).root || resolved === path.resolve(context.home)) {
    throw new Error(`사용자 홈 또는 파일시스템 루트는 격리할 수 없습니다: ${resolved}`);
  }
  if (isSameOrDescendant(resolved, context.backupRoot)) {
    throw new Error(`백업 폴더가 정리 대상 내부에 있어 작업을 거부했습니다: ${resolved}`);
  }
}

function ensureParent(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

function quarantine(source, context, category, dryRun) {
  assertSafeQuarantineSource(source, context);
  const destination = path.join(context.backupRoot, category, safeRelative(source));
  if (dryRun) return destination;
  ensureParent(destination);
  if (pathExists(destination)) throw new Error(`백업 대상이 이미 존재합니다: ${destination}`);
  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(source), destination);
      fs.unlinkSync(source);
    } else {
      fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
      fs.rmSync(source, { recursive: true, force: false });
    }
  }
  return destination;
}

function backupConfig(source, context, dryRun) {
  const destination = path.join(context.backupRoot, 'config-original', safeRelative(source));
  if (!dryRun) {
    ensureParent(destination);
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
  return destination;
}

function directManagedString(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).some((item) => typeof item === 'string' && ORCA_HOOK_PATTERN.test(item));
}

function pruneJsonHooks(value) {
  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) {
      if (typeof item === 'string' && ORCA_HOOK_PATTERN.test(item)) continue;
      if (directManagedString(item)) continue;
      const cleaned = pruneJsonHooks(item);
      if (item && typeof item === 'object' && Array.isArray(item.hooks)
          && (!cleaned.hooks || cleaned.hooks.length === 0)) continue;
      if (cleaned !== undefined) next.push(cleaned);
    }
    return next;
  }
  if (!value || typeof value !== 'object') return value;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && ORCA_HOOK_PATTERN.test(child)) continue;
    if (directManagedString(child)) continue;
    const cleaned = pruneJsonHooks(child);
    if (cleaned === undefined) continue;
    if (Array.isArray(cleaned) && cleaned.length === 0) continue;
    if (cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) continue;
    next[key] = cleaned;
  }
  return next;
}

function writeAtomic(target, text) {
  const temp = `${target}.orca-cleanup-${process.pid}.tmp`;
  fs.writeFileSync(temp, text, 'utf8');
  fs.renameSync(temp, target);
}

function cleanJsonHook(target, context, dryRun) {
  const value = readJson(target);
  if (!value) throw new Error(`JSON을 해석할 수 없어 자동 수정하지 않았습니다: ${target}`);
  const cleaned = pruneJsonHooks(value);
  const before = `${JSON.stringify(value, null, 2)}\n`;
  const after = `${JSON.stringify(cleaned, null, 2)}\n`;
  if (before === after) return null;
  const backup = backupConfig(target, context, dryRun);
  if (!dryRun) writeAtomic(target, after);
  return backup;
}

function cleanKimiHook(target, context, dryRun) {
  const text = readText(target);
  const start = text.indexOf(KIMI_START);
  const end = text.indexOf(KIMI_END, start + KIMI_START.length);
  if (start < 0 || end < 0) return null;
  const backup = backupConfig(target, context, dryRun);
  const after = `${text.slice(0, start)}${text.slice(end + KIMI_END.length)}`.replace(/\n{3,}/g, '\n\n');
  if (!dryRun) writeAtomic(target, after);
  return backup;
}

function cleanCodexLegacyHook(target, context, dryRun) {
  const text = readText(target);
  const after = stripDelimitedBlock(text, CODEX_LEGACY_START, CODEX_LEGACY_END);
  if (after === text) return null;
  const backup = backupConfig(target, context, dryRun);
  if (!dryRun) writeAtomic(target, after);
  return backup;
}

function cleanHermesConfig(target, context, dryRun) {
  const text = readText(target);
  const after = text.split(/(?<=\n)/).filter((line) => !/^\s*-\s*orca-status\s*(?:\r?\n)?$/.test(line)).join('');
  if (after === text) return null;
  const backup = backupConfig(target, context, dryRun);
  if (!dryRun) writeAtomic(target, after);
  return backup;
}

function cleanWindowsUserPath(context, dryRun) {
  const parts = (context.userPath || '').split(';');
  const next = parts.filter((entry) => !isWindowsOrcaPathEntry(entry, context)).join(';');
  if (next === context.userPath) return null;
  const backup = path.join(context.backupRoot, 'config-original', 'windows-user-path.txt');
  if (!dryRun) {
    ensureParent(backup);
    fs.writeFileSync(backup, `${context.userPath}\n`, { encoding: 'utf8', flag: 'wx' });
    if (process.platform !== 'win32') throw new Error('Windows 사용자 PATH는 Windows에서만 수정할 수 있습니다.');
    const script = "[Environment]::SetEnvironmentVariable('Path',$env:ORCA_CLEAN_PATH,'User')";
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8', env: { ...process.env, ORCA_CLEAN_PATH: next },
    });
    if (result.status !== 0) throw new Error(`Windows 사용자 PATH 수정 실패: ${result.stderr.trim()}`);
    context.userPath = next;
  }
  return backup;
}

function removeLockEntries(target, names, context, dryRun) {
  const value = readJson(target);
  if (!value) throw new Error(`잠금 JSON을 해석할 수 없습니다: ${target}`);
  const wanted = new Set(names);
  let changed = false;
  const containers = [value.skills, value.installed, value.dependencies, value];
  for (const container of containers) {
    if (!container || typeof container !== 'object' || Array.isArray(container)) continue;
    for (const [name, details] of Object.entries(container)) {
      if (!wanted.has(name)) continue;
      const source = typeof details === 'string'
        ? details
        : [details?.source, details?.sourceUrl, details?.repository, details?.repo, details?.url]
          .filter(Boolean).join(' ');
      if (ORCA_SOURCE_PATTERN.test(source)) {
        delete container[name];
        changed = true;
      }
    }
  }
  if (!changed) return null;
  const backup = backupConfig(target, context, dryRun);
  if (!dryRun) writeAtomic(target, `${JSON.stringify(value, null, 2)}\n`);
  return backup;
}

function selected(finding, options) {
  return !finding.requires || Boolean(options[finding.requires]);
}

export function cleanOrcaResidue(context, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const findings = scanOrcaResidue(context);
  const actions = [];
  const errors = [];

  const selectedUserStateRoots = findings
    .filter((item) => item.kind === 'user-state' && selected(item, options))
    .map((item) => item.path);

  for (const item of findings) {
    if (item.kind !== 'user-state'
        && selectedUserStateRoots.some((root) => isSameOrDescendant(root, item.path))) {
      actions.push({ action: 'covered', ...item });
      continue;
    }
    if (!selected(item, options)) {
      actions.push({ action: 'skipped', ...item });
      continue;
    }
    try {
      if (item.kind === 'hook' && item.hookType === 'json') {
        const backup = cleanJsonHook(item.path, context, dryRun);
        actions.push({ action: backup ? (dryRun ? 'would-edit' : 'edited') : 'unchanged', backup, ...item });
      } else if (item.kind === 'hook' && item.hookType === 'kimi') {
        const backup = cleanKimiHook(item.path, context, dryRun);
        actions.push({ action: backup ? (dryRun ? 'would-edit' : 'edited') : 'unchanged', backup, ...item });
      } else if (item.kind === 'hook' && item.hookType === 'codex-legacy' && !item.removeWhole) {
        const backup = cleanCodexLegacyHook(item.path, context, dryRun);
        actions.push({ action: backup ? (dryRun ? 'would-edit' : 'edited') : 'unchanged', backup, ...item });
      } else if (item.kind === 'hook' && item.hookType === 'hermes-config') {
        const backup = cleanHermesConfig(item.path, context, dryRun);
        actions.push({ action: backup ? (dryRun ? 'would-edit' : 'edited') : 'unchanged', backup, ...item });
      } else if (item.kind === 'skill-lock') {
        const backup = removeLockEntries(item.path, item.names, context, dryRun);
        actions.push({ action: backup ? (dryRun ? 'would-edit' : 'edited') : 'unchanged', backup, ...item });
      } else if (item.kind === 'path-entry') {
        const backup = cleanWindowsUserPath(context, dryRun);
        actions.push({ action: backup ? (dryRun ? 'would-edit' : 'edited') : 'unchanged', backup, ...item });
      } else {
        const category = item.kind.replace(/[^a-z0-9-]/gi, '-');
        const backup = quarantine(item.path, context, category, dryRun);
        actions.push({ action: dryRun ? 'would-quarantine' : 'quarantined', backup, ...item });
      }
    } catch (error) {
      errors.push({ path: item.path, message: error.message });
      actions.push({ action: 'error', error: error.message, ...item });
    }
  }

  if (!dryRun && actions.some((item) => ['edited', 'quarantined'].includes(item.action))) {
    fs.mkdirSync(context.backupRoot, { recursive: true });
    const manifest = signedCleanupManifest({
      manifestVersion: 1,
      createdAt: new Date().toISOString(),
      platform: context.platform,
      backupRoot: context.backupRoot,
      actions,
      errors,
    });
    fs.writeFileSync(path.join(context.backupRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return { findings, actions, errors, backupRoot: context.backupRoot, dryRun };
}

function assertSafeRestorePath(target, backupRoot, home) {
  const resolved = path.resolve(target);
  if (!path.isAbsolute(target) || resolved === path.parse(resolved).root || resolved === path.resolve(home)) {
    throw new Error(`복원 대상이 안전하지 않습니다: ${target}`);
  }
  if (isSameOrDescendant(backupRoot, resolved) || isSameOrDescendant(resolved, backupRoot)) {
    throw new Error(`복원 대상과 백업 폴더가 겹칩니다: ${resolved}`);
  }
  return resolved;
}

function assertBackupBelongsToManifest(backup, backupRoot) {
  if (!backup || !path.isAbsolute(backup)) throw new Error(`유효하지 않은 백업 경로입니다: ${backup || '(없음)'}`);
  const resolved = path.resolve(backup);
  if (!isSameOrDescendant(backupRoot, resolved) || resolved === backupRoot) {
    throw new Error(`manifest 밖의 백업 경로는 복원하지 않습니다: ${resolved}`);
  }
  return resolved;
}

const QUARANTINED_RESTORE_KINDS = new Set([
  'app-data', 'cli', 'extension', 'hook', 'project-state', 'remote-state',
  'shared-state', 'skill', 'skill-transaction', 'user-state', 'voice-data', 'wsl-state',
]);
const EDITED_RESTORE_KINDS = new Set(['hook', 'path-entry', 'skill-lock']);

function sameManifestPath(left, right, platform) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function expectedBackupForRestoreItem(item, backupRoot) {
  if (item.action === 'quarantined' && QUARANTINED_RESTORE_KINDS.has(item.kind)) {
    const category = item.kind.replace(/[^a-z0-9-]/gi, '-');
    return path.join(backupRoot, category, safeRelative(item.path));
  }
  if (item.action === 'edited' && EDITED_RESTORE_KINDS.has(item.kind)) {
    return item.kind === 'path-entry'
      ? path.join(backupRoot, 'config-original', 'windows-user-path.txt')
      : path.join(backupRoot, 'config-original', safeRelative(item.path));
  }
  throw new Error(`지원하지 않는 복원 작업입니다: ${item.action}/${item.kind}`);
}

function assertExpectedBackupForItem(item, state) {
  const backup = assertBackupBelongsToManifest(item.backup, state.backupRoot);
  const expected = expectedBackupForRestoreItem(item, state.backupRoot);
  if (!sameManifestPath(backup, expected, state.platform)) {
    throw new Error(`대상 경로와 백업 경로의 매핑이 일치하지 않습니다: ${item.path}`);
  }
  return backup;
}

function validateCleanupManifest(manifest, resolvedManifest, platform) {
  if (manifest.manifestVersion !== 1) {
    throw new Error(`지원하지 않는 manifest 버전입니다: ${manifest.manifestVersion ?? '(없음)'}`);
  }
  if (!['win32', 'darwin', 'linux'].includes(manifest.platform) || manifest.platform !== platform) {
    throw new Error(`manifest 운영체제가 현재 복원 환경과 다릅니다: ${manifest.platform ?? '(없음)'} -> ${platform}`);
  }
  const backupRoot = path.dirname(resolvedManifest);
  if (!manifest.backupRoot || !sameManifestPath(manifest.backupRoot, backupRoot, platform)) {
    throw new Error('manifest의 backupRoot가 manifest 위치와 일치하지 않습니다.');
  }
  if (!Array.isArray(manifest.actions) || !Array.isArray(manifest.errors)) {
    throw new Error('manifest의 actions 또는 errors 형식이 올바르지 않습니다.');
  }
  if (manifest.integrity?.algorithm !== 'sha256'
      || manifest.integrity.digest !== cleanupManifestDigest(manifest)) {
    throw new Error('manifest 무결성 검증에 실패했습니다. 파일이 수정되었을 수 있습니다.');
  }
  return backupRoot;
}

function copyForRestore(source, destination) {
  const stat = fs.lstatSync(source);
  ensureParent(destination);
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination);
  } else if (stat.isDirectory()) {
    fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true });
  } else if (stat.isFile()) {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  } else {
    throw new Error(`지원하지 않는 백업 파일 형식입니다: ${source}`);
  }
}

function filesHaveSameBytes(left, right, size) {
  const leftHandle = fs.openSync(left, 'r');
  const rightHandle = fs.openSync(right, 'r');
  const leftBuffer = Buffer.allocUnsafe(64 * 1024);
  const rightBuffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let offset = 0;
    while (offset < size) {
      const length = Math.min(leftBuffer.length, size - offset);
      const leftRead = fs.readSync(leftHandle, leftBuffer, 0, length, offset);
      const rightRead = fs.readSync(rightHandle, rightBuffer, 0, length, offset);
      if (leftRead === 0 || rightRead === 0) return false;
      if (leftRead !== rightRead || !leftBuffer.subarray(0, leftRead).equals(rightBuffer.subarray(0, rightRead))) return false;
      offset += leftRead;
    }
    return true;
  } finally {
    fs.closeSync(leftHandle);
    fs.closeSync(rightHandle);
  }
}

function pathsEquivalent(left, right) {
  try {
    const leftStat = fs.lstatSync(left);
    const rightStat = fs.lstatSync(right);
    if (leftStat.isSymbolicLink() || rightStat.isSymbolicLink()) {
      return leftStat.isSymbolicLink() && rightStat.isSymbolicLink()
        && fs.readlinkSync(left) === fs.readlinkSync(right);
    }
    if (leftStat.isFile() || rightStat.isFile()) {
      return leftStat.isFile() && rightStat.isFile() && leftStat.size === rightStat.size
        && filesHaveSameBytes(left, right, leftStat.size);
    }
    if (!leftStat.isDirectory() || !rightStat.isDirectory()) return false;
    const leftEntries = fs.readdirSync(left).sort();
    const rightEntries = fs.readdirSync(right).sort();
    return leftEntries.length === rightEntries.length
      && leftEntries.every((name, index) => name === rightEntries[index]
        && pathsEquivalent(path.join(left, name), path.join(right, name)));
  } catch {
    return false;
  }
}

function removePartialRestore(target) {
  if (!pathExists(target)) return;
  fs.rmSync(target, { recursive: true, force: false });
}

function setWindowsUserPath(value) {
  if (process.platform !== 'win32') throw new Error('Windows 사용자 PATH는 Windows에서만 복원할 수 있습니다.');
  const script = "[Environment]::SetEnvironmentVariable('Path',$env:ORCA_RESTORE_PATH,'User')";
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', env: { ...process.env, ORCA_RESTORE_PATH: value },
  });
  if (result.status !== 0) throw new Error(`Windows 사용자 PATH 복원 실패: ${result.stderr.trim()}`);
}

function restoreWindowsPathEntry(item, state) {
  const backup = assertExpectedBackupForItem(item, state);
  if (!pathExists(backup)) throw new Error(`PATH 백업이 없습니다: ${backup}`);
  const original = readText(backup).replace(/\r?\n$/, '');
  const current = state.readUserPath();
  if (current === original) return { action: 'already-restored', conflictBackup: null };
  const conflictBackup = path.join(state.conflictRoot, 'windows-user-path.txt');
  if (state.dryRun) return { action: 'would-restore', conflictBackup };
  ensureParent(conflictBackup);
  fs.writeFileSync(conflictBackup, `${current}\n`, { encoding: 'utf8', flag: 'wx' });
  try {
    state.writeUserPath(original);
  } catch (error) {
    try { state.writeUserPath(current); } catch { /* 원래 PATH 백업은 conflictBackup에 남긴다. */ }
    throw error;
  }
  return { action: 'restored', conflictBackup };
}

function restoreFilesystemItem(item, state) {
  const source = assertExpectedBackupForItem(item, state);
  const target = assertSafeRestorePath(item.path, state.backupRoot, state.home);
  if (!pathExists(source)) {
    if (pathExists(target)) return { action: 'already-restored', conflictBackup: null };
    throw new Error(`복원할 백업이 없습니다: ${source}`);
  }
  if (pathExists(target) && pathsEquivalent(source, target)) {
    return { action: 'already-restored', conflictBackup: null };
  }
  const conflictContext = { home: state.home, backupRoot: state.conflictRoot };
  const conflictBackup = pathExists(target)
    ? quarantine(target, conflictContext, 'current', state.dryRun)
    : null;
  if (state.dryRun) return { action: 'would-restore', conflictBackup };
  try {
    copyForRestore(source, target);
  } catch (error) {
    try {
      removePartialRestore(target);
      if (conflictBackup && pathExists(conflictBackup)) copyForRestore(conflictBackup, target);
    } catch (rollbackError) {
      throw new Error(`${error.message}; 현재 파일 자동 복귀도 실패했습니다: ${rollbackError.message}`);
    }
    throw error;
  }
  return { action: 'restored', conflictBackup };
}

export function restoreOrcaBackup(manifestPath, options = {}) {
  const resolvedManifest = path.resolve(manifestPath);
  const manifest = readJson(resolvedManifest);
  if (!manifest) {
    throw new Error(`유효한 Orca 정리 manifest가 아닙니다: ${resolvedManifest}`);
  }
  const platform = options.platform || process.platform;
  const backupRoot = validateCleanupManifest(manifest, resolvedManifest, platform);
  const dryRun = Boolean(options.dryRun);
  const conflictRoot = path.join(backupRoot, 'restore-conflicts', operationId());
  const state = {
    backupRoot,
    conflictRoot,
    dryRun,
    home: path.resolve(options.home || os.homedir()),
    platform,
    readUserPath: options.readUserPath || (() => readWindowsUserPath('win32')),
    writeUserPath: options.writeUserPath || setWindowsUserPath,
  };
  const actions = [];
  const errors = [];
  const restorable = manifest.actions.filter((item) => ['quarantined', 'edited'].includes(item.action));

  for (const item of restorable) {
    const base = {
      kind: item.kind,
      path: item.path,
      backup: item.backup,
      sourceAction: item.action,
    };
    try {
      const result = item.kind === 'path-entry'
        ? restoreWindowsPathEntry(item, state)
        : restoreFilesystemItem(item, state);
      actions.push({ ...base, ...result });
    } catch (error) {
      errors.push({ path: item.path, message: error.message });
      actions.push({ ...base, action: 'error', error: error.message });
    }
  }

  let reportPath = null;
  if (!dryRun) {
    reportPath = path.join(backupRoot, `restore-manifest-${operationId()}.json`);
    fs.writeFileSync(reportPath, `${JSON.stringify({
      restoreVersion: 1,
      restoredAt: new Date().toISOString(),
      sourceManifest: resolvedManifest,
      conflictRoot: actions.some((item) => item.conflictBackup) ? conflictRoot : null,
      actions,
      errors,
    }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  }
  return { manifestPath: resolvedManifest, backupRoot, conflictRoot, reportPath, actions, errors, dryRun };
}

export const internals = {
  CODEX_LEGACY_END,
  CODEX_LEGACY_START,
  KIMI_START,
  KIMI_END,
  LINUX_CLI_DISPATCHER_MARKER,
  LINUX_CLI_COMMAND_NAME,
  hasOrcaSkillSignature,
  isOrcaCli,
  pruneJsonHooks,
  signedCleanupManifest,
  stripDelimitedBlock,
};
