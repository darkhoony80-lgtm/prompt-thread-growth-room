PROMPT THREAD GROWTH ROOM - 통합본 설치 안내

이 ZIP은 댓글 관리 수정 + 게시물 자동생성 V1 파일을 한 패키지에 합친 통합본입니다.

[포함 기능]
1. 댓글 관리
- 최근 2일 댓글만 표시
- 기존 답장 완료 상태 유지
- 스팸/욕설은 일괄 답장에서 제외
- 기존 20개 제한 제거
- 미응답 전체를 일괄 답장 대상으로 사용
- API 보호를 위해 기존 순차 처리 속도 유지

2. 게시물 자동생성 V1
- AI 프롬프트 / AI 활용 팁 / 오늘의 핫이슈 / 재미·공감형 / 실험적인 콘텐츠
- Gemini 후보 5개 생성
- 여러 후보 👍 채택 가능
- 👎 피드백 저장
- 발행 대기함
- 텍스트 즉시 Threads 게시
- 4:5 Gemini 이미지 생성 및 후킹 미리보기
- 후킹 6~10자 우선, 최대 14자
- AI 이미지에는 글자를 직접 생성하지 않음

[GitHub에 업로드할 파일]
ZIP을 풀면 저장소 루트 기준으로 다음 구조가 나옵니다.

api/
  content/
    generate.js
    image.js
  threads/
    comments.js
    publish.js
post-auto-v1.js
INDEX_HTML_PATCH.txt
README_INSTALL.txt
README_INTEGRATED.txt

[중요]
index.html은 기존 정상 UI 전체를 덮어쓰지 않습니다.
INDEX_HTML_PATCH.txt의 댓글 관련 3개 수정사항을 적용한 뒤,
index.html의 </body> 바로 앞에 아래 한 줄을 추가하세요.

<script src="/post-auto-v1.js"></script>

[현재 이미지 즉시 게시 제한]
Threads 이미지 게시에는 Meta가 외부에서 읽을 수 있는 공개 image_url이 필요합니다.
현재 프로젝트에는 공개 이미지 저장소가 없으므로:
- 텍스트 후보: 즉시 게시 가능
- 이미지 후보: 생성/미리보기/발행 대기 가능
- 이미지 후보 즉시 게시: 공개 이미지 저장소 연결 전까지 차단

다음 단계에서 Vercel Blob 등 공개 이미지 저장소를 연결하면 이미지 즉시 게시까지 완성할 수 있습니다.

[업로드 후]
main 브랜치에 반영되면 Vercel이 자동 배포합니다.
배포 완료 후 운영 사이트에서 댓글 관리와 게시물 자동생성 화면을 각각 확인하세요.
