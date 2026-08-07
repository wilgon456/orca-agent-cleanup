<div align="center">

# 🧹 Orca Agent Cleanup

**Orca 제거 후에도 Claude Code·Codex가 계속 Orca CLI를 호출하나요?**<br>
남아 있는 스킬, 에이전트 훅, PATH와 앱 데이터를 찾아 안전하게 격리합니다.

[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![PowerShell](https://img.shields.io/badge/PowerShell-5.1%2B-5391FE?logo=powershell&logoColor=white)](https://learn.microsoft.com/powershell/)
[![License](https://img.shields.io/github/license/wilgon456/orca-agent-cleanup?color=2ea44f)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/wilgon456/orca-agent-cleanup)](https://github.com/wilgon456/orca-agent-cleanup/commits/main)
[![Stars](https://img.shields.io/github/stars/wilgon456/orca-agent-cleanup?style=social)](https://github.com/wilgon456/orca-agent-cleanup/stargazers)

[빠른 시작](#-빠른-시작) · [정리 범위](#-무엇을-정리하나요) · [안전장치](#-안전하게-동작하는-이유) · [복구 방법](#-복구-방법)

</div>

> [!IMPORTANT]
> 이 저장소는 Orca 공식 프로젝트와 관련이 없는 커뮤니티 도구입니다.<br>
> 인터넷에서 받은 정리 스크립트는 실행 전에 반드시 내용을 확인하세요.

## 🤔 이런 문제를 해결합니다

Orca 앱을 제거했는데도 다음과 같은 현상이 계속될 수 있습니다.

- `computer use` 요청이 OpenAI 기본 도구 대신 Orca CLI로 연결됨
- Claude Code가 프롬프트 제출·도구 실행 때마다 Orca 훅을 호출함
- `orca-cli`, `computer-use`, `orchestration` 스킬이 계속 노출됨
- 존재하지 않는 Orca 실행 경로가 사용자 `PATH`에 남아 있음
- `%APPDATA%\Orca`, `~/.orca` 등에 수 GB의 데이터가 남아 있음

주된 원인은 Orca가 공용 스킬 경로인 `~/.agents/skills`와 Claude Code 설정에 설치한 연동 항목이 앱 제거 후에도 남기 때문입니다.

## ✨ 주요 기능

| 기능 | 설명 |
| --- | --- |
| 🔎 출처 확인 | 이름만 보고 지우지 않고 `stablyai/orca` 출처를 검증합니다. |
| 🧩 스킬 정리 | `orca-cli`, `computer-use`, `orchestration` 및 Orca 출처 스킬을 격리합니다. |
| 🔗 훅 정리 | Claude Code 설정에서 Orca 훅과 상태 표시줄만 골라 제거합니다. |
| 🛡️ 정상 도구 보호 | Paseo, OpenAI 공식 `computer-use`, 다른 공급자의 스킬은 보존합니다. |
| 📦 복구 가능한 격리 | 영구 삭제 대신 타임스탬프가 붙은 백업 폴더로 이동합니다. |
| 👀 사전 확인 | 감사 모드와 `-WhatIf`으로 변경 내용을 먼저 확인할 수 있습니다. |

## 🚀 빠른 시작

### 1. 저장소 받기

Windows PowerShell 5.1 또는 PowerShell 7에서 실행하세요.

```powershell
git clone https://github.com/wilgon456/orca-agent-cleanup.git
cd orca-agent-cleanup
```

### 2. 잔재 검사하기

아무것도 변경하지 않고 남아 있는 항목만 보여줍니다.

```powershell
.\scripts\Get-OrcaAgentResidue.ps1
```

### 3. 정리 내용 미리보기

실제 변경 없이 수행 예정 작업을 확인합니다.

```powershell
.\scripts\Remove-OrcaAgentIntegrations.ps1 `
  -Apply `
  -IncludeAppData `
  -WhatIf
```

### 4. 안전하게 정리하기

설정 파일을 백업하고 Orca 연동 및 앱 데이터를 격리합니다.

```powershell
.\scripts\Remove-OrcaAgentIntegrations.ps1 `
  -Apply `
  -IncludeAppData
```

정리가 끝나면 실행 중인 Claude Code와 Codex를 완전히 종료한 뒤 다시 시작하세요. 기존 세션은 시작 시 불러온 스킬 목록을 캐시하고 있을 수 있습니다.

## 🧭 정리 과정

```mermaid
flowchart LR
    A["잔재 검사"] --> B["WhatIf 미리보기"]
    B --> C["설정 백업"]
    C --> D["스킬·훅 격리"]
    D --> E["Claude·Codex 재시작"]
    E --> F["정상 동작 확인"]
    F --> G["필요하면 백업 삭제"]
```

## 🧽 무엇을 정리하나요?

### 기본 정리 대상

- `~/.agents/.skill-lock.json`의 `stablyai/orca` 등록
- `~/.agents/skills` 아래 Orca 출처 스킬
- Claude Code의 Orca 에이전트 훅과 상태 표시줄 설정
- `~/.orca` 아래 Claude·Codex·기타 AI 에이전트 연결 훅
- 사용자 `PATH`의 정확한 Orca CLI 경로

### 선택 정리 대상

| 옵션 | 추가로 격리하는 항목 |
| --- | --- |
| `-IncludeAppData` | `%APPDATA%\Orca`, `%LOCALAPPDATA%\Orca` |
| `-IncludeWorkspaceData` | `~/orca` 워크스페이스 전체 |

> [!WARNING]
> `~/orca`에는 실제 Git 워크트리와 작업 파일이 있을 수 있습니다.<br>
> `-IncludeWorkspaceData`는 내용을 확인한 경우에만 사용하세요.

### 건드리지 않는 항목

- Paseo 스킬과 Paseo 데이터
- OpenAI 번들 `computer-use` 플러그인
- Orca와 무관한 Claude Code 훅
- 다른 공급자가 만든 동명 스킬
- 과거 채팅·세션 기록 속 단순 문자열
- 설치되어 실행 중인 Orca 프로그램 본체

Orca 앱이 아직 설치되어 있다면 먼저 **Windows 설정 → 앱 → 설치된 앱**에서 Orca를 제거하고 Claude, Codex, Orca를 모두 종료하세요.

## 🛡️ 안전하게 동작하는 이유

1. **기본 실행은 감사 모드입니다.** `-Apply`가 없으면 변경하지 않습니다.
2. **출처를 검증합니다.** 스킬 이름뿐 아니라 잠금 파일과 `SKILL.md` 서명을 확인합니다.
3. **설정을 통째로 덮어쓰지 않습니다.** Orca 명령이 들어간 훅만 선택적으로 제거합니다.
4. **영구 삭제하지 않습니다.** 모든 데이터는 백업 폴더로 이동합니다.
5. **반복 실행할 수 있습니다.** 이미 정리된 환경에서도 오류 없이 종료하도록 테스트합니다.

기본 백업 위치:

```text
~/OrcaAgentCleanupBackups/YYYYMMDD-HHmmss/
├─ config/       # 수정 전 설정 파일
├─ skills/       # 격리된 Orca 출처 스킬
└─ data/         # .orca, AppData, 선택한 워크스페이스
```

## ⚙️ 옵션

| 옵션 | 설명 |
| --- | --- |
| `-Apply` | 실제 변경을 허용합니다. 생략하면 감사만 수행합니다. |
| `-WhatIf` | 실행 예정 작업만 출력합니다. |
| `-IncludeAppData` | Roaming·Local Orca 앱 데이터를 격리합니다. |
| `-IncludeWorkspaceData` | `~/orca`를 격리합니다. 실제 작업 파일 포함 가능성이 있습니다. |
| `-BackupRoot <경로>` | 백업·격리 폴더를 직접 지정합니다. |
| `-SkipPathCleanup` | 사용자 `PATH`를 변경하지 않습니다. 테스트할 때 유용합니다. |

<details>
<summary><strong>감사 결과를 JSON으로 받기</strong></summary>

자동화나 진단 자료 수집에는 `-Json` 옵션을 사용할 수 있습니다.

```powershell
.\scripts\Get-OrcaAgentResidue.ps1 -Json
```

</details>

## ♻️ 복구 방법

실행 결과에 출력된 백업 폴더에서 다음 순서로 복구할 수 있습니다.

1. Claude Code, Codex, Orca 관련 프로세스를 모두 종료합니다.
2. `config`의 설정 파일을 원래 위치로 복사합니다.
3. `skills`와 `data`의 격리 폴더를 원래 위치로 이동합니다.
4. Claude Code와 Codex를 다시 시작합니다.

정상 동작을 충분히 확인한 뒤에만 백업 폴더를 직접 삭제해 디스크 공간을 회수하세요.

## 🧪 테스트

스모크 테스트는 임시 사용자 홈을 만들고 다음 사항을 확인합니다.

- Orca 출처 스킬만 격리되는지
- Paseo와 다른 공급자의 스킬이 보존되는지
- 정상 Claude Code 훅이 유지되는지
- 설정과 앱 데이터가 백업되는지
- 정리 스크립트를 두 번 실행해도 안전한지

```powershell
.\tests\Invoke-SmokeTest.ps1
```

## ❓ 자주 묻는 질문

<details>
<summary><strong>OpenAI의 computer use도 삭제되나요?</strong></summary>

아니요. 이 도구는 `stablyai/orca` 출처가 확인된 공유 스킬만 정리합니다. Codex에 포함된 OpenAI 공식 번들 플러그인은 건드리지 않습니다.

</details>

<details>
<summary><strong>Paseo도 함께 삭제되나요?</strong></summary>

아니요. Paseo는 별도 도구로 취급하며 스킬과 데이터를 모두 보존합니다.

</details>

<details>
<summary><strong>왜 바로 영구 삭제하지 않나요?</strong></summary>

앱 데이터나 `~/orca`에는 인증 정보, 설정, Git 워크트리 같은 사용자 데이터가 포함될 수 있습니다. 정상 동작을 확인하기 전까지 복구 가능성을 남기는 편이 안전합니다.

</details>

<details>
<summary><strong>실행 정책 오류가 나오면 어떻게 하나요?</strong></summary>

현재 PowerShell 프로세스에서만 임시로 허용한 뒤 다시 실행할 수 있습니다.

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

조직에서 관리하는 PC라면 보안 정책을 임의로 변경하지 말고 관리자에게 문의하세요.

</details>

## 🤝 기여하기

버그 제보와 Pull Request를 환영합니다. 이슈를 작성할 때 다음 정보를 포함해 주세요.

- Windows와 PowerShell 버전
- Orca 앱 제거 여부
- 비밀정보를 제거한 감사 결과
- 예상한 동작과 실제 동작

## 📄 라이선스

[MIT License](LICENSE)로 배포됩니다.

---

<div align="center">

도움이 되었다면 ⭐를 눌러 더 많은 사용자가 찾을 수 있게 해주세요.

</div>
