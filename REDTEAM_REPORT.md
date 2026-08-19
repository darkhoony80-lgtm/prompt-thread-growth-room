# Red Team 점검

- 5번째 '실험형' 카테고리 제거. 4개 축만 허용.
- AI TIP 중복 방지: 같은 날 비슷한 효용의 AI TIP 2개 금지.
- AI TIP은 전문 용어 + 영어 한 줄 명령어가 없으면 탈락 규칙.
- AI PROMPT는 상세 영어 프롬프트를 핵심 자산으로 강제.
- FOOD_PICK은 Google Search 조사 자료에서만 식당/메뉴 사용.
- FOOD_PICK 이미지가 실제 식당 사진으로 오인되지 않도록 AI 연출 이미지 표기.
- HOT_ISSUE는 AI 편향 금지, 최근 뉴스 Google Search grounding.
- 이미지 생성은 Google 공식 @google/genai SDK의 interactions.output_image 및 steps fallback 모두 지원.
- 이미지 생성 실패 시 interaction status/model/step_types를 로그에 기록.
- Vercel Blob은 최신 SDK의 OIDC 자동 인증 사용. 장기 read-write token 의존 제거.
- 즉시 게시 전 최종 썸네일 존재를 강제.
- 게시 API도 approved image_url 없으면 거부.
- 댓글 2일 필터 및 20개 제한 제거, 병렬 처리 금지.
