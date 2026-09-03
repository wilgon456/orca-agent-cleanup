<div align="center">

# 🐋 Orca Agent Cleanup

**Orca 제거 후에도 AI 에이전트가 Orca CLI·Computer Use를 계속 호출하나요?**<br>
Windows, macOS, Linux에 남아 있는 Orca 스킬, 훅, CLI, 음성 모델과 앱 데이터를 찾아 복구 가능하게 격리합니다.

[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white)](#-지원-운영체제)
[![macOS](https://img.shields.io/badge/macOS-지원-000000?logo=apple&logoColor=white)](#-지원-운영체제)
[![Linux](https://img.shields.io/badge/Linux-지원-FCC624?logo=linux&logoColor=black)](#-지원-운영체제)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Version](https://img.shields.io/badge/version-v1.3.0-2ea44f)](https://github.com/wilgon456/orca-agent-cleanup/releases)
[![Tests](https://github.com/wilgon456/orca-agent-cleanup/actions/workflows/test.yml/badge.svg)](https://github.com/wilgon456/orca-agent-cleanup/actions/workflows/test.yml)
[![License](https://img.shields.io/github/license/wilgon456/orca-agent-cleanup?color=2ea44f)](LICENSE)
[![Stars](https://img.shields.io/github/stars/wilgon456/orca-agent-cleanup?style=social)](https://github.com/wilgon456/orca-agent-cleanup/stargazers)

[빠른 시작](#-빠른-시작) · [정리 범위](#-무엇을-정리하나요) · [안전장치](#-안전하게-동작하는-이유) · [복구](#-복구-방법)

</div>

> [!IMPORTANT]
> 이 저장소는 Orca 또는 Stably와 관계없는 커뮤니티 도구입니다.<br>
> 먼저 Orca 앱을 정상 제거하고 Claude, Codex 등 관련 에이전트를 모두 종료한 뒤 사용하세요.

## 🆕 v1.3.0

- Linux AppImage가 만드는 `~/.cache/orca/appimage`와 서명이 확인된 Codex 플러그인 캐시의 Orca 스킬을 탐지합니다.
- 정리 전에 manifest v2 journal을 만들고 각 작업 전후 상태를 기록해 중단된 정리도 `restore`로 복구할 수 있습니다.
- 백업 파일과 디렉터리 내용의 SHA-256을 기록하며 `verify` 명령으로 복원 전에 손상을 확인합니다.
- 기본 백업 경로에 UUID를 사용하고 비어 있지 않은 사용자 지정 백업 폴더는 거부합니다.
- 공식 Orca 스킬·설치·캐시 계약의 변경을 매일 확인하고 차이가 생기면 Issue를 생성합니다.
- GitHub Actions를 커밋 SHA로 고정하고 CodeQL 및 Node.js 24 검증을 추가했습니다.

> [!NOTE]
> 이 도구는 **Orca 앱 본체를 제거하지 않습니다.** 운영체제의 정상 제거 기능으로 Orca를 먼저 삭제한 뒤, 남은 스킬·훅·CLI·설정·캐시를 정리하는 도구입니다.

## ✨ 이런 문제를 해결합니다

Orca 앱을 제거해도 공용 스킬 폴더와 각 에이전트 설정에는 연결 정보가 남을 수 있습니다. 그러면 다음과 같은 현상이 계속됩니다.

- `computer use` 요청이 기본 도구가 아니라 존재하지 않는 Orca CLI로 연결됨
- Claude Code나 Codex가 도구를 실행할 때마다 Orca 훅을 호출함
- `orca-cli`, `computer-use`, `orchestration` 등의 스킬이 계속 노출됨
- 삭제된 Orca 실행 경로가 `PATH` 또는 `/usr/local/bin/orca`에 남음
- 앱 데이터와 음성 모델이 디스크 공간을 계속 차지함

이 도구는 [Orca 공식 저장소](https://github.com/stablyai/orca)의 현재 스킬 manifest와 설치 코드를 기준으로 잔재를 식별합니다.

## ✅ 지원 범위 한눈에 보기

| 정리 대상 | Windows | macOS | Linux | 기본 정리 |
| --- | :---: | :---: | :---: | :---: |
| Orca 공식 스킬 8종 | ✅ | ✅ | ✅ | ✅ |
| Codex 플러그인 캐시의 서명된 Orca 스킬 | ✅ | ✅ | ✅ | ✅ |
| `computer-use`·`orca-cli`·`orchestration` | ✅ | ✅ | ✅ | ✅ |
| Claude·Codex·Gemini 등 Orca 관리형 훅 | ✅ | ✅ | ✅ | ✅ |
| `~/.orca`의 관리형 훅·암호화 음성 토큰 | ✅ | ✅ | ✅ | ✅ |
| Orca CLI 경로·런처 | ✅ | ✅ | ✅ | ✅ |
| Orca 앱 데이터와 기본 음성 모델 | ✅ | ✅ | ✅ | `--include-app-data` |
| 별도·사용자 지정 음성 모델 경로 | ✅ | ✅ | ✅ | `--include-voice-data` |
| WSL 릴레이·CLI·Skills | ✅ | — | — | `--include-wsl` |
| SSH 릴레이·원격 세션 | ✅ | ✅ | ✅ | `--include-remote` |
| `~/.orca` 전체 사용자 상태 | ✅ | ✅ | ✅ | `--include-user-state` |
| 프로젝트 `.orca`·worktree 휴지통 | ✅ | ✅ | ✅ | `--include-project-state` |

> [!TIP]
> **Orca 전용 정리 도구입니다.** Claude, Codex, Gemini 자체와 OpenAI 공식 `computer-use`, Paseo 및 다른 공급자의 스킬은 제거하지 않습니다.

## 🚀 빠른 시작

Node.js 18 이상이 필요합니다. Windows PowerShell, macOS Terminal, Linux 셸에서 명령은 같습니다.

### 1. 저장소 받기

```bash
git clone https://github.com/wilgon456/orca-agent-cleanup.git
cd orca-agent-cleanup
```

### 2. 잔재 검사

아무것도 변경하지 않고 발견된 항목만 보여줍니다.

```bash
node scripts/orca-agent-cleanup.mjs scan
```

### 3. 정리 결과 미리보기

앱 데이터와 음성 모델까지 포함한 예정 작업을 확인합니다.

```bash
node scripts/orca-agent-cleanup.mjs clean --dry-run --include-app-data --include-voice-data
```

### 4. 복구 가능하게 정리

```bash
node scripts/orca-agent-cleanup.mjs clean --include-app-data --include-voice-data
```

### 5. 백업 무결성 확인

```bash
node scripts/orca-agent-cleanup.mjs verify \
  --manifest ~/OrcaAgentCleanupBackups/<실행시각-UUID>/manifest.json
```

정리가 끝나면 Claude, Codex와 터미널을 완전히 종료한 뒤 다시 실행하세요. 기존 세션이 스킬 목록이나 환경 변수를 캐시하고 있을 수 있습니다.

## 🖥️ 지원 운영체제

| 환경 | 지원 내용 |
| --- | --- |
| Windows 10·11 | 공용·에이전트별 스킬, 관리형 훅, `%APPDATA%`·`%LOCALAPPDATA%`, `ProgramData`·`Public` 음성 캐시, 사용자 `PATH` |
| macOS | 공용·에이전트별 스킬, 관리형 훅, `~/Library`의 Stably 앱 데이터·음성 캐시, `/usr/local/bin/orca`·`~/.local/bin/orca` |
| Linux | 공용·에이전트별 스킬, 관리형 훅, `~/.config/Orca`·`~/.config/orca`, `~/.cache/Orca`·`~/.cache/orca/appimage`·`~/.cache/orca-updater`, 사용자 홈의 `orca-ide`와 관리형 `orca` dispatcher |

> [!NOTE]
> Linux에서 `/usr/bin/orca`는 GNOME 스크린 리더입니다. 이 도구는 그 경로를 건드리지 않습니다. Orca CLI 공식 명령은 `orca-ide`입니다. Windows에서 `--include-wsl`을 사용하면 실행 중인 WSL 배포판의 Linux 경로도 함께 검사합니다.

## 🧹 무엇을 정리하나요?

### 공식 번들 스킬 8종

Orca의 현재 공식 manifest에 등록된 다음 스킬을 검사합니다.

| 영역 | 스킬 |
| --- | --- |
| Computer Use·CLI | `computer-use`, `orca-cli` |
| 오케스트레이션 | `orchestration`, `orca-per-workspace-env` |
| 에뮬레이터 | `orca-emulator`, `orca-emulator-android` |
| Linear 연동 | `orca-linear`, `linear-tickets` |

검사하는 사용자 스킬 위치:

```text
~/.codex/skills                 ~/.agents/skills
~/.claude/skills                ~/.grok/skills
~/.config/opencode/skills       ~/.pi/agent/skills
~/.omp/agent/skills             ~/.hermes/skills
~/.prime/agent/skills           ~/.gemini/skills
~/.gemini/antigravity/skills    ~/.cursor/skills
~/.factory/skills               ~/.continue/skills
~/.trae-cn/skills               ~/.augment/skills
```

`CLAUDE_CONFIG_DIR`, `GROK_HOME`, `HERMES_HOME`으로 이동된 Skills와 Windows의 `%LOCALAPPDATA%\hermes\skills`도 검사합니다. Skills 설치가 중단되어 남은 `.orca-skill-extract-*`, `.*.orca-staging-*`, `.*.orca-placement-*` 등 Orca 전용 트랜잭션 경로도 격리합니다.

`--project`를 사용하면 프로젝트의 `.agents`, `.claude`, `.factory`, `.continue`, `.trae`, `.grok`, `.augment` 스킬 폴더도 검사합니다.

```bash
node scripts/orca-agent-cleanup.mjs scan --project /path/to/project
```

같은 프로젝트의 `.orca/issue-command`, `.orca/drops`와 인접 `.orca-worktree-trash`는 사용자 파일이 섞일 수 있어 `--include-project-state`를 함께 지정한 경우에만 격리합니다.

동일한 이름만으로는 정리하지 않습니다. `stablyai/orca` 잠금 정보나 파일 내부의 Orca 고유 서명이 확인되어야 합니다. 따라서 OpenAI 공식 `computer-use`, Paseo, 다른 공급자의 동명 스킬은 대상이 아닙니다.

### AI 에이전트 연결과 훅

Orca가 연결할 수 있는 다음 에이전트의 설정을 검사합니다.

```text
Claude / OpenClaude / Codex / Gemini / Antigravity / Cursor
Amp / Droid / Command Code / Grok / Copilot / Hermes / Devin / Kimi
```

- JSON 설정에서는 `.orca/agent-hooks` 등 Orca 명령이 들어간 훅만 제거합니다.
- Kimi의 Orca 관리 블록만 제거합니다.
- Amp·Hermes는 Orca 관리 표식이 확인된 플러그인만 격리합니다.
- `CLAUDE_CONFIG_DIR`, `GROK_HOME`, `HERMES_HOME`, `KIMI_CODE_HOME`을 반영합니다.
- `@orca-managed-pi-extension` 표식이 확인된 Pi·OMP·Prime 확장만 격리합니다.
- Codex의 `orca-agent-status.config.toml`과 `BEGIN/END ORCA AGENT STATUS HOOKS` 레거시 블록을 정리합니다.
- 권한, 모델, 타사 훅 등 나머지 설정은 보존합니다.
- 수정 전 원본 설정을 백업합니다.

### CLI와 공유 상태

- Windows 사용자 `PATH`의 공식 Orca CLI 경로
- macOS에서 Orca 앱을 가리키는 `/usr/local/bin/orca`, `~/.local/bin/orca`
- Linux의 `~/.local/bin/orca-ide`와 `# orca-serve-bare-orca-dispatcher` 표식이 있는 `~/.local/bin/orca`
- `~/.orca/agent-hooks` 관리형 훅과 `openai-speech-token.enc` 음성 토큰
- `~/.orca` 전체와 그 안의 자격증명·세션은 기본적으로 보존하며 `--include-user-state`에서만 함께 격리

macOS 런처는 심볼릭 링크 대상 또는 파일 내용이 `Orca.app`을 가리키는 경우에만 격리합니다. Linux에서는 공식 `orca-ide` 런처와 Orca가 만든 dispatcher만 대상으로 하며, GNOME `orca`는 유지합니다.

### 앱 데이터와 음성

`--include-app-data`로 다음 위치를 포함합니다.

| Windows | macOS | Linux |
| --- | --- | --- |
| `%APPDATA%\Orca` | `~/Library/Application Support/Orca` | `~/.config/Orca` |
| `%LOCALAPPDATA%\Orca` | `~/Library/Caches/com.stablyai.orca` | `~/.cache/Orca` |
| `%LOCALAPPDATA%\orca-updater` | `~/Library/Application Support/orca` | `~/.config/orca` |
|  | `~/Library/Caches/com.stablyai.orca.ShipIt` | `~/.cache/orca-updater` |
|  | `~/Library/Caches/orca-updater` | `~/.cache/orca/appimage` |
|  | `~/Library/HTTPStorages/com.stablyai.orca` |  |
|  | `~/Library/Preferences/com.stablyai.orca.plist` |  |
|  | `~/Library/Saved Application State/com.stablyai.orca.savedState` |  |

Orca의 기본 음성 모델은 앱 데이터의 `speech-models` 아래에 저장됩니다. Windows에서 비 ASCII 사용자 경로를 우회해 `ProgramData` 또는 `Public`에 만든 음성 캐시는 `--include-voice-data`로 함께 격리합니다.

사용자가 음성 모델 위치를 바꿨다면 해당 경로를 직접 지정하세요.

```bash
node scripts/orca-agent-cleanup.mjs clean --dry-run \
  --include-voice-data \
  --voice-model-path /custom/path/to/speech-models
```

PowerShell에서는 줄 연결 문자 대신 한 줄로 실행하거나 백틱(``)을 사용하면 됩니다.

### WSL·SSH·전체 사용자 상태

실행 중인 WSL 배포판의 `~/.orca-wsl`, `~/.local/share/orca`, CLI, 훅과 Skills를 포함하려면 다음처럼 미리 확인합니다.

```powershell
node scripts/orca-agent-cleanup.mjs clean --dry-run --include-wsl
```

자동 발견되지 않는 WSL 홈은 `--wsl-home <경로>`로 추가할 수 있습니다. SSH에는 자동 로그인하지 않습니다. 원격 서버에서 이 도구를 직접 실행하거나 로컬에서 접근 가능한 원격 홈을 `--remote-home <경로>`로 지정한 뒤 `--include-remote`를 사용하세요.

```bash
node scripts/orca-agent-cleanup.mjs clean --dry-run --include-remote --remote-home /mnt/remote/home/user
```

`--include-user-state`는 `~/.orca` 전체를 하나의 복구 단위로 격리합니다. 자격증명, 세션, 키 바인딩과 사용자 작업물이 포함될 수 있으므로 완전 제거가 목적일 때만 사용하세요.

## 🛡️ 안전하게 동작하는 이유

1. **기본 명령은 검사 전용입니다.** `scan`은 파일을 변경하지 않습니다.
2. **출처를 확인합니다.** 이름이 아니라 잠금 파일과 Orca 고유 서명을 함께 검사합니다.
3. **영구 삭제하지 않습니다.** 대상은 복구용 백업 폴더로 이동합니다.
4. **설정 전체를 덮어쓰지 않습니다.** 확인된 Orca 훅만 제거하고 원본을 백업합니다.
5. **미리보기를 제공합니다.** `clean --dry-run`으로 실제 작업 전에 확인할 수 있습니다.
6. **반복 실행할 수 있습니다.** 이미 정리된 환경에서는 추가 변경 없이 끝납니다.
7. **작업 전 journal을 기록합니다.** 정리 중 프로세스가 중단돼도 완료·대기 작업을 manifest에서 판별합니다.
8. **백업 내용도 검증합니다.** manifest v2는 파일과 디렉터리의 SHA-256을 기록하며 손상된 백업은 복원하지 않습니다.

### 자동 정리 승인 조건

| 항목 | 자동 정리되는 조건 |
| --- | --- |
| 스킬 | 공식 이름 8종이면서 해당 스킬 폴더의 `stablyai/orca` 잠금 출처 또는 Orca 고유 문구가 확인됨 |
| Codex 플러그인 캐시 | 깊이·항목 수를 제한해 탐색하고 `skills/<공식 이름>/SKILL.md`의 Orca 서명이 확인됨 |
| 프로젝트 스킬 | `--project`로 지정한 해당 프로젝트의 잠금 파일과 스킬 폴더가 서로 일치함 |
| 에이전트 훅 | 명령이 정확히 `.orca/agent-hooks`를 참조하거나 Orca 관리 표식이 확인됨 |
| 음성 캐시 | 경로 안에서 Orca 공식 음성 모델 ID가 확인됨 |
| macOS CLI | 런처가 실제 `Orca.app/Contents/Resources/bin`을 가리킴 |
| Linux CLI | `orca-ide`가 Orca 리소스 런처를 가리키거나 dispatcher에 공식 표식이 있음 |
| Windows PATH | `%LOCALAPPDATA%\Programs\orca\resources\bin`과 정확히 일치함 |
| 앱 데이터 | 운영체제별 공식 Orca 경로이며 사용자가 `--include-app-data`를 명시함 |
| Pi 계열 확장 | 파일 내부에 `@orca-managed-pi-extension` 표식이 확인됨 |
| WSL·SSH 상태 | Orca 고정 경로이며 각각 `--include-wsl`, `--include-remote`를 명시함 |
| 전체 사용자 상태 | 경로가 정확히 `~/.orca`이고 `--include-user-state`를 명시함 |
| 프로젝트 상태 | `--project`로 범위를 지정하고 `--include-project-state`를 명시함 |

조건을 만족하지 않는 동명 항목은 `unverified`로 표시하고 자동 정리하지 않습니다. 사용자 홈, 파일시스템 루트 또는 정리 대상 안에 지정된 백업 폴더도 거부합니다.

기본 백업 위치:

```text
~/OrcaAgentCleanupBackups/<실행 시각-UUID>/
├── manifest.json       # 작업 전부터 원자적으로 갱신하는 복구 journal
├── config-original/    # 수정 전 설정·PATH
├── skill/              # 격리한 스킬
├── skill-transaction/  # 중단된 Skills 설치·삭제 트랜잭션
├── hook/               # 격리한 관리형 훅
├── extension/          # Orca 관리형 Pi·OMP·Prime 확장
├── shared-state/       # ~/.orca 안의 확인된 훅·음성 토큰만
├── user-state/         # 명시적으로 포함한 ~/.orca 전체
├── wsl-state/          # 명시적으로 포함한 WSL 상태
├── remote-state/       # 명시적으로 포함한 SSH 릴레이·세션 상태
├── project-state/      # 명시적으로 포함한 프로젝트 Orca 상태
├── app-data/           # 앱 데이터
├── voice-data/         # 별도 음성 모델
└── cli/                # CLI 런처
```

## 🎛️ 명령 옵션

| 옵션 | 설명 |
| --- | --- |
| `scan` | 잔재를 검사하며 아무것도 변경하지 않습니다. |
| `clean` | 확인된 기본 잔재를 백업 폴더로 격리합니다. |
| `restore` | 정리 manifest를 기준으로 파일·설정·Windows PATH를 복원합니다. |
| `verify` | manifest와 백업 파일·디렉터리의 SHA-256 무결성을 검사합니다. |
| `--dry-run` | `clean` 예정 작업만 표시합니다. |
| `--include-app-data` | Orca 앱 데이터와 그 안의 기본 음성 모델을 포함합니다. |
| `--include-voice-data` | Windows의 별도 음성 캐시와 지정한 음성 경로를 포함합니다. |
| `--include-user-state` | 자격증명·세션을 포함한 `~/.orca` 전체를 격리합니다. |
| `--include-wsl` | 실행 중인 WSL 배포판의 Orca 상태를 포함합니다. |
| `--wsl-home <경로>` | WSL 홈 경로를 직접 추가합니다. 반복 지정할 수 있습니다. |
| `--include-remote` | SSH 릴레이·원격 세션 상태를 포함합니다. |
| `--remote-home <경로>` | 접근 가능한 원격 홈을 추가합니다. 반복 지정할 수 있습니다. |
| `--include-project-state` | 지정한 프로젝트의 `.orca`와 인접 worktree 휴지통을 포함합니다. |
| `--project <경로>` | 프로젝트 스킬 위치를 추가합니다. 반복 지정할 수 있습니다. |
| `--voice-model-path <경로>` | 사용자 지정 음성 모델 위치를 추가합니다. 반복 지정할 수 있습니다. |
| `--backup-root <경로>` | 백업·격리 폴더를 직접 지정합니다. |
| `--manifest <경로>` | `restore` 또는 `verify`에 사용할 `manifest.json`을 지정합니다. |
| `--json` | 자동화에 사용할 JSON 결과를 출력합니다. |

전체 도움말:

```bash
node scripts/orca-agent-cleanup.mjs --help
```

## ♻️ 복구 방법

각 백업의 `manifest.json`에는 원래 경로와 백업 경로가 함께 기록됩니다. v1.3부터 사용하는 `manifestVersion: 2`는 정리 시작 전에 생성되고 각 작업 전후에 원자적으로 갱신됩니다. 기존 v1 manifest도 계속 복원할 수 있습니다.

복원 전에 manifest, 경로 매핑과 백업 내용의 SHA-256을 검사할 수 있습니다. v1 백업은 당시 내용 해시를 기록하지 않았으므로 경로와 manifest만 검증합니다.

```bash
node scripts/orca-agent-cleanup.mjs verify \
  --manifest ~/OrcaAgentCleanupBackups/<실행시각-UUID>/manifest.json
```

manifest v2의 `cleanupStatus`가 `in-progress`라면 정리 도중 중단된 상태입니다. `restore --dry-run`으로 먼저 확인하면 백업까지 이동된 대기 작업은 복원하고, 아직 실행되지 않은 작업은 건너뜁니다.

먼저 Claude, Codex, Orca 등 관련 프로그램을 모두 종료하고 복원 예정 작업을 확인합니다.

```bash
node scripts/orca-agent-cleanup.mjs restore --dry-run \
  --manifest ~/OrcaAgentCleanupBackups/<실행시각>/manifest.json
```

확인 후 실제로 복원합니다.

```bash
node scripts/orca-agent-cleanup.mjs restore \
  --manifest ~/OrcaAgentCleanupBackups/<실행시각>/manifest.json
```

복원 위치에 정리 이후 생성·수정된 파일이 있으면 덮어쓰지 않습니다. 해당 항목을 같은 백업 폴더의 `restore-conflicts/<복원시각>/`에 먼저 보존한 뒤 정리 전 원본을 복원합니다. 복원 결과는 `restore-manifest-*.json`에 기록되며, 같은 manifest를 다시 실행해도 이미 복원된 동일 항목은 건너뜁니다.

자동 복구를 사용할 수 없는 경우에는 `manifest.json`의 `path`와 `backup`을 확인해 수동으로 되돌릴 수 있습니다. 설정 원본은 `config-original/`에 있습니다.

정상 동작을 충분히 확인한 후에만 백업 폴더를 직접 삭제하세요.

## ⚠️ 자동으로 하지 않는 작업

- Orca 앱 본체 삭제
- macOS 개인정보 보호 및 보안의 접근성·마이크·화면 기록 권한 변경
- Windows 설치 관리자 항목 또는 레지스트리의 앱 제거 정보 삭제
- GNOME 스크린 리더 `/usr/bin/orca` 삭제
- Linux 패키지 관리자가 설치한 시스템 `orca-ide` 삭제
- `/opt/orca`와 `/etc/systemd/system/orca-*.service` 같은 헤드리스 서버 시스템 설치물 삭제
- SSH 호스트에 자동 로그인하거나 네트워크 너머의 경로를 추측하는 작업
- 중지된 WSL 배포판을 자동으로 시작하는 작업
- 개발 체크아웃 전용 `orca-dev` 실행 파일·데이터 삭제
- Orca 소유권 표식이 없는 Codex trust 항목이나 설정 `.bak` 백업 삭제
- 출처를 확인할 수 없는 동명 스킬 삭제
- `~/orca` 및 프로젝트 안의 사용자 워크스페이스·소스 코드 삭제
- 과거 채팅·세션 기록에서 `orca`라는 문자열만 지우는 작업

Orca 앱이 아직 설치되어 있다면 먼저 정상 제거하세요.

- Windows: **설정 → 앱 → 설치된 앱 → Orca → 제거**
- macOS: Orca를 종료하고 **응용 프로그램**에서 `Orca.app`을 휴지통으로 이동
- Linux: 배포판 패키지 또는 AppImage를 먼저 제거하세요. Arch는 `stably-orca-bin` 같은 AUR 패키지를 패키지 관리자로 지웁니다.

macOS 권한은 필요하다면 **시스템 설정 → 개인정보 보호 및 보안**에서 Orca 항목을 직접 확인하세요.

## 🪟 기존 PowerShell 도구

Windows 전용 이전 인터페이스도 호환성을 위해 유지합니다.

```powershell
.\scripts\Get-OrcaAgentResidue.ps1
.\scripts\Remove-OrcaAgentIntegrations.ps1 -Apply -IncludeAppData -WhatIf
```

새로운 스킬 8종, 여러 에이전트 훅, 음성 데이터, macOS·Linux까지 포함하려면 공통 Node.js 도구 사용을 권장합니다.

## 🧪 테스트

테스트는 임시 사용자 폴더에 Windows, macOS, Linux 환경을 각각 구성하며 실제 사용자 설정을 변경하지 않습니다.

```bash
node --test tests/orca-agent-cleanup.test.mjs
```

GitHub Actions에서는 Windows, macOS, Ubuntu의 Node.js 18·22·24 조합과 Windows PowerShell 호환성을 검사합니다. CodeQL은 JavaScript 경로 처리와 데이터 흐름을 별도로 분석합니다. 공식 Orca 계약 파일은 매일 감시하며 변경 시 검토 Issue를 자동 생성합니다.

Windows 전용 기존 도구의 회귀 테스트:

```powershell
.\tests\Invoke-SmokeTest.ps1
```

보안 취약점 신고 방법은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 🙋 자주 묻는 질문

<details>
<summary><strong>OpenAI의 computer-use도 지우나요?</strong></summary>

아니요. `stablyai/orca` 출처 또는 Orca 고유 서명이 확인된 복사본만 대상으로 합니다. OpenAI 공식 번들 플러그인이나 출처가 다른 동명 스킬은 보존합니다.

</details>

<details>
<summary><strong>음성 API 키도 남아 있나요?</strong></summary>

Orca가 저장한 암호화 음성 토큰 `~/.orca/openai-speech-token.enc`만 개별 격리합니다. `~/.orca` 전체, 운영체제 키체인과 다른 프로그램의 API 키는 건드리지 않습니다.

</details>

<details>
<summary><strong>왜 바로 영구 삭제하지 않나요?</strong></summary>

설정과 앱 데이터에는 인증 정보나 사용자 파일이 포함될 수 있습니다. AI 에이전트가 정상 동작하는지 확인할 때까지 복구 가능성을 남기는 편이 안전합니다.

</details>

## 🤝 기여하기

버그 제보와 Pull Request를 환영합니다. 이슈에는 운영체제, Orca 제거 여부, 개인정보를 가린 `scan --json` 결과, 예상 동작과 실제 동작을 적어 주세요.

## 📄 라이선스

[MIT License](LICENSE)로 배포합니다.

---

<div align="center">

도움이 되었다면 ⭐를 눌러 더 많은 사용자가 찾을 수 있게 해주세요.

</div>
