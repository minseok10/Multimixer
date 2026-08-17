/**
 * 스템 이름에서 악기 이름만 뽑아내는 규칙.
 *
 * 관리 화면의 "스템 이름 일괄 정리"와 CLI(`scripts/rename-stems.mjs`)가 같은 결과를
 * 내야 하므로 규칙은 여기 한 곳에만 둔다. 브라우저와 Node에서 모두 그대로 import할 수
 * 있도록 의존성 없는 순수 ESM으로 유지한다.
 */

/** 파일명 꼬리표로 흔히 붙는 악기 이름. 표기(대소문자·복수형)는 이 목록으로 통일한다. */
export const INSTRUMENTS = [
  'Vocals', 'Vocal', 'Drums', 'Drum', 'Bass', 'Guitar', 'Guitars', 'Piano', 'Keys',
  'Keyboard', 'Synth', 'Strings', 'Brass', 'Perc', 'Percussion', 'Other', 'Inst', 'MR',
  'Chorus', 'Pad', 'Arp', 'Lead', 'FX', 'Click',
];

const CANONICAL = new Map(INSTRUMENTS.map((name) => [name.toLowerCase(), name]));

/**
 * 스템 이름에서 악기 부분만 뽑아낸다. 확신이 없으면 null(=건드리지 않음)을 준다.
 *
 * @param {string} stemName
 * @returns {string | null}
 */
export function instrumentName(stemName) {
  const trimmed = stemName.trim();

  // 1순위: 맨 뒤 괄호 — "제목 [영상ID] (Vocals)" 형태
  const parenthesized = trimmed.match(/\(([^()]+)\)\s*$/);
  if (parenthesized) {
    const inner = parenthesized[1].trim();
    if (!inner) return null;
    return CANONICAL.get(inner.toLowerCase()) ?? inner;
  }

  // 2순위: 구분자로 끝에 붙은 악기 이름 — "제목_drums", "제목 - Bass"
  const suffix = trimmed.match(/[-_ ]([A-Za-z]+)\s*$/);
  if (suffix) {
    const canonical = CANONICAL.get(suffix[1].toLowerCase());
    if (canonical) return canonical;
  }

  // 3순위: 이름 전체가 이미 악기 이름 (표기만 정리)
  return CANONICAL.get(trimmed.toLowerCase()) ?? null;
}
