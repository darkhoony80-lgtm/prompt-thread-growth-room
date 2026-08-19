# 최종 통합 수정본 적용

이 ZIP은 기존 `index.html`을 교체하지 않습니다.
현재 index.html은 이미 `/post-auto-v1.js`를 로드하고 있으므로 아래 파일만 저장소 루트에 업로드하면 됩니다.

- api/content/generate.js
- api/content/variant.js
- api/content/image.js
- api/content/store-image.js
- api/threads/publish.js
- api/threads/comments.js
- post-auto-v1.js
- package.json

## 확정된 4개 콘텐츠 축
1. AI 프롬프트: 상세 영문 프롬프트
2. AI 활용 팁: RED TEAM 같은 짧고 낯선 전문 명령어 + 영어 한 줄 명령어
3. 오늘 뭐 먹지?: 전국 실제 맛집/메뉴를 Google Search로 확인하고 우리가 먼저 추천
4. 오늘의 핫이슈: 당일 뉴스 전체 분야에서 가장 강한 이슈를 Google Search로 확인

## 이미지
- Gemini 3.1 Flash Image 공식 SDK 사용
- 4:5, 1K
- 이미지 자체에는 텍스트 생성 금지
- 브라우저 Canvas에서 정확한 한글 후킹 합성
- 이미지 재생성 및 후킹 재적용 가능
- 눈으로 확인하기 전 발행 대기/즉시 게시 불가

## Blob
Vercel Blob 연결은 OIDC 상태 그대로 사용합니다.
최신 `@vercel/blob` SDK는 Vercel 프로젝트에서 OIDC 인증을 자동 사용하므로 별도의 BLOB_READ_WRITE_TOKEN 검사를 넣지 않았습니다.

## 댓글
- 최근 2일
- 20개 제한 제거
- 기존 답장 제외
- 스팸/욕설 제외
- 전체 미응답을 500ms 간격으로 한 개씩 처리

## 업로드 후 검증
1. GitHub main에 업로드/교체
2. Vercel Production Ready
3. 후보 생성
4. AI TIP에 영어 한 줄 명령어가 포함되는지 확인
5. FOOD_PICK에 실제 식당명이 나오는지 확인
6. HOT_ISSUE가 AI 뉴스에 편향되지 않는지 확인
7. 이미지 1개 생성
8. 이미지 다시 생성
9. 한글 후킹 적용
10. 발행 대기
11. 이미지+본문 Threads 실제 게시 1건
12. 댓글 최근 2일/일괄 전체 수 확인
