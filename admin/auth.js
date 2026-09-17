/* ============================================================
   auth.js — 로그인 관문

   로그인하기 전에는 아무 화면도 보이지 않는다.
   지금 단계(S-2)에서는 로그인만 붙인다.
   데이터는 아직 브라우저에 있고, S-3 에서 Supabase 로 옮긴다.
   ============================================================ */

(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };

  var gate    = $('#authGate');
  var appRoot = $('#appRoot');
  var topbar  = $('#topbar');
  var form    = $('#loginForm');
  var idInput = $('#loginId');
  var pwInput = $('#loginPw');
  var errBox  = $('#loginError');
  var btn     = $('#btnLogin');

  function showError(msg) {
    errBox.textContent = msg || '';
    errBox.classList.toggle('is-on', !!msg);
  }

  function setBusy(on) {
    btn.disabled = on;
    btn.textContent = on ? '확인 중…' : '로그인';
    idInput.disabled = on;
    pwInput.disabled = on;
  }

  /* 로그인한 뒤, 서버에서 데이터를 받아 온 다음 화면을 연다.
     받아오기 전에 열면 빈 명단이 잠깐 보이고, 그 상태로 저장이 돌면
     서버 명단을 덮어쓸 위험이 있다. */
  function showApp(session) {
    var id = SB.toShortId(session && session.user && session.user.email);

    setBusy(true);
    btn.textContent = '불러오는 중…';

    /* loadAll 이 그 자리에서 터지는 경우가 있다(라이브러리가 덜 떴을 때 등).
       Promise 로 감싸 두면 그 경우도 아래 catch 로 내려와 버튼이 풀린다. */
    return new Promise(function (resolve) { resolve(Store.loadAll()); }).then(function () {
      Store.enableSync(true);          /* 다 받은 뒤에야 서버로 밀기 시작한다 */

      gate.hidden = true;
      appRoot.hidden = false;
      topbar.hidden = false;
      $('#whoami').textContent = id || '';
      $('#whoamiWrap').hidden = !id;
      document.body.classList.remove('is-locked');
      setBusy(false);

      window.dispatchEvent(new CustomEvent('jt:loaded'));
    }).catch(function (err) {
      Store.enableSync(false);
      setBusy(false);                 /* 다시 눌러 볼 수 있어야 한다 */
      console.error(err);
      showError('데이터를 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 로그인해 주세요.');
    });
  }

  function showLogin() {
    Store.enableSync(false);         /* 로그인 전에는 서버로 아무것도 보내지 않는다 */
    gate.hidden = false;
    appRoot.hidden = true;
    topbar.hidden = true;
    document.body.classList.add('is-locked');
    setBusy(false);
    pwInput.value = '';
    setTimeout(function () { idInput.focus(); }, 60);
  }

  /* ---------- 로그인 ---------- */

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    showError('');
    setBusy(true);

    /* 로그인 응답에 세션이 들어 있다. 여기서 getSession() 을 다시 부르면
       라이브러리 내부 잠금을 서로 기다리다 화면이 멈춘다. */
    SB.signIn(idInput.value, pwInput.value)
      .then(function (session) {
        setBusy(false);
        try {
          showApp(session);
        } catch (uiErr) {
          /* 화면 전환에서 터져도 버튼이 멈춰 있으면 안 된다 */
          console.error(uiErr);
          setBusy(false);
          showError('로그인은 됐지만 화면을 여는 중 문제가 생겼습니다. 다시 시도해 주세요.');
        }
      })
      .catch(function (err) {
        setBusy(false);
        showError(err && err.message ? err.message : '로그인에 실패했습니다.');
        pwInput.value = '';
        pwInput.focus();
      });
  });

  /* 아이디에 @ 를 안 써도 되는 것을 눈으로 알려준다.
     자동완성처럼 사람이 치지 않고 값이 들어오는 경우도 있어 change 까지 본다. */
  function syncIdHint() {
    var v = idInput.value.trim();
    $('#loginIdHint').textContent = v && v.indexOf('@') === -1
      ? SB.toEmail(v) + ' 로 로그인합니다'
      : '아이디만 입력하면 됩니다 (예: jonghyeon)';
  }
  idInput.addEventListener('input', syncIdHint);
  idInput.addEventListener('change', syncIdHint);

  /* ---------- 로그아웃 ---------- */

  $('#btnLogout').addEventListener('click', function () {
    SB.signOut().then(function () {
      showLogin();
      showError('');
    });
  });

  /* ---------- 시작 ---------- */

  function boot() {
    /* 지금 떠 있는 버전을 화면에 적는다.
       배포했는데 화면이 그대로일 때, 옛 파일이 캐시로 남았는지 바로 알 수 있다. */
    var verEl = $('#appVersion');
    if (verEl) verEl.textContent = 'v' + (window.SB ? SB.VERSION : '?');

    /* 저장 상태를 상단에 보여 준다. 여러 기기에서 같이 쓰므로
       '지금 서버에 올라갔는지'가 눈에 보여야 한다. */
    var dot = $('#syncDot');
    Store.onSyncChange(function (s) {
      if (!dot) return;
      if (s.error) {
        dot.className = 'sync sync--bad';
        dot.textContent = '저장 실패';
        dot.title = s.error;
      } else if (s.pending > 0) {
        dot.className = 'sync sync--busy';
        dot.textContent = '저장 중';
        dot.title = '';
      } else {
        dot.className = 'sync sync--ok';
        dot.textContent = '저장됨';
        dot.title = '';
      }
    });

    try {
      SB.init();
    } catch (e) {
      showError(e.message);
      gate.hidden = false;
      document.body.classList.add('is-locked');
      return;
    }

    /* 세션 확인이 늦어져도 화면이 빈 채로 멈추지 않게 한다 */
    SB.getSession().then(function (session) {
      if (session) showApp(session);
      else showLogin();
    }).catch(function (err) {
      console.error(err);
      showLogin();
      showError('로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.');
    });

    /* 다른 탭에서 로그아웃하면 이 탭도 잠근다.
       이 콜백 안에서는 Supabase 함수를 부르지 않는다 (supabase.js 에서 한 박자 미뤄 부른다). */
    SB.onAuthChange(function (event, session) {
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        if (!gate.hidden) return;     /* 이미 잠겨 있으면 그대로 */
        showLogin();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
