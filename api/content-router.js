import {GoogleGenAI} from '@google/genai';
import {put} from '@vercel/blob';

const TEXT_MODEL='gemini-3.6-flash';
const IMAGE_MODEL='gemini-3.1-flash-image';
const GENERATE_URL=`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`;
const LABELS={
  AI_PROMPT:'AI 프롬프트',
  AI_TIP:'AI 활용 팁',
  FOOD_PICK:'오늘 뭐 먹지?',
  HOT_ISSUE:'🔥 오늘의 핫이슈'
};

function send(res,status,body){
  res.status(status).json(body);
}
function stripFence(s=''){
  return String(s).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
}
function parseJson(s=''){
  const raw=stripFence(s);
  try{return JSON.parse(raw)}catch{}
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a>=0&&b>a)return JSON.parse(raw.slice(a,b+1));
  throw new Error('INVALID_JSON');
}
function clampHook(v=''){
  return [...String(v).replace(/\s+/g,' ').trim()].slice(0,14).join('');
}
function cleanCandidate(x,i){
  const allowed=Object.keys(LABELS);
  const category=allowed.includes(x?.category)?x.category:'AI_PROMPT';
  const hooks=(Array.isArray(x?.hook_candidates)?x.hook_candidates:[])
    .map(clampHook).filter(Boolean).slice(0,5);
  const hook=clampHook(x?.hook||hooks[0]||'오늘 이거 봐');
  if(!hooks.includes(hook))hooks.unshift(hook);
  const s=x?.score||{};
  return {
    id:`c-${Date.now()}-${i}-${Math.random().toString(36).slice(2,7)}`,
    category,
    category_label:LABELS[category],
    topic:String(x?.topic||'').trim().slice(0,100),
    hook,
    hook_candidates:hooks.slice(0,5),
    body:String(x?.body||'').trim().slice(0,500),
    reason:String(x?.reason||'').trim().slice(0,180),
    image_brief:String(x?.image_brief||'').trim().slice(0,1200),
    source_notes:Array.isArray(x?.source_notes)?x.source_notes.map(v=>String(v).slice(0,220)).slice(0,5):[],
    score:{
      stop:Number(s.stop)||0,
      save:Number(s.save)||0,
      share:Number(s.share)||0,
      comment:Number(s.comment)||0,
      follow:Number(s.follow)||0,
      novelty:Number(s.novelty)||0,
      visual:Number(s.visual)||0,
      total:Number(s.total)||0
    }
  };
}
async function generateJson(key,prompt,temp=.9){
  const r=await fetch(`${GENERATE_URL}?key=${encodeURIComponent(key)}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      contents:[{parts:[{text:prompt}]}],
      generationConfig:{temperature:temp,responseMimeType:'application/json'}
    })
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j?.error?.message||'GEMINI_GENERATE_FAILED');
  const text=(j?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('');
  return parseJson(text);
}
async function groundedResearch(ai,input){
  const interaction=await ai.interactions.create({
    model:TEXT_MODEL,
    input,
    tools:[{type:'google_search'}]
  });
  return String(interaction.output_text||'').slice(0,14000);
}
async function researchHotIssues(ai){
  return groundedResearch(ai,`현재 한국 시간 기준으로 오늘 가장 화제가 큰 이슈를 조사해.
AI 뉴스에 편향하지 말고 환율/증시/물가/정책/사회/사건사고/전쟁/국제/날씨/태풍/폭우/폭염/지진/스포츠/연예/자동차/부동산/과학/테크 전체를 살펴봐.
최근 24시간을 최우선, 필요하면 48시간까지만.
여러 출처로 교차 확인되는 사실만 사용하고 루머는 제외.
오늘 Threads에서 사람들이 가장 많이 궁금해하거나 대화할 가치가 큰 것 위주로 최대 8개.
각 이슈마다 핵심 사실, 왜 오늘 중요한지, 숫자/시간 등 주의할 팩트를 짧게 정리해.
피해자가 있는 사건은 선정적 묘사를 피하고 공익적 정보 중심으로.`);
}
async function researchFood(ai){
  return groundedResearch(ai,`한국 전국에서 실제 영업 중인 것으로 확인되는 식당/맛집 후보를 조사해.
서울에 편향하지 말고 부산/대구/대전/광주/인천/울산/제주/강릉/전주/수원 등 전국을 넓게 고려해.
점심, 저녁, 혼밥, 해장, 회식, 술자리 안주, 여행 한 끼 같은 상황별로 추천할 만한 곳을 최대 12곳.
각 항목은 정확한 식당명, 지역, 대표적으로 알려진 메뉴, 왜 추천할 만한지까지만.
검색으로 실제 존재와 현재 정보를 확인하기 어려운 곳은 제외.
가격/영업시간은 변동 가능성이 크므로 확실하지 않으면 쓰지 마.`);
}
function ideationPrompt({hot,food,feedback,performance}){
  return `너는 한국 Threads 계정을 팔로워 성장시키는 콘텐츠 편집장이다.
AI는 제작 도구일 뿐 모든 게시물의 주제가 아니다.
내부 아이디어를 16개 만든 뒤 JSON으로 반환한다. 최종 선정은 다음 단계가 한다.

콘텐츠 축은 정확히 네 종류뿐이다.

1) AI_PROMPT
목표: "이 프롬프트로 이런 결과가 나온다고?"라는 저장 욕구.
본문의 핵심 자산은 상세한 영어 프롬프트다.
짧고 흔한 "cinematic, warm lighting" 수준 금지.
피사체/행동/환경/시간/카메라/렌즈/구도/조명/색감/질감/현실성/금지요소 중 필요한 것을 구체적으로 설계.
500자 제한 안에서 복사해서 바로 써볼 수 있을 만큼 정교하게 압축.
한국어 소개 1~2문장 + 영어 프롬프트가 중심.
특정 서비스 이름은 그 서비스 전용 기능을 실제 사용하는 경우가 아니면 억지로 붙이지 않는다.

2) AI_TIP
목표: "이런 짧은 명령어가 있었어?"라는 발견감.
일반인은 잘 모르지만 AI 설계자/고급 사용자가 쓰는 짧은 개념·명령어를 하나씩 소개한다.
예시 방향: RED TEAM, STEELMAN, PRE-MORTEM, EDGE CASES, COUNTEREXAMPLE, RUBRIC, DEVIL'S ADVOCATE, FIRST PRINCIPLES.
단, 예시만 매번 재탕하지 말고 새로운 전문 용어도 발굴.
"전문가처럼 답해줘", "결론부터 말해줘", "예시 2개" 같은 초급 팁은 절대 금지.
본문 형식: 낯선 용어 → 한 줄짜리 영어 명령어 → 아주 쉬운 한국어 설명 → 언제 쓰면 좋은지.
영어 명령어가 반드시 포함되어야 한다.

3) FOOD_PICK
목표: "오늘 뭐 먹지?"를 우리가 먼저 해결.
사용자에게 추천해달라고 묻지 않는다. 우리가 "오늘 점심은 내가 정해줄게", "오늘 저녁은 여기", "오늘 술안주는 이거"처럼 먼저 결론을 준다.
아래 Google Search 조사에서 실제 확인된 전국 식당만 사용한다.
식당명/지역/메뉴를 지어내지 않는다.
음식 이미지가 실제 해당 식당 사진이라고 오해되지 않도록 본문 끝에 짧게 "※ 이미지는 메뉴 이해를 돕는 AI 연출 이미지"를 넣는다.
전국 맛집 조사:
${food}

4) HOT_ISSUE
목표: 오늘 실제 세상에서 가장 중요한 한두 이슈를 쉽고 빠르게 전달.
AI 이슈를 우선하지 않는다.
아래 Google Search 조사 내용만 사실 재료로 사용하고 기사 제목을 복사하지 않는다.
환율/전쟁/사건사고/날씨/태풍 등 그날 가장 강한 이슈가 무엇이든 선택 가능.
본문: 무슨 일 → 왜 중요한지 → 우리가 알아둘 핵심. 선정적 표현과 확인되지 않은 숫자 금지.
오늘의 조사:
${hot}

[후킹]
각 아이디어마다 hook_candidates 5개.
6~10자 우선, 최대 14자. 기사 제목 복사 금지.
호기심/단정/반전/의문/놀라움 중 소재에 맞는 방식.
이미지 상단에서 1초 안에 읽혀야 한다.

[이미지 브리프]
모든 아이디어에 image_brief 작성.
4:5 세로형. 이미지 자체에는 글자/로고/워터마크/가짜 UI 금지.
상단 30%는 후킹을 나중에 정확한 한글로 합성할 여백.
중앙/하단은 핵심 비주얼.
AI_PROMPT는 그 프롬프트의 매력적인 결과물 자체를 보여준다.
AI_TIP은 뻔한 로봇/AI 뇌 대신 해당 개념을 시각적으로 상징화.
FOOD_PICK은 실제로 먹고 싶어지는 음식 중심. 특정 식당 실제 사진처럼 오인시키지 않는다.
HOT_ISSUE는 뉴스 편집 비주얼이되 실제 현장/피해자 사진처럼 오인시키는 재현 금지.

최근 취향 피드백:
${feedback||'없음'}

실제 게시 성과:
${performance||'없음'}

JSON만:
{"ideas":[{"category":"AI_TIP","topic":"...","hook_candidates":["...","...","...","...","..."],"body":"...","reason":"...","image_brief":"...","source_notes":[]}]}`;
}
function selectionPrompt(ideas){
  return `너는 냉정한 Threads 편집국장이다. 아래 ${ideas.length}개 후보에서 최종 4개를 선정하거나 약한 후보는 같은 소재를 개선해라.

각 항목 0~10:
stop 스크롤 정지
save 저장
share 리포스트/전송
comment 댓글
follow 팔로우 전환
novelty 신선도
visual 이미지 파워
total 100점 환산.

중요한 강제 규칙:
- 콘텐츠 축은 AI_PROMPT / AI_TIP / FOOD_PICK / HOT_ISSUE 네 개뿐.
- 최종 4개는 네 축에서 정확히 하나씩 선정한다.
- AI_TIP은 짧은 전문 용어와 영어 명령어가 없으면 탈락.
- AI_PROMPT는 영어 프롬프트가 충분히 세부적이지 않으면 탈락.
- FOOD_PICK은 조사된 실제 식당/메뉴 정보가 있어야 통과.
- HOT_ISSUE는 팩트 메모 범위를 넘겨 지어내면 탈락.
- 이미지가 뻔하면 탈락 또는 image_brief 재작성.
- hook은 6~10자 우선, 최대 14자.
- 네 후보가 서로 다른 효용과 분위기를 가져 피드 전체가 AI 이야기로 도배되지 않게 한다.

후보:
${JSON.stringify(ideas).slice(0,32000)}

JSON만:
{"candidates":[{"category":"AI_TIP","topic":"...","hook":"...","hook_candidates":["..."],"body":"...","reason":"...","image_brief":"...","source_notes":[],"score":{"stop":0,"save":0,"share":0,"comment":0,"follow":0,"novelty":0,"visual":0,"total":0}}]}`;
}

async function actionGenerate(req,res){
  const key=process.env.GEMINI_API_KEY;
  if(!key)return send(res,503,{ok:false,error:'GEMINI_NOT_CONFIGURED'});
  const feedback=String(req.body?.feedback||'').slice(0,4000);
  const performance=String(req.body?.performance||'').slice(0,5000);
  try{
    const ai=new GoogleGenAI({apiKey:key});
    const [hot,food]=await Promise.all([researchHotIssues(ai),researchFood(ai)]);
    const draft=await generateJson(key,ideationPrompt({hot,food,feedback,performance}),1.0);
    const ideas=(Array.isArray(draft?.ideas)?draft.ideas:[]).slice(0,20);
    if(ideas.length<10)throw new Error('IDEA_POOL_TOO_SMALL');
    const chosen=await generateJson(key,selectionPrompt(ideas),.72);
    const raw=(Array.isArray(chosen?.candidates)?chosen.candidates:[])
      .map(cleanCandidate).filter(x=>x.body&&x.hook);
    const order=['AI_PROMPT','AI_TIP','FOOD_PICK','HOT_ISSUE'];
    const items=order.map(category=>
      raw.filter(x=>x.category===category).sort((a,b)=>b.score.total-a.score.total)[0]
    ).filter(Boolean);
    if(items.length!==4)throw new Error('FINAL_FOUR_PILLARS_INVALID');
    return send(res,200,{
      ok:true,engine:'growth-v4-four-pillars',
      grounded_hot_issues:true,grounded_food:true,
      internal_idea_count:ideas.length,items
    });
  }catch(e){
    console.error('[CONTENT_GENERATE_FAILED]',JSON.stringify({message:e.message}));
    return send(res,502,{ok:false,error:'CONTENT_GENERATE_FAILED',detail:e.message});
  }
}

function textFromResponse(response){
  return (response?.candidates?.[0]?.content?.parts||[])
    .map(part=>part?.text||'').join('').trim();
}
async function imageDirector(ai,candidate,variation){
  const instruction=`너는 세계적 소셜미디어 아트디렉터다.
다음 Threads 후보에 맞는 Gemini 이미지 생성용 영어 프롬프트 하나만 작성해.

카테고리: ${candidate.category}
소재: ${candidate.topic}
본문: ${candidate.body}
후킹(이미지에 직접 쓰지 않음): ${candidate.hook}
브리프: ${candidate.image_brief}
재생성 번호: ${variation}

절대 규칙:
4:5 portrait.
이미지 안에 글자/숫자/로고/워터마크/가짜 UI를 생성하지 않는다.
상단 약 30%는 나중에 정확한 한국어 후킹을 합성할 수 있도록 차분한 negative space.
핵심 피사체는 중앙/하단.
모바일 피드에서 즉시 이해되는 강한 단일 비주얼.
뻔한 AI 로봇, 푸른 회로판, 홀로그램 뇌를 기본값으로 쓰지 않는다.
AI_PROMPT: 제공 프롬프트의 결과물이 욕망을 만들 정도로 완성도 높게.
AI_TIP: 개념을 상징적으로 보여주되 실제 읽을 수 있는 UI나 텍스트는 만들지 않는다.
FOOD_PICK: 실제 특정 식당 사진을 복제하지 말고 해당 메뉴를 매우 먹음직스럽게 연출한 일반적 음식 비주얼.
HOT_ISSUE: 실제 보도사진/피해자/특정 현장으로 오인되지 않는 프리미엄 편집기사형 상징 비주얼.
영어 이미지 프롬프트만 출력.`;

  const response=await ai.models.generateContent({
    model:TEXT_MODEL,
    contents:instruction,
    config:{temperature:.8}
  });
  return textFromResponse(response).slice(0,3000);
}
function extractInlineImage(response){
  const parts=response?.candidates?.[0]?.content?.parts||[];
  for(const part of parts){
    if(part?.inlineData?.data){
      return {
        data:part.inlineData.data,
        mime_type:part.inlineData.mimeType||'image/png'
      };
    }
  }
  return null;
}
async function actionImage(req,res){
  const key=process.env.GEMINI_API_KEY;
  const candidate=req.body?.candidate;
  if(!key)return send(res,503,{ok:false,error:'GEMINI_NOT_CONFIGURED'});
  if(!candidate)return send(res,400,{ok:false,error:'CANDIDATE_REQUIRED'});
  const variation=Number(req.body?.variation)||1;
  try{
    const ai=new GoogleGenAI({apiKey:key});
    const prompt=await imageDirector(ai,candidate,variation);
    if(!prompt)throw new Error('IMAGE_DIRECTOR_EMPTY');
    const response=await ai.models.generateContent({
      model:IMAGE_MODEL,
      contents:prompt,
      config:{
        responseModalities:['TEXT','IMAGE'],
        responseFormat:{
          image:{
            aspectRatio:'4:5',
            imageSize:'1K'
          }
        }
      }
    });
    const img=extractInlineImage(response);
    if(!img){
      const parts=response?.candidates?.[0]?.content?.parts||[];
      console.error('[GEMINI_IMAGE_MISSING]',JSON.stringify({
        candidate_count:response?.candidates?.length||0,
        parts_count:parts.length,
        part_types:parts.map(p=>p?.inlineData?'inlineData':p?.text?'text':'unknown'),
        finish_reason:response?.candidates?.[0]?.finishReason||null
      }));
      throw new Error('GEMINI_IMAGE_MISSING');
    }
    return send(res,200,{ok:true,...img,director_prompt:prompt});
  }catch(e){
    console.error('[CONTENT_IMAGE_FAILED]',JSON.stringify({message:e.message}));
    return send(res,502,{ok:false,error:'CONTENT_IMAGE_FAILED',detail:e.message});
  }
}

function decodeImage(dataUrl=''){
  const m=String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if(!m)return null;
  return {mime:m[1],buffer:Buffer.from(m[2],'base64')};
}
async function actionStoreImage(req,res){
  const d=decodeImage(req.body?.data_url);
  if(!d)return send(res,400,{ok:false,error:'IMAGE_DATA_REQUIRED'});
  if(d.buffer.length>4_000_000)return send(res,413,{ok:false,error:'IMAGE_TOO_LARGE'});
  const id=String(req.body?.candidate_id||Date.now())
    .replace(/[^a-zA-Z0-9_-]/g,'').slice(0,70);
  const ext=d.mime==='image/png'?'png':d.mime==='image/webp'?'webp':'jpg';
  try{
    const blob=await put(`threads-growth/${Date.now()}-${id}.${ext}`,d.buffer,{
      access:'public',
      addRandomSuffix:true,
      contentType:d.mime,
      cacheControlMaxAge:31536000
    });
    return send(res,200,{ok:true,url:blob.url,pathname:blob.pathname});
  }catch(e){
    console.error('[BLOB_UPLOAD_FAILED]',JSON.stringify({message:e.message}));
    return send(res,502,{ok:false,error:'BLOB_UPLOAD_FAILED',detail:e.message});
  }
}

async function actionVariant(req,res){
  const key=process.env.GEMINI_API_KEY;
  const x=req.body?.candidate;
  if(!key)return send(res,503,{ok:false,error:'GEMINI_NOT_CONFIGURED'});
  if(!x)return send(res,400,{ok:false,error:'CANDIDATE_REQUIRED'});
  const prompt=`같은 카테고리와 핵심 소재는 유지하되 완전히 다른 각도로 Threads 콘텐츠를 재작성해.
AI_TIP이면 짧은 전문 용어 + 영어 한 줄 명령어가 필수.
AI_PROMPT면 상세 영어 프롬프트가 핵심.
FOOD_PICK이면 기존 검증된 식당/메뉴 사실을 바꾸거나 지어내지 말 것.
HOT_ISSUE이면 source_notes의 사실 범위를 넘지 말 것.
hook 6~10자 우선 최대 14자. 본문 500자 이내.
이미지 브리프도 새 각도에 맞게 변경.
기존:${JSON.stringify(x).slice(0,6000)}
JSON만: {"hook":"...","hook_candidates":["...","...","...","...","..."],"body":"...","reason":"...","image_brief":"..."}`;
  try{
    const v=await generateJson(key,prompt,1);
    return send(res,200,{ok:true,item:{
      ...x,
      hook:clampHook(v.hook||x.hook),
      hook_candidates:Array.isArray(v.hook_candidates)?v.hook_candidates.slice(0,5):x.hook_candidates,
      body:String(v.body||x.body).slice(0,500),
      reason:String(v.reason||x.reason).slice(0,180),
      image_brief:String(v.image_brief||x.image_brief).slice(0,1200)
    }});
  }catch(e){
    return send(res,502,{ok:false,error:'VARIANT_FAILED',detail:e.message});
  }
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return send(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});

  const action=String(req.query?.action||req.body?.action||'').trim();

  if(action==='generate')return actionGenerate(req,res);
  if(action==='image')return actionImage(req,res);
  if(action==='store-image')return actionStoreImage(req,res);
  if(action==='variant')return actionVariant(req,res);

  return send(res,400,{
    ok:false,
    error:'UNKNOWN_CONTENT_ACTION',
    allowed:['generate','image','store-image','variant']
  });
}
