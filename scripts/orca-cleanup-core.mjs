import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

const ORCA_SOURCE_PATTERN = /(?:github\.com\/)?stablyai\/orca/i;
const ORCA_SKILL_SIGNATURES = [
  /(?:github\.com\/)?stablyai\/orca/i,
  /\bORCA\s+skills\s+get\b/i,
  /\bEngage\s+Orca\b/i,
  /Use Orca(?:'s|’s)? computer-use CLI/i,
];
const ORCA_HOOK_PATTERN = /(?:[\\/]\.orca[\\/]agent-hooks[\\/]|ORCA_AGENT_HOOK|orca-(?:agent-)?(?:hook|status))/i;
const MANAGED_FILE_PATTERN = /Managed by Orca\. Do not edit; changes may be overwritten\./i;
const KIMI_START = '# >>> orca-managed-kimi-hooks (managed by Orca; do not edit) >>>';
const KIMI_END = '# <<< orca-managed-kimi-hooks <<<';

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
  return [
    '.codex/skills',
    '.agents/skills',
    '.claude/skills',
    '.grok/skills',
    '.config/opencode/skills',
    '.pi/agent/skills',
    '.omp/agent/skills',
    '.gemini/skills',
    '.gemini/antigravity/skills',
    '.cursor/skills',
  ].map((relative) => path.join(home, ...relative.split('/')));
}

function defaultHookCandidates(home, env) {
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
    ['kimi', path.join(home, '.kimi-code', 'config.toml')],
    ['amp', path.join(home, '.config', 'amp', 'plugins', 'orca-agent-status.ts')],
    ['hermes', path.join(home, '.hermes', 'plugins', 'orca-status')],
    ['hermes-config', path.join(home, '.hermes', 'config.yaml')],
  ];
  if (env.APPDATA) candidates.push(['json', path.join(env.APPDATA, 'Devin', 'config.json')]);
  return candidates.map(([type, filePath]) => ({ type, path: filePath }));
}

function defaultAppDataCandidates(platform, home, env) {
  if (platform === 'darwin') {
    return [
      path.join(home, 'Library', 'Application Support', 'Orca'),
      path.join(home, 'Library', 'Caches', 'Orca'),
      path.join(home, 'Library', 'Logs', 'Orca'),
      path.join(home, 'Library', 'Preferences', 'com.stablyai.orca.plist'),
      path.join(home, 'Library', 'Saved Application State', 'com.stablyai.orca.savedState'),
    ];
  }
  if (platform === 'win32') {
    return [
      env.APPDATA && path.join(env.APPDATA, 'Orca'),
      env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Orca'),
    ].filter(Boolean);
  }
  return [
    path.join(home, '.config', 'Orca'),
    path.join(home, '.cache', 'Orca'),
  ];
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

function isWindowsOrcaPathEntry(entry, context) {
  if (context.platform !== 'win32') return false;
  const expanded = entry.replace(/%([^%]+)%/g, (_, name) => context.env[name] || context.env[name.toUpperCase()] || `%${name}%`);
  const normalized = path.normalize(expanded.replace(/^"|"$/g, '')).replace(/[\\/]+$/, '').toLowerCase();
  const expected = context.env.LOCALAPPDATA
    ? path.normalize(path.join(context.env.LOCALAPPDATA, 'Programs', 'orca', 'resources', 'bin')).toLowerCase()
    : '';
  return Boolean(expected && normalized === expected);
}

export function buildContext(overrides = {}) {
  const platform = overrides.platform || process.platform;
  const home = path.resolve(overrides.home || os.homedir());
  const env = { ...process.env, ...(overrides.env || {}) };
  const projects = unique(overrides.projects || []);
  const homeSkillRoots = overrides.homeSkillRoots || defaultHomeSkillRoots(home);
  const projectSkillRoots = projects.flatMap((project) => [
    path.join(project, '.agents', 'skills'),
    path.join(project, '.claude', 'skills'),
  ]);
  const lockFiles = overrides.lockFiles || unique([
    path.join(home, '.agents', '.skill-lock.json'),
    ...projects.map((project) => path.join(project, '.agents', '.skill-lock.json')),
  ]);

  return {
    platform,
    home,
    env,
    projects,
    skillRoots: unique([...homeSkillRoots, ...projectSkillRoots]),
    lockFiles,
    hookCandidates: overrides.hookCandidates || defaultHookCandidates(home, env),
    appDataCandidates: unique(overrides.appDataCandidates || defaultAppDataCandidates(platform, home, env)),
    voiceCandidates: unique([...(overrides.voiceCandidates || defaultVoiceCandidates(platform, env)), ...(overrides.customVoicePaths || [])]),
    customVoicePaths: unique(overrides.customVoicePaths || []),
    workspaceCandidates: unique(overrides.workspaceCandidates || [path.join(home, 'orca')]),
    cliCandidates: unique(overrides.cliCandidates || (platform === 'darwin'
      ? ['/usr/local/bin/orca', path.join(home, '.local', 'bin', 'orca')]
      : [])),
    userPath: overrides.userPath ?? readWindowsUserPath(platform),
    backupRoot: path.resolve(overrides.backupRoot || path.join(home, 'OrcaAgentCleanupBackups', timestamp())),
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/T/, '-').replace(/\..+/, '');
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

function lockedOrcaSkillNames(context) {
  const names = new Set();
  for (const lockFile of context.lockFiles) {
    for (const entry of entriesFromLock(readJson(lockFile))) {
      if (ORCA_SOURCE_PATTERN.test(entry.source)) names.add(entry.name);
    }
  }
  return names;
}

function hasOrcaSkillSignature(skillPath) {
  const text = [
    readText(path.join(skillPath, 'SKILL.md')),
    readText(path.join(skillPath, 'README.md')),
    readText(path.join(skillPath, 'package.json')),
  ].join('\n');
  return ORCA_SKILL_SIGNATURES.some((pattern) => pattern.test(text));
}

function isOrcaCli(candidate) {
  if (!pathExists(candidate)) return false;
  try {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) {
      const target = fs.readlinkSync(candidate);
      return /Orca\.app[\\/]Contents[\\/]Resources[\\/]bin/i.test(target);
    }
  } catch {
    return false;
  }
  const text = readText(candidate);
  return /Orca\.app[\\/]Contents[\\/]Resources[\\/]bin|stablyai\/orca|Managed by Orca/i.test(text);
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
  if (candidate.type === 'amp') return MANAGED_FILE_PATTERN.test(text);
  if (candidate.type === 'hermes-config') return /^\s*-\s*orca-status\s*$/m.test(text);
  return ORCA_HOOK_PATTERN.test(text) || MANAGED_FILE_PATTERN.test(text);
}

function finding(kind, target, reason, requires = null, meta = {}) {
  return { kind, path: path.resolve(target), reason, requires, ...meta };
}

export function scanOrcaResidue(context) {
  const findings = [];
  const lockedNames = lockedOrcaSkillNames(context);

  for (const root of context.skillRoots) {
    for (const name of OFFICIAL_ORCA_SKILLS) {
      const skillPath = path.join(root, name);
      if (!pathExists(skillPath)) continue;
      const isAgentsSkillRoot = path.basename(root) === 'skills' && path.basename(path.dirname(root)) === '.agents';
      if ((isAgentsSkillRoot && lockedNames.has(name)) || hasOrcaSkillSignature(skillPath)) {
        findings.push(finding('skill', skillPath, `Orca 공식 스킬(${name}) 출처 확인`));
      }
    }
  }

  for (const lockFile of context.lockFiles) {
    const entries = entriesFromLock(readJson(lockFile)).filter((entry) => ORCA_SOURCE_PATTERN.test(entry.source));
    if (entries.length) {
      findings.push(finding('skill-lock', lockFile, 'stablyai/orca 잠금 항목', null, { names: entries.map((entry) => entry.name) }));
    }
  }

  for (const candidate of context.hookCandidates) {
    if (hasHookMarker(candidate)) {
      findings.push(finding('hook', candidate.path, `Orca 관리형 ${candidate.type} 훅`, null, { hookType: candidate.type }));
    }
  }

  const sharedState = path.join(context.home, '.orca');
  if (pathExists(sharedState)) {
    findings.push(finding('shared-state', sharedState, '공용 훅·음성 토큰·Orca 상태 데이터'));
  }

  for (const target of context.appDataCandidates) {
    if (pathExists(target)) findings.push(finding('app-data', target, 'Orca 애플리케이션 데이터', 'includeAppData'));
  }
  for (const target of context.voiceCandidates) {
    if (pathExists(target)) findings.push(finding('voice-data', target, 'Orca 음성 모델 캐시', 'includeVoiceData'));
  }
  for (const target of context.workspaceCandidates) {
    if (pathExists(target)) findings.push(finding('workspace', target, 'Orca 워크스페이스(사용자 파일 포함 가능)', 'includeWorkspaceData'));
  }
  for (const target of context.cliCandidates) {
    if (isOrcaCli(target)) findings.push(finding('cli', target, 'Orca.app를 가리키는 CLI 런처'));
  }
  for (const entry of (context.userPath || '').split(';').filter(Boolean)) {
    if (isWindowsOrcaPathEntry(entry, context)) {
      findings.push(finding('path-entry', entry, 'Windows 사용자 PATH의 Orca CLI 경로', null, { rawPathEntry: entry }));
    }
  }

  return findings.sort((a, b) => a.path.localeCompare(b.path));
}

function safeRelative(target) {
  const parsed = path.parse(target);
  const withoutRoot = target.slice(parsed.root.length).replace(/:/g, '_');
  const rootLabel = parsed.root.replace(/[\\/:]+/g, '_') || 'root';
  return path.join(rootLabel, withoutRoot);
}

function ensureParent(target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
}

function quarantine(source, context, category, dryRun) {
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
      const normalized = typeof details === 'string' ? details : JSON.stringify(details);
      if (ORCA_SOURCE_PATTERN.test(normalized)) {
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

  for (const item of findings) {
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
    fs.writeFileSync(path.join(context.backupRoot, 'manifest.json'), `${JSON.stringify({
      createdAt: new Date().toISOString(),
      platform: context.platform,
      actions,
      errors,
    }, null, 2)}\n`, 'utf8');
  }
  return { findings, actions, errors, backupRoot: context.backupRoot, dryRun };
}

export const internals = {
  KIMI_START,
  KIMI_END,
  hasOrcaSkillSignature,
  pruneJsonHooks,
};
