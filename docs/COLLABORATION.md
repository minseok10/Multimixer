# Claude Code ↔ Codex 협업 가이드

이 저장소는 두 AI 코딩 도구(Claude Code, Codex)로 함께 개발하는 것을 전제로 구조를
잡았습니다. 핵심 아이디어는 **"위험도에 따라 경계선을 긋고, 그 경계를 계약으로 만든다"**
입니다.

## 1. 경계선 = 위험도 분리

| 영역 | 경로 | 성격 | 담당 원칙 |
| --- | --- | --- | --- |
| **오디오 엔진 (위상-핵심)** | `src/audio/**` | 드리프트·위상 정렬이 걸린 타이밍/스케줄링 코드 | 신중하게 작성 + **테스트로 잠금**. 스케줄링 로직은 함부로 리팩터링하지 않는다. |
| **UI / 인터랙션** | `src/components/**`, `src/styles.css` | 표시·레이아웃·상호작용 | 자유롭게 반복 개선하기 안전. Codex가 다루기 좋음. |
| **상태 브리지** | `src/state/**` | 엔진 ↔ React 연결 | 얇게 유지. 인터페이스 변경 시에만 손댐. |

> 왜 이렇게? 드리프트/위상 어긋남은 **스케줄링 한 곳**에서만 결정됩니다
> (`AudioEngine.play()`의 공통 `t0`). 이 지점을 건드리지 않는 한 UI는 아무리 바꿔도
> 위상은 깨지지 않습니다. 그래서 UI는 넓게 열고, 엔진은 좁게 잠급니다.

## 2. 공개 인터페이스를 계약으로

UI는 엔진 **내부**가 아니라 **공개 API**에만 의존합니다.

- 타입 계약: [`src/audio/types.ts`](../src/audio/types.ts) — `EngineState`, `TrackState`,
  `LoopRegion`, `Peaks`.
- 메서드 계약: `AudioEngine`의 public 메서드
  (`loadFile`, `addTrackBuffer`, `play/pause/stop/seek`, `setVolume/toggleMute/toggleSolo`,
  `setMasterVolume`, `setLoop/setLoopEnabled`, `subscribe/getSnapshot`, `getExportData`).

**Codex에게 줄 때:** "이 인터페이스에만 의존하고 `src/audio` 내부 구현은 바꾸지 말 것"을
명시하세요. UI 작업은 대부분 `EngineState` 스냅샷을 읽고 메서드를 호출하는 것으로 끝납니다.

## 3. 테스트가 가드레일

위상·게인·위치 계산 같은 **순수 로직**은 유닛테스트로 고정되어 있습니다.

- `src/audio/gains.test.ts` — 솔로/뮤트/볼륨 해석
- `src/audio/transport.test.ts` — 위치 계산 + 루프 wrap
- `src/audio/peaks.test.ts` — 파형 버킷

**규칙:** `src/audio`를 건드리는 변경은 `npm test`(그리고 아래 브라우저 검증) 통과가
필수입니다. Codex가 만든 PR이든 사람이 만든 PR이든, 테스트가 빨간불이면 머지하지 않습니다.
이렇게 하면 어느 도구가 만졌든 위상·게인 회귀가 즉시 드러납니다.

## 4. 실전 작업 쪼개기 예시

- **Claude (이 저장소에서 완료함):** 스캐폴딩, `AudioEngine`, 순수 모듈 + 테스트, 데모 스템,
  믹스다운/export, React 브리지, 공개 인터페이스 문서화.
- **Codex에게 넘기기 좋은 것:**
  - `TrackRow` / `Transport` 스타일·레이아웃 다듬기, 반응형 개선
  - 키보드 단축키(스페이스=재생/정지, ←/→=탐색 등)
  - 파형 색상 테마, 접근성(aria) 보강
  - 트랙 순서 드래그 정렬 같은 UI 기능 (엔진 메서드만 호출)
- **엔진에 손대야 하는 기능**(예: 크로스페이드, 트랙별 딜레이 보정)은 Claude 쪽에서
  테스트를 먼저 추가한 뒤 구현하는 것을 권장합니다.

## 5. 드리프트/위상 검증 방법 (어느 도구가 바꿨든 재현)

- `window.__mmEngine.getDebugSchedule()` — 재생 중 모든 소스의 `scheduledStart`가
  **완전히 동일**해야 합니다. 하나라도 다르면 위상 정렬이 깨진 것.
- 저장소 루트의 검증 스크립트(README의 "검증" 참고)로 브라우저에서 자동 확인 가능.
