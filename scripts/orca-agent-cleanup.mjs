#!/usr/bin/env node

import process from 'node:process';
import {
  buildContext,
  cleanOrcaResidue,
  OFFICIAL_ORCA_SKILLS,
  restoreOrcaBackup,
  scanOrcaResidue,
} from './orca-cleanup-core.mjs';

const HELP = `
Orca Agent Cleanup — Windows·macOS·Linux 공통 정리 도구

사용법:
  node scripts/orca-agent-cleanup.mjs scan [옵션]
  node scripts/orca-agent-cleanup.mjs clean [옵션]
  node scripts/orca-agent-cleanup.mjs restore --manifest <manifest.json> [옵션]

명령:
  scan                         잔재를 검사합니다(기본 명령, 변경 없음).
  clean                        확인된 잔재를 백업 폴더로 격리합니다.
  restore                      manifest에 기록된 파일과 설정을 복원합니다.

옵션:
  --dry-run                    clean의 예정 작업만 표시합니다.
  --include-app-data           Orca 앱 데이터·캐시를 포함합니다.
  --include-voice-data         별도 음성 모델 캐시를 포함합니다.
  --include-user-state         ~/.orca 전체(자격증명·세션 포함)를 포함합니다.
  --include-wsl                실행 중인 WSL 배포판의 Orca 잔재를 검사·정리합니다.
  --wsl-home <경로>            WSL 홈 경로를 직접 추가합니다(반복 가능).
  --include-remote             SSH 릴레이·원격 세션 잔재를 포함합니다.
  --remote-home <경로>         접근 가능한 원격 홈 경로를 추가합니다(반복 가능).
  --include-project-state      --project의 .orca·worktree 휴지통을 포함합니다.
  --project <경로>             프로젝트 스킬 위치를 추가합니다(반복 가능).
  --voice-model-path <경로>    사용자 지정 음성 모델 경로를 포함합니다(반복 가능).
  --backup-root <경로>         격리·백업 폴더를 지정합니다.
  --manifest <경로>            restore에 사용할 manifest.json을 지정합니다.
  --json                       결과를 JSON으로 출력합니다.
  -h, --help                   도움말을 표시합니다.

예시:
  node scripts/orca-agent-cleanup.mjs scan
  node scripts/orca-agent-cleanup.mjs clean --dry-run --include-app-data --include-voice-data
  node scripts/orca-agent-cleanup.mjs clean --include-app-data --include-voice-data
  node scripts/orca-agent-cleanup.mjs restore --dry-run --manifest /path/to/manifest.json
`;

function parseArgs(argv) {
  const result = {
    command: 'scan', projects: [], customVoicePaths: [], wslHomes: [], remoteHomes: [], json: false,
    dryRun: false, includeAppData: false, includeVoiceData: false,
    includeUserState: false, includeWsl: false, includeRemote: false, includeProjectState: false,
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) result.command = args.shift();
  while (args.length) {
    const arg = args.shift();
    if (arg === '--dry-run') result.dryRun = true;
    else if (arg === '--include-app-data') result.includeAppData = true;
    else if (arg === '--include-voice-data') result.includeVoiceData = true;
    else if (arg === '--include-user-state') result.includeUserState = true;
    else if (arg === '--include-wsl') result.includeWsl = true;
    else if (arg === '--include-remote') result.includeRemote = true;
    else if (arg === '--include-project-state') result.includeProjectState = true;
    else if (arg === '--json') result.json = true;
    else if (arg === '-h' || arg === '--help') result.help = true;
    else if (arg === '--project') result.projects.push(requireValue(arg, args));
    else if (arg === '--wsl-home') result.wslHomes.push(requireValue(arg, args));
    else if (arg === '--remote-home') result.remoteHomes.push(requireValue(arg, args));
    else if (arg === '--voice-model-path') result.customVoicePaths.push(requireValue(arg, args));
    else if (arg === '--backup-root') result.backupRoot = requireValue(arg, args);
    else if (arg === '--manifest') result.manifestPath = requireValue(arg, args);
    else throw new Error(`알 수 없는 옵션입니다: ${arg}`);
  }
  if (!['scan', 'clean', 'restore'].includes(result.command)) throw new Error(`알 수 없는 명령입니다: ${result.command}`);
  if (result.command === 'restore' && !result.manifestPath && !result.help) {
    throw new Error('restore에는 --manifest <경로>가 필요합니다.');
  }
  return result;
}

function requireValue(option, args) {
  const value = args.shift();
  if (!value || value.startsWith('--')) throw new Error(`${option} 뒤에 경로가 필요합니다.`);
  return value;
}

function icon(kind) {
  return ({ skill: '🧩', 'skill-lock': '🔒', hook: '🪝', 'shared-state': '🔗',
    'skill-transaction': '🧹', extension: '🧱', 'app-data': '🗂️', 'voice-data': '🎙️',
    'user-state': '🔐', 'wsl-state': '🐧', 'remote-state': '🌐', cli: '⌨️',
    'project-state': '📁',
    'path-entry': '🛣️', unverified: '🛡️' })[kind] || '•';
}

function printScan(findings) {
  console.log('\nOrca Agent Cleanup 검사 결과\n');
  if (!findings.length) {
    console.log('✅ 확인된 Orca 잔재가 없습니다.');
    return;
  }
  for (const item of findings) {
    const option = item.requires ? ` [정리 시 --${item.requires.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} 필요]` : '';
    console.log(`${icon(item.kind)} ${item.path}`);
    console.log(`   ${item.reason}${option}`);
  }
  console.log(`\n총 ${findings.length}개가 확인되었습니다. 검사만 수행했으며 변경 사항은 없습니다.`);
}

function printClean(result) {
  console.log(`\nOrca Agent Cleanup ${result.dryRun ? '미리보기' : '정리 결과'}\n`);
  if (!result.actions.length) {
    console.log('✅ 정리할 항목이 없습니다.');
    return;
  }
  const labels = {
    quarantined: '✅ 격리', edited: '✅ 수정', 'would-quarantine': '🔎 격리 예정',
    'would-edit': '🔎 수정 예정', skipped: '⏭️ 옵션 제외', covered: '↳ 상위 상태에 포함',
    unchanged: '➖ 변경 없음', error: '❌ 오류',
  };
  for (const item of result.actions) console.log(`${labels[item.action] || item.action}  ${item.path}`);
  if (!result.dryRun && result.actions.some((item) => ['quarantined', 'edited'].includes(item.action))) {
    console.log(`\n복구용 백업: ${result.backupRoot}`);
  }
  if (result.errors.length) console.log(`\n⚠️ ${result.errors.length}개 항목은 자동 처리하지 못했습니다. 위 오류를 확인하세요.`);
}

function printRestore(result) {
  console.log(`\nOrca Agent Cleanup ${result.dryRun ? '복원 미리보기' : '복원 결과'}\n`);
  if (!result.actions.length) {
    console.log('✅ manifest에 복원할 완료 작업이 없습니다.');
    return;
  }
  const labels = {
    restored: '✅ 복원', 'would-restore': '🔎 복원 예정',
    'already-restored': '➖ 이미 복원됨', error: '❌ 오류',
  };
  for (const item of result.actions) {
    console.log(`${labels[item.action] || item.action}  ${item.path}`);
    if (item.conflictBackup) console.log(`   현재 항목 보존: ${item.conflictBackup}`);
  }
  if (result.reportPath) console.log(`\n복원 보고서: ${result.reportPath}`);
  if (result.errors.length) console.log(`\n⚠️ ${result.errors.length}개 항목은 복원하지 못했습니다.`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP.trim());
    process.exit(0);
  }
  if (options.command === 'restore') {
    const result = restoreOrcaBackup(options.manifestPath, options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printRestore(result);
    if (result.errors.length) process.exitCode = 2;
  } else if (options.command === 'scan') {
    const context = buildContext(options);
    const findings = scanOrcaResidue(context);
    if (options.json) console.log(JSON.stringify({ platform: context.platform, officialSkills: OFFICIAL_ORCA_SKILLS, findings }, null, 2));
    else printScan(findings);
  } else {
    const context = buildContext(options);
    const result = cleanOrcaResidue(context, options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else printClean(result);
    if (result.errors.length) process.exitCode = 2;
  }
} catch (error) {
  console.error(`오류: ${error.message}`);
  console.error('도움말: node scripts/orca-agent-cleanup.mjs --help');
  process.exitCode = 1;
}
