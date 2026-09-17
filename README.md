# 김종현 국어 주간 학습 레포트

학생별 주간 학습 레포트를 만들어 링크로 보내는 정적 사이트.
서버 없이 GitHub Pages + Supabase 로 돌아간다.

- **생성기** `/admin/` — 선생님·조교만 사용. 로그인 필요.
- **레포트** `/r/{연도}/{월일}-{이름로마자}-{랜덤4자}.html` — 학부모가 링크로 연다. 로그인 없음.

## 폴더

```
admin/      생성기 화면 (명단 · 작성 · 발행 · 발송)
  config.js     ← 주소 · 저장소 · Supabase · 버전
assets/
  brand.js      ← 선생님 표기 · 학원명 · 문의 연락처
  report.css    레포트 공통 스타일 (고치면 이미 보낸 레포트도 같이 바뀐다)
  og-cover.png  카카오톡·문자 미리보기 썸네일 1200×630
template/
  report-template.html   레포트 원본. 생성기가 여기에 값을 채운다
supabase/
  schema.sql    표 9개 + RLS. SQL Editor 에서 한 번 실행
r/          발행된 레포트가 쌓이는 곳
preview/    확인용 화면 (배포 안 됨 · .gitignore)
tools/      썸네일 만드는 원본 (배포 안 됨 · .gitignore)
```

## 고칠 자리

| 바꿀 것 | 파일 |
|---|---|
| 선생님 표기 · 학원명 · 문의 번호 · 카톡 제목 이모티콘 | `assets/brand.js` |
| 배포 주소 · 저장소 · Supabase · 로그인 도메인 · 버전 | `admin/config.js` |
| 레포트 디자인 | `assets/report.css` |
| 생성기 화면 디자인 | `admin/style.css` |

`admin/` 안의 파일을 고칠 때는 **두 곳의 버전을 함께 올린다.**
`admin/config.js` 의 `version` 과 `admin/index.html` 의 `?v=…` (13군데).
안 올리면 GitHub Pages 캐시 때문에 최대 10분간 옛 파일이 나간다.

## 절대 하지 말 것

- 학부모 연락처를 이 저장소에 올리지 않는다. 명단은 Supabase 에만 둔다.
- Supabase **secret key · service_role key** 를 코드에 넣지 않는다.
  `config.js` 의 publishable key 만 넣는다. 그 키는 모든 표에 RLS 가 켜져 있을 때만 안전하다.
- 깃허브 토큰을 코드·백업 파일에 넣지 않는다. 토큰은 ③ 발행 탭에서 넣어 그 브라우저에만 저장된다.

운영 방법과 매주 순서는 `김종현_주간레포트_생성기_작업지시서.md` 에 있다. (저장소에 올라가지 않는다)
