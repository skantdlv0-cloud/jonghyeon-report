/* ============================================================
   config.js — 관리 시스템 접속 설정

   잘 바뀌지 않는 값들이다. 선생님 표기·학원명·문의 연락처는
   여기가 아니라 assets/brand.js 에 있다.

   여기 적힌 publishable key 는 공개돼도 되는 키다.
   단, 그것은 모든 표에 RLS 가 켜져 있을 때만 성립한다.
   (supabase/schema.sql 참고)
   secret key · service_role key 는 절대 여기 넣지 않는다.

   깃허브 토큰도 여기 넣지 않는다. 토큰은 ③ 발행 탭에서
   입력해 그 브라우저에만 저장된다.
   ============================================================ */

(function (global) {
  'use strict';

  global.CONFIG = {

    /* 로그인 화면 왼쪽 아래에 보인다.
       admin 파일을 고칠 때마다 이 값과 index.html 의 ?v= 를 함께 올린다.
       안 올리면 깃허브 페이지스 캐시 때문에 최대 10분간 옛 파일이 나간다. */
    version: '20260925g',

    /* 배포 주소. 끝에 / 를 붙이지 않는다. */
    siteUrl: 'https://skantdlv0-cloud.github.io/jonghyeon-report',

    /* ③ 발행 탭이 커밋을 올릴 저장소 */
    github: {
      owner:  'skantdlv0-cloud',
      repo:   'jonghyeon-report',
      branch: 'main'
    },

    supabase: {
      url: 'https://ikrsplmvwexhggibtkyb.supabase.co',
      key: 'sb_publishable_aZ0rETJraZ0eUpl0P9331g_kK0wad1h'
    },

    /* 짧은 아이디 뒤에 붙는 고정 도메인.
       바꾸면 기존 계정으로 로그인할 수 없다. */
    idDomain: 'jonghyeont.local',

    /* 로그인 칸에 흐리게 보이는 예시 */
    sampleId: 'jonghyeon',

    /* 브라우저 저장 이름 앞에 붙는다.
       깃허브 페이지스는 저장소가 달라도 주소 앞부분이 같아서
       (skantdlv0-cloud.github.io) 브라우저 저장소를 공유한다.
       다른 시스템과 겹치지 않는 값이어야 한다. */
    storagePrefix: 'kjh.'
  };

})(window);
