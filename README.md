# Multimixer

브라우저에서 도는 **멀티트랙 오디오 재생기**. 트랙별 볼륨·뮤트·솔로, 파형 시각화,
재생/정지/탐색/구간반복, 마스터 볼륨, 믹스 내보내기(WAV), **메트로놈**을 지원합니다.

가장 중요한 설계 목표는 **트랙 간 드리프트·위상 어긋남이 절대 없어야 한다**는 것입니다.

**메트로놈**도 같은 원리로 위상 고정됩니다: 클릭을 `AudioBuffer`로 렌더해 트랙들과 **동일한
공통 `t0`**에 `start` → 음악과 샘플 단위로 정렬(t=0이 첫 클릭). 클릭 버퍼는 `t0`를 정하기
**전에** 미리 생성하므로 생성 지연이 시작 시각을 밀지 않고(과거 예약 방지), 낮은 샘플레이트로
렌더해 메모리·생성비용을 줄입니다(재생 시 컨텍스트 레이트로 리샘플, 타이밍 보존). BPM은 업로드
파일 메타데이터(ID3 TBPM 등)에 있으면 자동 사용, 없으면 수동 입력.

## 왜 드리프트가 없는가 (핵심 설계)

여러 `<audio>` 엘리먼트를 동시에 재생하면 각자 독립된 클럭 때문에 시간이 지날수록
어긋납니다. Multimixer는 그렇게 하지 않습니다:

1. **단일 `AudioContext`** — 앱 전체가 하나의 샘플 클럭을 공유.
2. 모든 트랙을 **`AudioBuffer`로 완전 디코드** (`decodeAudioData`가 컨텍스트 샘플레이트로
   리샘플하므로 서로 다른 소스도 동일 레이트로 정렬).
3. 재생할 때 트랙마다 `AudioBufferSourceNode`를 만들고 **전부 같은 미래 시각 `t0`에 시작**:
   같은 클럭 + 같은 시작 샘플 ⇒ 위상 고정, 드리프트가 **수학적으로 불가능**.
4. `AudioBufferSourceNode`는 일시정지가 안 되므로 pause/seek/loop 변경은 "모든 소스를
   내리고 새 공통 `t0`로 다시 예약"으로 처리 — 항상 함께 움직입니다.
5. 버퍼를 타임라인 길이에 맞춰 제로패딩해, 네이티브 루프(`loopStart`/`loopEnd`)가 트랙마다
   **정확히 같은 샘플**에서 감깁니다.

자세한 근거는 코드 주석(`src/audio/AudioEngine.ts`)을 참고하세요.

## 개발

```bash
npm install
npm run dev        # 개발 서버
npm run build      # 타입체크 + 프로덕션 빌드
npm test           # 순수 로직 유닛테스트 (Vitest)
```

브라우저에서 "데모 스템 로드"를 누르면 즉석 합성된 4개 스템(Drums/Bass/Chords/Arp)이
로드됩니다. 파형을 클릭하면 탐색(seek), 드래그하면 루프 구간이 지정됩니다.

## 검증 (드리프트/위상)

- **유닛테스트**: `npm test` — 솔로/뮤트/볼륨 해석, 위치 계산 + 루프 wrap, 파형 버킷.
- **브라우저 위상-정렬 증명**: 빌드 후 아래를 실행하면 실제 브라우저에서 모든 소스의
  예약 시작 시각이 동일함을 자동 검증합니다.

  ```bash
  npm run build
  npm i -D playwright
  node scripts/verify-phase-lock.mjs
  ```

- **수동 확인**: 재생 중 콘솔에서 `window.__mmEngine.getDebugSchedule()` 의 모든
  `scheduledStart` 값이 동일한지 확인.

## 구조

```
src/audio/      # 프레임워크 독립 오디오 엔진 (위상-핵심) + 순수 모듈 + 테스트
src/state/      # 엔진 ↔ React 브리지 (useSyncExternalStore)
src/components/ # UI: Transport, TrackRow, Waveform, DropZone
scripts/        # 브라우저 위상-정렬 검증 스크립트
docs/           # Claude Code ↔ Codex 협업 가이드
```

두 AI 도구(Claude Code, Codex)로 함께 개발하기 위한 경계선과 규칙은
[`docs/COLLABORATION.md`](docs/COLLABORATION.md)를 참고하세요.
