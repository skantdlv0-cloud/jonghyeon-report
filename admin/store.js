/* ============================================================
   store.js — 브라우저 저장소 · 암호 백업 · 한글 로마자 변환

   중요: 명단과 토큰은 이 브라우저에만 있다.
         저장소(GitHub)에는 절대 올라가지 않는다.
   ============================================================ */

(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;

  /* 브라우저 저장 이름. 앞에 붙는 말은 config.js 의 storagePrefix 다.
     깃허브 페이지스는 저장소가 달라도 주소 앞부분이 같아서 브라우저
     저장소를 공유한다. 다른 시스템과 이름이 겹치면 로그인과 깃허브
     토큰이 서로 덮어쓴다. */
  var P = global.CONFIG.storagePrefix;

  var KEYS = {
    students:  P + 'students',
    draft:     P + 'draft',      /* 작성 중인 주차 내용 (자동 임시 저장) */
    queue:     P + 'queue',      /* 발행 대기열 */
    history:   P + 'history',    /* 반별 지난 회차 (수업·테스트 이름) */
    published: P + 'published',
    snippets:  P + 'snippets',
    sent:      P + 'sent',
    token:     P + 'token',
    settings:  P + 'settings',
    fieldDefs: P + 'fielddefs',  /* 명단에 내가 추가한 칸 (학생 칸 · 반 칸) */
    classInfo: P + 'classinfo'   /* 반마다 적어 둔 값 */
  };

  /* ---------- localStorage 안전 래퍼 ----------
     사생활 보호 모드나 저장 공간 초과 시 throw 되므로 전부 감싼다. */

  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('읽기 실패:', key, e);
      return fallback;
    }
  }

  /* ---------- 서버 동기화 ----------
     모든 저장이 write() 한 곳을 지나므로, 여기서 서버로도 밀어 준다.
     화면 코드는 예전 그대로 두고 저장 방식만 바꾸기 위한 구조다.

     로컬 저장은 즉시 끝내고(화면이 기다리지 않게), 서버 전송은 묶어서 보낸다. */

  var syncEnabled = false;          /* 로그인 전에는 서버로 보내지 않는다 */
  var syncTimers = {};
  var syncState = { pending: 0, error: null };
  var syncListeners = [];

  function onSyncChange(fn) { syncListeners.push(fn); }

  function emitSync() {
    syncListeners.forEach(function (fn) {
      try { fn(syncState); } catch (e) { console.error(e); }
    });
  }

  function enableSync(on) {
    syncEnabled = !!on;
    syncState.error = null;
    emitSync();
  }

  function runSync(label, fn) {
    syncState.pending++;
    emitSync();
    return Promise.resolve().then(fn).then(function () {
      syncState.pending--;
      syncState.error = null;
      emitSync();
    }).catch(function (e) {
      syncState.pending--;
      syncState.error = (e && e.message) || String(e);
      console.error('동기화 실패 [' + label + ']', e);
      emitSync();
    });
  }

  /* 칸 관리에서 직접 지울 때만 잠깐 켜진다. saveFieldDefs 를 보라.
     이게 꺼져 있는데 빈 목록이 오면 서버를 비우지 않는다. */
  var fieldClearOk = false;

  /* 같은 종류의 저장이 연달아 오면 마지막 것만 보낸다 */
  function queueSync(label, delay, fn) {
    if (!syncEnabled || !global.DB) return;
    clearTimeout(syncTimers[label]);
    syncTimers[label] = setTimeout(function () { runSync(label, fn); }, delay);
  }

  function pushToServer(key, value) {
    if (key === KEYS.students) {
      queueSync('students', 500, function () { return global.DB.syncStudents(value); });

    } else if (key === KEYS.snippets) {
      queueSync('snippets', 700, function () { return global.DB.saveSnippets(value); });

    } else if (key === KEYS.draft) {
      queueSync('draft', 800, function () { return pushDraft(value); });

    } else if (key === KEYS.fieldDefs) {
      /* '칸이 하나도 없다' 는 목록으로 서버를 비우는 것은 칸 관리에서 직접
         지웠을 때만 허용한다. 지금 값을 잡아 둔다 — 디바운스가 끝난 뒤에
         읽으면 이미 꺼져 있다. */
      var allowClear = fieldClearOk;
      queueSync('fieldDefs', 500, function () {
        return global.DB.syncFieldDefs(value, { allowClear: allowClear });
      });

    } else if (key === KEYS.classInfo) {
      queueSync('classInfo', 500, function () { return global.DB.syncClassInfo(value); });

    } else if (key === KEYS.published) {
      /* 발행은 D단계에서 건별로 직접 보낸다 */
    }
    /* settings 는 기기별 화면 설정이라 서버에 보내지 않는다.
       queue, history 는 entries·week_common 에서 다시 만들 수 있어 로컬에만 둔다.
       (브라우저 저장 이름은 config.js 의 storagePrefix 가 앞에 붙는다) */
  }

  function pushDraft(draft) {
    if (!draft || !draft.weekStart) return Promise.resolve();

    var ids = getStudents().map(function (s) { return s.id; });
    var jobs = [];

    /* 종료일은 반과 상관없이 먼저 올린다.
       아래 반 공통 저장은 '반 공통에 뭔가 적은 반' 만 도는데, 예전에는
       종료일도 거기 얹혀 있어서 아무 반도 안 적었으면 종료일이 통째로
       서버에 안 올라갔다. 그게 새로고침하면 금요일로 되돌아가던 원인이다. */
    jobs.push(global.DB.saveWeekMeta(draft.weekStart, draft.weekEnd));

    Object.keys(draft.common || {}).forEach(function (cls) {
      if (!cls || cls === '_') return;
      var c = draft.common[cls];
      jobs.push(global.DB.saveWeekCommon(draft.weekStart, draft.weekEnd, cls,
                                         c.lessons, c.tests, c.comment));
    });

    jobs.push(global.DB.saveEntries(draft.weekStart, draft.entries, ids));
    return Promise.all(jobs);
  }

  function write(key, value) {
    var ok = true;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('저장 실패:', key, e);
      ok = false;
    }
    try { pushToServer(key, value); } catch (e) { console.error(e); }
    return ok;
  }

  /* 로컬에만 저장 (서버로 보내지 않음). 서버에서 받아온 값을 캐시에 넣을 때 쓴다. */
  function writeLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function remove(key) {
    try { localStorage.removeItem(key); return true; }
    catch (e) { return false; }
  }

  /* ---------- 한글 → 로마자 (국어의 로마자 표기법) ----------
     파일 이름에 쓸 값을 자동으로 제안한다. 사용자가 고칠 수 있다. */

  var CHO = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
  var JUNG = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo',
              'u','wo','we','wi','yu','eu','ui','i'];
  /* 받침 28개 — 유니코드 순서 그대로여야 한다.
     ''  ㄱ  ㄲ  ㄳ  ㄴ  ㄵ  ㄶ  ㄷ  ㄹ  ㄺ  ㄻ  ㄼ  ㄽ  ㄾ
     ㄿ  ㅀ  ㅁ  ㅂ  ㅄ  ㅅ  ㅆ  ㅇ  ㅈ  ㅊ  ㅋ  ㅌ  ㅍ  ㅎ */
  var JONG = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l',
              'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't'];

  /* 두 글자 성씨 — 이름 부분만 뽑을 때 쓴다 */
  var SURNAMES_2 = ['남궁','선우','황보','제갈','사공','서문','독고','동방',
                    '망절','司空','어금','장곡','강전'];

  function romanizeSyllable(ch) {
    var code = ch.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return /[a-zA-Z0-9]/.test(ch) ? ch.toLowerCase() : '';
    var cho  = Math.floor(code / 588);
    var jung = Math.floor((code % 588) / 28);
    var jong = code % 28;
    return CHO[cho] + JUNG[jung] + JONG[jong];
  }

  /* '김하늘' → 'haneul'  (성을 뺀 이름만) */
  function romanizeGivenName(fullName) {
    var name = String(fullName || '').replace(/\s+/g, '');
    if (!name) return '';

    var given = name;
    var two = name.slice(0, 2);
    if (SURNAMES_2.indexOf(two) !== -1) {
      given = name.slice(2);
    } else if (name.length > 1) {
      given = name.slice(1);
    }
    if (!given) given = name;

    var out = '';
    for (var i = 0; i < given.length; i++) out += romanizeSyllable(given[i]);
    return out.replace(/[^a-z0-9]/g, '');
  }

  /* ---------- 전화번호 ---------- */

  function phoneDigits(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function phoneFormat(v) {
    var d = phoneDigits(v);
    if (!d) return '';
    if (d.length === 11) return d.slice(0,3) + '-' + d.slice(3,7) + '-' + d.slice(7);
    if (d.length === 10) {
      if (d.slice(0,2) === '02') return d.slice(0,2) + '-' + d.slice(2,6) + '-' + d.slice(6);
      return d.slice(0,3) + '-' + d.slice(3,6) + '-' + d.slice(6);
    }
    return d;
  }

  function phoneValid(v) {
    var d = phoneDigits(v);
    return d === '' || (d.length >= 9 && d.length <= 11);
  }

  /* 인사말에 쓸 호칭. 비어 있으면 '어머님'. */
  function parentTitleOf(s) {
    return (s && String(s.parentTitle || '').trim()) || '어머님';
  }

  /* 학생 본인 번호.
     migration-001 전에는 옛 '연락처 2' 칸에 들어 있으므로 둘 다 본다. */
  function studentPhoneOf(s) {
    return (s && (s.studentPhone || s.parentPhone2)) || '';
  }

  /* 문자 보낼 수 있는 번호 목록 — E단계에서 고를 때 쓴다.
     who 로 학부모인지 학생인지 구분한다. 발송 문구가 이걸 보고 갈린다. */
  function phonesOf(s) {
    var out = [];
    if (s && s.parentPhone) {
      out.push({ who: 'parent', label: parentTitleOf(s), number: s.parentPhone });
    }
    var stu = studentPhoneOf(s);
    if (stu) {
      out.push({ who: 'student', label: '학생 본인', number: stu });
    }
    return out;
  }

  /* ---------- 학생 명단 ---------- */

  /* 학생 id 는 Supabase 의 uuid 를 그대로 쓴다.
     브라우저에서 만들어 두면 서버가 새 id 를 주지 않아 옮겨 담을 일이 없다. */
  function newId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    var h = Array.from(a).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
  }

  function isUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
  }

  function getStudents() {
    var list = read(KEYS.students, []);
    return Array.isArray(list) ? list : [];
  }

  function saveStudents(list) {
    return write(KEYS.students, list);
  }

  function upsertStudent(s) {
    var list = getStudents();
    var i = list.findIndex(function (x) { return x.id === s.id; });
    if (i >= 0) list[i] = s; else list.push(s);
    saveStudents(list);
    return s;
  }

  function deleteStudent(id) {
    saveStudents(getStudents().filter(function (x) { return x.id !== id; }));
  }

  /* ---------- 내가 만든 칸 ----------
     칸 하나: { id, key, label, type, options[], showInTable, scope, sortOrder }

     scope 가 두 가지다.
       'student' — 학생마다 따로 적는다. 값은 students[].extra[key]
       'class'   — 반마다 한 번 적는다.  값은 classInfo[반이름][key]
     키(key)는 두 쪽을 통틀어 겹치지 않는다. */

  var FIELD_TYPES = [
    { type: 'text',     name: '글자',      hint: '한 줄짜리 짧은 내용 (예: 시험 범위)' },
    { type: 'textarea', name: '여러 줄 글', hint: '길게 적는 내용 (예: 수업 진도, 상담 기록)' },
    { type: 'date',     name: '날짜',      hint: '달력에서 고르는 날짜 (예: 등록일)' },
    { type: 'checkbox', name: '체크박스',   hint: '예/아니오 하나 (예: 교재 배부)' },
    { type: 'select',   name: '선택지',    hint: '미리 정한 것 중 하나 (예: 상/중/하)' }
  ];

  var SCOPES = {
    student: { name: '학생 칸', desc: '학생마다 따로 적습니다' },
    class:   { name: '반 칸',   desc: '반마다 한 번만 적으면 그 반 전체에 적용됩니다' }
  };

  function scopeOf(f) { return f && f.scope === 'class' ? 'class' : 'student'; }

  /* scope 를 주면 그쪽 칸만, 안 주면 전부 돌려준다 */
  function getFieldDefs(scope) {
    var list = read(KEYS.fieldDefs, []);
    if (!Array.isArray(list)) return [];
    if (scope) list = list.filter(function (f) { return scopeOf(f) === scope; });
    return list.slice().sort(function (a, b) {
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
  }

  /* 저장할 때 순서를 0,1,2… 로 다시 매긴다. 중간에 하나 지워도 빈 번호가 남지 않는다.
     scope 를 주면 그쪽 칸만 이 목록으로 바꾸고, 다른 쪽은 건드리지 않는다. */
  function saveFieldDefs(list, scope) {
    function clean(f, i) {
      return {
        id: f.id,
        key: f.key,
        label: String(f.label || '').trim(),
        type: f.type || 'text',
        options: Array.isArray(f.options) ? f.options : [],
        showInTable: f.showInTable !== false,
        scope: scopeOf(f),
        sortOrder: i
      };
    }

    var next;
    if (!scope) {
      next = (list || []).map(clean);
    } else {
      var mine = (list || []).map(function (f) {
        var c = clean(f, 0); c.scope = scope; return c;
      });
      var others = getFieldDefs().filter(function (f) { return scopeOf(f) !== scope; });
      /* 순서는 scope 안에서만 센다 */
      mine.forEach(function (f, i) { f.sortOrder = i; });
      others.forEach(function (f, i) { f.sortOrder = i; });
      next = others.concat(mine);
    }

    /* 여기는 사람이 칸 관리에서 직접 지운 경우다. 마지막 칸까지 지워
       목록이 비면 서버도 비우는 게 맞다. 다른 경로(백업 복원 등)에서
       빈 목록이 오는 것과 구분하려고 잠깐만 켠다. */
    fieldClearOk = true;
    try {
      return write(KEYS.fieldDefs, next);
    } finally {
      fieldClearOk = false;
    }
  }

  /* 칸 이름은 한글이라 그대로 키로 쓸 수 없다(서버가 영문 키만 받는다).
     이름을 바꿔도 적어 둔 값이 따라가야 하므로,
     키는 만들 때 한 번 정하고 두 번 다시 바꾸지 않는다.
     학생 칸과 반 칸을 통틀어 겹치지 않게 만든다. */
  function newFieldKey(existing) {
    var used = {};
    (existing || getFieldDefs()).forEach(function (f) { used[f.key] = true; });
    getFieldDefs().forEach(function (f) { used[f.key] = true; });
    for (var i = 0; i < 500; i++) {
      var k = 'f_' + Date.now().toString(36) + '_' + i.toString(36);
      if (!used[k]) return k;
    }
    return 'f_' + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- 반 현황 ----------
     { '운유1': { f_xxx: '값' }, … }
     반 이름이 열쇠다. 명단에서 반 이름을 바꾸면 적어 둔 내용은 따라오지 않는다. */

  function getClassInfo() {
    var m = read(KEYS.classInfo, {});
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  }

  function saveClassInfo(map) {
    return write(KEYS.classInfo, map || {});
  }

  /* 반 하나의 값만 갈아 끼운다 */
  function setClassExtra(className, extra) {
    var m = getClassInfo();
    m[className] = extra || {};
    return saveClassInfo(m);
  }

  function classExtra(className) {
    return getClassInfo()[className] || {};
  }

  /* 칸을 지워도 적어 둔 값은 남겨 둔다.
     실수로 지웠을 때 같은 이름으로 다시 만들면 살아나지 않지만,
     지우자마자 44명분 기록이 사라지는 것보다는 낫다. */
  function fieldValue(owner, def) {
    if (!owner || !def) return '';
    var bag = scopeOf(def) === 'class'
      ? (typeof owner === 'string' ? classExtra(owner) : (owner.extra || owner))
      : (owner.extra || {});
    var v = bag[def.key];
    return v == null ? '' : v;
  }

  /* 화면에 보여 줄 글자로 바꾼다 */
  function fieldText(owner, def) {
    var v = fieldValue(owner, def);
    if (def.type === 'checkbox') return v ? '✓' : '';
    return String(v);
  }

  /* 반 목록 — 등장 순서를 유지하되 이름순으로 정렬 */
  function getClasses() {
    var seen = {};
    getStudents().forEach(function (s) {
      var c = (s.className || '').trim();
      if (c) seen[c] = (seen[c] || 0) + 1;
    });
    return Object.keys(seen).sort(function (a, b) {
      return a.localeCompare(b, 'ko');
    }).map(function (name) {
      return { name: name, count: seen[name] };
    });
  }

  /* ---------- 암호 백업 (PBKDF2 + AES-GCM) ----------
     브라우저 내장 Web Crypto 만 쓴다. 외부 라이브러리 없음.
     암호를 잊으면 복구할 방법이 없다. */

  var PBKDF2_ITER = 250000;

  function b64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function unb64(str) {
    var s = atob(str), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  function deriveKey(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (baseKey) {
        return crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
          baseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  /* 기기 이전용 전체 백업을 암호로 잠근다.

     담는 것 : 명단 · 설정 · 발송 기록 · 발행 이력 · 코멘트 상용구
     빼는 것 : 깃허브 토큰
       토큰은 기기마다 따로 발급하고 따로 폐기하는 물건이다.
       파일에 담아 옮기면 폐기해도 파일에 남아 위험해진다. */
  function exportEncrypted(password) {
    var payload = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      students:  getStudents(),
      settings:  read(KEYS.settings, {}),
      sent:      read(KEYS.sent, {}),
      published: read(KEYS.published, {}),
      snippets:  read(KEYS.snippets, []),
      fieldDefs: read(KEYS.fieldDefs, []),
      classInfo: read(KEYS.classInfo, {}),
      draft:     read(KEYS.draft, null),
      queue:     read(KEYS.queue, {}),
      history:   read(KEYS.history, {})
    };
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv   = crypto.getRandomValues(new Uint8Array(12));

    return deriveKey(password, salt).then(function (key) {
      var enc = new TextEncoder();
      return crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        enc.encode(JSON.stringify(payload))
      );
    }).then(function (cipherBuf) {
      return {
        app: global.CONFIG.github.repo + '-admin',
        type: 'device-backup',
        contains: {
          students:  payload.students.length,
          sentWeeks: Object.keys(payload.sent).length,
          published: Object.keys(payload.published).length
        },
        version: SCHEMA_VERSION,
        encrypted: true,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITER, salt: b64(salt) },
        cipher: { name: 'AES-GCM', iv: b64(iv) },
        data: b64(cipherBuf)
      };
    });
  }

  /* 백업 파일을 풀어 payload 를 돌려준다.
     { students, settings, sent, published, snippets } */
  function importEncrypted(fileObj, password) {
    return Promise.resolve().then(function () {
      var TYPES = ['device-backup', 'students-backup'];   /* 뒤는 예전 형식 */
      if (!fileObj || TYPES.indexOf(fileObj.type) === -1) {
        throw new Error('이 파일은 백업 파일이 아닙니다.');
      }

      /* 백업에 들어 있는 것만 넘긴다.
         없는 항목은 undefined 로 두어야 한다. 여기서 빈 값([] 이나 {})을 만들어
         넘기면 restorePayload 가 그것으로 덮어쓴다.

         예전에 fieldDefs·classInfo 가 이 목록에서 빠져 있었다. 내보낼 때는
         담기는데 불러올 때 사라져서, 백업을 되살리면 칸 정의가 빈 배열로
         덮이고 서버의 field_defs 까지 통째로 지워졌다. (반 현황이 날아간 원인) */
      function normalize(payload) {
        if (!Array.isArray(payload.students)) throw new Error('명단이 들어 있지 않습니다.');
        return {
          students:  payload.students,
          settings:  payload.settings  || {},
          sent:      payload.sent      || {},
          published: payload.published || {},
          snippets:  payload.snippets  || [],
          fieldDefs: Array.isArray(payload.fieldDefs) ? payload.fieldDefs : undefined,
          classInfo: (payload.classInfo && typeof payload.classInfo === 'object')
                       ? payload.classInfo : undefined,
          draft:     payload.draft     || null,
          queue:     payload.queue     || {},
          history:   payload.history   || {}
        };
      }

      if (!fileObj.encrypted) {
        /* 암호 없이 내보낸 파일도 받아준다 */
        return normalize(fileObj);
      }

      var salt = unb64(fileObj.kdf.salt);
      var iv   = unb64(fileObj.cipher.iv);
      var data = unb64(fileObj.data);

      return deriveKey(password, salt).then(function (key) {
        return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
      }).then(function (plainBuf) {
        return normalize(JSON.parse(new TextDecoder().decode(plainBuf)));
      }).catch(function (e) {
        /* AES-GCM 은 암호가 틀리면 복호화 단계에서 바로 실패한다 */
        if (e instanceof Error && e.message.indexOf('명단') === 0) throw e;
        throw new Error('암호가 맞지 않거나 파일이 손상되었습니다.');
      });
    });
  }

  /* 백업에서 읽은 내용을 이 기기에 복원한다 */
  /* 백업에서 읽은 내용을 이 기기에 복원한다.

     백업에 없는 항목은 건드리지 않는다. 옛 형식 백업(students-backup)에는
     칸 정의가 아예 없는데, 그걸 빈 값으로 덮으면 지금 쓰고 있는 칸이 사라진다.
     돌려준 목록은 '무엇을 되살렸는지' 화면에서 알려 주는 데 쓴다. */
  function restorePayload(p) {
    var done = [];

    saveStudents(p.students || []);
    done.push('명단 ' + (p.students || []).length + '명');

    write(KEYS.settings,  p.settings  || {});
    write(KEYS.sent,      p.sent      || {});
    write(KEYS.published, p.published || {});
    write(KEYS.snippets,  p.snippets  || []);
    write(KEYS.queue,     p.queue     || {});
    write(KEYS.history,   p.history   || {});

    if (p.fieldDefs) {
      write(KEYS.fieldDefs, p.fieldDefs);
      done.push('칸 정의 ' + p.fieldDefs.length + '개');
    }
    if (p.classInfo) {
      write(KEYS.classInfo, p.classInfo);
      done.push('반 현황 ' + Object.keys(p.classInfo).length + '개 반');
    }

    if (p.draft) write(KEYS.draft, p.draft); else remove(KEYS.draft);

    return {
      restored: done,
      skippedFieldDefs: !p.fieldDefs,
      skippedClassInfo: !p.classInfo
    };
  }

  /* ---------- 날짜 ---------- */

  function toISO(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function parseISO(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }

  /* 그 날짜가 속한 주(월요일 시작)의 월요일 */
  function mondayOf(d) {
    var x = new Date(d.getTime());
    var dow = x.getDay();                 /* 0=일 … 6=토 */
    x.setDate(x.getDate() - ((dow + 6) % 7));
    return x;
  }

  /* 시작일이 속한 주의 금요일.

     ⚠ 이 값은 시작일보다 빠를 수 있다. 토요일이나 일요일을 시작일로
     고르면 '그 주 금요일' 은 이미 지나간 날이다.
       2026-09-19(토) → 2026-09-18(금)
     9/19~9/18 로 42건이 발행된 첫 단추가 바로 이것이었다.

     그래서 이 함수를 자동 종료일에 그대로 쓰지 않는다.
     autoEnd() 를 쓴다. 이 함수는 옛 자료를 읽을 때의 대비책으로만 남긴다. */
  function fridayOfWeek(startISO) {
    var d = parseISO(startISO);
    if (!d) return '';
    var mon = mondayOf(d);
    mon.setDate(mon.getDate() + 4);
    return toISO(mon);
  }

  /* 기본 기간 길이(일). 사람이 종료일을 고치면 그 길이를 기억해 두고
     다음 주차에도 같은 길이를 쓴다. 월~금이면 5, 월~일이면 7.
     한 번도 안 고쳤으면 5(월~금). */
  var DEFAULT_SPAN = 5;

  function weekSpan() {
    var n = Number(read(KEYS.settings, {}).weekSpan);
    return (n >= 1 && n <= 31) ? Math.round(n) : DEFAULT_SPAN;
  }

  function setWeekSpan(days) {
    var n = Math.round(Number(days) || 0);
    if (n < 1 || n > 31) return;
    var s = read(KEYS.settings, {});
    if (s.weekSpan === n) return;
    s.weekSpan = n;
    write(KEYS.settings, s);
  }

  /* 시작일만 고른 상태에서 자동으로 채울 종료일.

     '그 주 금요일' 이 아니라 '지난번과 같은 기간 길이' 를 쓴다.
     그래야 무슨 요일로 시작하든 종료일이 시작일보다 빠를 수 없다.
       월요일 시작 + 5일 = 그 주 금요일  (예전과 같은 결과)
       토요일 시작 + 5일 = 다음 수요일   (예전에는 지난 금요일이 나왔다) */
  function autoEnd(startISO, span) {
    var days = span || weekSpan();
    var e = endFromSpan(startISO, days);
    if (!e) return '';
    return e < startISO ? startISO : e;      /* 어떤 경우에도 역전되지 않는다 */
  }

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  /* '2026-09-14' → '9/14(월)' */
  function dateWithDow(iso) {
    var d = parseISO(iso);
    if (!d) return '';
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + DOW[d.getDay()] + ')';
  }

  /* 두 날짜 사이가 며칠인가. 양 끝을 모두 센다. 9/14~9/20 → 7 */
  function daysBetween(startISO, endISO) {
    var a = parseISO(startISO), b = parseISO(endISO);
    if (!a || !b) return 0;
    return Math.round((b - a) / 86400000) + 1;
  }

  /* 시작일에 기간 길이를 더해 종료일을 구한다. 7일이면 9/21 → 9/27 */
  function endFromSpan(startISO, days) {
    var d = parseISO(startISO);
    if (!d || !days || days < 1) return '';
    d.setDate(d.getDate() + days - 1);
    return toISO(d);
  }

  /* 오늘이 속한 주. 끝은 기억해 둔 기간 길이를 따른다.
     월~금으로 쓰면 5일, 월~일로 쓰면 7일이 된다. */
  function thisWeek() {
    var start = toISO(mondayOf(new Date()));
    return { start: start, end: autoEnd(start) };
  }

  /* '2026-06-01' → '0601' (파일명용) */
  function mmdd(iso) {
    var m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? m[1] + m[2] : '';
  }

  /* '2026-06-01' → '6/1' */
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? Number(m[2]) + '/' + Number(m[3]) : '';
  }

  /* ---------- 코멘트 상용구 ---------- */

  function getSnippets()      { return read(KEYS.snippets, []); }
  function saveSnippets(list) { return write(KEYS.snippets, list); }

  /* ============================================================
     서버에서 전체 받아 캐시에 넣기 (로그인 직후)
     ============================================================ */

  var serverWasEmpty = false;

  /* 서버 내용을 받아 이 기기의 캐시에 넣는다.

     중요: 서버가 비어 있는데 이 브라우저에만 자료가 있을 수 있다.
     (예전 방식으로 쓰던 기기에서 처음 로그인한 경우)
     그때 서버(빈 값)로 덮어쓰면 옮길 자료가 사라진다.
     그래서 서버에 학생이 하나도 없으면 이 기기 내용을 그대로 둔다.
     대신 '서버로 올리기' 안내를 띄운다. */
  var missingTables = [];
  function serverMissing() { return missingTables.slice(); }

  function loadAll() {
    if (!global.DB) return Promise.reject(new Error('DB 모듈이 없습니다.'));

    return global.DB.loadAll().then(function (d) {
      missingTables = d.missingTables || [];
      var serverHasData = d.students.length > 0;
      var localHasData = getStudents().length > 0;

      serverWasEmpty = !serverHasData;

      if (!serverHasData && localHasData) {
        /* 명단은 이 기기 것을 지키되, 칸 정의는 서버에 있으면 받아 둔다.
           칸이 없으면 학생의 extra 값을 화면에 그릴 수가 없다. */
        if ((d.fieldDefs || []).length) writeLocal(KEYS.fieldDefs, d.fieldDefs);
        if (Object.keys(d.classInfo || {}).length) writeLocal(KEYS.classInfo, d.classInfo);
        return d;                      /* 이 기기 것을 지킨다 */
      }

      writeLocal(KEYS.students, d.students);
      writeLocal(KEYS.snippets, d.snippets);
      /* SQL 을 아직 실행하지 않았으면 서버가 칸을 제대로 모른다.
         받아온 것으로 덮어쓰면 이 기기에 만들어 둔 반 칸이 사라진다. */
      if (missingTables.indexOf('field_defs.scope') === -1) {
        writeLocal(KEYS.fieldDefs, d.fieldDefs || []);
      }
      if (missingTables.indexOf('class_info') === -1) {
        writeLocal(KEYS.classInfo, d.classInfo || {});
      }
      writeLocal(KEYS.sent, d.sent);
      writeLocal(KEYS.published, d.published);

      /* 열어 둘 주차 — 마지막으로 손댄 주차.

         예전에는 '시작일이 가장 늦은 주차' 를 열었다. 그러다 보니 날짜를
         잘못 골라 생긴 엉뚱한 주차(예: 9/19)가 하나라도 있으면 로그인할
         때마다 거기로 들어갔고, 정작 작업하던 주차는 직접 날짜를 다시
         골라야 보였다. 이제는 서버가 알려 주는 '마지막으로 고친 주차' 를 쓴다. */
      var weeks = Object.keys(d.entries).concat(Object.keys(d.common)).sort();
      var week = d.latestWeek ||
                 (weeks.length ? weeks[weeks.length - 1] : thisWeek().start);

      /* 종료일은 week_meta 가 주인이다. 서버에 없을 때만 자동으로 채운다.
         옛 자료에 뒤집힌 값(9/19~9/18 같은)이 남아 있으면 쓰지 않는다. */
      var end = d.weekEnds[week] || '';
      if (!end || end < week) end = autoEnd(week);

      writeLocal(KEYS.draft, {
        weekStart: week,
        weekEnd: end,
        /* 종료일을 사람이 고른 적이 있는지. 서버에 줄이 있으면 고른 것이다.
           이 값이 참이면 시작일을 바꿔도 기간 길이를 지킨다. */
        weekEndTouched: !!d.weekEnds[week] && d.weekEnds[week] >= week,
        common: d.common[week] || {},
        entries: d.entries[week] || {}
      });

      return d;
    });
  }

  function wasServerEmpty() { return serverWasEmpty; }

  /* ============================================================
     S-4. 이 브라우저에 있던 내용을 Supabase 로 한 번에 올리기

     예전 학생 id 는 's_1a2b' 같은 값이라 Supabase 의 uuid 와 맞지 않는다.
     새 uuid 를 만들어 붙이고, 그 id 를 쓰던 곳(작성 내용·보냄 표시·발행 이력)도
     함께 바꿔 준다.
     ============================================================ */

  function migrateLocalToServer() {
    if (!global.DB) return Promise.reject(new Error('DB 모듈이 없습니다.'));

    var students = getStudents();
    if (!students.length) {
      return Promise.reject(new Error('이 브라우저에 올릴 명단이 없습니다.'));
    }

    /* 옛 id → 새 uuid */
    var idMap = {};
    var fixed = students.map(function (s) {
      var next = isUuid(s.id) ? s.id : newId();
      idMap[s.id] = next;
      var copy = {};
      Object.keys(s).forEach(function (k) { copy[k] = s[k]; });
      copy.id = next;
      return copy;
    });

    function remapByStudent(obj) {
      var out = {};
      Object.keys(obj || {}).forEach(function (week) {
        out[week] = {};
        Object.keys(obj[week] || {}).forEach(function (sid) {
          out[week][idMap[sid] || sid] = obj[week][sid];
        });
      });
      return out;
    }

    var draft = read(KEYS.draft, null);
    if (draft && draft.entries) {
      var e2 = {};
      Object.keys(draft.entries).forEach(function (sid) {
        e2[idMap[sid] || sid] = draft.entries[sid];
      });
      draft.entries = e2;
    }

    var sent = remapByStudent(read(KEYS.sent, {}));
    var published = remapByStudent(read(KEYS.published, {}));
    var snippets = getSnippets().map(function (s) {
      return { id: isUuid(s.id) ? s.id : newId(), text: s.text };
    });
    var fields = getFieldDefs().map(function (f, i) {
      return {
        id: isUuid(f.id) ? f.id : newId(),
        key: f.key, label: f.label, type: f.type,
        options: f.options || [], showInTable: f.showInTable !== false,
        scope: scopeOf(f), sortOrder: i
      };
    });
    var classInfo = getClassInfo();

    /* 먼저 로컬을 새 id 로 바꿔 둔다. 중간에 실패해도 다시 시도할 수 있다. */
    writeLocal(KEYS.students, fixed);
    if (draft) writeLocal(KEYS.draft, draft);
    writeLocal(KEYS.sent, sent);
    writeLocal(KEYS.published, published);
    writeLocal(KEYS.snippets, snippets);
    writeLocal(KEYS.fieldDefs, fields);

    var ids = fixed.map(function (s) { return s.id; });
    var report = { students: fixed.length, entries: 0, commons: 0,
                   snippets: snippets.length, fields: fields.length, sent: 0 };

    return global.DB.syncStudents(fixed)
      .then(function () { return global.DB.saveSnippets(snippets); })
      .then(function () { return fields.length ? global.DB.syncFieldDefs(fields) : null; })
      .then(function () {
        return Object.keys(classInfo).length ? global.DB.syncClassInfo(classInfo) : null;
      })
      .then(function () {
        if (!draft || !draft.weekStart) return null;
        var jobs = [];
        Object.keys(draft.common || {}).forEach(function (cls) {
          if (!cls || cls === '_') return;
          report.commons++;
          var c = draft.common[cls];
          jobs.push(global.DB.saveWeekCommon(draft.weekStart, draft.weekEnd, cls,
                                         c.lessons, c.tests, c.comment));
        });
        report.entries = Object.keys(draft.entries || {}).length;
        jobs.push(global.DB.saveEntries(draft.weekStart, draft.entries, ids));
        return Promise.all(jobs);
      })
      .then(function () {
        var jobs = [];
        Object.keys(sent).forEach(function (week) {
          Object.keys(sent[week]).forEach(function (sid) {
            if (ids.indexOf(sid) === -1) return;
            report.sent++;
            jobs.push(global.DB.markSent(week, sid, sent[week][sid].via, sent[week][sid].by));
          });
        });
        return Promise.all(jobs);
      })
      .then(function () {
        serverWasEmpty = false;      /* 이제 서버에 자료가 있다 → 안내를 내린다 */
        return report;
      });
  }

  /* ---------- 토큰 ---------- */

  function getToken()      { return read(KEYS.token, null); }
  function saveToken(obj)  { return write(KEYS.token, obj); }
  function clearToken()    { return remove(KEYS.token); }

  /* ---------- 전체 지우기 ---------- */

  function clearAll() {
    Object.keys(KEYS).forEach(function (k) { remove(KEYS[k]); });
  }

  function clearStudentsOnly() {
    remove(KEYS.students);
  }

  /* ---------- 내보내기 ---------- */

  global.Store = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    KEYS: KEYS,

    read: read, write: write, writeLocal: writeLocal, remove: remove,

    loadAll: loadAll,
    wasServerEmpty: wasServerEmpty,
    migrateLocalToServer: migrateLocalToServer,
    enableSync: enableSync,
    onSyncChange: onSyncChange,
    syncState: syncState,

    newId: newId,
    isUuid: isUuid,
    getStudents: getStudents,
    saveStudents: saveStudents,
    upsertStudent: upsertStudent,
    deleteStudent: deleteStudent,
    getClasses: getClasses,

    romanizeGivenName: romanizeGivenName,
    phoneDigits: phoneDigits,
    phoneFormat: phoneFormat,
    phoneValid: phoneValid,
    parentTitleOf: parentTitleOf,
    studentPhoneOf: studentPhoneOf,
    phonesOf: phonesOf,

    exportEncrypted: exportEncrypted,
    importEncrypted: importEncrypted,
    restorePayload: restorePayload,

    toISO: toISO, parseISO: parseISO,
    fridayOfWeek: fridayOfWeek, thisWeek: thisWeek,
    dateWithDow: dateWithDow, daysBetween: daysBetween, endFromSpan: endFromSpan,
    autoEnd: autoEnd, weekSpan: weekSpan, setWeekSpan: setWeekSpan,
    mmdd: mmdd, shortDate: shortDate,

    getSnippets: getSnippets, saveSnippets: saveSnippets,
    getFieldDefs: getFieldDefs, saveFieldDefs: saveFieldDefs,
    newFieldKey: newFieldKey, FIELD_TYPES: FIELD_TYPES, SCOPES: SCOPES,
    fieldValue: fieldValue, fieldText: fieldText, scopeOf: scopeOf,
    getClassInfo: getClassInfo, saveClassInfo: saveClassInfo,
    serverMissing: serverMissing,
    setClassExtra: setClassExtra, classExtra: classExtra,

    getToken: getToken, saveToken: saveToken, clearToken: clearToken,
    clearAll: clearAll, clearStudentsOnly: clearStudentsOnly
  };

})(window);
