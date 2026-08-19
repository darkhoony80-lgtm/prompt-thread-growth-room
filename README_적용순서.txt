Prompt Thread 수정본: 인증 안정화 + 말투 + 후보 보존

교체 파일
1. api/content-router.js
2. post-auto-v1.js
3. lib-threads-session.js
4. api/threads/oauth/callback.js
5. api/system-status.js

1) Threads 인증
- OAuth 후 단기 토큰을 장기 토큰으로 즉시 교환
- 장기 토큰 만료일 저장
- 앱 상태 확인 시 만료 7일 이내면 자동 갱신
- 새 Serverless Function 추가 없음
- 이번 배포 뒤 Threads를 한 번 다시 연결해야 장기 토큰 방식이 적용됨

2) 게시물 말투
- 자연스러운 반말
- 존댓말/보도자료체/딱딱한 기사체 지양
- 짧은 줄바꿈 + 이모지 1~3개
- AI TIP: 짧고 영리한 반말
- AI PROMPT: 한국어 설명은 반말, 영어 프롬프트는 전문 영어 유지
- FOOD PICK: 맛깔나고 가벼운 반말
- HOT ISSUE: 쉽게 풀어주는 반말
- 재난/전쟁/피해 사건은 장난스러운 표현 금지

3) 후보 보존
- 후보 4개를 localStorage(pt_drafts_v6)에 저장
- Threads 재연결/새로고침 뒤에도 복원
- 이미지 생성 성공 즉시 최종 썸네일을 Blob에 저장
- 이미지 URL도 후보와 함께 보존
- 사용자가 '비우기'를 눌러야 해당 후보 삭제

4) 이미지 생성
- 현재 정상 작동하는 gemini-3.1-flash-image + imageConfig 4:5 / 1K 유지
- 이미지 생성 방식 자체는 변경하지 않음

적용 순서
1. ZIP 압축 해제
2. GitHub main에서 위 5개 파일을 동일 경로로 덮어쓰기
3. Commit changes
4. Vercel 최신 Deployment Ready 확인
5. Ctrl+Shift+R
6. Threads 한 번 재연결
7. 콘텐츠 하나 생성
8. 새로고침 후 남아 있는지 확인
9. 이미지 생성
10. 다시 새로고침 후 이미지가 남아 있는지 확인
11. 즉시 게시 1건 테스트
