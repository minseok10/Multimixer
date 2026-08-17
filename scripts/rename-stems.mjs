/**
 * 업로드된 스템 이름에서 악기 이름만 남기는 일괄 정리 스크립트.
 *
 *   "Can't Be Right [68aA_o4yGwo] (Vocals)"  →  "Vocals"
 *   "여름밤_drums"                            →  "Drums"
 *
 * 기본은 미리보기(dry run)라 아무것도 바꾸지 않습니다. 목록을 확인한 뒤
 * --apply를 붙여 실제로 반영하세요.
 *
 * 사용법:
 *   node scripts/rename-stems.mjs                       # 미리보기
 *   ADMIN_PASSWORD=... node scripts/rename-stems.mjs --apply
 *   node scripts/rename-stems.mjs --base http://localhost:8787
 *   node scripts/rename-stems.mjs --song <노래 ID>       # 한 곡만
 */

const DEFAULT_BASE = 'https://mix.minseok.site';

// 파일명 꼬리표로 흔히 붙는 악기 이름. 표기(대소문자·복수형)는 이 목록으로 통일한다.
const INSTRUMENTS = [
  'Vocals', 'Vocal', 'Drums', 'Drum', 'Bass', 'Guitar', 'Guitars', 'Piano', 'Keys',
  'Keyboard', 'Synth', 'Strings', 'Brass', 'Perc', 'Percussion', 'Other', 'Inst', 'MR',
  'Chorus', 'Pad', 'Arp', 'Lead', 'FX', 'Click',
];
const CANONICAL = new Map(INSTRUMENTS.map((name) => [name.toLowerCase(), name]));

/**
 * 스템 이름에서 악기 부분만 뽑아낸다. 확신이 없으면 null(=건너뜀)을 준다.
 */
export function instrumentName(stemName) {
  const trimmed = stemName.trim();

  // 1순위: 맨 뒤 괄호 — "제목 [id] (Vocals)" 형태
  const parenthesized = trimmed.match(/\(([^()]+)\)\s*$/);
  if (parenthesized) return canonicalize(parenthesized[1].trim());

  // 2순위: 구분자로 끝에 붙은 악기 이름 — "제목_drums", "제목 - Bass"
  const suffix = trimmed.match(/[-_ ]([A-Za-z]+)\s*$/);
  if (suffix) {
    const canonical = CANONICAL.get(suffix[1].toLowerCase());
    if (canonical) return canonical;
  }

  // 3순위: 이름 전체가 이미 악기 이름 (표기만 정리)
  const whole = CANONICAL.get(trimmed.toLowerCase());
  if (whole) return whole;

  return null;
}

function canonicalize(value) {
  if (!value) return null;
  return CANONICAL.get(value.toLowerCase()) ?? value;
}

function parseArgs(argv) {
  const options = { base: DEFAULT_BASE, apply: false, song: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') options.apply = true;
    else if (argv[i] === '--base') options.base = argv[++i];
    else if (argv[i] === '--song') options.song = argv[++i];
    else throw new Error(`알 수 없는 인자: ${argv[i]}`);
  }
  return options;
}

async function readJson(response, fallback) {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `${fallback} (HTTP ${response.status})`);
  return body;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const password = process.env.ADMIN_PASSWORD;
  if (options.apply && !password) {
    console.error('--apply에는 ADMIN_PASSWORD 환경 변수가 필요합니다.');
    process.exit(1);
  }
  const authorization = password
    ? `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`
    : null;

  console.log(options.apply
    ? `스템 이름 일괄 정리 — 실제 적용\n대상: ${options.base}\n`
    : `스템 이름 일괄 정리 — 미리보기(아무것도 바꾸지 않음)\n대상: ${options.base}\n`);

  const library = await readJson(await fetch(`${options.base}/api/songs`), '노래 목록을 불러오지 못했습니다.');
  const songs = options.song ? library.songs.filter((s) => s.id === options.song) : library.songs;
  if (!songs.length) throw new Error('대상 노래가 없습니다.');

  let renamed = 0;
  let skipped = 0;
  let touchedSongs = 0;

  for (const song of songs) {
    const { song: detail } = await readJson(
      await fetch(`${options.base}/api/songs/${encodeURIComponent(song.id)}`),
      `${song.name} 정보를 불러오지 못했습니다.`,
    );
    const plans = detail.stems.map((stem) => ({ stem, next: instrumentName(stem.name) }));
    const changes = plans.filter(({ stem, next }) => next && next !== stem.name);
    const unmatched = plans.filter(({ next }) => !next);

    if (!changes.length && !unmatched.length) {
      console.log(`■ ${detail.name} — 변경 없음`);
      continue;
    }
    console.log(`■ ${detail.name}`);
    touchedSongs += changes.length ? 1 : 0;

    // 같은 이름이 둘 이상 생기면 어느 트랙이 무엇인지 구분할 수 없으니 알려준다.
    const counts = new Map();
    for (const { next } of changes) counts.set(next, (counts.get(next) ?? 0) + 1);

    for (const { stem, next } of plans) {
      if (!next) {
        console.log(`   건너뜀   ${stem.name}  (악기 이름을 찾지 못함)`);
        skipped++;
        continue;
      }
      if (next === stem.name) {
        console.log(`   그대로   ${stem.name}`);
        continue;
      }
      const warning = counts.get(next) > 1 ? '  ⚠ 같은 이름 중복' : '';
      if (options.apply) {
        await readJson(
          await fetch(
            `${options.base}/api/admin/songs/${encodeURIComponent(detail.id)}/stems/${encodeURIComponent(stem.id)}`,
            {
              method: 'PATCH',
              headers: { Authorization: authorization, 'Content-Type': 'application/json' },
              body: JSON.stringify({ name: next }),
            },
          ),
          `${stem.name} 이름을 바꾸지 못했습니다.`,
        );
      }
      console.log(`   ${options.apply ? '변경됨' : '변경예정'}  ${stem.name}  →  ${next}${warning}`);
      renamed++;
    }
  }

  console.log(`\n요약: 노래 ${songs.length}개 중 ${touchedSongs}개, 스템 ${renamed}개 ${options.apply ? '변경 완료' : '변경 예정'}` +
    (skipped ? ` / ${skipped}개 건너뜀` : ''));
  if (!options.apply && renamed) {
    console.log(`\n적용하려면:\n  ADMIN_PASSWORD='...' node scripts/rename-stems.mjs --apply`);
  }
}

main().catch((error) => {
  console.error(`\n실패: ${error.message}`);
  process.exit(1);
});
