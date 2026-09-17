/* ============================================================
   supabase.js — 로그인

   접속 주소·키·아이디 도메인은 전부 config.js 에 있다.
   이 파일은 그 값을 가져다 쓰기만 한다.

   config.js 의 publishable key 는 공개돼도 되는 키다.
   단, 그것은 모든 테이블에 RLS 가 켜져 있을 때만 성립한다.
   (supabase/schema.sql 참고. 비로그인 쓰기가 42501 로 거부되는 것을 확인했다.)

   secret key 는 절대 넣지 않는다.
   ============================================================ */

(function (global) {
  'use strict';

  if (!global.CONFIG) {
    throw new Error('config.js 를 먼저 불러와야 합니다.');
  }

  /* 화면 아래에 표시된다. 배포 후 옛 파일이 캐시로 남았는지 눈으로 확인하는 용도.
     index.html 의 ?v= 값과 같아야 한다. */
  var APP_VERSION = global.CONFIG.version;

  var CONFIG = {
    url: global.CONFIG.supabase.url,
    key: global.CONFIG.supabase.key,

    /* 짧은 아이디 뒤에 붙이는 고정 도메인.
       바꾸면 기존 계정으로 로그인할 수 없다. */
    idDomain: global.CONFIG.idDomain
  };

  var STORAGE_KEY = global.CONFIG.storagePrefix + 'auth';

  var client = null;

  function init() {
    if (client) return client;
    if (!global.supabase || !global.supabase.createClient) {
      throw new Error('Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    client = global.supabase.createClient(CONFIG.url, CONFIG.key, {
      auth: {
        persistSession: true,        /* 새로고침해도 로그인 유지 */
        autoRefreshToken: true,
        detectSessionInUrl: false,   /* 주소창으로 로그인하지 않는다 */
        storageKey: STORAGE_KEY
      }
    });
    return client;
  }

  /* 'jonghyeon' → 'jonghyeon@jonghyeont.local'
     전체 주소를 그대로 쳐도 받아준다. */
  function toEmail(input) {
    var v = String(input || '').trim().toLowerCase();
    if (!v) return '';
    if (v.indexOf('@') !== -1) return v;
    return v + '@' + CONFIG.idDomain;
  }

  /* 'jonghyeon@jonghyeont.local' → 'jonghyeon' (화면에 보여줄 때) */
  function toShortId(email) {
    var v = String(email || '');
    var at = v.indexOf('@');
    return at === -1 ? v : v.slice(0, at);
  }

  /* 약속이 정해진 시간 안에 끝나지 않으면 실패로 돌린다.
     화면이 말없이 멈춰 있는 것보다 오류를 보여 주는 편이 낫다. */
  function withTimeout(promise, ms, message) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      }, ms);
      promise.then(function (v) {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve(v);
      }, function (e) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(e);
      });
    });
  }

  /* 로그인.
     응답에 세션이 들어 있으므로 뒤이어 getSession() 을 부르지 않는다.
     signInWithPassword 가 내부 잠금을 쥔 상태에서 then 이 돌기 때문에,
     그 안에서 다른 auth 호출을 하면 잠금을 서로 기다리다 멈춘다. */
  function signIn(id, password) {
    var email = toEmail(id);
    if (!email) return Promise.reject(new Error('아이디를 입력해 주세요.'));
    if (!password) return Promise.reject(new Error('비밀번호를 입력해 주세요.'));

    var call;
    try {
      call = init().auth.signInWithPassword({ email: email, password: password });
    } catch (e) {
      return Promise.reject(translate(e));
    }

    return withTimeout(call, 20000, '서버 응답이 없습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.')
      .then(function (res) {
        if (res.error) throw translate(res.error);
        if (!res.data || !res.data.session) {
          throw new Error('로그인은 됐지만 세션을 받지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        }
        return res.data.session;
      });
  }

  function signOut() {
    return init().auth.signOut();
  }

  function getSession() {
    return withTimeout(
      init().auth.getSession(),
      15000,
      '로그인 상태를 확인하지 못했습니다.'
    ).then(function (r) {
      return r.data ? r.data.session : null;
    });
  }

  /* 콜백은 라이브러리가 내부 잠금을 쥔 채로 부른다.
     그 안에서 auth 함수를 다시 부르면 멈추므로, 한 박자 뒤로 미뤄 실행한다. */
  function onAuthChange(fn) {
    init().auth.onAuthStateChange(function (event, session) {
      setTimeout(function () {
        try { fn(event, session); }
        catch (e) { console.error('auth 콜백 오류', e); }
      }, 0);
    });
  }

  /* Supabase 오류 메시지를 우리 상황에 맞게 바꾼다 */
  function translate(err) {
    var m = String(err && err.message || '');

    if (/Invalid login credentials/i.test(m)) {
      return new Error('아이디 또는 비밀번호가 맞지 않습니다.');
    }
    if (/Email not confirmed/i.test(m)) {
      return new Error('계정이 아직 확인되지 않았습니다. Supabase 에서 Auto Confirm 을 켜 주세요.');
    }
    if (/Signups not allowed|signup is disabled/i.test(m)) {
      return new Error('가입이 막혀 있습니다. 선생님께 계정 생성을 요청해 주세요.');
    }
    if (/rate limit|too many/i.test(m)) {
      return new Error('시도가 너무 잦습니다. 잠시 뒤에 다시 해 주세요.');
    }
    if (/Failed to fetch|NetworkError/i.test(m)) {
      return new Error('서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    return new Error(m || '로그인에 실패했습니다.');
  }

  global.SB = {
    VERSION: APP_VERSION,
    CONFIG: CONFIG,
    init: init,
    get client() { return init(); },
    toEmail: toEmail,
    toShortId: toShortId,
    withTimeout: withTimeout,
    signIn: signIn,
    signOut: signOut,
    getSession: getSession,
    onAuthChange: onAuthChange
  };

})(window);
