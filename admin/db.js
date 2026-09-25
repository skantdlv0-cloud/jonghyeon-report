/* ============================================================
   db.js — Supabase 읽기·쓰기

   화면 코드는 이 파일을 직접 부르지 않는다.
   store.js 가 캐시를 들고 있고, 저장할 때 여기로 넘긴다.

   표 이름과 칸 이름은 supabase/schema.sql 과 맞춘다.
   화면에서는 camelCase, DB 에서는 snake_case 를 쓰므로 여기서 바꿔 준다.
   ============================================================ */

(function (global) {
  'use strict';

  function sb() { return SB.client; }

  /* ---------- 학생 ---------- */

  /* migration-001 이 만드는 student_phone 칸이 서버에 있는가.
     loadAll 이 한 번 살펴 두고, 없으면 그 칸을 빼고 저장한다.
     (배포가 SQL 보다 먼저 나가도 명단 저장이 깨지지 않게) */
  function hasStudentPhone() {
    return missingTables.indexOf('students.student_phone') === -1;
  }

  function toDbStudent(s) {
    var row = {
      id: s.id,
      name: s.name || '',
      slug: s.slug || '',
      school: s.school || '',
      grade: s.grade || '',
      class_name: s.className || '',
      parent_title: s.parentTitle || '',
      parent_phone: s.parentPhone || '',
      extra: s.extra || {},
      archived: !!s.archived,
      sort_order: s.sortOrder || 0
    };

    if (hasStudentPhone()) {
      row.student_phone = s.studentPhone || '';
      /* 옛 '연락처 2'. migration-001 이 student_phone 으로 옮겼고
         migration-002 가 비운다. 옛 기기에서 들어온 값을 말없이
         지우지 않으려고 그대로 실어 보낸다. */
      row.parent_phone2 = s.parentPhone2 || '';
    } else {
      /* migration-001 을 아직 안 돌렸다. 학생 번호를 담을 칸이 없으므로
         옛 칸에 그대로 둔다. SQL 을 돌리면 그때 옮겨진다. */
      row.parent_phone2 = s.studentPhone || s.parentPhone2 || '';
    }

    return row;
  }

  function fromDbStudent(r) {
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      school: r.school || '',
      grade: r.grade || '',
      className: r.class_name || '',
      parentTitle: r.parent_title || '',
      parentPhone: r.parent_phone || '',
      /* migration-001 전에는 학생 번호가 옛 칸에 있다 */
      studentPhone: r.student_phone || r.parent_phone2 || '',
      parentPhone2: r.parent_phone2 || '',
      extra: r.extra || {},
      archived: !!r.archived,
      sortOrder: r.sort_order || 0,
      createdAt: r.created_at
    };
  }

  /* ---------- 내가 만든 칸 (field_defs) ---------- */

  function toDbField(f) {
    return {
      id: f.id,
      key: f.key,
      label: f.label || '',
      type: f.type || 'text',
      options: f.options || [],
      show_in_table: f.showInTable !== false,
      scope: f.scope === 'class' ? 'class' : 'student',
      sort_order: f.sortOrder || 0
    };
  }

  function fromDbField(r) {
    return {
      id: r.id,
      key: r.key,
      label: r.label || '',
      type: r.type || 'text',
      options: r.options || [],
      /* 예전 행에는 show_in_table 이 없다. 없으면 보이는 쪽으로 본다. */
      showInTable: r.show_in_table !== false,
      /* 예전 행에는 scope 가 없다. 전부 학생 칸이었다. */
      scope: r.scope === 'class' ? 'class' : 'student',
      sortOrder: r.sort_order || 0
    };
  }

  /* 칸 목록 전체 맞추기.
     학생 명단과 달리 여기서는 빈 목록도 허용한다.
     칸을 다 지우는 것은 자연스러운 조작이고, 지워도 학생 자료(extra)는 남는다. */
  function syncFieldDefs(list, opts) {
    var c = sb();
    opts = opts || {};

    /* scope 칸이 아직 없으면(SQL 미실행) 서버로 보내지 않는다.
       보내면 오류가 나고, scope 를 빼고 보내면 반 칸이 학생 칸으로 둔갑한다.
       SQL 을 실행하고 다시 저장하면 그때 한꺼번에 올라간다. */
    if (missingTables.indexOf('field_defs.scope') !== -1) {
      return Promise.resolve({ skipped: true });
    }

    var rows = (list || []).map(toDbField);

    if (!rows.length) {
      /* 빈 목록으로 서버를 비우는 것은 칸 관리에서 직접 지웠을 때만 한다.

         예전에 백업 복원이 빈 목록을 보내 서버의 칸 정의가 통째로 날아갔다.
         값(class_info.extra, students.extra)은 남아 있었지만 보여 줄 칸이
         없어져서 반 현황이 사라진 것처럼 보였다.

         그래서 허락 없이 들어온 빈 목록은 지우지 않고, 서버에 몇 개가
         남아 있는지 세어 알려 준다. */
      if (!opts.allowClear) {
        return c.from('field_defs').select('id')
          .then(check)
          .then(function (res) {
            var n = (res.data || []).length;
            if (!n) return { skipped: true, serverCount: 0 };
            return { skipped: true, refusedClear: true, serverCount: n };
          });
      }
      return c.from('field_defs')
        .delete().neq('id', '00000000-0000-0000-0000-000000000000').then(check);
    }

    return c.from('field_defs').upsert(rows, { onConflict: 'id' })
      .then(check)
      .then(function () {
        var ids = rows.map(function (r) { return r.id; });
        return c.from('field_defs').delete().not('id', 'in', '(' + ids.join(',') + ')').then(check);
      });
  }

  /* ---------- 반 현황 (class_info) ----------
     { '운유1': { f_xxx: '값' }, … } 모양으로 주고받는다. */

  function syncClassInfo(map) {
    var c = sb();
    var names = Object.keys(map || {});

    /* 표가 아직 없으면(SQL 미실행) 서버로 보내지 않는다.
       이 기기에는 남아 있으므로, SQL 을 실행하고 다시 저장하면 올라간다. */
    if (missingTables.indexOf('class_info') !== -1) {
      return Promise.resolve({ skipped: true });
    }

    if (!names.length) {
      /* 반이 하나도 없으면 아무것도 하지 않는다.
         명단이 아직 안 올라온 상태에서 서버를 비우면 안 된다. */
      return Promise.resolve({ skipped: true });
    }

    var rows = names.map(function (n) {
      return { class_name: n, extra: map[n] || {}, updated_at: new Date().toISOString() };
    });

    return c.from('class_info').upsert(rows, { onConflict: 'class_name' })
      .then(check)
      .then(function () {
        /* 없어진 반은 지운다. 반 이름을 바꾸면 옛 이름 줄이 남기 때문이다. */
        var list = names.map(function (n) { return '"' + String(n).split('"').join('""') + '"'; });
        return c.from('class_info')
          .delete().not('class_name', 'in', '(' + list.join(',') + ')').then(check);
      });
  }

  /* ---------- 주간 입력 ---------- */

  function toDbEntry(weekStart, studentId, e) {
    return {
      week_start: weekStart,
      student_id: studentId,
      attend_status: e.attendStatus || '',
      attend_note: e.attendNote || '',
      focus_score: Math.max(0, Math.min(5, Number(e.focusScore) || 0)),
      scores: e.scores || {},
      homework: e.homework || {},
      on_time_rate: Math.max(0, Math.min(100, e.onTimeRate == null ? 100 : Number(e.onTimeRate))),
      comment: e.comment || ''
    };
  }

  function fromDbEntry(r) {
    return {
      attendStatus: r.attend_status || '',
      attendNote: r.attend_note || '',
      focusScore: r.focus_score || 0,
      scores: r.scores || {},
      homework: r.homework || {},
      onTimeRate: r.on_time_rate == null ? 100 : r.on_time_rate,
      comment: r.comment || ''
    };
  }

  /* ============================================================
     전체 읽기 — 로그인 직후 한 번
     ============================================================ */

  /* 아직 SQL 을 실행하지 않아 표가 없을 수도 있는 조회.
     이걸로 로그인 전체가 막히면 안 되므로, 실패하면 빈 값으로 넘어간다.
     대신 어느 표가 없었는지 적어 두고 화면에서 알려 준다. */
  var missingTables = [];

  function optional(name, q) {
    function miss() {
      if (missingTables.indexOf(name) === -1) missingTables.push(name);
      return { data: [], error: null };
    }
    return Promise.resolve(q).then(
      function (r) { return (r && r.error) ? miss() : r; },
      function () { return miss(); }
    );
  }

  function loadAll() {
    var c = sb();
    missingTables = [];
    return Promise.all([
      c.from('students').select('*').order('class_name').order('name'),
      c.from('snippets').select('*').order('sort_order'),
      c.from('week_common').select('*'),
      c.from('entries').select('*'),
      c.from('sent').select('*'),
      c.from('published').select('*'),
      c.from('field_defs').select('*').order('sort_order'),
      optional('class_info', c.from('class_info').select('*')),
      /* migration-004 가 scope 칸도 같이 만든다. 없는 칸을 고르면 오류가 난다. */
      optional('field_defs.scope', c.from('field_defs').select('scope').limit(1)),
      /* migration-001 이 만드는 칸. 배포가 SQL 보다 먼저 나가도
         명단 저장이 실패하지 않도록 있는지 미리 살핀다. */
      optional('students.student_phone', c.from('students').select('student_phone').limit(1)),
      /* migration-003 이 만드는 표. 주차 종료일이 여기 한 줄로 들어 있다. */
      optional('week_meta', c.from('week_meta').select('*'))
    ]).then(function (res) {
      res.forEach(function (r) {
        if (r.error) throw new Error('불러오기 실패: ' + r.error.message);
      });

      var students = res[0].data.map(fromDbStudent);
      var snippets = res[1].data.map(function (r) { return { id: r.id, text: r.text }; });

      /* 반 공통 → { '2026-06-01': { '고1 A반': {lessons, tests} } } */
      var common = {};
      var weeks = {};
      res[2].data.forEach(function (r) {
        common[r.week_start] = common[r.week_start] || {};
        common[r.week_start][r.class_name] = {
          lessons: r.lessons || [''],
          tests: r.tests || ['']
        };
        /* week_meta 가 없던 시절 자료를 위한 대비책.
           week_meta 에 줄이 있으면 아래에서 덮어쓴다. */
        if (!weeks[r.week_start] || r.week_end > weeks[r.week_start]) {
          weeks[r.week_start] = r.week_end;
        }
      });

      /* 학생별 입력 → { '2026-06-01': { studentId: entry } } */
      var entries = {};
      /* 마지막으로 손댄 주차. 로그인하면 이 주차를 연다.
         예전에는 시작일이 가장 늦은 주차를 열었는데, 날짜를 잘못 골라
         생긴 엉뚱한 주차가 있으면 로그인할 때마다 거기로 들어갔다. */
      var latestWeek = '', latestAt = '';
      res[3].data.forEach(function (r) {
        entries[r.week_start] = entries[r.week_start] || {};
        entries[r.week_start][r.student_id] = fromDbEntry(r);
        var at = r.updated_at || r.created_at || '';
        if (at > latestAt) { latestAt = at; latestWeek = r.week_start; }
      });

      /* 보냄 표시 */
      var sent = {};
      res[4].data.forEach(function (r) {
        sent[r.week_start] = sent[r.week_start] || {};
        sent[r.week_start][r.student_id] = { at: r.sent_at, via: r.via, by: r.sent_by };
      });

      /* 주차 종료일 — week_meta 가 있으면 그것이 주인이다.
         (migration-003 전에는 줄이 없으므로 위의 week_common 값이 남는다)

         res 의 자리는 위 Promise.all 의 순서 그대로다. week_meta 는 마지막이다.
         자리를 잘못 세면 엉뚱한 결과를 종료일로 읽으므로 이름으로 못을 박아 둔다. */
      var WEEK_META = 10;
      (res[WEEK_META] && res[WEEK_META].data || []).forEach(function (r) {
        if (r && r.week_start && r.week_end) weeks[r.week_start] = r.week_end;
      });

      /* 발행 이력 */
      var published = {};
      res[5].data.forEach(function (r) {
        published[r.week_start] = published[r.week_start] || {};
        published[r.week_start][r.student_id] = {
          path: r.path, url: r.url, publishedAt: r.published_at, commitSha: r.commit_sha
        };
      });

      return {
        students: students,
        snippets: snippets,
        common: common,
        weekEnds: weeks,
        latestWeek: latestWeek,
        entries: entries,
        sent: sent,
        published: published,
        fieldDefs: res[6].data.map(fromDbField),
        classInfo: (function () {
          var m = {};
          (res[7].data || []).forEach(function (r) { m[r.class_name] = r.extra || {}; });
          return m;
        })(),
        missingTables: missingTables.slice()
      };
    });
  }

  /* ============================================================
     쓰기
     ============================================================ */

  /* 명단 전체 맞추기.
     주의: 빈 목록이 넘어오면 삭제하지 않는다.
     실수로 비워진 캐시가 서버 명단을 지우는 사고를 막기 위함이다.
     명단을 정말 비울 때는 purge=true 로 명시해서 부른다. */
  function syncStudents(list, purge) {
    var c = sb();
    var rows = (list || []).map(toDbStudent);

    if (!rows.length) {
      if (!purge) return Promise.resolve({ skipped: true });
      return c.from('students').delete().neq('id', '00000000-0000-0000-0000-000000000000')
        .then(check);
    }

    return c.from('students').upsert(rows, { onConflict: 'id' })
      .then(check)
      .then(function () {
        var ids = rows.map(function (r) { return r.id; });
        return c.from('students').delete().not('id', 'in', '(' + ids.join(',') + ')').then(check);
      });
  }

  /* 주차 종료일. 반과 상관없이 주차마다 한 줄이다.

     예전에는 종료일이 week_common 에만 있어서, 반 공통(차시·테스트 이름)을
     아직 안 적은 반은 줄이 안 생겨 종료일이 서버에 올라가지 않았다.
     그래서 새로고침하면 그 주 금요일로 되돌아갔다. (그게 날짜 버그의 원인 A·B)

     표가 아직 없으면(migration-003 미실행) 건너뛴다. 이 기기에는 남아 있으므로
     SQL 을 실행하고 다시 저장하면 그때 올라간다. */
  function saveWeekMeta(weekStart, weekEnd) {
    if (!weekStart || !weekEnd) return Promise.resolve({ skipped: true });
    if (weekEnd < weekStart) return Promise.resolve({ skipped: true });
    if (missingTables.indexOf('week_meta') !== -1) {
      return Promise.resolve({ skipped: true });
    }
    return sb().from('week_meta').upsert({
      week_start: weekStart,
      week_end: weekEnd,
      updated_at: new Date().toISOString()
    }, { onConflict: 'week_start' }).then(check);
  }

  function saveWeekCommon(weekStart, weekEnd, className, lessons, tests) {
    if (!weekStart || !className) return Promise.resolve();
    return sb().from('week_common').upsert({
      week_start: weekStart,
      week_end: weekEnd || weekStart,
      class_name: className,
      lessons: lessons || [],
      tests: tests || []
    }, { onConflict: 'week_start,class_name' }).then(check);
  }

  function saveEntries(weekStart, entryMap, studentIds) {
    if (!weekStart) return Promise.resolve();
    var rows = [];
    Object.keys(entryMap || {}).forEach(function (sid) {
      /* 명단에 없는 학생의 입력은 보내지 않는다 (외래키 오류가 난다) */
      if (studentIds && studentIds.indexOf(sid) === -1) return;
      rows.push(toDbEntry(weekStart, sid, entryMap[sid]));
    });
    if (!rows.length) return Promise.resolve();
    return sb().from('entries').upsert(rows, { onConflict: 'week_start,student_id' }).then(check);
  }

  function saveSnippets(list) {
    var c = sb();
    var rows = (list || []).map(function (s, i) {
      return { id: s.id, text: s.text, sort_order: i };
    }).filter(function (r) { return r.text && String(r.text).trim(); });

    /* 상용구는 수가 적으므로 통째로 맞춘다 */
    return c.from('snippets').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      .then(check)
      .then(function () {
        if (!rows.length) return null;
        return c.from('snippets').insert(rows).then(check);
      });
  }

  function markSent(weekStart, studentId, via, by) {
    return sb().from('sent').upsert({
      week_start: weekStart, student_id: studentId,
      via: via || 'copy', sent_by: by || '', sent_at: new Date().toISOString()
    }, { onConflict: 'week_start,student_id' }).then(check);
  }

  function unmarkSent(weekStart, studentId) {
    return sb().from('sent').delete()
      .eq('week_start', weekStart).eq('student_id', studentId).then(check);
  }

  function savePublished(weekStart, studentId, path, url, commitSha) {
    return sb().from('published').upsert({
      week_start: weekStart, student_id: studentId,
      path: path, url: url, commit_sha: commitSha || ''
    }, { onConflict: 'week_start,student_id' }).then(check);
  }

  /* 그 반의 '지난 회차' 수업 내용 — 이번 주보다 앞선 가장 최근 주 */
  function lastCommonOf(className, beforeWeek) {
    return sb().from('week_common')
      .select('*')
      .eq('class_name', className)
      .lt('week_start', beforeWeek)
      .order('week_start', { ascending: false })
      .limit(1)
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        if (!r.data || !r.data.length) return null;
        var row = r.data[0];
        return {
          lessons: row.lessons || [''],
          tests: row.tests || [''],
          weekStart: row.week_start,
          weekEnd: row.week_end
        };
      });
  }

  /* ---------- 공용 설정 (인사말 등) ----------
     기기마다 따로 두지 않고 서버에 둔다.
     선생님이 문구를 고치면 조교 노트북에도 같이 반영된다. */

  function getSetting(key) {
    return sb().from('app_settings').select('*').eq('key', key).limit(1)
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        return (r.data && r.data.length) ? r.data[0].value : null;
      });
  }

  function saveSetting(key, value, by) {
    return sb().from('app_settings').upsert({
      key: key, value: value, updated_by: by || '', updated_at: new Date().toISOString()
    }, { onConflict: 'key' }).then(check);
  }

  /* ---------- 발행된 주차 목록 ----------
     ④ 발송 탭에서 주차를 골라 볼 때 쓴다. */
  function publishedWeeks() {
    return sb().from('published').select('week_start')
      .order('week_start', { ascending: false })
      .then(function (r) {
        if (r.error) throw new Error(r.error.message);
        var seen = {};
        var out = [];
        (r.data || []).forEach(function (row) {
          if (seen[row.week_start]) return;
          seen[row.week_start] = 1;
          out.push(row.week_start);
        });
        return out;
      });
  }

  /* 그 주차의 발행 이력 + 보냄 표시를 한 번에 */
  function weekSendData(weekStart) {
    var c = sb();
    return Promise.all([
      c.from('published').select('*').eq('week_start', weekStart),
      c.from('sent').select('*').eq('week_start', weekStart),
      c.from('week_common').select('week_start,week_end').eq('week_start', weekStart).limit(1),
      /* 종료일의 주인은 week_meta 다. 표가 아직 없으면(migration-003 미실행)
         빈 값으로 넘어가고 아래에서 week_common 값을 쓴다. */
      optional('week_meta', c.from('week_meta').select('week_end').eq('week_start', weekStart).limit(1))
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw new Error(r.error.message); });

      var published = {};
      res[0].data.forEach(function (r) {
        published[r.student_id] = { path: r.path, url: r.url, publishedAt: r.published_at };
      });

      var sent = {};
      res[1].data.forEach(function (r) {
        sent[r.student_id] = { at: r.sent_at, via: r.via, by: r.sent_by };
      });

      /* week_meta 먼저, 없으면 옛 자리(week_common), 그래도 없으면 빈 값.
         뒤집힌 값은 쓰지 않는다. */
      var meta = (res[3] && res[3].data && res[3].data.length) ? res[3].data[0].week_end : '';
      var old  = (res[2].data && res[2].data.length) ? res[2].data[0].week_end : '';
      var weekEnd = meta || old || '';
      if (weekEnd && weekEnd < weekStart) weekEnd = '';

      return { published: published, sent: sent, weekEnd: weekEnd };
    });
  }

  function check(r) {
    if (r && r.error) throw new Error(r.error.message);
    return r;
  }

  global.DB = {
    loadAll: loadAll,
    syncStudents: syncStudents,
    saveWeekCommon: saveWeekCommon,
    saveWeekMeta: saveWeekMeta,
    saveEntries: saveEntries,
    saveSnippets: saveSnippets,
    markSent: markSent,
    unmarkSent: unmarkSent,
    savePublished: savePublished,
    lastCommonOf: lastCommonOf,
    getSetting: getSetting,
    saveSetting: saveSetting,
    publishedWeeks: publishedWeeks,
    weekSendData: weekSendData,
    toDbStudent: toDbStudent,
    fromDbStudent: fromDbStudent,
    syncFieldDefs: syncFieldDefs,
    syncClassInfo: syncClassInfo,
    missingTables: function () { return missingTables.slice(); },

    /* 자동 검증용 — SQL 을 아직 안 돌린 상태를 흉내 낼 때만 쓴다.
       화면 코드에서는 부르지 않는다. */
    __markMissing: function (name) {
      if (missingTables.indexOf(name) === -1) missingTables.push(name);
      return Promise.resolve(missingTables.slice());
    }
  };

})(window);
