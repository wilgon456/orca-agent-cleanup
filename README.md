<div align="center">

# 🐋 Orca Agent Cleanup

**Orca 제거 후에도 AI 에이전트가 Orca CLI·Computer Use를 계속 호출하나요?**<br>
Windows와 macOS에 남아 있는 Orca 스킬, 훅, CLI, 음성 모델과 앱 데이터를 찾아 복구 가능하게 격리합니다.

[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white)](#-지원-운영체제)
[![macOS](https://img.shields.io/badge/macOS-지원-000000?logo=apple&logoColor=white)](#-지원-운영체제)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://github.com/wilgon456/orca-agent-cleanup/actions/workflows/test.yml/badge.svg)](https://github.com/wilgon456/orca-agent-cleanup/actions/workflows/test.yml)
[![License](https://img.shields.io/github/license/wilgon456/orca-agent-cleanup?color=2ea44f)](LICENSE)
[![Stars](https://img.shields.io/github/stars/wilgon456/orca-agent-cleanup?style=social)](https://github.com/wilgon456/orca-agent-cleanup/stargazers)

[빠른 시작](#-빠른-시작) · [정리 범위](#-무엇을-정리하나요) · [안전장치](#-안전하게-동작하는-이유) · [복구](#-복구-방법)

</div>

> [!IMPORTANT]
> 이 저장소는 Orca 또는 Stably와 관계없는 커뮤니티 도구입니다.<br>
> 먼저 Orca 앱을 정상 제거하고 Claude, Codex 등 관련 에이전트를 모두 종료한 뒤 사용하세요.

## ✨ 이런 문제를 해결합니다

Orca 앱을 제거해도 공용 스킬 폴더와 각 에이전트 설정에는 연결 정보가 남을 수 있습니다. 그러면 다음과 같은 현상이 계속됩니다.

- `computer use` 요청이 기본 도구가 아니라 존재하지 않는 Orca CLI로 연결됨
- Claude Code나 Codex가 도구를 실행할 때마다 Orca 훅을 호출함
- `orca-cli`, `computer-use`, `orchestration` 등의 스킬이 계속 노출됨
- 삭제된 Orca 실행 경로가 `PATH` 또는 `/usr/local/bin/orca`에 남음
- 앱 데이터와 음성 모델이 디스크 공간을 계속 차지함

이 도구는 [Orca 공식 저장소](https://github.com/stablyai/orca)의 현재 스킬 manifest와 설치 코드를 기준으로 잔재를 식별합니다.

## ✅ 지원 범위 한눈에 보기

| 정리 대상 | Windows | macOS | 기본 정리 |
| --- | :---: | :---: | :---: |
| Orca 공식 스킬 8종 | ✅ | ✅ | ✅ |
| `computer-use`·`orca-cli`·`orchestration` | ✅ | ✅ | ✅ |
| Claude·Codex·Gemini 등 Orca 관리형 훅 | ✅ | ✅ | ✅ |
| `~/.orca`의 관리형 훅·암호화 음성 토큰 | ✅ | ✅ | ✅ |
| Orca CLI 경로·런처 | ✅ | ✅ | ✅ |
| Orca 앱 데이터와 기본 음성 모델 | ✅ | ✅ | `--include-app-data` |
| 별도·사용자 지정 음성 모델 경로 | ✅ | ✅ | `--include-voice-data` |

> [!TIP]
> **Orca 전용 정리 도구입니다.** Claude, Codex, Gemini 자체와 OpenAI 공식 `computer-use`, Paseo 및 다른 공급자의 스킬은 제거하지 않습니다.

## 🚀 빠른 시작

Node.js 18 이상이 필요합니다. Windows PowerShell, macOS Terminal에서 명령은 같습니다.

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

정리가 끝나면 Claude, Codex와 터미널을 완전히 종료한 뒤 다시 실행하세요. 기존 세션이 스킬 목록이나 환경 변수를 캐시하고 있을 수 있습니다.

## 🖥️ 지원 운영체제

| 환경 | 지원 내용 |
| --- | --- |
| Windows 10·11 | 공용·에이전트별 스킬, 관리형 훅, `%APPDATA%`·`%LOCALAPPDATA%`, `ProgramData`·`Public` 음성 캐시, 사용자 `PATH` |
| macOS | 공용·에이전트별 스킬, 관리형 훅, `~/Library`의 Stably 앱 데이터·음성 캐시, `/usr/local/bin/orca`·`~/.local/bin/orca` |

> [!NOTE]
> Linux와 WSL은 현재 정식 테스트 대상이 아닙니다. macOS와 Windows용 경로를 Linux 환경에 그대로 적용하지 마세요.

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
~/.omp/agent/skills             ~/.gemini/skills
~/.gemini/antigravity/skills    ~/.cursor/skills
```

`--project`를 사용하면 프로젝트의 `.agents/skills`, `.claude/skills`도 검사합니다.

```bash
node scripts/orca-agent-cleanup.mjs scan --project /path/to/project
```

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
- 권한, 모델, 타사 훅 등 나머지 설정은 보존합니다.
- 수정 전 원본 설정을 백업합니다.

### CLI와 공유 상태

- Windows 사용자 `PATH`의 공식 Orca CLI 경로
- macOS에서 Orca 앱을 가리키는 `/usr/local/bin/orca`, `~/.local/bin/orca`
- `~/.orca/agent-hooks` 관리형 훅과 `openai-speech-token.enc` 음성 토큰
- `~/.orca` 전체와 그 안의 worktree·사용자 파일은 보존

macOS 런처는 심볼릭 링크 대상 또는 파일 내용이 `Orca.app`을 가리키는 경우에만 격리합니다. 같은 이름의 무관한 명령은 유지합니다.

### 앱 데이터와 음성

`--include-app-data`로 다음 위치를 포함합니다.

| Windows | macOS |
| --- | --- |
| `%APPDATA%\Orca` | `~/Library/Application Support/Orca` |
| `%LOCALAPPDATA%\Orca` | `~/Library/Caches/com.stablyai.orca` |
|  | `~/Library/Caches/com.stablyai.orca.ShipIt` |
|  | `~/Library/HTTPStorages/com.stablyai.orca` |
|  | `~/Library/Preferences/com.stablyai.orca.plist` |
|  | `~/Library/Saved Application State/com.stablyai.orca.savedState` |

Orca의 기본 음성 모델은 앱 데이터의 `speech-models` 아래에 저장됩니다. Windows에서 비 ASCII 사용자 경로를 우회해 `ProgramData` 또는 `Public`에 만든 음성 캐시는 `--include-voice-data`로 함께 격리합니다.

사용자가 음성 모델 위치를 바꿨다면 해당 경로를 직접 지정하세요.

```bash
node scripts/orca-agent-cleanup.mjs clean --dry-run \
  --include-voice-data \
  --voice-model-path /custom/path/to/speech-models
```

PowerShell에서는 줄 연결 문자 대신 한 줄로 실행하거나 백틱(``)을 사용하면 됩니다.

## 🛡️ 안전하게 동작하는 이유

1. **기본 명령은 검사 전용입니다.** `scan`은 파일을 변경하지 않습니다.
2. **출처를 확인합니다.** 이름이 아니라 잠금 파일과 Orca 고유 서명을 함께 검사합니다.
3. **영구 삭제하지 않습니다.** 대상은 복구용 백업 폴더로 이동합니다.
4. **설정 전체를 덮어쓰지 않습니다.** 확인된 Orca 훅만 제거하고 원본을 백업합니다.
5. **미리보기를 제공합니다.** `clean --dry-run`으로 실제 작업 전에 확인할 수 있습니다.
6. **반복 실행할 수 있습니다.** 이미 정리된 환경에서는 추가 변경 없이 끝납니다.

### 자동 정리 승인 조건

| 항목 | 자동 정리되는 조건 |
| --- | --- |
| 스킬 | 공식 이름 8종이면서 해당 스킬 폴더의 `stablyai/orca` 잠금 출처 또는 Orca 고유 문구가 확인됨 |
| 프로젝트 스킬 | `--project`로 지정한 해당 프로젝트의 잠금 파일과 스킬 폴더가 서로 일치함 |
| 에이전트 훅 | 명령이 정확히 `.orca/agent-hooks`를 참조하거나 Orca 관리 표식이 확인됨 |
| 음성 캐시 | 경로 안에서 Orca 공식 음성 모델 ID가 확인됨 |
| macOS CLI | 런처가 실제 `Orca.app/Contents/Resources/bin`을 가리킴 |
| Windows PATH | `%LOCALAPPDATA%\Programs\orca\resources\bin`과 정확히 일치함 |
| 앱 데이터 | 운영체제별 공식 Orca 경로이며 사용자가 `--include-app-data`를 명시함 |

조건을 만족하지 않는 동명 항목은 `unverified`로 표시하고 자동 정리하지 않습니다. 사용자 홈, 파일시스템 루트 또는 정리 대상 안에 지정된 백업 폴더도 거부합니다.

기본 백업 위치:

```text
~/OrcaAgentCleanupBackups/<실행 시각>/
├── manifest.json       # 원래 경로, 작업 결과, 복구 위치
├── config-original/    # 수정 전 설정·PATH
├── skill/              # 격리한 스킬
├── hook/               # 격리한 관리형 훅
├── shared-state/       # ~/.orca 안의 확인된 훅·음성 토큰만
├── app-data/           # 앱 데이터
├── voice-data/         # 별도 음성 모델
└── cli/                # CLI 런처
```

## 🎛️ 명령 옵션

| 옵션 | 설명 |
| --- | --- |
| `scan` | 잔재를 검사하며 아무것도 변경하지 않습니다. |
| `clean` | 확인된 기본 잔재를 백업 폴더로 격리합니다. |
| `--dry-run` | `clean` 예정 작업만 표시합니다. |
| `--include-app-data` | Orca 앱 데이터와 그 안의 기본 음성 모델을 포함합니다. |
| `--include-voice-data` | Windows의 별도 음성 캐시와 지정한 음성 경로를 포함합니다. |
| `--project <경로>` | 프로젝트 스킬 위치를 추가합니다. 반복 지정할 수 있습니다. |
| `--voice-model-path <경로>` | 사용자 지정 음성 모델 위치를 추가합니다. 반복 지정할 수 있습니다. |
| `--backup-root <경로>` | 백업·격리 폴더를 직접 지정합니다. |
| `--json` | 자동화에 사용할 JSON 결과를 출력합니다. |

전체 도움말:

```bash
node scripts/orca-agent-cleanup.mjs --help
```

## ♻️ 복구 방법

각 백업의 `manifest.json`에는 원래 경로와 백업 경로가 함께 기록됩니다.

1. Claude, Codex 등 관련 프로그램을 모두 종료합니다.
2. `manifest.json`에서 복구할 항목의 `path`와 `backup`을 확인합니다.
3. 격리된 파일·폴더를 `backup`에서 원래 `path`로 되돌립니다.
4. 설정 파일은 `config-original`의 원본으로 교체합니다.
5. 프로그램을 다시 실행합니다.

정상 동작을 충분히 확인한 후에만 백업 폴더를 직접 삭제하세요.

## ⚠️ 자동으로 하지 않는 작업

- Orca 앱 본체 삭제
- macOS 개인정보 보호 및 보안의 접근성·마이크·화면 기록 권한 변경
- Windows 설치 관리자 항목 또는 레지스트리의 앱 제거 정보 삭제
- 출처를 확인할 수 없는 동명 스킬 삭제
- `~/orca` 및 프로젝트 안의 사용자 워크스페이스·소스 코드 삭제
- 과거 채팅·세션 기록에서 `orca`라는 문자열만 지우는 작업

Orca 앱이 아직 설치되어 있다면 먼저 정상 제거하세요.

- Windows: **설정 → 앱 → 설치된 앱 → Orca → 제거**
- macOS: Orca를 종료하고 **응용 프로그램**에서 `Orca.app`을 휴지통으로 이동

macOS 권한은 필요하다면 **시스템 설정 → 개인정보 보호 및 보안**에서 Orca 항목을 직접 확인하세요.

## 🪟 기존 PowerShell 도구

Windows 전용 이전 인터페이스도 호환성을 위해 유지합니다.

```powershell
.\scripts\Get-OrcaAgentResidue.ps1
.\scripts\Remove-OrcaAgentIntegrations.ps1 -Apply -IncludeAppData -WhatIf
```

새로운 스킬 8종, 여러 에이전트 훅, 음성 데이터, macOS까지 포함하려면 공통 Node.js 도구 사용을 권장합니다.

## 🧪 테스트

테스트는 임시 사용자 폴더에 Windows와 macOS 환경을 각각 구성하며 실제 사용자 설정을 변경하지 않습니다.

```bash
node --test tests/orca-agent-cleanup.test.mjs
```

Windows 전용 기존 도구의 회귀 테스트:

```powershell
.\tests\Invoke-SmokeTest.ps1
```

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
