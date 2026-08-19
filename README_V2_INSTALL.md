# Prompt Thread Growth Engine V2 통합본

## 반영 내용
- 5축: AI 프롬프트 / AI 활용 팁 / 오늘의 핫이슈 / 재미·공감형 / 실험적인 콘텐츠
- Google Search grounding으로 최신 핫이슈 조사, AI 뉴스 편향 금지
- 내부 아이디어 풀 → 평가/재작성 → 최종 5개
- 고급 AI 프롬프트, 영어 원문 GPT 명령어 시리즈, 생활/음식 선제 추천, 실험형 다양성
- 후킹 5개 내부 생성, 6~10자 우선/최대14자
- 모든 최종 후보 4:5 이미지 검수 필수
- Gemini 아트디렉터 → 글자 없는 Gemini 이미지 → Canvas 정확한 한글 후킹 합성
- 이미지 다시 생성, 후킹만 재적용, 다른 버전 생성
- 최종 이미지를 눈으로 확인하기 전에는 발행 대기/즉시 게시 불가
- 승인 이미지는 Vercel Public Blob에 업로드 후 Threads IMAGE 게시
- 👍 여러 후보 모두 발행 대기 가능
- 게시 성과 + 👍/👎 피드백을 다음 생성에 참고
- 댓글 최근 2일, 기존 답장 제외, 20개 제한 제거, 미응답 전체를 500ms 간격 순차 답장

## GitHub 적용
이 ZIP은 압축을 풀면 바로 파일이 나옵니다. 저장소 루트에 폴더 구조 그대로 업로드하고 같은 경로 파일은 교체하세요.

변경/추가 파일:
- api/content/generate.js
- api/content/variant.js
- api/content/image.js
- api/content/store-image.js
- api/threads/publish.js
- api/threads/comments.js
- post-auto-v1.js  (파일명 유지, 내부는 V2)
- package.json

현재 index.html이 이미 `<script src="/post-auto-v1.js"></script>`를 불러오므로 index.html 추가 수정은 필요 없습니다.

## Vercel Blob 설정 1회 필수
Vercel 프로젝트 → Storage → Create Database → Blob → Public으로 생성하고 현재 프로젝트에 연결하세요.
`BLOB_READ_WRITE_TOKEN` 환경변수가 추가됐는지 확인한 뒤 새 Production 배포를 하세요.

Blob이 없어도 후보/이미지/썸네일 미리보기까지는 가능하지만 이미지 발행 대기와 즉시 게시 단계는 안전하게 중단됩니다.

## 검증 순서
1. GitHub 업로드/Commit
2. Vercel 배포 Ready
3. 후보 5개 생성
4. AI 외 핫이슈/생활 소재가 실제로 나오는지 확인
5. 5개 이미지 순차 생성
6. 한글 후킹, 2줄, 가독성 확인
7. 이미지 다시 생성
8. 후킹 수정 후 '후킹 적용'
9. 👍 발행 대기 1건
10. 대기함에서 실제 Threads 게시 1건
11. Threads에서 이미지+본문 확인
12. 댓글 최근 2일 및 일괄 버튼이 20 제한 없이 미응답 전체인지 확인
