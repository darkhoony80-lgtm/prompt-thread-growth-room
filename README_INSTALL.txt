PROMPT THREAD 성장 운영실 - 게시물 자동생성 V1 + 댓글 2일 패치

1. 이 ZIP의 폴더 구조 그대로 GitHub 저장소 루트에 업로드하세요.
   - api/content/generate.js
   - api/content/image.js
   - api/threads/publish.js
   - post-auto-v1.js

2. index.html 맨 아래 </body> 바로 전에 다음 한 줄을 추가하세요.
<script src="/post-auto-v1.js"></script>

3. 댓글 2일 패치는 이전 ZIP을 적용하세요.
   - api/threads/comments.js 교체
   - index.html의 20개 제한 제거 패치

4. 중요: 이미지 생성/미리보기까지는 Gemini API만으로 동작합니다.
   Threads IMAGE 게시에는 Meta가 읽을 수 있는 공개 image_url이 필요합니다.
   현재 프로젝트에는 영구 이미지 저장소가 없으므로, V1은 텍스트 후보만 '즉시 게시'가 실제 게시됩니다.
   이미지 후보에서 즉시 게시를 누르면 이유를 명확히 안내하고 게시를 막습니다.
   다음 단계에서 Vercel Blob을 연결하면 이미지 즉시 게시까지 완성할 수 있습니다.

5. AI 이미지 규칙
   - Gemini 3.1 Flash Image
   - 4:5
   - 이미지 자체에는 글자 생성 금지
   - 상단 28% 여백
   - 브라우저 미리보기에서 정확한 한글 후킹 오버레이
   - hook 14자 제한은 생성 API에서 강제

6. 후보 5개 축
   AI 프롬프트 / AI 활용 팁 / 오늘의 핫이슈 / 재미·공감형 / 실험적인 콘텐츠
   좋아요는 복수 채택 가능, localStorage 발행 대기함에 저장
   싫어요/채택/게시 피드백은 다음 생성 요청에 반영

7. 핫이슈 주의
   이 V1의 Gemini 호출 자체에는 별도의 뉴스 검색 도구가 연결되어 있지 않습니다.
   따라서 generate.js는 최신성을 확신할 수 없는 HOT_ISSUE를 지어내지 말고 다른 축으로 대체하도록 지시합니다.
   진짜 '오늘의 핫이슈 자동 수집'은 별도 뉴스/검색 API 연결 단계가 필요합니다.
