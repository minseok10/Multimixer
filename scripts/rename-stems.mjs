/**
 * 업로드된 스템 이름에서 악기 이름만 남기는 일괄 정리 스크립트.
 *
 *   "Can't Be Right [68aA_o4yGwo] (Vocals)"  →  "Vocals"
 *   "여름밤_drums"                            →  "Drums"
 *
 * 기본은 미리보기(dry run)라 아무것도 바꾸지 않습니다. 목록을 확인한 뒤
 * --apply를 붙여 실제로 반영하세요.
 *
 * 이름 판정 규칙은 관리 화면의 "스템 이름 일괄 정리" 버튼과 같은 모듈
 * (src/stemNames.js)을 쓴다.
 *
 * 사용법:
 *   node scripts/rename-stems.mjs                       # 미리보기
 *   ADMIN_PASSWORD=... node scripts/rename-stems.mjs --apply
 *   node scripts/rename-stems.mjs --base http://localhost:8787
 *   node scripts/rename-stems.mjs --song <노래 ID>       # 한 곡만
 */

import { instrumentName } from '../src/stemNames.js';

const DEFAULT_BASE = 'https://mix.minseok.site';

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
