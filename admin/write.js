/* ============================================================
   write.js — ② 작성 탭 (B단계 + C단계)

   B: 주차 선택 · 반 공통 입력 · 학생별 입력 · 실시간 미리보기
   C: 자동 임시 저장 · 지난주 불러오기 · 코멘트 상용구 · 맞춤법 경고

   40~100명을 매주 입력하므로, 반복 입력을 최대한 줄이는 것이 목표다.
     · 수업 내용과 테스트 이름은 반마다 한 번
     · 학생별로는 출결·별점·점수·과제·코멘트만
   ============================================================ */

(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var DAYS = ['월', '화', '수', '목', '금'];

  var STATUSES = [
    { key: 'attend', label: '출석' },
    { key: 'late',   label: '지각' },
    { key: 'absent', label: '결석' },
    { key: 'makeup', label: '보강' }
  ];

  /* ============================================================
     상태
     ============================================================ */

  var draft = null;
  var currentClass = '';
  var selectedId = '';          /* 미리보기 중인 학생 */
  var collapsedEntries = {};
  var commentTargetId = '';
  var tplPromise = null;

  function students() { return (window.UI ? UI.getStudents() : Store.getStudents()); }
  function toast(m, k) { if (window.UI) UI.toast(m, k); }

  function emptyDraft() {
    var w = Store.thisWeek();
    return { weekStart: w.start, weekEnd: w.end, weekEndTouched: false,
             common: {}, entries: {} };
  }

  function emptyEntry() {
    return {
      attendStatus: '', attendNote: '',
      focusScore: 0, scores: {},
      homework: {}, onTimeRate: 100,
      comment: ''
    };
  }

  function emptyCommon() { return { lessons: [''], tests: [''] }; }

  function loadDraft() {
    var d = Store.read(Store.KEYS.draft, null);
    if (!d || !d.weekStart) d = emptyDraft();
    d.common = d.common || {};
    d.entries = d.entries || {};
    return d;
  }

  var saveTimer = null;
  var dirty = false;          /* 이 화면에서 실제로 고친 게 있는가 */

  /* 고친 적이 없으면 저장하지 않는다.
     탭을 두 개 열어 둔 경우, 손대지 않은 탭이 닫히면서
     메모리에 있던 옛 내용으로 다른 탭의 작업을 덮어쓸 수 있다. */
  function flushDraft() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!dirty) return;
    dirty = false;
    Store.write(Store.KEYS.draft, draft);
  }

  function saveDraft() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushDraft, 400);
  }

  /* 탭을 닫거나 화면을 벗어날 때 마지막 타자까지 확실히 저장한다.
     디바운스만 믿으면 마지막 0.4초가 날아갈 수 있다. */
  window.addEventListener('pagehide', flushDraft);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushDraft();
  });
  /* 입력칸에서 포커스가 빠지면 바로 저장 */
  document.addEventListener('focusout', function (e) {
    if (e.target && e.target.closest && e.target.closest('#panel-write')) flushDraft();
  });

  function commonOf(cls) {
    if (!draft.common[cls]) draft.common[cls] = emptyCommon();
    return draft.common[cls];
  }

  function entryOf(id) {
    if (!draft.entries[id]) draft.entries[id] = emptyEntry();
    return draft.entries[id];
  }

  /* 출결을 골랐으면 '작성됨' 으로 본다 */
  function isWritten(id) {
    var e = draft.entries[id];
    return !!(e && e.attendStatus);
  }

  function studentsOfClass(cls) {
    return students()
      .filter(function (s) { return (s.className || '') === cls; })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || '', 'ko'); });
  }

  /* ============================================================
     주차
     ============================================================ */

  function renderWeek() {
    $('#weekStart').value = draft.weekStart || '';
    $('#weekEnd').value   = draft.weekEnd || '';

    /* 종료일이 시작일보다 빠를 수 없다. 화면에서 먼저 막는다.
       (예전에 9/19~9/18 로 42건이 발행된 적이 있다) */
    $('#weekEnd').min = draft.weekStart || '';

    var host = $('#weekSummary');
    if (!draft.weekStart || !draft.weekEnd) { host.textContent = ''; return; }

    if (draft.weekEnd < draft.weekStart) {
      host.textContent = '종료일이 시작일보다 빠릅니다 — 다시 골라 주세요';
      host.className = 'week-summary week-summary--bad';
      return;
    }

    /* 요일과 일수를 같이 보여 준다. 잘못 고른 날짜가 눈에 띈다. */
    var days = Store.daysBetween(draft.weekStart, draft.weekEnd);
    host.textContent = Store.dateWithDow(draft.weekStart) + ' ~ ' +
                       Store.dateWithDow(draft.weekEnd) + ' · ' + days + '일';
    host.className = 'week-summary num';
  }

  $('#weekStart').addEventListener('change', function (e) {
    var prevStart = draft.weekStart;
    draft.weekStart = e.target.value;

    /* 종료일을 사람이 고른 적이 있으면 기간 길이를 지킨다.
       예전에는 조건 없이 그 주 금요일로 덮어써서, 9/20 으로 고쳐 둔 종료일이
       시작일을 한 번 다시 누르는 것만으로 9/18 로 되돌아갔다. */
    var span = (draft.weekEndTouched && prevStart && draft.weekEnd)
                 ? Store.daysBetween(prevStart, draft.weekEnd) : 0;

    if (span > 0) {
      draft.weekEnd = Store.autoEnd(draft.weekStart, span) || draft.weekEnd;
      toast(span + '일 기간을 그대로 옮겼습니다');
    } else {
      /* 지난번에 쓰던 기간 길이로 자동. '그 주 금요일' 을 쓰지 않는 이유는
         토·일을 시작일로 고르면 그 금요일이 이미 지나간 날이라
         종료일이 시작일보다 빨라지기 때문이다. */
      draft.weekEnd = Store.autoEnd(draft.weekStart) || draft.weekEnd;
    }

    renderWeek();
    saveDraft();
    refreshAll();
  });

  $('#weekEnd').addEventListener('change', function (e) {
    var v = e.target.value;
    if (v && draft.weekStart && v < draft.weekStart) {
      toast('종료일이 시작일보다 빠릅니다', 'bad');
      renderWeek();                        /* 옛 값으로 되돌린다 */
      return;
    }
    draft.weekEnd = v;
    draft.weekEndTouched = true;           /* 사람이 고른 값이다 */
    /* 이 길이를 기억해 두고 다음 주차에도 같은 길이를 쓴다 */
    Store.setWeekSpan(Store.daysBetween(draft.weekStart, v));
    renderWeek();
    saveDraft();
  });

  $('#btnThisWeek').addEventListener('click', function () {
    var w = Store.thisWeek();
    draft.weekStart = w.start;
    draft.weekEnd = w.end;
    draft.weekEndTouched = false;
    renderWeek();
    saveDraft();
    refreshAll();
    toast('이번 주로 맞췄습니다 · ' + Store.daysBetween(w.start, w.end) + '일');
  });

  /* ============================================================
     반 고르기
     ============================================================ */

  function renderClassPicker() {
    var classes = Store.getClasses();
    var host = $('#classPicker');
    host.textContent = '';

    if (!classes.length) {
      host.innerHTML = '<p class="panel__hint">명단에 반이 지정된 학생이 없습니다. ① 명단 탭에서 반을 넣어 주세요.</p>';
      currentClass = '';
      return;
    }

    if (!classes.some(function (c) { return c.name === currentClass; })) {
      currentClass = classes[0].name;
    }

    var frag = document.createDocumentFragment();
    classes.forEach(function (c) {
      var list = studentsOfClass(c.name);
      var done = list.filter(function (s) { return isWritten(s.id); }).length;

      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (c.name === currentClass ? ' is-on' : '') +
                    (done === list.length && list.length ? ' is-done' : '');
      b.dataset.cls = c.name;
      b.innerHTML = '<span class="chip__name"></span>' +
                    '<span class="chip__count num">' + done + '/' + list.length + '</span>';
      b.querySelector('.chip__name').textContent = c.name;
      frag.appendChild(b);
    });
    host.appendChild(frag);

    var total = students().length;
    var written = students().filter(function (s) { return isWritten(s.id); }).length;
    $('#classPickerHint').textContent = '전체 ' + written + ' / ' + total + '명 작성됨';
  }

  $('#classPicker').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip');
    if (!chip) return;
    currentClass = chip.dataset.cls;
    selectedId = '';
    refreshAll();
  });

  /* ============================================================
     반 공통 — 수업 내용 · 테스트 이름
     ============================================================ */

  function renderCommon() {
    $('#commonTitle').textContent = currentClass ? currentClass + ' 공통' : '반 공통';
    var c = commonOf(currentClass || '_');

    var lessons = $('#lessonList');
    lessons.textContent = '';
    (c.lessons.length ? c.lessons : ['']).forEach(function (text, i) {
      var row = document.createElement('div');
      row.className = 'row-item';
      row.innerHTML =
        '<span class="row-item__no num">' + (i + 1) + '차시</span>' +
        '<input class="input" type="text" data-kind="lesson" data-i="' + i + '"' +
        ' placeholder="예) 현대시 「진달래꽃」 — 화자의 정서와 반어 표현 분석">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-del="lesson" data-i="' + i + '" aria-label="삭제">×</button>';
      row.querySelector('input').value = text || '';
      lessons.appendChild(row);
    });

    var tests = $('#testList');
    tests.textContent = '';
    (c.tests.length ? c.tests : ['']).forEach(function (name, i) {
      var row = document.createElement('div');
      row.className = 'row-item';
      row.innerHTML =
        '<span class="row-item__no">테스트</span>' +
        '<input class="input" type="text" data-kind="test" data-i="' + i + '"' +
        ' placeholder="예) 문법 리뷰테스트">' +
        '<button class="btn btn--sm btn--ghost" type="button" data-del="test" data-i="' + i + '" aria-label="삭제">×</button>';
      row.querySelector('input').value = name || '';
      tests.appendChild(row);
    });
  }

  /* 테스트 이름이 바뀌면 학생 카드의 점수 칸 개수도 달라진다.
     타이핑 중에 매번 다시 그리면 무거우니 잠깐 묶어서 처리한다. */
  var entriesTimer = null;
  function scheduleEntries() {
    clearTimeout(entriesTimer);
    entriesTimer = setTimeout(renderEntries, 300);
  }

  $('#commonPanel').addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.kind === 'lesson') {
      commonOf(currentClass).lessons[+el.dataset.i] = el.value;
      saveDraft(); schedulePreview();
    } else if (el.dataset.kind === 'test') {
      commonOf(currentClass).tests[+el.dataset.i] = el.value;
      saveDraft(); schedulePreview();
      scheduleEntries();
    }
  });

  $('#commonPanel').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-del]');
    if (!btn) return;
    var c = commonOf(currentClass);
    var i = +btn.dataset.i;

    if (btn.dataset.del === 'lesson') {
      c.lessons.splice(i, 1);
      if (!c.lessons.length) c.lessons = [''];
    } else {
      c.tests.splice(i, 1);
      if (!c.tests.length) c.tests = [''];
      /* 테스트를 지우면 학생들의 점수 인덱스도 같이 당긴다 */
      Object.keys(draft.entries).forEach(function (id) {
        var sc = draft.entries[id].scores || {};
        var next = {};
        Object.keys(sc).forEach(function (k) {
          var n = +k;
          if (n < i) next[n] = sc[k];
          else if (n > i) next[n - 1] = sc[k];
        });
        draft.entries[id].scores = next;
      });
    }
    saveDraft();
    renderCommon();
    renderEntries();
    schedulePreview();
  });

  $('#btnAddLesson').addEventListener('click', function () {
    commonOf(currentClass).lessons.push('');
    saveDraft(); renderCommon();
  });

  $('#btnAddTest').addEventListener('click', function () {
    commonOf(currentClass).tests.push('');
    saveDraft(); renderCommon(); renderEntries();
  });

  /* ---------- 지난주 불러오기 (C단계) ---------- */

  /* 지난 회차는 서버에서 찾는다. 조교가 쓴 것을 선생님 기기에서도 불러올 수 있어야 한다. */
  $('#btnLoadLast').addEventListener('click', function () {
    if (!currentClass) { toast('반을 먼저 고르세요', 'bad'); return; }
    if (!draft.weekStart) { toast('주차를 먼저 정하세요', 'bad'); return; }

    var btn = this;
    btn.disabled = true;
    btn.textContent = '찾는 중…';

    DB.lastCommonOf(currentClass, draft.weekStart).then(function (h) {
      btn.disabled = false;
      btn.textContent = '지난주 불러오기';

      if (!h) { toast('이 반의 지난 회차 기록이 없습니다', 'bad'); return; }

      var c = commonOf(currentClass);
      var hasContent = c.lessons.some(function (x) { return String(x || '').trim(); }) ||
                       c.tests.some(function (x) { return String(x || '').trim(); });

      function apply() {
        c.lessons = (h.lessons || ['']).slice();
        c.tests   = (h.tests || ['']).slice();
        if (!c.lessons.length) c.lessons = [''];
        if (!c.tests.length) c.tests = [''];
        saveDraft(); renderCommon(); renderEntries(); schedulePreview();
        toast(Store.shortDate(h.weekStart) + ' 주차를 불러왔습니다', 'good');
      }

      if (!hasContent) { apply(); return; }
      UI.confirmAsk('지난주 불러오기',
        Store.shortDate(h.weekStart) + ' 주차 내용으로 바꿉니다. 지금 입력한 수업 내용과 테스트 이름은 사라집니다.',
        '바꾸기').then(function (ok) { if (ok) apply(); });

    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '지난주 불러오기';
      toast('불러오지 못했습니다 — ' + e.message, 'bad');
    });
  });

  /* ============================================================
     학생별 입력
     ============================================================ */

  function entryCardHtml(s, tests) {
    var e = entryOf(s.id);
    var open = !collapsedEntries[s.id];

    var statusBtns = STATUSES.map(function (st) {
      return '<button type="button" class="att-btn att-btn--' + st.key +
             (e.attendStatus === st.key ? ' is-on' : '') +
             '" data-act="status" data-v="' + st.key + '">' + st.label + '</button>';
    }).join('');

    var stars = '';
    for (var i = 1; i <= 5; i++) {
      stars += '<button type="button" class="star' + (i <= e.focusScore ? ' is-on' : '') +
               '" data-act="star" data-v="' + i + '" aria-label="' + i + '점">★</button>';
    }

    var scoreRow = tests.length
      ? tests.map(function (name, i) {
          return '<label class="score"><span class="score__name"></span>' +
                 '<input class="input input--num" type="number" inputmode="numeric" min="0" max="100" ' +
                 'data-act="score" data-i="' + i + '" placeholder="-"></label>';
        }).join('')
      : '<span class="muted-note">반 공통에 테스트 이름을 넣으면 점수 칸이 생깁니다</span>';

    var hwRow = DAYS.map(function (d) {
      return '<button type="button" class="hw' + (e.homework[d] ? ' is-on' : '') +
             '" data-act="hw" data-v="' + d + '">' + d + '</button>';
    }).join('');

    var needNote = e.attendStatus === 'late' || e.attendStatus === 'makeup';

    return '' +
      '<div class="entry' + (open ? '' : ' is-collapsed') + (isWritten(s.id) ? ' is-written' : '') +
        (selectedId === s.id ? ' is-selected' : '') + '" data-id="' + s.id + '">' +
        '<div class="entry__head" data-act="head">' +
          '<span class="entry__name"></span>' +
          '<span class="entry__badge">' + (isWritten(s.id) ? '작성됨' : '미작성') + '</span>' +
          '<span class="entry__caret" aria-hidden="true">▾</span>' +
        '</div>' +
        '<div class="entry__body">' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">출결</span>' +
            '<span class="att-group">' + statusBtns + '</span>' +
            '<input class="input input--note" type="text" data-act="note" ' +
              'placeholder="예) 10분 지각 · 9/12 보강"' + (needNote ? '' : ' hidden') + '>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">집중도</span>' +
            '<span class="stars">' + stars + '</span>' +
            '<span class="stars__val num">' + (e.focusScore || 0) + ' / 5</span>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">점수</span>' +
            '<span class="scores">' + scoreRow + '</span>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">과제</span>' +
            '<span class="hw-group">' + hwRow + '</span>' +
            '<span class="rate-note num" data-role="rate"></span>' +
            '<label class="ontime">기한 <input class="input input--num" type="number" min="0" max="100" ' +
              'data-act="ontime" value="' + (e.onTimeRate == null ? 100 : e.onTimeRate) + '">%</label>' +
          '</div>' +
          '<div class="fieldline">' +
            '<span class="fieldline__label">코멘트</span>' +
            '<button type="button" class="comment-btn" data-act="comment">' +
              '<span class="comment-btn__text"></span>' +
              '<span class="comment-btn__count num"></span>' +
            '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function fillEntryCard(el, s, tests) {
    var e = entryOf(s.id);
    el.querySelector('.entry__name').textContent = s.name || '';

    $$('.score', el).forEach(function (lab, i) {
      lab.querySelector('.score__name').textContent = tests[i] || '';
      var inp = lab.querySelector('input');
      var v = e.scores && e.scores[i];
      inp.value = (v === 0 || v) ? v : '';
    });

    var note = el.querySelector('[data-act="note"]');
    if (note) note.value = e.attendNote || '';

    el.querySelector('[data-role="rate"]').textContent =
      '제출률 ' + Report.submitRateOf(e.homework) + '%';

    var txt = (e.comment || '').trim();
    el.querySelector('.comment-btn__text').textContent =
      txt ? txt.replace(/\s+/g, ' ').slice(0, 40) + (txt.length > 40 ? '…' : '') : '코멘트 작성';
    el.querySelector('.comment-btn__count').textContent = txt ? txt.length + '자' : '';
  }

  function renderEntries() {
    var host = $('#entryList');
    var list = studentsOfClass(currentClass);
    var onlyUn = $('#onlyUnwritten').checked;
    var shown = onlyUn ? list.filter(function (s) { return !isWritten(s.id); }) : list;
    var tests = (commonOf(currentClass || '_').tests || [])
      .filter(function (t) { return String(t || '').trim(); });

    host.textContent = '';

    if (!list.length) {
      host.innerHTML = '<div class="empty-state">이 반에 등록된 학생이 없습니다.</div>';
    } else if (!shown.length) {
      host.innerHTML = '<div class="empty-state">이 반은 <b>모두 작성했습니다.</b></div>';
    } else {
      var frag = document.createDocumentFragment();
      shown.forEach(function (s) {
        var wrap = document.createElement('div');
        wrap.innerHTML = entryCardHtml(s, tests);
        var card = wrap.firstElementChild;
        fillEntryCard(card, s, tests);
        frag.appendChild(card);
      });
      host.appendChild(frag);
    }

    var done = list.filter(function (s) { return isWritten(s.id); }).length;
    $('#entryProgress').textContent = currentClass
      ? currentClass + ' · ' + done + ' / ' + list.length + '명 작성됨'
      : '';
    $('#queueInfo').textContent = done ? done + '명 작성됨 · 발행 탭에 자동으로 올라갑니다' : '출결을 고르면 발행 목록에 올라갑니다';
    $('#btnEnqueue').disabled = !done;
  }

  /* ---------- 입력 반응 (이벤트 위임) ---------- */

  $('#entryList').addEventListener('click', function (ev) {
    var card = ev.target.closest('.entry');
    if (!card) return;
    var id = card.dataset.id;
    var e = entryOf(id);
    var btn = ev.target.closest('[data-act]');
    if (!btn) return;

    var act = btn.dataset.act;

    if (act === 'head') {
      collapsedEntries[id] = !collapsedEntries[id];
      card.classList.toggle('is-collapsed', !!collapsedEntries[id]);
      selectStudent(id);
      return;
    }

    if (act === 'status') {
      e.attendStatus = (e.attendStatus === btn.dataset.v) ? '' : btn.dataset.v;
      if (e.attendStatus !== 'late' && e.attendStatus !== 'makeup') e.attendNote = '';
      $$('.att-btn', card).forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.v === e.attendStatus);
      });
      var note = card.querySelector('[data-act="note"]');
      note.hidden = !(e.attendStatus === 'late' || e.attendStatus === 'makeup');
      if (!note.hidden) note.value = e.attendNote || '';
      card.classList.toggle('is-written', isWritten(id));
      card.querySelector('.entry__badge').textContent = isWritten(id) ? '작성됨' : '미작성';
      afterChange(id);
      return;
    }

    if (act === 'star') {
      var v = +btn.dataset.v;
      e.focusScore = (e.focusScore === v) ? 0 : v;
      $$('.star', card).forEach(function (b) {
        b.classList.toggle('is-on', +b.dataset.v <= e.focusScore);
      });
      card.querySelector('.stars__val').textContent = e.focusScore + ' / 5';
      afterChange(id);
      return;
    }

    if (act === 'hw') {
      var d = btn.dataset.v;
      e.homework[d] = !e.homework[d];
      btn.classList.toggle('is-on', !!e.homework[d]);
      card.querySelector('[data-role="rate"]').textContent =
        '제출률 ' + Report.submitRateOf(e.homework) + '%';
      afterChange(id);
      return;
    }

    if (act === 'comment') {
      openCommentModal(id);
    }
  });

  $('#entryList').addEventListener('input', function (ev) {
    var card = ev.target.closest('.entry');
    if (!card) return;
    var id = card.dataset.id;
    var e = entryOf(id);
    var act = ev.target.dataset.act;

    if (act === 'score') {
      var i = +ev.target.dataset.i;
      var raw = ev.target.value.trim();
      if (raw === '') delete e.scores[i];
      else e.scores[i] = Math.max(0, Math.min(100, parseInt(raw, 10) || 0));
      afterChange(id);
    } else if (act === 'note') {
      e.attendNote = ev.target.value;
      afterChange(id);
    } else if (act === 'ontime') {
      e.onTimeRate = Math.max(0, Math.min(100, parseInt(ev.target.value, 10) || 0));
      afterChange(id);
    }
  });

  function afterChange(id) {
    saveDraft();
    selectStudent(id, true);
    renderClassPicker();
    updateCounts();
  }

  function updateCounts() {
    var list = studentsOfClass(currentClass);
    var done = list.filter(function (s) { return isWritten(s.id); }).length;
    $('#entryProgress').textContent = currentClass
      ? currentClass + ' · ' + done + ' / ' + list.length + '명 작성됨' : '';
    $('#queueInfo').textContent = done ? done + '명 작성됨 · 발행 탭에 자동으로 올라갑니다' : '출결을 고르면 발행 목록에 올라갑니다';
    $('#btnEnqueue').disabled = !done;
  }

  $('#onlyUnwritten').addEventListener('change', renderEntries);

  $('#btnCollapseEntries').addEventListener('click', function () {
    var list = studentsOfClass(currentClass);
    var anyOpen = list.some(function (s) { return !collapsedEntries[s.id]; });
    list.forEach(function (s) { collapsedEntries[s.id] = anyOpen; });
    this.textContent = anyOpen ? '모두 펼치기' : '모두 접기';
    renderEntries();
  });

  /* ============================================================
     미리보기
     ============================================================ */

  var previewTimer = null;

  function selectStudent(id, keepScroll) {
    selectedId = id;
    $$('.entry', $('#entryList')).forEach(function (c) {
      c.classList.toggle('is-selected', c.dataset.id === id);
    });
    schedulePreview();
  }

  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 300);
  }

  function cssHref() {
    return new URL('../assets/report.css', location.href).href;
  }

  function brandHref() {
    return new URL('../assets/brand.js', location.href).href;
  }

  function renderPreview() {
    var s = students().find(function (x) { return x.id === selectedId; });
    if (!s) { $('#previewWho').textContent = '학생 카드를 누르면 그 학생 레포트가 보입니다'; return; }

    $('#previewWho').textContent = s.name + ' 학생';

    if (!tplPromise) tplPromise = Report.loadTemplate();
    tplPromise.then(function (tpl) {
      var data = Report.toReportData(s, commonOf(currentClass), entryOf(s.id),
                                     { start: draft.weekStart, end: draft.weekEnd });
      var path = Report.buildPath(s, draft.weekStart, 'prev');
      var html = Report.buildHtml(tpl, data, path,
                                  { cssHref: cssHref(), brandHref: brandHref() });
      $('#previewFrame').srcdoc = html;
    }).catch(function (err) {
      $('#previewWho').textContent = '미리보기를 만들지 못했습니다 — ' + err.message;
    });
  }

  $('#btnPreviewReload').addEventListener('click', function () {
    tplPromise = null;
    renderPreview();
  });

  /* ============================================================
     코멘트 (전체화면) + 상용구
     ============================================================ */

  var commentModal = $('#commentModal');

  function openCommentModal(id) {
    commentTargetId = id;
    var s = students().find(function (x) { return x.id === id; });
    var e = entryOf(id);

    $('#commentWho').textContent = (s ? s.name + ' 학생 ' : '') + '코멘트';
    $('#commentText').value = e.comment || '';
    updateCommentCount();
    renderInfoBar();
    renderSnipBar();
    $('#commentWarn').classList.remove('is-on');
    commentModal.showModal();
    setTimeout(function () { $('#commentText').focus(); }, 40);
  }

  function updateCommentCount() {
    var t = $('#commentText').value;
    $('#commentCount').textContent = t.length + '자';

    var s = students().find(function (x) { return x.id === commentTargetId; });
    var warns = checkText(t, s ? s.name : '');
    var box = $('#commentWarn');
    if (warns.length) {
      box.innerHTML = '⚠️ ' + warns.map(function (w) {
        return '<b>' + escapeHtml(w.found) + '</b> → ' + escapeHtml(w.suggest);
      }).join(' · ');
      box.classList.add('is-on');
    } else {
      box.classList.remove('is-on');
    }
  }

  $('#commentText').addEventListener('input', updateCommentCount);

  $('#btnCommentCancel').addEventListener('click', function () { commentModal.close(); });

  $('#commentForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var en = entryOf(commentTargetId);
    en.comment = $('#commentText').value;
    saveDraft();
    commentModal.close();
    renderEntries();
    selectStudent(commentTargetId);
    toast('코멘트를 저장했습니다', 'good');
  });

  function renderSnipBar() {
    var host = $('#snipBar');
    var list = Store.getSnippets();
    host.textContent = '';
    if (!list.length) {
      host.innerHTML = '<span class="muted-note">상용구가 없습니다. [상용구 관리]에서 등록하세요.</span>';
      return;
    }
    list.forEach(function (sn) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'snip-chip';
      b.textContent = sn.text.replace(/\s+/g, ' ').slice(0, 22) + (sn.text.length > 22 ? '…' : '');
      b.title = sn.text;
      b.dataset.id = sn.id;
      host.appendChild(b);
    });
  }

  $('#snipBar').addEventListener('click', function (e) {
    var b = e.target.closest('.snip-chip');
    if (!b) return;
    var sn = Store.getSnippets().find(function (x) { return x.id === b.dataset.id; });
    if (!sn) return;

    var s = students().find(function (x) { return x.id === commentTargetId; });
    var text = sn.text.split('OO').join(s ? s.name : 'OO');

    var ta = $('#commentText');
    var cur = ta.value;
    ta.value = cur ? (cur.replace(/\s*$/, '') + '\n' + text) : text;
    ta.focus();
    updateCommentCount();
  });

  /* ---------- 정보 불러오기 ----------
     명단에서 만든 칸에 적어 둔 내용을 코멘트 창 위에 보여 주고,
     누르면 코멘트에 넣는다. 값이 빈 칸은 보이지 않는다.

     두 줄로 나눠 보여 준다.
       반  — 이 학생이 속한 반에 적어 둔 것 (시험 범위, 수업 진도 …)
       학생 — 이 학생에게만 적어 둔 것
     같은 이름의 칸이 양쪽에 있을 수 있어서 어느 쪽인지 보이게 한다. */

  function infoRow(kind, title, defs, owner) {
    var usable = defs.filter(function (f) {
      if (f.type === 'checkbox') return false;      /* 넣을 글자가 없다 */
      return String(Store.fieldValue(owner, f) || '').trim() !== '';
    });
    if (!usable.length) return null;

    var row = document.createElement('div');
    row.className = 'info-row info-row--' + kind;

    var lab = document.createElement('span');
    lab.className = 'info-bar__label';
    lab.textContent = title;
    row.appendChild(lab);

    usable.forEach(function (f) {
      var v = String(Store.fieldValue(owner, f)).trim();
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'info-chip info-chip--' + kind;
      b.dataset.key = f.key;
      b.title = title + ' · ' + f.label + ': ' + v;

      var n = document.createElement('span');
      n.className = 'info-chip__name';
      n.textContent = f.label;
      var t = document.createElement('span');
      t.className = 'info-chip__val';
      t.textContent = v.replace(/\s+/g, ' ').slice(0, 24) + (v.length > 24 ? '…' : '');

      b.appendChild(n);
      b.appendChild(t);
      row.appendChild(b);
    });

    return row;
  }

  function renderInfoBar() {
    var host = $('#infoBar');
    var s = students().find(function (x) { return x.id === commentTargetId; });

    host.textContent = '';

    var cls = s ? (s.className || '').trim() : '';
    var rows = [
      cls ? infoRow('class', '반 ' + cls, Store.getFieldDefs('class'), Store.classExtra(cls)) : null,
      infoRow('student', '학생', Store.getFieldDefs('student'), s)
    ].filter(Boolean);

    if (!rows.length) { host.hidden = true; return; }

    host.hidden = false;
    rows.forEach(function (r) { host.appendChild(r); });
  }

  /* 칩을 누르면 커서 자리에 값을 넣는다. 문장 중간에 끼워 쓰는 일이 많다. */
  $('#infoBar').addEventListener('click', function (e) {
    var b = e.target.closest('.info-chip');
    if (!b) return;

    var s = students().find(function (x) { return x.id === commentTargetId; });
    var f = Store.getFieldDefs().find(function (x) { return x.key === b.dataset.key; });
    if (!f) return;

    var owner = Store.scopeOf(f) === 'class'
      ? Store.classExtra((s && s.className) || '')
      : s;
    var text = String(Store.fieldValue(owner, f) || '').trim();
    if (!text) return;

    var ta = $('#commentText');
    var a = ta.selectionStart, z = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + text + ta.value.slice(z);
    var pos = a + text.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    updateCommentCount();
  });

  /* ---------- 상용구 관리 ---------- */

  var snipModal = $('#snipModal');

  $('#btnManageSnips').addEventListener('click', function () {
    renderSnipList();
    snipModal.showModal();
  });

  function renderSnipList() {
    var host = $('#snipList');
    var list = Store.getSnippets();
    host.textContent = '';
    if (!list.length) {
      host.innerHTML = '<p class="muted-note">아직 등록한 상용구가 없습니다.</p>';
      return;
    }
    list.forEach(function (sn) {
      var row = document.createElement('div');
      row.className = 'snip-row';
      row.innerHTML = '<span class="snip-row__text"></span>' +
                      '<button class="btn btn--sm btn--danger" type="button" data-del="' + sn.id + '">삭제</button>';
      row.querySelector('.snip-row__text').textContent = sn.text;
      host.appendChild(row);
    });
  }

  $('#btnSnipAdd').addEventListener('click', function () {
    var t = $('#snipNew').value.trim();
    if (!t) { toast('내용을 입력해 주세요', 'bad'); return; }
    var list = Store.getSnippets();
    list.push({ id: 'sn_' + Date.now().toString(36), text: t });
    Store.saveSnippets(list);
    $('#snipNew').value = '';
    renderSnipList();
    renderSnipBar();
    toast('상용구를 추가했습니다', 'good');
  });

  $('#snipList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-del]');
    if (!b) return;
    Store.saveSnippets(Store.getSnippets().filter(function (x) { return x.id !== b.dataset.del; }));
    renderSnipList();
    renderSnipBar();
  });

  $('#snipForm').addEventListener('submit', function () { renderSnipBar(); });

  /* ============================================================
     맞춤법 경고 (C단계)
     자주 나는 오타만 본다. 맞춤법 검사기가 아니다.
     ============================================================ */

  function hasBatchim(ch) {
    var code = ch.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return false;
    return (code % 28) !== 0;
  }

  var FIXED = [
    { re: /언머니/g,   suggest: '어머니' },
    { re: /어머님께서는요/g, suggest: '어머님께서는' },
    { re: /되요/g,     suggest: '돼요' },
    { re: /감사합니당/g, suggest: '감사합니다' },
    { re: /하겠슴니다/g, suggest: '하겠습니다' },
    { re: /했읍니다/g,  suggest: '했습니다' }
  ];

  function checkText(text, studentName) {
    var out = [];
    if (!text) return out;

    FIXED.forEach(function (f) {
      var m = text.match(f.re);
      if (m) out.push({ found: m[0], suggest: f.suggest });
    });

    /* 이름 + 조사 — 받침 있는 이름 뒤에는 '이가/이는/이를' 을 쓴다 */
    var name = String(studentName || '').trim();
    if (name.length >= 2) {
      var given = name.slice(1);                 /* 성을 뺀 이름 */
      [given, name].forEach(function (base) {
        if (!base) return;
        var last = base[base.length - 1];
        if (!hasBatchim(last)) return;
        ['가', '는', '를'].forEach(function (josa) {
          var bad = base + josa;
          if (text.indexOf(bad) !== -1) {
            out.push({ found: bad, suggest: base + '이' + josa });
          }
        });
      });
    }

    /* 중복 제거 */
    var seen = {};
    return out.filter(function (w) {
      if (seen[w.found]) return false;
      seen[w.found] = 1;
      return true;
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ============================================================
     대기열에 담기
     ============================================================ */

  var spellModal = $('#spellModal');
  var pendingEnqueue = null;

  $('#btnEnqueue').addEventListener('click', function () {
    if (!draft.weekStart || !draft.weekEnd) { toast('주차를 먼저 정해 주세요', 'bad'); return; }

    var list = studentsOfClass(currentClass).filter(function (s) { return isWritten(s.id); });
    if (!list.length) { toast('담을 학생이 없습니다', 'bad'); return; }

    /* 맞춤법 확인 */
    var warns = [];
    list.forEach(function (s) {
      checkText(entryOf(s.id).comment, s.name).forEach(function (w) {
        warns.push({ name: s.name, found: w.found, suggest: w.suggest });
      });
    });

    pendingEnqueue = list;
    if (warns.length) {
      $('#spellList').innerHTML = warns.map(function (w) {
        return '<div class="spell-row"><b>' + escapeHtml(w.name) + '</b> · ' +
               '<span class="spell-bad">' + escapeHtml(w.found) + '</span> → ' +
               '<span class="spell-ok">' + escapeHtml(w.suggest) + '</span></div>';
      }).join('');
      spellModal.showModal();
    } else {
      doEnqueue();
    }
  });

  $('#btnSpellFix').addEventListener('click', function () {
    spellModal.close();
    pendingEnqueue = null;
  });

  $('#btnSpellIgnore').addEventListener('click', function () {
    spellModal.close();
    doEnqueue();
  });

  /* 예전에는 '대기열'에 담아 두었지만, 발행 탭이 입력 내용에서 직접 목록을 만든다.
     따로 담을 필요가 없으므로 맞춤법만 확인하고 발행 탭으로 넘겨준다. */
  function doEnqueue() {
    var list = pendingEnqueue;
    pendingEnqueue = null;
    if (!list) return;

    flushDraft();                 /* 넘어가기 전에 마지막 입력까지 저장 */
    UI.selectTab(2);
  }

  /* ============================================================
     새로 그리기
     ============================================================ */

  function refreshAll() {
    if (!students().length) {
      $('#writeNoStudents').hidden = false;
      $('#writeMain').hidden = true;
      return;
    }
    $('#writeNoStudents').hidden = true;
    $('#writeMain').hidden = false;

    renderWeek();
    renderClassPicker();
    renderCommon();
    renderEntries();

    if (!selectedId) {
      var first = studentsOfClass(currentClass)[0];
      if (first) selectedId = first.id;
    }
    schedulePreview();
  }

  /* 작성 탭이 열릴 때마다 최신 명단으로 다시 그린다 */
  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index === 1) refreshAll();
  });

  /* 서버에서 받아온 뒤에는 그 내용으로 다시 그린다 */
  window.addEventListener('jt:loaded', function () {
    draft = loadDraft();
    selectedId = '';
    collapsedEntries = {};
    renderWeek();
    if (!$('#panel-write').hidden) refreshAll();
  });

  /* ============================================================
     시작
     ============================================================ */

  draft = loadDraft();
  renderWeek();

})();
