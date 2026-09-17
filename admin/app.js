/* ============================================================
   app.js — 화면 제어 (A단계: 명단 탭)

   100명까지 느려지지 않도록 지킨 것
     · 목록은 DocumentFragment 로 한 번에 붙인다
     · 행마다 리스너를 달지 않고 이벤트 위임을 쓴다
     · 검색은 입력할 때마다 다시 그리지 않고 0.15초 묶어서 처리한다
     · 학생 1명이 바뀌면 그 행만 다시 그린다
   ============================================================ */

(function () {
  'use strict';

  var $  = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- 토스트 ---------- */

  var toastHost = $('#toastHost');

  function toast(msg, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast--' + kind : '');
    el.textContent = msg;
    toastHost.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .2s';
      el.style.opacity = '0';
      setTimeout(function () { el.remove(); }, 220);
    }, 2400);
  }

  /* ---------- 확인 모달 ---------- */

  var confirmModal = $('#confirmModal');

  function confirmAsk(title, desc, okLabel) {
    return new Promise(function (resolve) {
      $('#confirmTitle').textContent = title;
      $('#confirmDesc').textContent = desc;
      $('#btnConfirmYes').textContent = okLabel || '삭제';

      function cleanup(result) {
        $('#btnConfirmYes').removeEventListener('click', onYes);
        $('#btnConfirmNo').removeEventListener('click', onNo);
        confirmModal.close();
        resolve(result);
      }
      function onYes() { cleanup(true); }
      function onNo()  { cleanup(false); }

      $('#btnConfirmYes').addEventListener('click', onYes);
      $('#btnConfirmNo').addEventListener('click', onNo);
      confirmModal.showModal();
    });
  }

  /* ============================================================
     탭
     ============================================================ */

  var TABS = [
    { tab: '#tab-roster',  panel: '#panel-roster'  },
    { tab: '#tab-write',   panel: '#panel-write'   },
    { tab: '#tab-publish', panel: '#panel-publish' },
    { tab: '#tab-send',    panel: '#panel-send'    }
  ];

  function selectTab(idx) {
    TABS.forEach(function (t, i) {
      var on = i === idx;
      $(t.tab).setAttribute('aria-selected', on ? 'true' : 'false');
      $(t.panel).hidden = !on;
    });
    document.dispatchEvent(new CustomEvent('jt:tab', { detail: { index: idx } }));
  }

  TABS.forEach(function (t, i) {
    $(t.tab).addEventListener('click', function () { selectTab(i); });
  });

  /* ============================================================
     공용 PC 안내 — 닫으면 기억한다
     ============================================================ */

  var settings = Store.read(Store.KEYS.settings, {});
  var pcNotice = $('#publicPcNotice');

  if (!settings.hidePublicPcNotice) pcNotice.hidden = false;

  $('#publicPcClose').addEventListener('click', function () {
    pcNotice.hidden = true;
    settings.hidePublicPcNotice = true;
    Store.write(Store.KEYS.settings, settings);
  });

  /* ============================================================
     명단 — 상태
     ============================================================ */

  var students = Store.getStudents();
  var fields = Store.getFieldDefs('student');       /* 학생마다 적는 칸 */
  var classFields = Store.getFieldDefs('class');   /* 반마다 적는 칸 */
  var collapsed = {};                 /* 반별 접힘 상태 */
  var filterText = '';
  var filterClass = '';

  var rosterList = $('#rosterList');

  function sortStudents(list) {
    return list.slice().sort(function (a, b) {
      var c = (a.className || '￿').localeCompare(b.className || '￿', 'ko');
      if (c !== 0) return c;
      return (a.name || '').localeCompare(b.name || '', 'ko');
    });
  }

  function matches(s) {
    if (filterClass && (s.className || '') !== filterClass) return false;
    if (!filterText) return true;
    var hay = [s.name, s.slug, s.school, s.grade, s.className];
    /* 내가 만든 칸에 적어 둔 내용도 같이 찾는다 */
    fields.forEach(function (f) { hay.push(Store.fieldText(s, f)); });
    return hay.join(' ').toLowerCase().indexOf(filterText) !== -1;
  }

  /* ---------- 행 하나 ---------- */

  /* 연락처 칸 — 호칭 + 번호 두 줄까지 */
  function phoneCellHtml(s) {
    var lines = [];
    if (s.parentPhone)  lines.push({ title: s.parentTitle || '', num: s.parentPhone });
    if (s.parentPhone2) lines.push({ title: lines.length ? '' : (s.parentTitle || ''), num: s.parentPhone2 });

    if (!lines.length) return '<span class="roster__phone is-empty">없음</span>';

    return '<span class="phone-lines">' + lines.map(function (l) {
      return '<span class="phone-line">' +
               (l.title ? '<span class="phone-line__title"></span>' : '') +
               '<span class="phone-line__num"></span>' +
             '</span>';
    }).join('') + '</span>';
  }

  function fillPhoneCell(td, s) {
    var lines = [];
    if (s.parentPhone)  lines.push({ title: s.parentTitle || '', num: s.parentPhone });
    if (s.parentPhone2) lines.push({ title: lines.length ? '' : (s.parentTitle || ''), num: s.parentPhone2 });

    var nodes = td.querySelectorAll('.phone-line');
    lines.forEach(function (l, i) {
      var n = nodes[i];
      if (!n) return;
      var t = n.querySelector('.phone-line__title');
      if (t) t.textContent = l.title;
      n.querySelector('.phone-line__num').textContent = Store.phoneFormat(l.num);
    });
  }

  /* 표에 열로 보이기로 한 칸만 추린다 */
  function tableFields() {
    return fields.filter(function (f) { return f.showInTable !== false; });
  }

  function rowHtml(s) {
    var extra = tableFields().map(function () {
      return '<td class="roster__extra"><span class="roster__extraval"></span></td>';
    }).join('');

    return '' +
      '<td data-label="이름"><span class="roster__name"></span></td>' +
      '<td data-label="로마자"><span class="roster__slug"></span></td>' +
      '<td data-label="학교"></td>' +
      '<td data-label="학년"></td>' +
      '<td data-label="연락처">' + phoneCellHtml(s) + '</td>' +
      extra +
      '<td class="roster__actions">' +
        '<button class="btn btn--sm" data-act="edit">수정</button>' +
        '<button class="btn btn--sm btn--danger" data-act="del">삭제</button>' +
      '</td>';
  }

  /* textContent 로 넣어 이름·학교에 든 특수문자를 그대로 안전하게 표시한다 */
  function fillRow(tr, s) {
    tr.dataset.id = s.id;
    tr.innerHTML = rowHtml(s);
    var tds = tr.children;
    tds[0].querySelector('.roster__name').textContent = s.name || '';
    tds[1].querySelector('.roster__slug').textContent = s.slug || '';
    tds[2].textContent = s.school || '-';
    tds[3].textContent = s.grade || '-';
    /* 모바일 라벨은 CSS ::before 가 data-label 로 그린다 */
    tds[2].setAttribute('data-label', '학교');
    tds[3].setAttribute('data-label', '학년');
    fillPhoneCell(tds[4], s);

    tableFields().forEach(function (f, i) {
      var td = tds[5 + i];
      if (!td) return;
      td.setAttribute('data-label', f.label);
      var v = Store.fieldText(s, f);
      var box = td.querySelector('.roster__extraval');
      box.textContent = v || '-';
      box.classList.toggle('is-empty', !v);
      td.classList.toggle('is-empty', !v);   /* 휴대폰에서는 빈 줄을 숨긴다 */
      if (f.type === 'checkbox') box.classList.add('roster__extraval--mark');
    });
  }

  /* ---------- 전체 그리기 ---------- */

  function render() {
    var visible = sortStudents(students).filter(matches);

    $('#brandCount').textContent = '학생 ' + students.length + '명';
    $('#rosterHint').textContent =
      (filterText || filterClass) && students.length
        ? visible.length + '명 표시 중 · 서버에 저장되어 모든 기기에서 같이 보입니다'
        : '서버에 저장되어 모든 기기에서 같이 보입니다';

    rosterList.textContent = '';

    if (!students.length) {
      rosterList.innerHTML =
        '<div class="empty-state">아직 등록된 학생이 없습니다.<br>' +
        '<b>+ 학생 추가</b>를 눌러 시작하거나, 아래에서 백업 파일을 불러오세요.</div>';
      refreshClassOptions();
      renderClassInfo();
      return;
    }
    if (!visible.length) {
      rosterList.innerHTML = '<div class="empty-state">조건에 맞는 학생이 없습니다.</div>';
      refreshClassOptions();
      renderClassInfo();
      return;
    }

    /* 반별로 묶는다 */
    var groups = [];
    var index = {};
    visible.forEach(function (s) {
      var key = (s.className || '').trim() || '(반 없음)';
      if (!(key in index)) { index[key] = groups.length; groups.push({ name: key, rows: [] }); }
      groups[index[key]].rows.push(s);
    });

    var frag = document.createDocumentFragment();

    /* 검색·필터 중에는 접힘을 무시한다. 접힌 반에 결과가 숨으면 안 된다. */
    var forceExpand = !!(filterText || filterClass);

    groups.forEach(function (g) {
      var wrap = document.createElement('div');
      wrap.className = 'class-group' +
        (!forceExpand && collapsed[g.name] ? ' is-collapsed' : '');
      wrap.dataset.cls = g.name;

      var head = document.createElement('button');
      head.type = 'button';
      head.className = 'class-head';
      head.dataset.act = 'toggle';
      head.innerHTML =
        '<span class="class-head__name"></span>' +
        '<span class="class-head__count">' + g.rows.length + '명</span>' +
        '<span class="class-head__caret" aria-hidden="true">▾</span>';
      head.querySelector('.class-head__name').textContent = g.name;
      wrap.appendChild(head);

      var table = document.createElement('table');
      table.className = 'roster';
      var headExtra = tableFields().map(function () { return '<th></th>'; }).join('');
      table.innerHTML =
        '<thead><tr>' +
          '<th>이름</th><th>로마자</th><th>학교</th><th>학년</th><th>연락처</th>' +
          headExtra + '<th></th>' +
        '</tr></thead><tbody></tbody>';
      /* 칸 이름은 textContent 로 넣는다. 사용자가 지은 이름이라 무엇이든 들어올 수 있다. */
      var ths = table.querySelectorAll('thead th');
      tableFields().forEach(function (f, i) { ths[5 + i].textContent = f.label; });

      var tbody = table.querySelector('tbody');
      g.rows.forEach(function (s) {
        var tr = document.createElement('tr');
        fillRow(tr, s);
        tbody.appendChild(tr);
      });

      /* 칸을 많이 만들면 표가 화면보다 넓어진다. 잘리지 않게 가로로 민다. */
      var scroller = document.createElement('div');
      scroller.className = 'roster-scroll';
      scroller.appendChild(table);
      wrap.appendChild(scroller);
      frag.appendChild(wrap);
    });

    rosterList.appendChild(frag);
    refreshClassOptions();
    syncExpandButton();
    renderClassInfo();          /* 반이 늘거나 줄면 반 현황도 따라간다 */
  }

  /* 학생이 많으면 반별로 접은 채 시작한다. 100명이 한꺼번에 펼쳐지면 화면이 너무 길어진다. */
  function collapseIfCrowded() {
    if (students.length <= 30) return;
    Store.getClasses().forEach(function (c) { collapsed[c.name] = true; });
    collapsed['(반 없음)'] = true;
  }

  /* 반 목록을 필터 드롭다운과 모달 datalist 에 반영 */
  function refreshClassOptions() {
    var classes = Store.getClasses();

    var sel = $('#classFilter');
    var keep = sel.value;
    sel.textContent = '';
    var optAll = document.createElement('option');
    optAll.value = ''; optAll.textContent = '전체 반';
    sel.appendChild(optAll);
    classes.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.name;
      o.textContent = c.name + ' (' + c.count + ')';
      sel.appendChild(o);
    });
    sel.value = classes.some(function (c) { return c.name === keep; }) ? keep : '';

    var dl = $('#classOptions');
    dl.textContent = '';
    classes.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.name;
      dl.appendChild(o);
    });
  }

  /* ---------- 이벤트 위임 ---------- */

  rosterList.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;

    if (btn.dataset.act === 'toggle') {
      var g = btn.closest('.class-group');
      var name = g.dataset.cls;
      collapsed[name] = !collapsed[name];
      g.classList.toggle('is-collapsed', !!collapsed[name]);
      return;
    }

    var tr = btn.closest('tr');
    if (!tr) return;
    var s = students.find(function (x) { return x.id === tr.dataset.id; });
    if (!s) return;

    if (btn.dataset.act === 'edit') openStudentModal(s);
    if (btn.dataset.act === 'del')  removeStudent(s);
  });

  function removeStudent(s) {
    confirmAsk('학생 삭제', '‘' + s.name + '’ 학생을 명단에서 지웁니다. 되돌릴 수 없습니다.', '삭제')
      .then(function (ok) {
        if (!ok) return;
        Store.deleteStudent(s.id);
        students = Store.getStudents();
        render();
        toast(s.name + ' 학생을 지웠습니다');
      });
  }

  /* ---------- 검색 · 필터 ---------- */

  var searchTimer = null;
  $('#searchInput').addEventListener('input', function (e) {
    var v = e.target.value.trim().toLowerCase();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      filterText = v;
      render();
    }, 150);
  });

  $('#classFilter').addEventListener('change', function (e) {
    filterClass = e.target.value;
    render();
  });

  /* 화면에 보이는 반이 하나라도 접혀 있으면 '펼치기', 아니면 '접기' 로 동작한다 */
  function visibleClassNames() {
    return $$('.class-group', rosterList).map(function (g) { return g.dataset.cls; });
  }

  function syncExpandButton() {
    var names = visibleClassNames();
    var anyCollapsed = names.some(function (n) { return collapsed[n]; });
    var btn = $('#btnExpandAll');
    btn.textContent = anyCollapsed ? '모두 펼치기' : '모두 접기';
    /* 검색 중에는 강제로 펼쳐 두므로 버튼을 감춘다 */
    btn.hidden = names.length < 2 || !!(filterText || filterClass);
  }

  $('#btnExpandAll').addEventListener('click', function () {
    var names = visibleClassNames();
    var anyCollapsed = names.some(function (n) { return collapsed[n]; });
    names.forEach(function (n) { collapsed[n] = !anyCollapsed; });
    render();
  });

  /* ============================================================
     학생 추가 · 수정 모달
     ============================================================ */

  var studentModal = $('#studentModal');
  var editingId = null;
  var slugTouched = false;

  function showStudentError(msg) {
    var box = $('#studentError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  /* ---------- 학생 모달 안의 '내가 만든 칸' ---------- */

  /* 칸 하나를 입력 요소로 그린다. 값은 넣지 않고 뒤에서 채운다(특수문자 안전). */
  function extraFieldNode(f) {
    var wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.dataset.key = f.key;

    var lab = document.createElement('span');
    lab.className = 'field__label';
    lab.textContent = f.label;
    var opt = document.createElement('span');
    opt.className = 'field__opt';
    opt.textContent = '선택';
    lab.appendChild(document.createTextNode(' '));
    lab.appendChild(opt);

    var input;
    if (f.type === 'textarea') {
      input = document.createElement('textarea');
      input.className = 'textarea';
    } else if (f.type === 'select') {
      input = document.createElement('select');
      input.className = 'select';
      var blank = document.createElement('option');
      blank.value = ''; blank.textContent = '(비움)';
      input.appendChild(blank);
      (f.options || []).forEach(function (o) {
        var el = document.createElement('option');
        el.value = o; el.textContent = o;
        input.appendChild(el);
      });
    } else if (f.type === 'checkbox') {
      input = document.createElement('input');
      input.type = 'checkbox';
      wrap.className = 'check-line';
      wrap.textContent = '';
      wrap.appendChild(input);
      var t = document.createElement('span');
      t.textContent = f.label;
      wrap.appendChild(t);
      input.dataset.role = 'extra';
      return wrap;
    } else if (f.type === 'date') {
      input = document.createElement('input');
      input.className = 'input';
      input.type = 'date';
    } else {
      input = document.createElement('input');
      input.className = 'input';
      input.type = 'text';
      input.autocomplete = 'off';
    }

    input.dataset.role = 'extra';
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }

  function renderExtraFields(s) {
    var host = $('#extraFields');
    host.textContent = '';
    if (!fields.length) return;

    var head = document.createElement('div');
    head.className = 'extra-head';
    head.innerHTML = '<span class="extra-head__title">내가 만든 칸</span>';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--sm btn--ghost';
    btn.id = 'btnFieldsFromStudent';
    btn.textContent = '칸 관리';
    head.appendChild(btn);
    host.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'grid2';
    fields.forEach(function (f) {
      var node = extraFieldNode(f);
      if (f.type === 'textarea') node.classList.add('grid2__full');
      var input = node.querySelector('[data-role="extra"]');
      var v = s ? Store.fieldValue(s, f) : '';
      if (f.type === 'checkbox') input.checked = !!v;
      else input.value = v == null ? '' : String(v);
      grid.appendChild(node);
    });
    host.appendChild(grid);
  }

  /* 모달에 적힌 값을 extra 객체로 모은다.
     지금 없는 칸(나중에 지운 칸)에 적혀 있던 값은 건드리지 않고 그대로 둔다.
     칸을 잘못 지웠다가 다시 만들 때를 위한 것이다. */
  function collectExtra(s) {
    var out = {};
    var known = {};
    fields.forEach(function (f) { known[f.key] = true; });
    Object.keys((s && s.extra) || {}).forEach(function (k) {
      if (!known[k]) out[k] = s.extra[k];
    });
    fields.forEach(function (f) {
      var wrap = $('#extraFields [data-key="' + f.key + '"]');
      if (!wrap) return;
      var input = wrap.querySelector('[data-role="extra"]');
      if (!input) return;
      if (f.type === 'checkbox') { if (input.checked) out[f.key] = true; return; }
      var v = String(input.value || '').trim();
      if (v) out[f.key] = v;
    });
    return out;
  }

  function openStudentModal(s) {
    editingId = s ? s.id : null;
    slugTouched = !!s;

    $('#studentModalTitle').textContent = s ? '학생 수정' : '학생 추가';
    $('#fName').value   = s ? (s.name || '')        : '';
    $('#fSlug').value   = s ? (s.slug || '')        : '';
    $('#fSchool').value = s ? (s.school || '')      : '';
    $('#fGrade').value  = s ? (s.grade || '')       : '';
    $('#fClass').value  = s ? (s.className || '')   : '';
    $('#fParentTitle').value = s ? (s.parentTitle || '') : '';
    $('#fPhone').value  = s && s.parentPhone  ? Store.phoneFormat(s.parentPhone)  : '';
    $('#fPhone2').value = s && s.parentPhone2 ? Store.phoneFormat(s.parentPhone2) : '';

    /* 새 학생이면 직전에 쓰던 학년·반을 미리 채워 연속 입력을 빠르게 한다 */
    if (!s) {
      $('#fGrade').value = settings.lastGrade || '';
      $('#fClass').value = settings.lastClass || '';
      $('#fSchool').value = settings.lastSchool || '';
      $('#fParentTitle').value = settings.lastParentTitle || '';
    }

    renderExtraFields(s);

    showStudentError('');
    studentModal.showModal();
    setTimeout(function () { $('#fName').focus(); }, 30);
  }

  $('#btnAddStudent').addEventListener('click', function () { openStudentModal(null); });
  $('#btnStudentCancel').addEventListener('click', function () { studentModal.close(); });

  /* 이름을 치면 로마자를 자동 제안한다. 사용자가 직접 고친 뒤에는 건드리지 않는다. */
  $('#fName').addEventListener('input', function (e) {
    if (slugTouched) return;
    $('#fSlug').value = Store.romanizeGivenName(e.target.value);
  });
  $('#fSlug').addEventListener('input', function () { slugTouched = true; });

  ['#fPhone', '#fPhone2'].forEach(function (sel) {
    $(sel).addEventListener('blur', function (e) {
      var d = Store.phoneDigits(e.target.value);
      if (d) e.target.value = Store.phoneFormat(d);
    });
  });

  $('#studentForm').addEventListener('submit', function (e) {
    e.preventDefault();

    var name   = $('#fName').value.trim();
    var slug   = $('#fSlug').value.trim().toLowerCase();
    var phone  = Store.phoneDigits($('#fPhone').value);
    var phone2 = Store.phoneDigits($('#fPhone2').value);

    if (!name) { showStudentError('이름을 입력해 주세요.'); return; }
    if (!slug) { showStudentError('파일명에 쓸 로마자를 입력해 주세요.'); return; }
    if (!/^[a-z0-9]+$/.test(slug)) {
      showStudentError('로마자는 영어 소문자와 숫자만 쓸 수 있습니다. (예: haneul)');
      return;
    }
    if (!Store.phoneValid(phone)) {
      showStudentError('연락처 1의 자릿수를 확인해 주세요.');
      return;
    }
    if (!Store.phoneValid(phone2)) {
      showStudentError('연락처 2의 자릿수를 확인해 주세요.');
      return;
    }
    if (phone2 && phone2 === phone) {
      showStudentError('연락처 1과 2가 같습니다. 다른 번호를 넣거나 연락처 2를 비워 주세요.');
      return;
    }
    if (phone2 && !phone) {
      /* 1번이 비고 2번만 있으면 번호를 1번으로 올린다 */
      phone = phone2;
      phone2 = '';
    }

    /* 로마자가 겹치면 링크가 헷갈리므로 미리 막는다 */
    var dup = students.find(function (x) {
      return x.slug === slug && x.id !== editingId;
    });
    if (dup) {
      showStudentError('로마자 ‘' + slug + '’ 은(는) ' + dup.name + ' 학생이 쓰고 있습니다. 다르게 적어 주세요. (예: ' + slug + '2)');
      return;
    }

    var rec = {
      id: editingId || Store.newId(),
      name: name,
      slug: slug,
      school: $('#fSchool').value.trim(),
      grade: $('#fGrade').value.trim(),
      className: $('#fClass').value.trim(),
      parentTitle: $('#fParentTitle').value.trim(),
      parentPhone: phone,
      parentPhone2: phone2,
      extra: collectExtra(editingId ? students.find(function (x) { return x.id === editingId; }) : null),
      createdAt: editingId
        ? (students.find(function (x) { return x.id === editingId; }) || {}).createdAt || Date.now()
        : Date.now()
    };

    Store.upsertStudent(rec);
    students = Store.getStudents();

    /* 다음 학생 입력을 빠르게 하려고 마지막 값을 기억해 둔다 */
    settings.lastGrade       = rec.grade;
    settings.lastClass       = rec.className;
    settings.lastSchool      = rec.school;
    settings.lastParentTitle = rec.parentTitle;
    Store.write(Store.KEYS.settings, settings);

    studentModal.close();
    render();
    toast(editingId ? rec.name + ' 학생을 수정했습니다' : rec.name + ' 학생을 추가했습니다', 'good');
  });

  /* ============================================================
     반 현황 — 반마다 한 번만 적으면 되는 내용
     ============================================================ */

  var classInfoModal = $('#classInfoModal');
  var editingClass = null;

  /* 한 반에 몇 칸이나 채웠는지 */
  function classFilled(name) {
    var bag = Store.classExtra(name);
    return classFields.filter(function (f) {
      var v = bag[f.key];
      return v !== undefined && v !== '' && v !== false;
    }).length;
  }

  function renderClassInfo() {
    var host = $('#classInfoList');
    var classes = Store.getClasses();
    host.textContent = '';

    /* 서버에 표가 없으면(SQL 미실행) 그렇다고 말해 준다.
       기능은 그대로 쓰되 이 기기에만 남는다. */
    var notice = $('#classSqlNotice');
    if (notice) notice.hidden = !Store.serverMissing().length;

    if (!classes.length) {
      host.innerHTML =
        '<div class="empty-state">아직 반이 없습니다.<br>' +
        '학생을 추가하면서 반 이름을 적으면 여기에 나옵니다.</div>';
      return;
    }

    if (!classFields.length) {
      host.innerHTML =
        '<div class="empty-state">아직 만든 반 칸이 없습니다.<br>' +
        '<b>반 칸 관리</b>에서 시험 범위·수업 진도 같은 칸을 만들어 보세요.</div>';
      return;
    }

    var frag = document.createDocumentFragment();

    classes.forEach(function (c) {
      var bag = Store.classExtra(c.name);

      var card = document.createElement('div');
      card.className = 'cinfo';
      card.dataset.cls = c.name;

      var head = document.createElement('div');
      head.className = 'cinfo__head';
      head.innerHTML =
        '<span class="cinfo__name"></span>' +
        '<span class="cinfo__count"></span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn--sm" type="button" data-cact="edit">적기</button>';
      head.querySelector('.cinfo__name').textContent = c.name;
      head.querySelector('.cinfo__count').textContent = c.count + '명';
      card.appendChild(head);

      var body = document.createElement('div');
      body.className = 'cinfo__body';

      classFields.forEach(function (f) {
        var v = Store.fieldText(bag, f);
        var line = document.createElement('div');
        line.className = 'cinfo__line' + (v ? '' : ' is-empty');

        var name = document.createElement('span');
        name.className = 'cinfo__label';
        name.textContent = f.label;

        var val = document.createElement('span');
        val.className = 'cinfo__val';
        val.textContent = v || '비어 있음';

        line.appendChild(name);
        line.appendChild(val);
        body.appendChild(line);
      });

      card.appendChild(body);
      frag.appendChild(card);
    });

    host.appendChild(frag);
  }

  function openClassInfoModal(name) {
    editingClass = name;

    $('#classInfoTitle').textContent = name + ' 반 현황';
    $('#classInfoDesc').textContent =
      '여기에 적은 내용은 ' + name + ' 반 학생 전체에 쓰입니다';

    var host = $('#classInfoFields');
    host.textContent = '';

    var bag = Store.classExtra(name);
    var grid = document.createElement('div');
    grid.className = 'grid2';

    classFields.forEach(function (f) {
      var node = extraFieldNode(f);
      if (f.type === 'textarea') node.classList.add('grid2__full');
      var input = node.querySelector('[data-role="extra"]');
      var v = bag[f.key];
      if (f.type === 'checkbox') input.checked = !!v;
      else input.value = v == null ? '' : String(v);
      grid.appendChild(node);
    });

    host.appendChild(grid);

    $('#classInfoError').classList.remove('is-on');
    classInfoModal.showModal();
  }

  $('#classInfoList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-cact="edit"]');
    if (!btn) return;
    var card = btn.closest('.cinfo');
    if (card) openClassInfoModal(card.dataset.cls);
  });

  $('#btnClassInfoCancel').addEventListener('click', function () { classInfoModal.close(); });

  $('#classInfoForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editingClass) { classInfoModal.close(); return; }

    /* 지금 없는 칸(나중에 지운 칸)에 적혀 있던 값은 그대로 둔다 */
    var out = {};
    var known = {};
    classFields.forEach(function (f) { known[f.key] = true; });
    var old = Store.classExtra(editingClass);
    Object.keys(old).forEach(function (k) { if (!known[k]) out[k] = old[k]; });

    classFields.forEach(function (f) {
      var wrap = $('#classInfoFields [data-key="' + f.key + '"]');
      if (!wrap) return;
      var input = wrap.querySelector('[data-role="extra"]');
      if (!input) return;
      if (f.type === 'checkbox') { if (input.checked) out[f.key] = true; return; }
      var v = String(input.value || '').trim();
      if (v) out[f.key] = v;
    });

    Store.setClassExtra(editingClass, out);
    classInfoModal.close();
    renderClassInfo();
    window.dispatchEvent(new CustomEvent('jt:fields'));
    toast(editingClass + ' 반 현황을 저장했습니다', 'good');
  });

  /* ============================================================
     칸 관리 — 내가 만든 칸을 추가·수정·이동·삭제
     ============================================================ */

  var fieldsModal    = $('#fieldsModal');
  var fieldEditModal = $('#fieldEditModal');
  var editingFieldId = null;
  var fieldScope     = 'student';        /* 지금 관리 중인 쪽 — 'student' | 'class' */

  /* 지금 보고 있는 쪽의 칸 목록 */
  function scopeList() { return fieldScope === 'class' ? classFields : fields; }
  function scopeName() { return Store.SCOPES[fieldScope].name; }

  function typeName(t) {
    var hit = Store.FIELD_TYPES.find(function (x) { return x.type === t; });
    return hit ? hit.name : t;
  }

  /* 이 칸을 실제로 쓰고 있는 곳이 몇인지 — 지우기 전에 알려 준다.
     학생 칸이면 학생 수, 반 칸이면 반 수를 센다. */
  function usedCount(f) {
    function has(bag) {
      var v = (bag || {})[f.key];
      return v !== undefined && v !== '' && v !== false;
    }
    if (Store.scopeOf(f) === 'class') {
      var info = Store.getClassInfo();
      return Object.keys(info).filter(function (n) { return has(info[n]); }).length;
    }
    return students.filter(function (s) { return has(s.extra); }).length;
  }

  function usedUnit(f) { return Store.scopeOf(f) === 'class' ? '개 반' : '명'; }

  function renderFieldList() {
    var host = $('#fieldList');
    var list = scopeList();
    host.textContent = '';

    $('#fieldsTitle').textContent = scopeName() + ' 관리';
    $('#fieldsDesc').textContent = fieldScope === 'class'
      ? '시험 범위·수업 진도처럼 반마다 한 번만 적으면 되는 칸을 만듭니다. ' +
        '만든 칸은 명단 아래 [반 현황] 에 나옵니다.'
      : '학생마다 따로 적어 둘 칸을 만듭니다. ' +
        '만든 칸은 명단 표와 학생 수정 창에 같이 나옵니다.';

    $('#fieldsCount').textContent = list.length
      ? (fieldScope === 'class'
          ? list.length + '개'
          : list.length + '개 · 표에 보이는 칸 ' +
            list.filter(function (f) { return f.showInTable !== false; }).length + '개')
      : '';

    if (!list.length) {
      host.innerHTML =
        '<div class="empty-state">아직 만든 ' + scopeName() + '이 없습니다.<br>' +
        '<b>+ 칸 추가</b>로 시험 범위·수업 진도 같은 칸을 만들어 보세요.</div>';
      return;
    }

    list.forEach(function (f, i) {
      var row = document.createElement('div');
      row.className = 'field-row';
      row.dataset.id = f.id;
      row.innerHTML =
        '<div class="field-row__main">' +
          '<span class="field-row__label"></span>' +
          '<span class="field-row__meta"></span>' +
        '</div>' +
        '<div class="field-row__acts">' +
          '<button class="btn btn--sm btn--ghost" type="button" data-fact="up"' +
            (i === 0 ? ' disabled' : '') + ' aria-label="위로">↑</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-fact="down"' +
            (i === list.length - 1 ? ' disabled' : '') + ' aria-label="아래로">↓</button>' +
          '<button class="btn btn--sm" type="button" data-fact="edit">수정</button>' +
          '<button class="btn btn--sm btn--danger" type="button" data-fact="del">삭제</button>' +
        '</div>';

      row.querySelector('.field-row__label').textContent = f.label;

      var meta = [typeName(f.type)];
      if (f.type === 'select' && (f.options || []).length) {
        meta.push((f.options || []).slice(0, 4).join('/') +
                  ((f.options || []).length > 4 ? '…' : ''));
      }
      if (fieldScope !== 'class') {
        meta.push(f.showInTable !== false ? '표에 보임' : '표에 숨김');
      }
      var n = usedCount(f);
      if (n) meta.push(n + usedUnit(f) + ' 작성됨');
      row.querySelector('.field-row__meta').textContent = meta.join(' · ');

      host.appendChild(row);
    });
  }

  function showFieldEditError(msg) {
    var box = $('#fieldEditError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  /* 칸 종류 드롭다운은 Store 의 목록에서 한 번만 만든다 */
  (function buildTypeSelect() {
    var sel = $('#fdType');
    Store.FIELD_TYPES.forEach(function (t) {
      var o = document.createElement('option');
      o.value = t.type; o.textContent = t.name;
      sel.appendChild(o);
    });
  })();

  function syncTypeUi() {
    var t = $('#fdType').value;
    var hit = Store.FIELD_TYPES.find(function (x) { return x.type === t; });
    $('#fdTypeHint').textContent = hit ? hit.hint : '';
    $('#fdOptionsWrap').hidden = t !== 'select';
    /* '명단 표에 열로 보이기' 는 학생 칸에만 있는 얘기다 */
    $('#fdTableWrap').hidden = fieldScope === 'class';
    /* 여러 줄 글은 표에 넣으면 줄이 넘쳐서, 새로 만들 때는 꺼 둔 채로 시작한다 */
    if (t === 'textarea' && editingFieldId === null) $('#fdShowInTable').checked = false;
  }
  $('#fdType').addEventListener('change', syncTypeUi);

  function openFieldEdit(f) {
    editingFieldId = f ? f.id : null;
    $('#fieldEditTitle').textContent = scopeName() + (f ? ' 수정' : ' 추가');
    $('#fieldEditDesc').textContent = Store.SCOPES[fieldScope].desc +
      '. 칸 이름은 나중에 언제든 바꿀 수 있습니다.';
    $('#fdLabel').value = f ? (f.label || '') : '';
    $('#fdType').value  = f ? (f.type || 'text') : 'text';
    $('#fdOptions').value = f && Array.isArray(f.options) ? f.options.join('\n') : '';
    $('#fdShowInTable').checked = f ? f.showInTable !== false : true;
    syncTypeUi();
    showFieldEditError('');
    fieldEditModal.showModal();
    setTimeout(function () { $('#fdLabel').focus(); }, 30);
  }

  function saveFields(next) {
    Store.saveFieldDefs(next, fieldScope);
    /* 순서 번호가 다시 매겨진 것을 받아 온다 */
    fields = Store.getFieldDefs('student');
    classFields = Store.getFieldDefs('class');
    renderFieldList();
    render();                          /* 명단 표의 열도 같이 바뀐다 */
    renderClassInfo();
    window.dispatchEvent(new CustomEvent('jt:fields'));   /* 작성 탭이 따라 바뀐다 */
  }

  function openFieldsModal(scope) {
    fieldScope = scope;
    renderFieldList();
    fieldsModal.showModal();
  }

  $('#btnManageFields').addEventListener('click', function () {
    openFieldsModal('student');
  });
  $('#btnManageClassFields').addEventListener('click', function () {
    openFieldsModal('class');
  });

  $('#btnFieldAdd').addEventListener('click', function () { openFieldEdit(null); });
  $('#btnFieldEditCancel').addEventListener('click', function () { fieldEditModal.close(); });

  /* 학생 수정 창에서 바로 칸 관리로 */
  $('#extraFields').addEventListener('click', function (e) {
    if (!e.target.closest('#btnFieldsFromStudent')) return;
    openFieldsModal('student');
  });

  $('#fieldList').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-fact]');
    if (!btn) return;
    var row = btn.closest('.field-row');
    var id = row && row.dataset.id;
    var list = scopeList();
    var i = list.findIndex(function (f) { return f.id === id; });
    if (i < 0) return;

    var act = btn.dataset.fact;
    var next = list.slice();

    if (act === 'up' && i > 0) {
      next.splice(i - 1, 0, next.splice(i, 1)[0]);
      saveFields(next);

    } else if (act === 'down' && i < next.length - 1) {
      next.splice(i + 1, 0, next.splice(i, 1)[0]);
      saveFields(next);

    } else if (act === 'edit') {
      openFieldEdit(list[i]);

    } else if (act === 'del') {
      var f = list[i];
      var n = usedCount(f);
      confirmAsk(
        '‘' + f.label + '’ ' + scopeName() + '을 지울까요?',
        n ? n + usedUnit(f) + '이 적어 둔 내용이 화면에서 사라집니다. (다시 만들어도 살아나지 않습니다)'
          : '아직 아무 데도 적지 않은 칸입니다.',
        '지우기'
      ).then(function (ok) {
        if (!ok) return;
        next.splice(i, 1);
        saveFields(next);
        toast('‘' + f.label + '’ 칸을 지웠습니다');
      });
    }
  });

  $('#fieldEditForm').addEventListener('submit', function (e) {
    e.preventDefault();

    var label = $('#fdLabel').value.trim();
    var type  = $('#fdType').value;
    var opts  = $('#fdOptions').value.split('\n')
      .map(function (x) { return x.trim(); })
      .filter(function (x, i2, arr) { return x && arr.indexOf(x) === i2; });

    if (!label) { showFieldEditError('칸 이름을 적어 주세요.'); return; }

    /* 이름이 겹치는지는 같은 쪽 안에서만 본다.
       학생 칸 '시험 범위' 와 반 칸 '시험 범위' 는 따로 둘 수 있어야 한다. */
    var list = scopeList();
    var dup = list.find(function (f) {
      return f.label === label && f.id !== editingFieldId;
    });
    if (dup) {
      showFieldEditError('‘' + label + '’ ' + scopeName() + '이 이미 있습니다. 다른 이름을 적어 주세요.');
      return;
    }

    if (type === 'select' && !opts.length) {
      showFieldEditError('선택지를 한 줄에 하나씩 적어 주세요.');
      return;
    }

    var next = list.slice();
    var i = next.findIndex(function (f) { return f.id === editingFieldId; });
    var inTable = fieldScope === 'class' ? false : $('#fdShowInTable').checked;

    if (i >= 0) {
      /* key 는 그대로 둔다. 이름만 바꿔도 적어 둔 값이 따라온다. */
      next[i] = {
        id: next[i].id, key: next[i].key,
        label: label, type: type, options: opts,
        showInTable: inTable, scope: fieldScope,
        sortOrder: next[i].sortOrder
      };
    } else {
      next.push({
        id: Store.newId(),
        key: Store.newFieldKey(),      /* 학생 칸·반 칸을 통틀어 안 겹치게 */
        label: label, type: type, options: opts,
        showInTable: inTable, scope: fieldScope,
        sortOrder: next.length
      });
    }

    saveFields(next);
    fieldEditModal.close();

    /* 열려 있는 입력 창이 있으면 칸이 바로 보이게 다시 그린다 */
    if (studentModal.open) {
      renderExtraFields(editingId
        ? students.find(function (x) { return x.id === editingId; })
        : null);
    }
    if (classInfoModal.open && editingClass) openClassInfoModal(editingClass);

    toast('‘' + label + '’ ' + scopeName() + (i >= 0 ? '을 고쳤습니다' : '을 만들었습니다'), 'good');
  });

  /* ============================================================
     백업 암호 모달
     ============================================================ */

  var passModal = $('#passModal');
  var passResolve = null;

  function askPassword(mode) {
    /* mode: 'export' | 'import' */
    return new Promise(function (resolve) {
      passResolve = resolve;

      var isExport = mode === 'export';
      $('#passTitle').textContent = isExport ? '백업 암호 정하기' : '백업 암호 입력';
      $('#passDesc').textContent = isExport
        ? '이 암호로 파일을 잠급니다. 조교에게는 파일과 암호를 따로 전달하세요.'
        : '이 백업 파일을 잠글 때 쓴 암호를 넣어 주세요.';
      $('#passConfirmField').hidden = !isExport;
      $('#passWarn').hidden = !isExport;
      $('#fPass1').value = '';
      $('#fPass2').value = '';
      $('#fPass1').setAttribute('autocomplete', isExport ? 'new-password' : 'current-password');
      $('#passError').classList.remove('is-on');

      passModal.showModal();
      setTimeout(function () { $('#fPass1').focus(); }, 30);
    });
  }

  function passFinish(value) {
    if (!passResolve) return;
    var r = passResolve;
    passResolve = null;
    passModal.close();
    r(value);
  }

  $('#btnPassCancel').addEventListener('click', function () { passFinish(null); });

  passModal.addEventListener('cancel', function () { passFinish(null); });

  $('#passForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var p1 = $('#fPass1').value;
    var p2 = $('#fPass2').value;
    var isExport = !$('#passConfirmField').hidden;
    var err = $('#passError');

    if (p1.length < 4) {
      err.textContent = '암호는 4자 이상으로 정해 주세요.';
      err.classList.add('is-on');
      return;
    }
    if (isExport && p1 !== p2) {
      err.textContent = '두 암호가 서로 다릅니다. 다시 확인해 주세요.';
      err.classList.add('is-on');
      return;
    }
    passFinish(p1);
  });

  /* ============================================================
     내보내기
     ============================================================ */

  $('#btnExport').addEventListener('click', function () {
    if (!students.length) { toast('내보낼 학생이 없습니다', 'bad'); return; }

    askPassword('export').then(function (pass) {
      if (!pass) return;
      return Store.exportEncrypted(pass).then(function (backup) {
        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var d = new Date();
        var stamp = d.getFullYear() + '-' +
                    String(d.getMonth() + 1).padStart(2, '0') + '-' +
                    String(d.getDate()).padStart(2, '0');
        a.href = url;
        a.download = 'kimjonghyeon-students-' + stamp + '.jtbak';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        toast(students.length + '명을 암호 백업으로 내려받았습니다', 'good');
      });
    }).catch(function (e) {
      console.error(e);
      toast('백업을 만들지 못했습니다', 'bad');
    });
  });

  /* ============================================================
     불러오기 — 버튼 · 파일 선택 · 드래그
     ============================================================ */

  var fileInput = $('#importFile');
  var dropzone = $('#dropzone');

  $('#btnImport').addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.add('is-over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      dropzone.classList.remove('is-over');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleImportFile(f);
  });

  fileInput.addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) handleImportFile(f);
    e.target.value = '';           /* 같은 파일을 다시 골라도 동작하게 */
  });

  function handleImportFile(file) {
    file.text().then(function (text) {
      var obj;
      try { obj = JSON.parse(text); }
      catch (e) { throw new Error('JSON 형식이 아닙니다. 올바른 백업 파일인지 확인해 주세요.'); }

      if (!obj || ['device-backup', 'students-backup'].indexOf(obj.type) === -1) {
        throw new Error('백업 파일이 아닙니다.');
      }

      var needPass = !!obj.encrypted;
      return (needPass ? askPassword('import') : Promise.resolve(''))
        .then(function (pass) {
          if (needPass && pass == null) return null;       /* 취소 */
          return Store.importEncrypted(obj, pass);
        });
    }).then(function (payload) {
      if (!payload) return;
      return applyBackup(payload);
    }).catch(function (e) {
      console.error(e);
      toast(e.message || '불러오지 못했습니다', 'bad');
    });
  }

  /* 백업을 이 기기에 반영한다. 기존 내용이 있으면 먼저 묻는다. */
  function applyBackup(payload) {
    var n = payload.students.length;
    var weeks = Object.keys(payload.sent || {}).length;

    function apply() {
      Store.restorePayload(payload);
      students = Store.getStudents();
      fields = Store.getFieldDefs('student');
      classFields = Store.getFieldDefs('class');
      settings = Store.read(Store.KEYS.settings, {});
      collapsed = {};
      filterText = '';
      filterClass = '';
      $('#searchInput').value = '';
      collapseIfCrowded();
      render();
      toast('학생 ' + n + '명' + (weeks ? ' · 발송 기록 ' + weeks + '주차' : '') + ' 불러왔습니다', 'good');
    }

    if (!students.length) { apply(); return; }

    return confirmAsk(
      '백업 불러오기',
      '지금 이 기기에 학생 ' + students.length + '명이 저장되어 있습니다. ' +
      '백업에 든 ' + n + '명으로 바꿀까요? 지금 내용(발송 기록 포함)은 사라집니다.',
      '바꾸기'
    ).then(function (ok) { if (ok) apply(); });
  }

  /* ============================================================
     명단 지우기
     ============================================================ */

  /* ---------- 이 기기 정리 (로그아웃 + 로컬 사본 삭제) ----------
     서버 자료는 건드리지 않는다. 다시 로그인하면 그대로 보인다. */

  $('#btnClearAll').addEventListener('click', function () {
    var hasToken = !!Store.getToken();

    confirmAsk(
      '이 기기에서 로그아웃하고 정리',
      '이 브라우저에 남아 있는 로그인 상태' +
      (hasToken ? '와 깃허브 토큰' : '') +
      ', 내려받아 둔 사본을 지우고 로그아웃합니다. ' +
      '서버의 학생 명단과 작성 내용은 그대로 남습니다.',
      '정리하고 로그아웃'
    ).then(function (ok) {
      if (!ok) return;

      Store.enableSync(false);      /* 정리 중에 빈 값이 서버로 새어 나가지 않게 */
      Store.clearAll();
      students = [];
      settings = {};
      collapsed = {};
      filterText = '';
      filterClass = '';
      $('#searchInput').value = '';
      render();

      SB.signOut().then(function () {
        location.reload();          /* 로그인 화면부터 다시 */
      });
    });
  });

  /* ============================================================
     시작
     ============================================================ */

  /* ============================================================
     S-4. 이 브라우저에 있던 자료를 서버로 올리기

     예전 방식(브라우저 저장)으로 쌓아 둔 명단이 있는데
     서버가 비어 있을 때만 안내를 띄운다.
     ============================================================ */

  function refreshMigrateNotice() {
    var local = Store.getStudents();
    /* 서버가 비어 있는데 이 브라우저에만 명단이 있을 때만 안내한다 */
    $('#migrateNotice').hidden = !(local.length && Store.wasServerEmpty());
  }

  $('#btnMigrate').addEventListener('click', function () {
    var n = students.length;
    confirmAsk(
      '서버로 올리기',
      '이 브라우저에 있는 학생 ' + n + '명과 작성 내용을 서버로 올립니다. ' +
      '서버에 이미 같은 학생이 있으면 이 브라우저 내용으로 덮어씁니다.',
      '올리기'
    ).then(function (ok) {
      if (!ok) return;
      var btn = $('#btnMigrate');
      btn.disabled = true;
      btn.textContent = '올리는 중…';

      Store.migrateLocalToServer().then(function (r) {
        students = Store.getStudents();
        render();
        $('#migrateNotice').hidden = true;
        toast('학생 ' + r.students + '명 · 입력 ' + r.entries + '건을 올렸습니다', 'good');
        window.dispatchEvent(new CustomEvent('jt:loaded'));
      }).catch(function (e) {
        btn.disabled = false;
        btn.textContent = '서버로 올리기';
        toast('올리지 못했습니다 — ' + e.message, 'bad');
      });
    });
  });

  /* 서버에서 다 받아온 뒤 화면을 새로 그린다 */
  window.addEventListener('jt:loaded', function () {
    students = Store.getStudents();
    fields = Store.getFieldDefs('student');
    classFields = Store.getFieldDefs('class');
    settings = Store.read(Store.KEYS.settings, {});
    collapsed = {};
    collapseIfCrowded();
    render();
    refreshMigrateNotice();
  });

  collapseIfCrowded();
  render();

  /* ---------- 다른 탭(write.js)이 쓰는 공용 도구 ---------- */

  global_UI();
  function global_UI() {
    window.UI = {
      $: $, $$: $$,
      toast: toast,
      confirmAsk: confirmAsk,
      selectTab: selectTab,
      getStudents: function () { return students; }
    };
  }

  /* 명단이 바뀌면 작성 탭도 다시 그려야 한다 */
  var origRender = render;
  window.addEventListener('jt:need-refresh', function () { origRender(); });

})();
