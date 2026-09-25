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

  function clampPct(v) {
    var n = Math.round(Number(v) || 0);
    return n < 0 ? 0 : n > 100 ? 100 : n;
  }

  /* ============================================================
     과제

     반 공통에 항목을 적고(이름), 학생마다 체크한다. 리뷰테스트와 같다.
       반 공통  [{key:'h1', group:'required', name:'문학 주간지'}, …]
       학생     {h1:true, h3:false}

     예전에는 월~금 요일 체크였다. 지난 주차 자료에는 그 모양이
     그대로 남아 있으므로 읽을 줄 알아야 한다. (legacyDays)
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

  /* 한 묶음의 제출률. 항목이 없으면 -1 (화면에 안 그린다) */
  function rateOf(common, hw, group) {
    var items = homeworkItems(common, group);
    if (!items.length) return -1;
    var done = items.filter(function (it) { return hw && hw[it.key]; }).length;
    return Math.round(done / items.length * 100);
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
    isLegacyHomework: isLegacyHomework,
    todayISO: todayISO
  };

})(window);
