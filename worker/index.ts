const SONG_PREFIX = 'songs/';
const MANIFEST_FILE = 'manifest.json';
const MAX_STEM_BYTES = 95 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_SONGS = 200;
const MAX_STEMS = 16;
const LIST_CACHE_SECONDS = 60;
const CREATOR_NOTE_KEY = 'site/creator-note.json';
const COMMENT_PREFIX = 'comments/';
const MAX_CREATOR_NOTE_LENGTH = 5000;
const MAX_COMMENT_LENGTH = 1000;
const MAX_COMMENTS_PER_SONG = 100;

const AUDIO_TYPES: Record<string, string> = {
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac',
  m4a: 'audio/mp4', aac: 'audio/aac',
};

interface StemRecord {
  id: string;
  name: string;
  fileName: string;
  size: number;
  url: string;
}

interface SongManifest {
  id: string;
  name: string;
  bpm?: number;
  status: 'draft' | 'complete';
  createdAt: string;
  stems: StemRecord[];
}

interface SongRecord {
  id: string;
  name: string;
  bpm?: number;
  size: number;
  stemCount: number;
  uploadedAt: string;
  url: string;
}

interface SongDetailRecord extends SongRecord {
  stems: StemRecord[];
}

interface CreatorNote {
  content: string;
  updatedAt: string | null;
}

interface SongComment {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (url.pathname === '/api/creator-note') {
        if (request.method === 'GET') return await getCreatorNote(env);
        if (request.method === 'PUT') {
          await requireAdmin(request, env);
          return await updateCreatorNote(request, env);
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/songs') {
        return await listSongs(request, env, ctx);
      }

      const commentsMatch = url.pathname.match(/^\/api\/songs\/([^/]+)\/comments$/);
      if (commentsMatch) {
        if (request.method === 'GET') return await listComments(env, commentsMatch[1]);
        if (request.method === 'POST') return await createComment(request, env, commentsMatch[1]);
      }

      const commentMatch = url.pathname.match(/^\/api\/songs\/([^/]+)\/comments\/([^/]+)$/);
      if (commentMatch) {
        if (request.method === 'PUT') return await updateComment(request, env, commentMatch[1], commentMatch[2]);
        if (request.method === 'DELETE') return await deleteComment(env, commentMatch[1], commentMatch[2]);
      }

      const publicMatch = url.pathname.match(/^\/api\/songs\/([^/]+)(?:\/stems\/([^/]+))?$/);
      if (publicMatch && (request.method === 'GET' || request.method === 'HEAD')) {
        return publicMatch[2]
          ? await serveStem(request, env, publicMatch[1], publicMatch[2])
          : await getSong(env, publicMatch[1]);
      }

      if (request.method === 'POST' && url.pathname === '/api/admin/songs') {
        await requireAdmin(request, env);
        return await createSong(request, env);
      }

      const stemUploadMatch = url.pathname.match(/^\/api\/admin\/songs\/([^/]+)\/stems\/(\d+)$/);
      if (request.method === 'PUT' && stemUploadMatch) {
        await requireAdmin(request, env);
        return await uploadStem(request, env, url, stemUploadMatch[1], stemUploadMatch[2]);
      }

      const completeMatch = url.pathname.match(/^\/api\/admin\/songs\/([^/]+)\/complete$/);
      if (request.method === 'POST' && completeMatch) {
        await requireAdmin(request, env);
        return await completeSong(request, env, completeMatch[1]);
      }

      const adminSongMatch = url.pathname.match(/^\/api\/admin\/songs\/([^/]+)$/);
      if (request.method === 'PATCH' && adminSongMatch) {
        await requireAdmin(request, env);
        return await updateSongDetails(request, env, adminSongMatch[1]);
      }
      if (request.method === 'DELETE' && adminSongMatch) {
        await requireAdmin(request, env);
        return await deleteSong(request, env, adminSongMatch[1]);
      }
      return json({ error: 'API 경로를 찾을 수 없습니다.' }, 404);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(JSON.stringify({
        message: 'request failed', method: request.method, path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json({ error: '서버에서 요청을 처리하지 못했습니다.' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function listSongs(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(new URL('/api/songs', request.url), { method: 'GET' });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const objects = await listAllObjects(env.SONGS, SONG_PREFIX, true);
  const songs = objects
    .filter((object) => object.key.endsWith(`/${MANIFEST_FILE}`) && object.customMetadata?.status === 'complete')
    .map(toSongRecord)
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
  const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);
  const response = json({
    songs, totalBytes,
    limits: { maxStemBytes: MAX_STEM_BYTES, maxTotalBytes: MAX_TOTAL_BYTES, maxSongs: MAX_SONGS, maxStems: MAX_STEMS },
  });
  response.headers.set('Cache-Control', `public, max-age=0, s-maxage=${LIST_CACHE_SECONDS}`);
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

async function createSong(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request, 4096, '노래 정보');
  const name = cleanText(isRecord(body) && typeof body.name === 'string' ? body.name : null, 120, '노래 이름');
  const bpm = isRecord(body) ? body.bpm : undefined;
  if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < 20 || bpm > 300) {
    throw new HttpError(400, 'BPM은 20에서 300 사이의 정수여야 합니다.');
  }
  const manifests = (await listAllObjects(env.SONGS, SONG_PREFIX, true))
    .filter((object) => object.key.endsWith(`/${MANIFEST_FILE}`));
  if (manifests.length >= MAX_SONGS) throw new HttpError(507, `노래는 최대 ${MAX_SONGS}개까지 저장할 수 있습니다.`);

  const manifest: SongManifest = {
    id: crypto.randomUUID(), name, bpm, status: 'draft', createdAt: new Date().toISOString(), stems: [],
  };
  await putManifest(env.SONGS, manifest);
  return json({ song: manifest }, 201);
}

async function uploadStem(request: Request, env: Env, url: URL, encodedSongId: string, rawIndex: string): Promise<Response> {
  const songId = validateId(encodedSongId, '노래');
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_STEMS) throw new HttpError(400, '잘못된 스템 순서입니다.');
  const manifest = await readManifest(env.SONGS, songId);
  if (manifest.status !== 'draft') throw new HttpError(409, '완료된 노래에는 스템을 추가할 수 없습니다.');
  if (manifest.stems.some((stem) => stem.id.startsWith(`${index}-`))) throw new HttpError(409, '같은 순서의 스템이 이미 있습니다.');

  const lengthHeader = request.headers.get('Content-Length');
  if (!lengthHeader) throw new HttpError(411, '파일 크기를 확인할 수 없습니다.');
  const size = Number(lengthHeader);
  if (!Number.isSafeInteger(size) || size <= 0) throw new HttpError(400, '빈 파일은 업로드할 수 없습니다.');
  if (size > MAX_STEM_BYTES) throw new HttpError(413, '스템 하나는 최대 95MiB까지 업로드할 수 있습니다.');
  if (!request.body) throw new HttpError(400, '업로드할 파일이 없습니다.');

  const fileName = cleanText(url.searchParams.get('filename'), 240, '파일 이름');
  const stemName = cleanText(url.searchParams.get('name') || fileName.replace(/\.[^.]+$/, ''), 120, '스템 이름');
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const contentType = AUDIO_TYPES[extension];
  if (!contentType) throw new HttpError(415, '지원하지 않는 오디오 형식입니다.');
  const totalBytes = (await listAllObjects(env.SONGS, SONG_PREFIX)).reduce((sum, object) => sum + object.size, 0);
  if (totalBytes + size > MAX_TOTAL_BYTES) throw new HttpError(507, '음악 저장소의 8GiB 안전 한도를 초과합니다.');

  const stemId = `${index}-${crypto.randomUUID()}.${extension}`;
  const key = stemKey(songId, stemId);
  const object = await env.SONGS.put(key, request.body, {
    httpMetadata: { contentType, contentDisposition: contentDisposition(fileName), cacheControl: 'public, max-age=3600' },
    customMetadata: { fileName, stemName }, storageClass: 'Standard',
  });
  manifest.stems.push({
    id: stemId, name: stemName, fileName, size: object.size,
    url: `/api/songs/${encodeURIComponent(songId)}/stems/${encodeURIComponent(stemId)}`,
  });
  manifest.stems.sort((a, b) => Number(a.id.split('-')[0]) - Number(b.id.split('-')[0]));
  await putManifest(env.SONGS, manifest);
  return json({ stem: manifest.stems.find((stem) => stem.id === stemId) }, 201);
}

async function completeSong(request: Request, env: Env, encodedSongId: string): Promise<Response> {
  const songId = validateId(encodedSongId, '노래');
  const manifest = await readManifest(env.SONGS, songId);
  if (manifest.status !== 'draft') throw new HttpError(409, '이미 완료된 노래입니다.');
  if (manifest.stems.length < 2) throw new HttpError(400, '노래에는 최소 2개의 스템이 필요합니다.');
  manifest.status = 'complete';
  await putManifest(env.SONGS, manifest);
  await invalidateSongListCache(request);
  console.log(JSON.stringify({ message: 'song completed', id: songId, stemCount: manifest.stems.length }));
  return json({ song: manifest });
}

async function getSong(env: Env, encodedSongId: string): Promise<Response> {
  const manifest = await readManifest(env.SONGS, validateId(encodedSongId, '노래'));
  if (manifest.status !== 'complete') throw new HttpError(404, '노래를 찾을 수 없습니다.');
  return json({ song: toSongDetail(manifest) });
}

async function serveStem(request: Request, env: Env, encodedSongId: string, encodedStemId: string): Promise<Response> {
  const songId = validateId(encodedSongId, '노래');
  const stemId = validateStemId(encodedStemId);
  const manifest = await readManifest(env.SONGS, songId);
  if (manifest.status !== 'complete' || !manifest.stems.some((stem) => stem.id === stemId)) {
    throw new HttpError(404, '스템을 찾을 수 없습니다.');
  }
  const key = stemKey(songId, stemId);
  const object = request.method === 'HEAD' ? await env.SONGS.head(key) : await env.SONGS.get(key);
  if (!object) throw new HttpError(404, '스템을 찾을 수 없습니다.');
  return new Response(request.method === 'HEAD' ? null : (object as R2ObjectBody).body, { headers: objectHeaders(object) });
}

async function deleteSong(request: Request, env: Env, encodedSongId: string): Promise<Response> {
  const songId = validateId(encodedSongId, '노래');
  const keys = (await listAllObjects(env.SONGS, `${SONG_PREFIX}${songId}/`)).map((object) => object.key);
  if (!keys.length) throw new HttpError(404, '노래를 찾을 수 없습니다.');
  for (let offset = 0; offset < keys.length; offset += 1000) await env.SONGS.delete(keys.slice(offset, offset + 1000));
  await invalidateSongListCache(request);
  console.log(JSON.stringify({ message: 'song deleted', id: songId, objectCount: keys.length }));
  return json({ ok: true });
}

async function updateSongDetails(request: Request, env: Env, encodedSongId: string): Promise<Response> {
  const songId = validateId(encodedSongId, '노래');
  const body = await readJsonBody(request, 4096, '노래 정보');
  const name = cleanText(isRecord(body) && typeof body.name === 'string' ? body.name : null, 120, '노래 이름');
  const bpm = isRecord(body) ? body.bpm : undefined;
  if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < 20 || bpm > 300) {
    throw new HttpError(400, 'BPM은 20에서 300 사이의 정수여야 합니다.');
  }

  const manifest = await readManifest(env.SONGS, songId);
  if (manifest.status !== 'complete') throw new HttpError(409, '공개가 완료된 노래만 수정할 수 있습니다.');
  manifest.name = name;
  manifest.bpm = bpm;
  await putManifest(env.SONGS, manifest);
  await invalidateSongListCache(request);
  console.log(JSON.stringify({ message: 'song metadata updated', id: songId, name, bpm }));
  return json({ song: toSongDetail(manifest) });
}

async function getCreatorNote(env: Env): Promise<Response> {
  const object = await env.SONGS.get(CREATOR_NOTE_KEY);
  if (!object) return json({ note: { content: '', updatedAt: null } satisfies CreatorNote });
  const value: unknown = await object.json();
  if (!isCreatorNote(value)) throw new HttpError(500, '저장된 제작자 코멘트가 올바르지 않습니다.');
  return json({ note: value });
}

async function updateCreatorNote(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request, 24 * 1024, '제작자 코멘트');
  const content = cleanMultilineText(
    isRecord(body) && typeof body.content === 'string' ? body.content : null,
    MAX_CREATOR_NOTE_LENGTH,
    '제작자 코멘트',
  );
  const updatedAt = new Date().toISOString();
  const note: CreatorNote = { content, updatedAt };
  await env.SONGS.put(CREATOR_NOTE_KEY, JSON.stringify(note), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { kind: 'creator-note', updatedAt },
    storageClass: 'Standard',
  });
  return json({ note });
}

async function listComments(env: Env, encodedSongId: string): Promise<Response> {
  const songId = await requireCompleteSong(env, encodedSongId);
  const objects = await listAllObjects(env.SONGS, commentPrefix(songId));
  const comments = (await Promise.all(objects.slice(0, MAX_COMMENTS_PER_SONG).map(async (object) => {
    try {
      const stored = await env.SONGS.get(object.key);
      if (!stored) return null;
      const value: unknown = await stored.json();
      return isSongComment(value) ? value : null;
    } catch {
      return null;
    }
  })))
    .filter((comment): comment is SongComment => comment !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return json({ comments, limit: MAX_COMMENTS_PER_SONG });
}

async function createComment(request: Request, env: Env, encodedSongId: string): Promise<Response> {
  const songId = await requireCompleteSong(env, encodedSongId);
  const existing = await listAllObjects(env.SONGS, commentPrefix(songId));
  if (existing.length >= MAX_COMMENTS_PER_SONG) {
    throw new HttpError(409, `댓글은 노래마다 최대 ${MAX_COMMENTS_PER_SONG}개까지 작성할 수 있습니다.`);
  }
  const body = await readJsonBody(request, 8192, '댓글');
  const content = cleanMultilineText(
    isRecord(body) && typeof body.content === 'string' ? body.content : null,
    MAX_COMMENT_LENGTH,
    '댓글',
  );
  const now = new Date().toISOString();
  const comment: SongComment = { id: crypto.randomUUID(), content, createdAt: now, updatedAt: now };
  await putComment(env.SONGS, songId, comment);
  return json({ comment }, 201);
}

async function updateComment(
  request: Request,
  env: Env,
  encodedSongId: string,
  encodedCommentId: string,
): Promise<Response> {
  const songId = await requireCompleteSong(env, encodedSongId);
  const commentId = validateId(encodedCommentId, '댓글');
  const key = commentKey(songId, commentId);
  const object = await env.SONGS.get(key);
  if (!object) throw new HttpError(404, '댓글을 찾을 수 없습니다.');
  const stored: unknown = await object.json();
  if (!isSongComment(stored) || stored.id !== commentId) throw new HttpError(500, '저장된 댓글이 올바르지 않습니다.');
  const body = await readJsonBody(request, 8192, '댓글');
  const content = cleanMultilineText(
    isRecord(body) && typeof body.content === 'string' ? body.content : null,
    MAX_COMMENT_LENGTH,
    '댓글',
  );
  const comment: SongComment = { ...stored, content, updatedAt: new Date().toISOString() };
  await putComment(env.SONGS, songId, comment);
  return json({ comment });
}

async function deleteComment(env: Env, encodedSongId: string, encodedCommentId: string): Promise<Response> {
  const songId = await requireCompleteSong(env, encodedSongId);
  const commentId = validateId(encodedCommentId, '댓글');
  const key = commentKey(songId, commentId);
  if (!await env.SONGS.head(key)) throw new HttpError(404, '댓글을 찾을 수 없습니다.');
  await env.SONGS.delete(key);
  return json({ ok: true });
}

async function requireCompleteSong(env: Env, encodedSongId: string): Promise<string> {
  const songId = validateId(encodedSongId, '노래');
  const manifest = await readManifest(env.SONGS, songId);
  if (manifest.status !== 'complete') throw new HttpError(404, '노래를 찾을 수 없습니다.');
  return songId;
}

async function putComment(bucket: R2Bucket, songId: string, comment: SongComment): Promise<void> {
  await bucket.put(commentKey(songId, comment.id), JSON.stringify(comment), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { kind: 'comment', createdAt: comment.createdAt, updatedAt: comment.updatedAt },
    storageClass: 'Standard',
  });
}

async function readManifest(bucket: R2Bucket, songId: string): Promise<SongManifest> {
  const object = await bucket.get(manifestKey(songId));
  if (!object) throw new HttpError(404, '노래를 찾을 수 없습니다.');
  const value: unknown = await object.json();
  if (!isManifest(value) || value.id !== songId) throw new HttpError(500, '저장된 노래 정보가 올바르지 않습니다.');
  return value;
}

async function putManifest(bucket: R2Bucket, manifest: SongManifest): Promise<void> {
  await bucket.put(manifestKey(manifest.id), JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      kind: 'manifest', status: manifest.status, displayName: manifest.name,
      ...(manifest.bpm ? { bpm: String(manifest.bpm) } : {}),
      stemCount: String(manifest.stems.length), totalBytes: String(manifest.stems.reduce((sum, stem) => sum + stem.size, 0)),
      createdAt: manifest.createdAt,
    }, storageClass: 'Standard',
  });
}

async function listAllObjects(bucket: R2Bucket, prefix: string, metadata = false): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, limit: 1000, cursor, ...(metadata ? { include: ['customMetadata'] as const } : {}) });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

function toSongRecord(object: R2Object): SongRecord {
  const id = object.key.slice(SONG_PREFIX.length, -(`/${MANIFEST_FILE}`.length));
  return {
    id, name: object.customMetadata?.displayName || id,
    ...(object.customMetadata?.bpm ? { bpm: Number(object.customMetadata.bpm) } : {}),
    size: Number(object.customMetadata?.totalBytes || 0),
    stemCount: Number(object.customMetadata?.stemCount || 0),
    uploadedAt: object.customMetadata?.createdAt || object.uploaded.toISOString(),
    url: `/api/songs/${encodeURIComponent(id)}`,
  };
}

function toSongDetail(manifest: SongManifest): SongDetailRecord {
  return {
    id: manifest.id,
    name: manifest.name,
    ...(manifest.bpm ? { bpm: manifest.bpm } : {}),
    size: manifest.stems.reduce((sum, stem) => sum + stem.size, 0),
    stemCount: manifest.stems.length,
    uploadedAt: manifest.createdAt,
    url: `/api/songs/${encodeURIComponent(manifest.id)}`,
    stems: manifest.stems,
  };
}

function manifestKey(songId: string): string { return `${SONG_PREFIX}${songId}/${MANIFEST_FILE}`; }
function stemKey(songId: string, stemId: string): string { return `${SONG_PREFIX}${songId}/stems/${stemId}`; }
function commentPrefix(songId: string): string { return `${SONG_PREFIX}${songId}/${COMMENT_PREFIX}`; }
function commentKey(songId: string, commentId: string): string { return `${commentPrefix(songId)}${commentId}.json`; }

function validateId(encodedId: string, label: string): string {
  let id: string;
  try { id = decodeURIComponent(encodedId); } catch { throw new HttpError(400, `잘못된 ${label} 식별자입니다.`); }
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, `잘못된 ${label} 식별자입니다.`);
  return id;
}

function validateStemId(encodedId: string): string {
  let id: string;
  try { id = decodeURIComponent(encodedId); } catch { throw new HttpError(400, '잘못된 스템 식별자입니다.'); }
  if (!/^\d{1,2}-[0-9a-f-]{36}\.(wav|mp3|ogg|flac|m4a|aac)$/.test(id)) throw new HttpError(400, '잘못된 스템 식별자입니다.');
  return id;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isCreatorNote(value: unknown): value is CreatorNote {
  return isRecord(value) && typeof value.content === 'string'
    && (value.updatedAt === null || typeof value.updatedAt === 'string');
}
function isSongComment(value: unknown): value is SongComment {
  return isRecord(value) && typeof value.id === 'string' && typeof value.content === 'string'
    && typeof value.createdAt === 'string' && typeof value.updatedAt === 'string';
}
function isManifest(value: unknown): value is SongManifest {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
    && (value.bpm === undefined || (typeof value.bpm === 'number' && Number.isInteger(value.bpm) && value.bpm >= 20 && value.bpm <= 300))
    && (value.status === 'draft' || value.status === 'complete') && typeof value.createdAt === 'string'
    && Array.isArray(value.stems) && value.stems.every((stem) => isRecord(stem)
      && typeof stem.id === 'string' && typeof stem.name === 'string' && typeof stem.fileName === 'string'
      && typeof stem.size === 'number' && typeof stem.url === 'string');
}

function objectHeaders(object: R2Object): Headers {
  const headers = new Headers(); object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag); headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'public, max-age=3600'); headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

async function requireAdmin(request: Request, env: Env): Promise<void> {
  if (!env.ADMIN_PASSWORD) throw new HttpError(503, '관리자 업로드가 아직 활성화되지 않았습니다.');
  const provided = decodeBasicPassword(request.headers.get('Authorization'));
  if (!provided || !await secretsEqual(provided, env.ADMIN_PASSWORD)) throw new HttpError(401, '관리자 비밀번호가 올바르지 않습니다.');
}

async function secretsEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(provided)), crypto.subtle.digest('SHA-256', encoder.encode(expected))]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function decodeBasicPassword(authorization: string | null): string | null {
  if (!authorization?.startsWith('Basic ')) return null;
  try {
    const credentials = new TextDecoder().decode(Uint8Array.from(atob(authorization.slice(6)), (char) => char.charCodeAt(0)));
    const separator = credentials.indexOf(':');
    return separator >= 0 && credentials.slice(0, separator) === 'admin' ? credentials.slice(separator + 1) : null;
  } catch { return null; }
}

function cleanText(value: string | null, maxLength: number, label: string): string {
  const cleaned = value?.trim();
  if (!cleaned) throw new HttpError(400, `${label}이 필요합니다.`);
  if (cleaned.length > maxLength) throw new HttpError(400, `${label}이 너무 깁니다.`);
  if (/[\u0000-\u001f\u007f]/.test(cleaned)) throw new HttpError(400, `${label}에 사용할 수 없는 문자가 있습니다.`);
  return cleaned;
}

function cleanMultilineText(value: string | null, maxLength: number, label: string): string {
  const cleaned = value?.trim();
  if (!cleaned) throw new HttpError(400, `${label} 내용이 필요합니다.`);
  if (cleaned.length > maxLength) throw new HttpError(400, `${label}은 ${maxLength}자까지 입력할 수 있습니다.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)) {
    throw new HttpError(400, `${label}에 사용할 수 없는 문자가 있습니다.`);
  }
  return cleaned;
}

async function readJsonBody(request: Request, maxBytes: number, label: string): Promise<unknown> {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new HttpError(413, `${label}가 너무 큽니다.`);
  if (!request.body) throw new HttpError(400, '올바른 JSON이 필요합니다.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, `${label}가 너무 큽니다.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  } catch {
    throw new HttpError(400, '올바른 JSON이 필요합니다.');
  }
}

function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'audio';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

async function invalidateSongListCache(request: Request): Promise<void> {
  await caches.default.delete(new Request(new URL('/api/songs', request.url), { method: 'GET' }));
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
