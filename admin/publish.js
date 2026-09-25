/* ============================================================
   publish.js — ③ 발행 탭 (D단계)

   토큰 저장 → 올릴 목록 확인 → 커밋 하나로 발행 → Pages 반영 확인

   올릴 목록은 서버에 있는 내용(학생·반 공통·주간 입력)에서 그때그때 만든다.
   따로 '대기열'을 들고 있지 않으므로, 조교가 노트북에서 쓴 것을
   선생님이 폰에서 그대로 발행할 수 있다.
   ============================================================ */

(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  function toast(m, k) { if (window.UI) UI.toast(m, k); }
  function students() { return (window.UI ? UI.getStudents() : Store.getStudents()); }

  var lastResult = null;

  /* ============================================================
     토큰
     ============================================================ */

  function showTokenError(msg) {
    var box = $('#tokenError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  function renderToken() {
    var t = Store.getToken();
    $('#tokenSetup').hidden = !!t;
    $('#tokenSaved').hidden = !t;

    if (t) {
      $('#tokenRepo').textContent = t.repo || 'jonghyeon-report';
      var when = t.savedAt ? new Date(t.savedAt).toLocaleDateString('ko-KR') : '';
      $('#tokenMeta').textContent =
        (when ? when + ' 저장 · ' : '') +
        '만료되면 다시 발급해 넣어 주세요 (보통 90일)';
      $('#tokenHint').textContent = '이 브라우저에만 저장됩니다 · 서버에는 올라가지 않습니다';
    } else {
      $('#tokenHint').textContent = '이 브라우저에만 저장됩니다';
    }
    refreshPublishButton();
  }

  $('#btnSaveToken').addEventListener('click', function () {
    var token = $('#tokenInput').value.trim();
    if (!token) { showTokenError('토큰을 붙여넣어 주세요.'); return; }

    var btn = this;
    btn.disabled = true;
    btn.textContent = '확인 중…';
    showTokenError('');

    GH.checkToken(token).then(function (info) {
      Store.saveToken({ value: token, repo: info.repo, savedAt: Date.now() });
      $('#tokenInput').value = '';
      btn.disabled = false;
      btn.textContent = '확인하고 저장';
      renderToken();
      renderList();          /* '토큰을 먼저 저장해 주세요' 안내를 원래 문구로 되돌린다 */
      toast('토큰을 확인했습니다', 'good');
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = '확인하고 저장';
      showTokenError(e.message);
    });
  });

  $('#btnClearToken').addEventListener('click', function () {
    UI.confirmAsk('토큰 지우기',
      '이 브라우저에서 깃허브 토큰을 지웁니다. 발행하려면 다시 넣어야 합니다. ' +
      '깃허브에서도 끄려면 Settings → Developer settings 에서 Revoke 하세요.',
      '지우기'
    ).then(function (ok) {
      if (!ok) return;
      Store.clearToken();
      renderToken();
      toast('토큰을 지웠습니다');
    });
  });

  /* ============================================================
     올릴 목록 만들기
     ============================================================ */

  var pending = [];      /* [{ student, data, path, url, alreadyPublished }] */
  /* 이번에 빠진 학생 수 — 안내에 적는다 */
  var skipped = { partial: 0, none: 0 };

  function buildList() {
    var draft = Store.read(Store.KEYS.draft, null);
    if (!draft || !draft.weekStart) return [];

    var published = Store.read(Store.KEYS.published, {});
    var weekPub = published[draft.weekStart] || {};
    var out = [];

    var includePartial = !!($('#pubIncludePartial') || {}).checked;
    skipped = { partial: 0, none: 0 };

    students().forEach(function (s) {
      if (s.archived) return;
      var e = (draft.entries || {})[s.id];

      var cls = s.className || '';
      var common = (draft.common || {})[cls] || { lessons: [], tests: [] };

      /* 작성 상태 판정은 report.js 한 곳에 있다. 작성 탭의 딱지와 같은 규칙이라
         '작성 완료' 로 보이는데 여기 없는 일이 생기지 않는다. */
      var st = Report.entryStatus(common, e);
      if (st.state === 'none') { skipped.none++; return; }
      if (st.state === 'partial') {
        skipped.partial++;
        if (!includePartial) return;
      }

      var data = Report.toReportData(s, common, e,
                                     { start: draft.weekStart, end: draft.weekEnd });

      /* 한 번 발행한 학생은 같은 경로를 다시 쓴다.
         그래야 이미 보낸 링크가 살아 있다. */
      var prev = weekPub[s.id];
      var path = prev ? prev.path : Report.buildPath(s, draft.weekStart);

      out.push({
        student: s,
        data: data,
        path: path,
        url: GH.SITE + path,
        republish: !!prev
      });
    });

    out.sort(function (a, b) {
      var c = (a.student.className || '').localeCompare(b.student.className || '', 'ko');
      if (c !== 0) return c;
      return (a.student.name || '').localeCompare(b.student.name || '', 'ko');
    });
    return out;
  }

  function renderList() {
    var draft = Store.read(Store.KEYS.draft, null);
    var host = $('#pubList');
    host.textContent = '';

    if (!draft || !draft.weekStart) {
      $('#pubWeekHint').textContent = '';
      host.innerHTML = '<div class="empty-state">② 작성 탭에서 주차를 먼저 정해 주세요.</div>';
      pending = [];
      refreshPublishButton();
      return;
    }

    $('#pubWeekHint').textContent =
      Store.shortDate(draft.weekStart) + ' ~ ' + Store.shortDate(draft.weekEnd) + ' 주차';

    pending = buildList();

    if (!pending.length) {
      host.innerHTML =
        '<div class="empty-state">올릴 레포트가 없습니다.<br>' +
        '② 작성 탭에서 <b>필수 항목을 다 채운 학생</b>만 올라갑니다.' +
        (skipped.partial
          ? '<br>작성 중인 학생이 ' + skipped.partial + '명 있습니다 — ' +
            '위의 <b>작성 중도 포함</b>을 켜면 함께 올라갑니다.'
          : '') +
        '</div>';
      refreshPublishButton();
      return;
    }

    /* 반이 여러 개면 반별로 묶어 보여준다.
       44명이 한 줄로 쏟아지면 어느 반이 빠졌는지 알아보기 어렵다. */
    var groups = [];
    var index = {};
    pending.forEach(function (p) {
      var key = (p.student.className || '').trim() || '(반 없음)';
      if (!(key in index)) { index[key] = groups.length; groups.push({ name: key, rows: [] }); }
      groups[index[key]].rows.push(p);
    });

    var frag = document.createDocumentFragment();

    groups.forEach(function (g) {
      if (groups.length > 1) {
        var head = document.createElement('div');
        head.className = 'pub-group';
        head.innerHTML = '<span class="pub-group__name"></span>' +
                         '<span class="pub-group__count">' + g.rows.length + '명</span>';
        head.querySelector('.pub-group__name').textContent = g.name;
        frag.appendChild(head);
      }

      g.rows.forEach(function (p) {
        var row = document.createElement('div');
        row.className = 'pub-row';
        row.innerHTML =
          '<span class="pub-row__name"></span>' +
          (groups.length > 1 ? '' : '<span class="pub-row__cls"></span>') +
          (p.republish ? '<span class="pub-row__tag">다시 올림</span>' : '') +
          '<span class="pub-row__path num"></span>';
        row.querySelector('.pub-row__name').textContent = p.student.name;
        var cls = row.querySelector('.pub-row__cls');
        if (cls) cls.textContent = p.student.className || '';
        row.querySelector('.pub-row__path').textContent = p.path;
        frag.appendChild(row);
      });
    });
    host.appendChild(frag);

    var again = pending.filter(function (p) { return p.republish; }).length;
    var left = skipped.partial && !($('#pubIncludePartial') || {}).checked
                 ? skipped.partial : 0;

    $('#pubInfo').textContent =
      (groups.length > 1 ? groups.length + '개 반 ' : '') + pending.length + '명' +
      (again ? ' (그중 ' + again + '명은 다시 올림 — 링크는 그대로)' : '') +
      (left ? ' · 작성 중 ' + left + '명은 빠졌습니다' : '');

    refreshPublishButton();
  }

  function refreshPublishButton() {
    var hasToken = !!Store.getToken();
    $('#btnPublish').disabled = !hasToken || !pending.length;
    if (!hasToken && pending.length) {
      $('#pubInfo').textContent = '토큰을 먼저 저장해 주세요';
    }
  }

  $('#btnPubRefresh').addEventListener('click', function () {
    renderList();
    toast('목록을 새로 읽었습니다');
  });

  /* '작성 중도 포함' 을 켜고 끄면 목록을 다시 만든다 */
  $('#pubIncludePartial').addEventListener('change', function (e) {
    renderList();
    toast(e.target.checked
      ? '작성 중인 학생도 목록에 넣었습니다'
      : '작성 완료한 학생만 올립니다');
  });

  /* ============================================================
     발행
     ============================================================ */

  function showPubError(msg) {
    var box = $('#pubError');
    box.textContent = msg || '';
    box.classList.toggle('is-on', !!msg);
  }

  function setProgress(done, total, label) {
    $('#pubProgress').hidden = false;
    var pct = total ? Math.round(done / total * 100) : 0;
    $('#pubFill').style.width = pct + '%';
    $('#pubLabel').textContent = label + ' · ' + pct + '%';
  }

  $('#btnPublish').addEventListener('click', function () {
    var tokenRec = Store.getToken();
    if (!tokenRec || !tokenRec.value) { toast('토큰을 먼저 저장해 주세요', 'bad'); return; }
    if (!pending.length) return;

    var draft = Store.read(Store.KEYS.draft, null);
    var weekLabel = Store.shortDate(draft.weekStart) + '~' + Store.shortDate(draft.weekEnd);

    UI.confirmAsk(
      '한꺼번에 올리기',
      pending.length + '명의 레포트를 깃허브에 올립니다. 커밋 하나로 올라갑니다. ' +
      '올린 뒤 1~2분 지나야 실제 주소가 열립니다.',
      '올리기'
    ).then(function (ok) {
      if (!ok) return;
      doPublish(tokenRec.value, weekLabel, draft);
    });
  });

  function doPublish(token, weekLabel, draft) {
    var btn = $('#btnPublish');
    btn.disabled = true;
    btn.textContent = '올리는 중…';
    showPubError('');
    $('#pubResultPanel').hidden = true;

    var snapshot = pending.slice();

    Report.loadTemplate().then(function (tpl) {
      var files = snapshot.map(function (p) {
        return {
          path: p.path,
          content: Report.buildHtml(tpl, p.data, p.path, { publishDate: Report.todayISO() })
        };
      });

      var msg = weekLabel + ' 주간 레포트 ' + files.length + '건';
      return GH.publish(token, files, msg, function (done, total) {
        setProgress(done, total, '깃허브에 올리는 중');
      });
    }).then(function (res) {
      setProgress(1, 1, '올리기 완료');

      /* 발행 이력을 서버에 남긴다. 링크가 바뀌지 않게 하는 근거가 된다. */
      var published = Store.read(Store.KEYS.published, {});
      published[draft.weekStart] = published[draft.weekStart] || {};

      var jobs = snapshot.map(function (p) {
        published[draft.weekStart][p.student.id] = {
          path: p.path, url: p.url, publishedAt: Date.now(), commitSha: res.sha
        };
        return DB.savePublished(draft.weekStart, p.student.id, p.path, p.url, res.sha);
      });
      Store.writeLocal(Store.KEYS.published, published);

      return Promise.all(jobs).then(function () { return res; });
    }).then(function (res) {
      lastResult = { snapshot: snapshot, sha: res.sha };
      showResult(snapshot, 'checking');

      btn.disabled = false;
      btn.textContent = '한꺼번에 올리기';
      toast(snapshot.length + '건을 올렸습니다. 반영 확인 중…', 'good');

      /* 실제로 열릴 때까지 기다린다. 반영 전에 링크를 보내면 학부모가 404 를 본다. */
      return GH.waitForPages(snapshot.map(function (p) { return p.url; }), function (ok, total) {
        $('#pubResultHint').textContent = '반영 확인 중… ' + ok + ' / ' + total;
      });
    }).then(function (allOk) {
      $('#pubProgress').hidden = true;
      showResult(snapshot, allOk ? 'live' : 'slow');
      if (allOk) toast('모든 링크가 열립니다', 'good');
    }).catch(function (e) {
      $('#pubProgress').hidden = true;
      btn.disabled = false;
      btn.textContent = '한꺼번에 올리기';
      showPubError(e.message);
      toast('올리지 못했습니다', 'bad');
    });
  }

  function showResult(list, state) {
    $('#pubResultPanel').hidden = false;

    $('#pubResultHint').textContent =
      state === 'live' ? '모든 주소가 열립니다. 이제 보내셔도 됩니다.'
    : state === 'slow' ? '아직 열리지 않는 주소가 있습니다. 1~2분 뒤 새로고침해 확인해 주세요.'
    : '반영 확인 중…';

    var host = $('#pubResult');
    host.textContent = '';
    var frag = document.createDocumentFragment();

    list.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'pub-row';
      row.innerHTML =
        '<span class="pub-row__name"></span>' +
        '<a class="pub-row__link" target="_blank" rel="noopener"></a>';
      row.querySelector('.pub-row__name').textContent = p.student.name;
      var a = row.querySelector('.pub-row__link');
      a.textContent = p.url;
      a.href = p.url;
      frag.appendChild(row);
    });
    host.appendChild(frag);
  }

  /* ============================================================
     시작
     ============================================================ */

  document.addEventListener('jt:tab', function (e) {
    if (e.detail.index === 2) { renderToken(); renderList(); }
  });

  window.addEventListener('jt:loaded', function () {
    renderToken();
    if (!$('#panel-publish').hidden) renderList();
  });

  renderToken();

})();
