/* ============================================================
   brand.js — 선생님 표기 · 학원명 · 문의 연락처

   여기 한 곳만 고치면 아래가 전부 같이 바뀐다.
     · 레포트 화면 제목      (김종현 국어 주간 학습 레포트)
     · 레포트 종합 코멘트 제목
     · 레포트 푸터 서명·학원명·문의 번호
     · 관리 시스템 화면 제목

   중요 — 이 파일은 이미 발행한 레포트도 함께 읽는다.
   그래서 전화번호를 여기서 고치면 예전에 보낸 링크의 푸터까지
   같이 바뀐다. 레포트를 다시 발행할 필요가 없다.

   딱 하나 예외가 있다. 카카오톡·문자 미리보기 제목은
   카카오 크롤러가 자바스크립트를 읽지 않아서 발행 시점에
   글자로 박아 넣는다. ogEmoji 를 바꾸면 그 뒤에 발행하는
   레포트부터 적용된다. (이미 보낸 링크의 미리보기는 그대로)
   ============================================================ */

(function (global) {
  'use strict';

  var BRAND = {
    /* 화면에 보이는 선생님 표기 */
    teacherName:  '김종현',
    subject:      '국어',

    /* 레포트 푸터 */
    signEmoji:    '✒️',
    footerThanks: '이번주도 함께해주셔서 감사합니다',
    brandName:    'MARATHON STUDY',
    contactName:  '김종현 선생님',
    contactPhone: '010-7200-9055',   /* 화면에 보이는 번호 */
    contactTel:   '01072009055',     /* 눌러서 거는 번호 — 숫자만 */

    /* 카카오톡·문자 미리보기 제목 맨 앞 (발행 시점에 박힌다) */
    ogEmoji:      '📘'
  };

  /* 레포트 제목 — '김종현 국어' */
  BRAND.reportBrand = BRAND.teacherName + ' ' + BRAND.subject;

  /* 레포트 전체 제목 — '김종현 국어 주간 학습 레포트' */
  BRAND.reportTitle = BRAND.reportBrand + ' 주간 학습 레포트';

  /* 관리 시스템 제목 — '김종현 관리 시스템' */
  BRAND.adminTitle = BRAND.teacherName + ' 관리 시스템';

  /* 종합 코멘트 카드 제목 — '김종현 종합 코멘트' */
  BRAND.commentTitle = BRAND.teacherName + ' 종합 코멘트';

  /* 푸터 서명 — '김종현 드림' */
  BRAND.signName = BRAND.teacherName + ' 드림';

  global.BRAND = BRAND;

  /* ------------------------------------------------------------
     data-brand 속성이 붙은 자리를 채운다.

       <span data-brand="brandName"></span>        → 글자를 넣는다
       <a    data-brand-tel></a>                   → 번호 + tel: 링크

     레포트 푸터가 이 방식으로 그려진다. 본문도 어차피 자바스크립트로
     그리므로, 푸터만 정적으로 둘 이유가 없다.
     ------------------------------------------------------------ */
  function fill() {
    var nodes = document.querySelectorAll('[data-brand]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-brand');
      if (BRAND[key] != null) nodes[i].textContent = BRAND[key];
    }

    var tels = document.querySelectorAll('[data-brand-tel]');
    for (var j = 0; j < tels.length; j++) {
      tels[j].textContent = BRAND.contactPhone;
      tels[j].setAttribute('href', 'tel:' + BRAND.contactTel);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fill);
  } else {
    fill();
  }

  BRAND.fill = fill;

})(window);
