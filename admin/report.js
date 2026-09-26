/* ============================================================
   report.js — 레포트 HTML 만들기

   template/report-template.html 을 그대로 읽어 플레이스홀더만 채운다.
   레포트 형식이 한 군데에만 있어야 하므로 여기서 HTML 을 새로 짜지 않는다.

   미리보기(B단계)와 발행(D단계)이 같은 함수를 쓴다.
   ============================================================ */

(function (global) {
  'use strict';

  var SITE_URL = global.CONFIG.siteUrl;

  /* 템플릿 설명 주석 — 치환 전에 반드시 먼저 지운다.
     안 지우면 주석 안 예시 자리에도 값이 들어간다. */
  var DOC_COMMENT = /<!-- =+\r?\n\s+치환 플레이스홀더[\s\S]*?=+ -->\r?\n\r?\n/;

  var templateCache = null;

  function loadTemplate() {
    if (templateCache) return Promise.resolve(templateCache);
    return fetch('../template/report-template.html', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('템플릿을 불러오지 못했습니다 (HTTP ' + r.status + ')');
        return r.text();
      })
      .then(function (text) {
        if (!DOC_COMMENT.test(text)) {
          throw new Error('템플릿에서 설명 주석 블록을 찾지 못했습니다.');
        }
        templateCache = text.replace(DOC_COMMENT, '');
        return templateCache;
      });
  }

  /* 랜덤 4자 — 이름만으로 남의 레포트를 추측해 여는 것을 막는다 */
  function randomSuffix() {
    var chars = 'abcdefghijkmnpqrstuvwxyz23456789';   /* 헷갈리는 l,o,0,1 제외 */
    var a = new Uint8Array(4);
    crypto.getRandomValues(a);
    var out = '';
    for (var i = 0; i < 4; i++) out += chars[a[i] % chars.length];
    return out;
  }

  /* /r/2026/0601-haneul-a7f3.html */
  function buildPath(student, startDate, suffix) {
    var year = String(startDate).slice(0, 4);
    return '/r/' + year + '/' + Store.mmdd(startDate) + '-' +
           (student.slug || 'student') + '-' + (suffix || randomSuffix()) + '.html';
  }

  /* JSON 안의 '<' 를 막지 않으면 코멘트에 </script> 가 들어갔을 때 페이지가 깨진다 */
  function safeJson(obj) {
    return JSON.stringify(obj, null, 2).replace(/</g, '\\u003C');
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '.' +
           String(d.getMonth() + 1).padStart(2, '0') + '.' +
           String(d.getDate()).padStart(2, '0');
  }

  /* 레포트 HTML 한 편을 만든다.
     opts.cssHref · opts.brandHref 를 주면 파일 경로를 절대주소로 바꾼다.
     미리보기는 srcdoc 안에서 열리므로 상대 경로가 통하지 않는다. */
  function buildHtml(tpl, data, reportPath, opts) {
    opts = opts || {};

    var B = global.BRAND || {};
    var period = Store.shortDate(data.startDate) + '~' + Store.shortDate(data.endDate);
    var out = tpl;

    if (opts.cssHref) {
      out = out.replace('../../assets/report.css', opts.cssHref);
    }
    if (opts.brandHref) {
      out = out.replace('../../assets/brand.js', opts.brandHref);
    }

    /* 카톡 미리보기용 — 크롤러가 자바스크립트를 안 읽어서 글자로 박는다 */
    out = out.split('{{OG_EMOJI}}').join(B.ogEmoji || '📘');
    out = out.split('{{REPORT_BRAND}}').join(B.reportBrand || '김종현 국어');
    out = out.split('{{REPORT_TITLE}}').join(B.reportTitle || '김종현 국어 주간 학습 레포트');

    out = out.split('{{SITE_URL}}').join(SITE_URL);
    out = out.split('{{REPORT_PATH}}').join(reportPath);
    out = out.split('{{STUDENT_NAME}}').join(data.studentName || '');
    out = out.split('{{PERIOD_SHORT}}').join(period);
    out = out.split('{{PUBLISH_DATE}}').join(opts.publishDate || todayISO());
    out = out.split('{{REPORT_DATA}}').join(safeJson(data));

    return out;
  }

  /* 작성 탭의 입력값 → 레포트 데이터(지시서 2-3 스키마) */
  function toReportData(student, common, entry, week) {
    var tests = (common.tests || [])
      .map(function (name, i) {
        var raw = entry.scores ? entry.scores[i] : '';
        if (name == null || !String(name).trim()) return null;
        return { name: String(name).trim(), score: clampPct(raw) };
      })
      .filter(Boolean);

    return {
      school: student.school || '',
      grade: student.grade || '',
      studentName: student.name || '',
      startDate: week.start,
      endDate: week.end,
      attendance: {
        status: entry.attendStatus || '',
        note: (entry.attendNote || '').trim()
      },
      lessons: (common.lessons || []).filter(function (l) { return String(l || '').trim(); }),
      focusScore: Number(entry.focusScore) || 0,
      tests: tests,
      homework: entry.homework || {},
      /* 반 공통에 적은 과제 목록을 레포트에도 함께 담는다.
         레포트 파일은 혼자서 그려져야 하므로 이름이 그 안에 있어야 한다. */
      homeworkItems: homeworkItems(common).map(function (it) {
        return { key: it.key, group: groupOf(it), name: String(it.name).trim() };
      }),
      requiredRate: rateOf(common, entry.homework, 'required'),
      optionalRate: rateOf(common, entry.homework, 'optional'),
      /* 옛 요일 방식 자료를 다시 그릴 때만 쓰인다 */
      submitRate: submitRateOf(entry.homework),
      onTimeRate: clampPct(entry.onTimeRate == null ? 100 : entry.onTimeRate),
      /* 레포트에는 코멘트가 한 칸만 나온다.
         학생 코멘트가 비어 있으면 그 자리에 반 공통 코멘트가 들어간다. */
      comment: commentFor(common, entry)
    };
  }

  /* 이 학생 레포트에 들어갈 코멘트.
       학생 코멘트에 글이 있다 → 그 학생 것
       비어 있다              → 반 공통 코멘트
     화면에서도 같은 규칙을 쓴다. (write.js 의 commentOf) */
  function commentFor(common, entry) {
    var own = ((entry && entry.comment) || '').trim();
    if (own) return own;
    return (((common && common.comment) || '')).trim();
  }

  /* ============================================================
     작성 완료 판정

     필수 항목이 다 채워졌을 때만 '작성 완료' 다.
     작성 탭의 딱지와 발행 탭의 목록이 이 한 함수를 같이 쓴다.
     그래야 '작성됨' 으로 보이는데 발행 목록에는 없는 일이 생기지 않는다.

       출결        언제나 필수
       집중도      1점 이상. 결석이면 면제
       리뷰테스트   반 공통에 이름이 있는 것 전부. 결석이면 면제
       코멘트      반 공통이든 개별이든 비어 있지 않을 것

     과제 체크와 제출률은 필수가 아니다. '안 함' 도 정상적인 값이라
     다 채웠는지 알 방법이 없기 때문이다.

     돌려주는 것
       state   'none'    아직 아무것도 안 건드림      (회색 · 미작성)
               'partial' 건드렸지만 빠진 게 있음      (주황 · 작성 중)
               'done'    필수가 다 채워짐             (초록 · 작성 완료)
       missing 빠진 항목 이름들 — 화면에서 무엇이 모자란지 알려 준다
     ============================================================ */

  function isAbsent(entry) {
    var a = String((entry && entry.attendStatus) || '').trim();
    return a === 'absent' || a === '결석';
  }

  function namedTests(common) {
    /* 이름이 적힌 것만. 점수는 원래 자리(index)로 붙으므로 자리를 같이 들고 간다. */
    var out = [];
    ((common && common.tests) || []).forEach(function (name, i) {
      if (name != null && String(name).trim()) out.push({ i: i, name: String(name).trim() });
    });
    return out;
  }

  function hasScore(entry, i) {
    var v = entry && entry.scores ? entry.scores[i] : undefined;
    if (v === 0) return true;             /* 0점(미응시)도 고른 값이다 */
    return v != null && String(v).trim() !== '';
  }

  function entryStatus(common, entry) {
    var e = entry || {};
    var att = String(e.attendStatus || '').trim();
    var absent = isAbsent(e);
    var missing = [];

    if (!att) missing.push('출결');

    if (!absent) {
      if (!(Number(e.focusScore) > 0)) missing.push('집중도');

      var tests = namedTests(common);
      var noScore = tests.filter(function (t) { return !hasScore(e, t.i); });
      if (noScore.length === 1) missing.push(noScore[0].name + ' 점수');
      else if (noScore.length > 1) missing.push('점수 ' + noScore.length + '개');
    }

    if (!commentFor(common, e)) missing.push('코멘트');

    /* '건드렸는가' 는 그 학생 것만 본다.
       반 공통 코멘트를 적었다고 해서 42명 전원이 '작성 중' 이 되면 안 된다. */
    var touched = !!att ||
                  Number(e.focusScore) > 0 ||
                  Object.keys(e.scores || {}).length > 0 ||
                  !!String(e.comment || '').trim() ||
                  homeworkTouched(e.homework);

    return {
      state: !missing.length ? 'done' : (touched ? 'partial' : 'none'),
      missing: missing
    };
  }

  var STATUS_LABEL = { none: '미작성', partial: '작성 중', done: '작성 완료' };

  function statusLabel(state) { return STATUS_LABEL[state] || '미작성'; }

  function clampPct(v) {
    var n = Math.round(Number(v) || 0);
    return n < 0 ? 0 : n > 100 ? 100 : n;
  }

  /* ============================================================
     과제

     반 공통에 항목을 적고(이름), 학생마다 항목별로 요일을 체크한다.
       반 공통  [{key:'h1', group:'required', name:'문학 주간지'}, …]
       학생     {h1:{월:true, 수:true}, h3:{}}

     제출률은 체크한 요일 칸 수로 센다.
       필수과제 제출률 = 필수 항목들에서 체크한 칸 / (필수 항목 수 × 5)

     학생 기록에는 세 모양이 섞여 있을 수 있다. 다 읽을 줄 알아야 한다.
       요일(옛)     {월:true, 화:true}      9/19 주차까지. 항목 목록 없음
       항목(어제)   {h1:true}               요일 없이 '했다' 만. (itemOnly)
       항목+요일    {h1:{월:true}}          지금
     '했다' 만 남은 항목이 하나라도 있으면 그 학생은 요일을 다시 체크할
     때까지 어제 모양(항목 ✓ / 개수로 센 제출률)으로 나간다.
     ============================================================ */

  var DAYS = ['월', '화', '수', '목', '금'];

  /* 이 학생 기록이 옛 요일 방식인가 */
  function isLegacyHomework(hw) {
    if (!hw) return false;
    for (var i = 0; i < DAYS.length; i++) {
      if (Object.prototype.hasOwnProperty.call(hw, DAYS[i])) return true;
    }
    return false;
  }

  /* 반 공통 과제 목록에서 한 묶음만 골라 온다 */
  function homeworkItems(common, group) {
    var list = (common && common.homework) || [];
    if (!Array.isArray(list)) return [];
    return list.filter(function (it) {
      if (!it || !it.key || !String(it.name || '').trim()) return false;
      return !group || groupOf(it) === group;
    });
  }

  function groupOf(it) {
    return (it && it.group === 'optional') ? 'optional' : 'required';
  }

  /* 한 항목에서 체크한 요일 수. '했다' 만 있는(true) 항목은 요일을 모르므로 0 */
  function daysDone(v) {
    if (!v || typeof v !== 'object') return 0;
    return DAYS.filter(function (d) { return !!v[d]; }).length;
  }

  /* 한 항목을 했는가 — 어제 모양(true)도, 요일이 하나라도 있어도 '했다' */
  function itemDone(v) {
    return v === true || daysDone(v) > 0;
  }

  /* 요일 없이 '했다' 만 남은 항목들 (어제 모양으로 체크해 둔 것) */
  function itemOnlyKeys(common, hw) {
    return homeworkItems(common).filter(function (it) {
      return hw && hw[it.key] === true;
    }).map(function (it) { return it.key; });
  }

  /* 한 묶음의 칸 세기. 항목이 없으면 null.
     '했다' 만 남은 항목이 있으면 어제처럼 항목 개수로 센다. */
  function countOf(common, hw, group) {
    var items = homeworkItems(common, group);
    if (!items.length) return null;
    if (itemOnlyKeys(common, hw).length) {
      return {
        done: items.filter(function (it) { return itemDone(hw && hw[it.key]); }).length,
        total: items.length
      };
    }
    var done = 0;
    items.forEach(function (it) { done += daysDone(hw && hw[it.key]); });
    return { done: done, total: items.length * DAYS.length };
  }

  /* 한 묶음의 제출률. 항목이 없으면 -1 (화면에 안 그린다) */
  function rateOf(common, hw, group) {
    var c = countOf(common, hw, group);
    if (!c) return -1;
    return Math.round(c.done / c.total * 100);
  }

  /* 학생이 과제 칸을 하나라도 켰는가 (작성 여부 판단용) */
  function homeworkTouched(hw) {
    return Object.keys(hw || {}).some(function (k) {
      var v = hw[k];
      return v && typeof v === 'object' ? daysDone(v) > 0 : !!v;
    });
  }

  /* 옛 요일 방식의 제출률 — 지난 주차를 다시 그릴 때만 쓴다 */
  function submitRateOf(hw) {
    var done = DAYS.filter(function (d) { return hw && hw[d]; }).length;
    return Math.round(done / DAYS.length * 100);
  }

  global.Report = {
    SITE_URL: SITE_URL,
    loadTemplate: loadTemplate,
    buildHtml: buildHtml,
    buildPath: buildPath,
    randomSuffix: randomSuffix,
    toReportData: toReportData,
    commentFor: commentFor,
    submitRateOf: submitRateOf,
    homeworkItems: homeworkItems,
    groupOf: groupOf,
    rateOf: rateOf,
    countOf: countOf,
    DAYS: DAYS,
    daysDone: daysDone,
    itemDone: itemDone,
    itemOnlyKeys: itemOnlyKeys,
    isLegacyHomework: isLegacyHomework,
    entryStatus: entryStatus,
    statusLabel: statusLabel,
    isAbsent: isAbsent,
    namedTests: namedTests,
    todayISO: todayISO
  };

})(window);
