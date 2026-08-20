import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {put} from '@vercel/blob';

const TEXT_MODEL='gemini-3.6-flash';
const IMAGE_MODEL='gemini-3.1-flash-image';

const TEXT_URL=`https://generativelanguage.googleapis.com/v1beta/models/${TEXT_MODEL}:generateContent`;
const IMAGE_URL=`https://generativelanguage.googleapis.com/v1/models/${IMAGE_MODEL}:generateContent`;

const LABELS={
  AI_PROMPT:'AI 프롬프트',
  AI_TIP:'AI 활용 팁',
  FOOD_PICK:'오늘 뭐 먹지?',
  HOT_ISSUE:'🔥 오늘의 핫이슈'
};

function send(res,status,body){
  return res.status(status).json(body);
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
    topic_tag:String(x?.topic_tag||'').replace(/^#+/,'').trim().slice(0,80),
    topic_tag_candidates:(Array.isArray(x?.topic_tag_candidates)?x.topic_tag_candidates:[])
      .map(v=>String(v||'').replace(/^#+/,'').trim().slice(0,80))
      .filter(Boolean).slice(0,3),
    hook,
    hook_candidates:hooks.slice(0,5),
    body:String(x?.body||'').trim().slice(0,500),
    reply_prompt:String(x?.reply_prompt||'').trim(),
    reason:String(x?.reason||'').trim().slice(0,180),
    image_brief:String(x?.image_brief||'').trim().slice(0,1200),
    source_notes:Array.isArray(x?.source_notes)
      ?x.source_notes.map(v=>String(v).slice(0,220)).slice(0,5):[],
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

async function geminiGenerate(key,{
  model=TEXT_MODEL,
  prompt,
  temperature=.8,
  json=false,
  googleSearch=false,
  image=false,
  referenceImage=null
}){
  const url=model===IMAGE_MODEL?IMAGE_URL:TEXT_URL;
  const parts=[];
  if(referenceImage?.data){
    parts.push({inlineData:{mimeType:referenceImage.mimeType||'image/png',data:referenceImage.data}});
  }
  parts.push({text:prompt});
  const body={contents:[{parts}]};

  if(googleSearch){
    body.tools=[{google_search:{}}];
  }

  body.generationConfig={temperature};

  if(json){
    body.generationConfig.responseMimeType='application/json';
  }

  if(image){
    body.generationConfig={
      responseModalities:['TEXT','IMAGE'],
      imageConfig:{
        aspectRatio:'4:5',
        imageSize:'1K'
      }
    };
  }

  let lastError=null;
  for(let attempt=0;attempt<3;attempt++){
    const r=await fetch(url,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify(body)
    });
    const j=await r.json().catch(()=>({}));
    if(r.ok)return j;
    lastError=new Error(j?.error?.message||`GEMINI_HTTP_${r.status}`);
    if(![429,500,502,503,504].includes(r.status)||attempt===2)break;
    await new Promise(resolve=>setTimeout(resolve,1200*Math.pow(2,attempt)));
  }
  throw lastError||new Error('GEMINI_REQUEST_FAILED');
}

function textFromGemini(j){
  return (j?.candidates?.[0]?.content?.parts||[])
    .map(p=>p?.text||'')
    .join('')
    .trim();
}

async function generateJson(key,prompt,temp=.9){
  const j=await geminiGenerate(key,{
    model:TEXT_MODEL,
    prompt,
    temperature:temp,
    json:true
  });
  return parseJson(textFromGemini(j));
}

async function groundedResearch(key,input){
  const j=await geminiGenerate(key,{
    model:TEXT_MODEL,
    prompt:input,
    temperature:.3,
    googleSearch:true
  });
  return textFromGemini(j).slice(0,14000);
}

async function researchHotIssues(key,recentHotIssues=[]){
  const recent=(Array.isArray(recentHotIssues)?recentHotIssues:[])
    .slice(0,20)
    .map(v=>`${String(v?.topic||'').trim()} | ${String(v?.hook||'').trim()}`)
    .filter(v=>v.replace(/[|\s]/g,''));
  const exclude=recent.length
    ? `

우리 계정에서 최근 이미 다룬 핫이슈:
- ${recent.join('\n- ')}

중복 금지 규칙:
- 위 목록과 같은 사건/발표/결정/사고/정책은 표현만 바꿔 다시 고르지 않는다.
- 기사 제목이나 후킹 문구가 달라도 핵심 사건이 같으면 제외한다.
- 같은 회사/인물/기관이어도 실제 새로운 후속 사건이 발생했고 핵심 사실이 달라졌다면 허용한다.
- 검색 상위 결과가 이미 다룬 사건이면 그 다음으로 중요한 다른 이슈를 선택한다.`
    : '';

  return groundedResearch(key,`현재 한국 시간 기준으로 오늘 가장 화제가 큰 이슈를 조사해.
AI 뉴스에 편향하지 말고 환율/증시/물가/정책/사회/사건사고/전쟁/국제/날씨/태풍/폭우/폭염/지진/스포츠/연예/자동차/부동산/과학/테크 전체를 살펴봐.
최근 24시간을 최우선, 필요하면 48시간까지만.
여러 출처로 교차 확인되는 사실만 사용하고 루머는 제외.
오늘 Threads에서 사람들이 가장 많이 궁금해하거나 대화할 가치가 큰 것 위주로 최대 8개.
각 이슈마다 핵심 사실, 왜 오늘 중요한지, 숫자/시간 등 주의할 팩트를 짧게 정리해.
피해자가 있는 사건은 선정적 묘사를 피하고 공익적 정보 중심으로.
${exclude}`);
}

function koreaFoodContext(){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Seoul',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false,
    weekday:'short'
  }).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t)?.value||'';
  const hour=Number(get('hour'))||0;
  const minute=Number(get('minute'))||0;
  const weekday=get('weekday')||'';
  const hm=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;

  let meal='간식/카페';
  let intent='가볍게 먹기 좋은 간식, 카페, 디저트 또는 브런치';
  if(hour>=5&&hour<10){
    meal='아침';
    intent='부담 적은 아침식사, 해장, 국밥, 죽, 토스트, 브런치';
  }else if(hour>=10&&hour<14){
    meal='점심';
    intent='점심 한 끼로 만족도 높은 메뉴, 혼밥/직장인 점심/지역 대표 메뉴';
  }else if(hour>=14&&hour<17){
    meal='오후 간식';
    intent='카페, 디저트, 빵, 분식, 가벼운 간식';
  }else if(hour>=17&&hour<21){
    meal='저녁';
    intent='저녁식사, 데이트, 가족식사, 고기/해산물/면/한식 등 든든한 메뉴';
  }else if(hour>=21||hour<2){
    meal='야식·술안주';
    intent='야식, 술안주, 포장/배달도 어울리는 메뉴, 늦은 시간 먹기 좋은 음식';
  }else{
    meal='심야';
    intent='늦은 밤 해장, 24시간 식사, 국밥/면/분식처럼 접근성 좋은 메뉴';
  }
  return {hour,minute,weekday,hm,meal,intent};
}

function recentFoodNames(input){
  const rows=Array.isArray(input)?input:[];
  return rows.map(v=>String(v?.topic||v||'').trim()).filter(Boolean).slice(0,8);
}

async function researchFood(key,recentFood=[]){
  const ctx=koreaFoodContext();
  const recent=recentFoodNames(recentFood);
  const exclude=recent.length
    ? `최근 이미 추천/생성한 업장: ${recent.join(' / ')}
위 업장들은 이번 후보에서 반드시 제외해. 이름이 비슷한 지점/분점으로 돌려막기도 금지.`
    : '최근 추천 이력 없음.';

  return groundedResearch(key,`현재 한국 시간은 ${ctx.hm}, 추천 상황은 "${ctx.meal}"이야.
이번 시간대에는 ${ctx.intent} 방향을 우선해.

한국 전국에서 실제 영업 중인 것으로 확인되는 식당/맛집 후보를 조사해.
서울에 편향하지 말고 부산/대구/대전/광주/인천/울산/제주/강릉/전주/수원 등 전국을 넓게 고려해.
${exclude}

중요 다양성 규칙:
- 직전 추천 업장은 절대 다시 고르지 않는다.
- 최근 추천 이력에 있는 업장은 최대 8개까지 제외한다.
- 가능하면 직전과 다른 지역, 다른 음식 장르, 다른 상황을 우선한다.
- 같은 유명 맛집 하나에 검색 결과가 몰려도 다른 검증 가능한 후보를 찾아라.
- 전국 추천이므로 특정 도시나 노포 한 종류에 계속 수렴하지 마라.
- 현재 시간대에 어울리지 않는 메뉴는 우선순위를 낮춘다.
- 점심이면 점심 한 끼, 저녁이면 저녁식사, 21시 이후면 야식/술안주 성격을 강하게 반영한다.

각 항목은 정확한 식당명, 지역, 대표적으로 알려진 메뉴, 왜 지금 시간대에 추천할 만한지까지만.
검색으로 실제 존재와 현재 정보를 확인하기 어려운 곳은 제외.
가격/영업시간은 변동 가능성이 크므로 확실하지 않으면 쓰지 마.
서로 다른 지역/장르로 최대 12곳.`); 
}

function aiPromptMoodRule(mood='RANDOM'){
  const rules={
    RANDOM:`완전 랜덤 모드. 행복/사랑/코믹/공포/판타지 중 하나를 고르는 기능이 아니다. 감정과 장르를 제한하지 않는다. 주제, 시대, 국가, 장소, 시간대, 날씨, 계절, 실내/실외, 인물 유무, 행동, 사건, 현실/초현실, 사진 장르, 카메라, 렌즈, 구도, 조명, 색감, 질감을 가능한 전체 범위에서 자유롭게 조합한다. 직전 결과의 분위기를 이어받지 말고 매번 새 출발한다. 비 오는 밤, 어두운 카페, 침침한 필름 감성을 기본값으로 삼지 않는다. 밝은 낮, 강한 원색, 자연광, 야외, 여행, 스포츠, 미래, 역사, 초현실, 미니멀, 다큐멘터리, 패션, 일상, 기묘함 등 모든 가능성을 열어 둔다.`,
    HAPPY:`행복 무드. 밝고 활기차고 생기 있는 에너지가 느껴지는 새로운 소재를 고른다. 햇살, 낮, 여행, 축제, 웃음, 움직임, 선명하고 기분 좋은 색감 등을 폭넓게 활용하되 매번 같은 장소나 구도를 반복하지 않는다.`,
    LOVE:`사랑 무드. 연애에만 한정하지 않고 설렘, 애정, 다정함, 우정, 가족애, 반려동물과의 교감, 소중한 순간 등 사랑을 넓게 해석한다. 부드럽고 매력적이되 하트 장식 같은 뻔한 상징에 의존하지 않는다.`,
    COMIC:`코믹 무드. 예상 밖의 상황, 유쾌한 행동, 시각적 반전, 재미있는 타이밍과 구도를 활용한다. 억지 밈이나 과장된 표정보다 사진 자체의 상황과 구도가 재치 있게 느껴져야 한다.`,
    HORROR:`공포 무드. 불길함, 미스터리, 기묘함, 긴장감, 심리적 공포를 세련되게 표현한다. 고어, 유혈, 잔혹 묘사는 금지한다. 밤 장면에만 고정하지 말고 밝은 낮의 기묘함, 평범한 장소의 불안감 등도 적극 활용한다.`,
    FANTASY:`판타지 무드. 현실에서 불가능한 세계, 마법적 환경, 초현실적 자연, 독창적 생명체와 공간, 시대 혼합 등 상상력을 적극적으로 사용한다. 중세 성, 엘프, 마법사 같은 흔한 클리셰에 고정되지 않는다.`
  };
  return rules[mood]||rules.RANDOM;
}

function pillarPrompt({pillar,research='',feedback='',performance='',mood='RANDOM'}){
  const common=`너는 한국 Threads 계정을 팔로워 성장시키는 콘텐츠 편집장이다.\n목표는 광고가 아니라 저장, 공유, 댓글, 팔로우를 부르는 원본 콘텐츠다.\n본문은 스레드에서 실제 사람이 말하듯 자연스러운 반말로 쓴다. 딱딱한 기사체, 보도자료체, 존댓말, 교과서식 설명은 피한다.\n짧은 문장과 줄바꿈을 활용하고, 귀엽고 친근한 리액션을 자연스럽게 섞는다. 이모지는 보통 1~3개만 사용하고 과하게 도배하지 않는다.\n사건사고·재난·피해자가 있는 내용에서는 장난스러운 표현을 피하고 친근하지만 차분한 반말을 사용한다.\n후킹은 6~10자 우선, 최대 14자. 기사 제목이나 흔한 문구를 복사하지 않는다.\nThreads 주제 태그도 함께 추천한다. 내부 소재명 topic과 Threads 주제 태그 topic_tag는 절대 같은 필드로 취급하지 않는다. topic_tag_candidates는 게시물 내용과 직접 관련된 후보 3개를 만든다. 한국 계정이므로 자연스럽고 실제 사람들이 찾을 법한 한글 Topic을 우선하되, AI Art처럼 영어명이 더 보편적인 주제는 영어도 허용한다. # 기호는 넣지 않는다. 너무 길거나 문장형인 태그, 광고 문구, 억지 신조어는 금지한다. topic_tag에는 후보 중 가장 적합한 하나를 넣는다.\n이미지는 4:5 세로형이며 글자/로고/워터마크 없이 프레임 전체를 하나의 자연스럽고 완성된 장면으로 채운다. 제목 공간을 위한 빈 영역, 상단 여백, 블러 띠, 검은 띠, 반투명 오버레이, 그라데이션 패널을 만들지 않는다. 후킹 제목과 VOA 워터마크는 이미지 생성 후 프로그램이 별도로 합성한다.\n최근 피드백: ${feedback||'없음'}\n실제 성과: ${performance||'없음'}`;

  const rules={
    AI_TIP:`AI_TIP 하나만 만든다. 일반인이 잘 모르는 짧은 전문 개념/명령어를 오늘의 명령어처럼 소개한다. RED TEAM, STEELMAN, PRE-MORTEM, EDGE CASES, COUNTEREXAMPLE, RUBRIC, FIRST PRINCIPLES 같은 수준이지만 예시를 재탕하지 말고 더 넓게 발굴한다. '전문가처럼 답해줘', '결론부터', '예시 2개' 같은 초급 팁은 금지. 본문은 ① 낯선 용어 ② 복붙 가능한 짧은 영어 명령어 ③ 쉬운 한국어 설명 ④ 언제 쓰면 좋은지. 영어 명령어 필수. 말투는 '이거 한번 써봐 👀', '생각보다 꽤 쓸만해'처럼 짧고 영리한 반말로 쓴다.`,
    AI_PROMPT:`AI_PROMPT 하나만 만든다. ${aiPromptMoodRule(mood)} 반드시 body와 reply_prompt를 완전히 분리한다. body는 Threads에 실제 게시되는 한국어 설명문이다. 결과 이미지의 매력, 빛/질감/분위기/촬영 느낌 중 핵심을 3~5문장으로 충분히 설명한다. 자연스러운 반말과 가벼운 이모지 1~2개를 사용한다. 영문 이미지 프롬프트 문장이나 영어 프롬프트 일부를 body에 절대 넣지 않는다. body 마지막은 반드시 '프롬프트는 첫 댓글에 남겨둘게 👇'처럼 첫 댓글을 안내한다. reply_prompt는 복붙용 영문 이미지 프롬프트만 넣는다. 한국어 설명, 번역, Prompt:, 따옴표, Markdown 금지. 피사체/행동/환경/시간/카메라/렌즈/구도/조명/색감/질감/현실성/금지요소 중 필요한 요소를 상세하게 구성한다. 길이 때문에 핵심 디테일을 억지로 삭제하지 않는다. 흔한 cinematic, warm lighting 단순 나열 수준은 금지.`,

AI_TIP:`AI 활용 팁은 반드시 body와 reply_prompt를 완전히 분리한다.
핵심은 '짧은 전문 명령어/기법 이름' 하나를 소개하는 것이다. RED TEAM, STEELMAN, PRE-MORTEM, EDGE CASES, COUNTEREXAMPLE, RUBRIC, FIRST PRINCIPLES, DECOMPOSITION처럼 1~3단어 수준의 짧고 기억하기 쉬운 개념을 우선한다. 단, 같은 용어를 반복 재탕하지 말고 매번 다른 전문 개념을 발굴한다.
body에는 해당 짧은 명령어 이름을 눈에 띄게 소개하고, 그게 무엇인지 / 언제 쓰는지 / 어떤 효과가 있는지를 한국어 반말로 3~5문장 설명한다. 실제 복붙 명령문은 body에 절대 넣지 않는다. body 마지막은 반드시 '프롬프트는 첫 댓글에 남겨둘게 👇'처럼 안내한다.
reply_prompt에는 사용자가 그대로 복사해 AI에 넣을 실제 프롬프트만 넣는다. 반드시 영어로 작성한다. 한국어 문장, 한국어 설명, 번역, Markdown, 코드블록, 장식 문구 금지. 길게 장황하게 쓰지 말고 보통 1~3문장의 짧고 강한 명령형 영어 프롬프트로 작성한다.
예시 방향: "Red-team this plan. Identify hidden assumptions, failure modes, and the strongest counterarguments."처럼 짧고 전문적이어야 한다.`,
    FOOD_PICK:`FOOD_PICK 하나만 만든다. 현재 한국 시간대를 반영해서 지금 먹기 가장 자연스러운 상황을 먼저 정한다. 점심 시간에는 점심, 저녁에는 저녁, 밤 9시 이후에는 야식/술안주 성격을 우선한다. '오늘 점심은 내가 정해줄게 😋', '오늘 저녁은 이거 먹자', '오늘 술안주는 이걸로 가자'처럼 우리가 먼저 결론을 준다. 아래 검색 결과에서 실제 확인된 전국 식당 하나를 고른다. 최근 생성 이력으로 제외된 업장은 절대 선택하지 않는다. 같은 지역/같은 장르/같은 업장을 연속 반복하지 말고 다양성을 우선한다. 식당명/지역/대표 메뉴/추천 이유를 간결하게 쓴다. 존재, 지역, 메뉴를 지어내지 않는다. 음식은 먹고 싶게 느껴지는 가볍고 맛깔나는 반말로 추천한다. 마지막에 '※ 이미지는 메뉴 이해를 돕는 AI 연출 이미지'를 넣는다.\n검색 결과:\n${research}`,
    HOT_ISSUE:`HOT_ISSUE 하나만 만든다. AI에 편향하지 말고 오늘 실제 뉴스 중 대화 가치와 화제성이 가장 큰 하나를 고른다. 환율/증시/정책/사회/사건사고/전쟁/국제/날씨/태풍/스포츠/연예/자동차/부동산/과학/테크 모두 동등하게 본다. 아래 검색 결과만 사실 재료로 사용한다. 검색 결과 안에 '최근 이미 다룬 핫이슈'와 중복 금지 규칙이 포함되어 있으면 반드시 따른다. 같은 사건을 제목/후킹/표현만 바꿔 재사용하지 않는다. 기사 제목 복사 금지. 본문은 '무슨 일인데? → 쉽게 말하면 왜 중요한데? → 앞으로 뭘 보면 돼?' 흐름으로 친근한 반말로 풀어준다. 뉴스 앵커처럼 딱딱하게 쓰지 않는다. 다만 재난·전쟁·피해자가 있는 사건은 가벼운 농담 없이 차분하게 쓴다. 루머와 확인 안 된 숫자 금지.\n검색 결과:\n${research}`
  };

  return `${common}\n\n${rules[pillar]}\n\nJSON만 반환:\n{"candidate":{"category":"${pillar}","topic":"...","topic_tag":"...","topic_tag_candidates":["...","...","..."],"hook":"...","hook_candidates":["...","...","...","...","..."],"body":"...","reason":"...","image_brief":"...","source_notes":[],"score":{"stop":0,"save":0,"share":0,"comment":0,"follow":0,"novelty":0,"visual":0,"total":0}}}`;
}

async function actionGenerate(req,res){
  const key=process.env.GEMINI_API_KEY;
  if(!key)return send(res,503,{ok:false,error:'GEMINI_NOT_CONFIGURED'});

  const pillar=String(req.body?.pillar||'').trim();
  const allowed=['AI_TIP','AI_PROMPT','FOOD_PICK','HOT_ISSUE'];
  if(!allowed.includes(pillar))return send(res,400,{ok:false,error:'PILLAR_REQUIRED',allowed});

  const feedback=String(req.body?.feedback||'').slice(0,4000);
  const performance=String(req.body?.performance||'').slice(0,5000);
  const recentFood=Array.isArray(req.body?.recentFood)?req.body.recentFood.slice(0,8):[];
  const recentHotIssues=Array.isArray(req.body?.recentHotIssues)?req.body.recentHotIssues.slice(0,20):[];
  const requestedMood=String(req.body?.mood||'RANDOM').trim().toUpperCase();
  const allowedMoods=['RANDOM','HAPPY','LOVE','COMIC','HORROR','FANTASY'];
  const mood=pillar==='AI_PROMPT'&&allowedMoods.includes(requestedMood)?requestedMood:'RANDOM';

  try{
    let research='';
    if(pillar==='HOT_ISSUE')research=await researchHotIssues(key,recentHotIssues);
    if(pillar==='FOOD_PICK')research=await researchFood(key,recentFood);

    const out=await generateJson(key,pillarPrompt({pillar,research,feedback,performance,mood}),.88);
    const raw=out?.candidate||out?.item||out;
    const item=cleanCandidate({...raw,category:pillar},0);
    if(pillar==='AI_PROMPT')item.mood=mood;
    if(!item.body||!item.hook)throw new Error('PILLAR_CONTENT_INVALID');

    return send(res,200,{
      ok:true,
      engine:'growth-v5-independent-pillars',
      pillar,
      grounded:pillar==='HOT_ISSUE'||pillar==='FOOD_PICK',
      item
    });
  }catch(e){
    console.error('[PILLAR_GENERATE_FAILED]',JSON.stringify({pillar,message:e?.message||String(e)}));
    return send(res,502,{ok:false,error:'PILLAR_GENERATE_FAILED',detail:e?.message||String(e)});
  }
}

async function imageDirector(key,candidate,variation){
  const prompt=`너는 세계적 소셜미디어 아트디렉터다.
다음 Threads 후보에 맞는 Gemini 이미지 생성용 영어 프롬프트 하나만 작성해.

카테고리: ${candidate.category}
소재: ${candidate.topic}
본문: ${candidate.body}
후킹(이미지에 직접 쓰지 않음): ${candidate.hook}
브리프: ${candidate.image_brief}
재생성 번호: ${variation}
AI 프롬프트 무드 지시: ${candidate.category==='AI_PROMPT'?aiPromptMoodRule(String(candidate.mood||'RANDOM').toUpperCase()):'해당 없음'}

절대 규칙:
4:5 portrait, premium social editorial thumbnail quality.
이미지 안에 글자/숫자/로고/워터마크/가짜 UI를 생성하지 않는다. 정확한 제목과 VOA 워터마크는 후처리 코드가 담당한다.
프레임의 위에서 아래까지 실제 장면과 자연스러운 배경이 끊김 없이 이어지는 완성된 full-bleed 이미지여야 한다. 제목을 넣기 위한 전용 공간을 절대 만들지 않는다. 상단 25~30%를 비우거나 단순화하지 말고, 제목 때문에 피사체나 장면을 아래로 밀어내지 않는다.
검은 띠, 어두운 띠, 흐린 띠, blur band, gradient band, translucent overlay, vignette panel, 빈 직사각형, 인위적인 패널, 프레임, 텍스트 박스, 헤더 영역을 생성하지 않는다. 중요한 얼굴이나 핵심 사물도 제목 합성을 위해 인위적으로 이동시키지 말고 소재 자체에 가장 자연스럽고 강한 구도를 우선한다.
모바일 피드에서 0.5초 안에 시선을 멈추게 하는 프리미엄 광고 캠페인/매거진 커버급 구도, 강한 명암, 깊이감, 현실적인 재질과 피부 표현.
사람이 소재 이해와 감정 전달에 도움이 되는 장면이라면 '20대의 매력적이고 세련된 한국 성인 여성'을 우선 사용한다. 귀엽고 자연스러운 인상, 현실적인 피부, 세련된 헤어와 상황에 맞는 의상. 미성년자로 보이는 외모는 금지.
인물을 사용하는 경우 첨부된 Character Master의 여성은 '보아(VOA)'다. 반드시 그 참조 인물의 동일한 정체성으로 생성한다. 얼굴형, 눈·코·입 비율, 피부톤, 연령대, 기본 머리색과 전체 인상은 바꾸지 않는다. Character Master는 얼굴/정체성 참조용이며 의상 참조용이 아니다. 참조 이미지의 옷을 기본 복장처럼 반복 복제하지 않는다. 보아가 등장할 때마다 장소, 계절, 날씨, 시대, 활동, 직업/역할, 무드에 맞는 자연스럽고 세련된 의상을 새로 스타일링한다. 예: 해변은 리조트웨어, 겨울 도시는 코트/니트, 운동 장면은 스포츠웨어, 업무 장면은 스마트 캐주얼, 판타지는 해당 세계관 복식처럼 장면 논리에 맞춘다. 동일 장면의 연속성이 필요한 경우에만 같은 옷을 유지한다. 표정, 포즈, 헤어 연출, 앵글과 배경도 장면에 맞게 바꿀 수 있다. 다른 여성으로 재해석하거나 얼굴을 랜덤화하지 않는다. 과도한 노출이나 성적 연출은 금지.
표정은 과장된 충격 표정보다 호기심, 미소, 놀람, 만족, 집중 같은 자연스러운 감정을 우선한다.
뻔한 AI 로봇, 푸른 회로판, 홀로그램 뇌, 의미 없는 네온을 기본값으로 쓰지 않는다.
AI_PROMPT: 제공 프롬프트의 '완성 결과' 자체가 저장 욕구를 만들 정도로 고급스럽게. 인물이 어울리는 주제라면 첨부 Character Master의 보아(VOA)를 자연스럽게 활용한다.
AI_TIP: 낯선 개념을 한 장면으로 직관화한다. 사람이 어울리면 첨부 Character Master의 보아(VOA)가 화면/오브젝트와 자연스럽게 상호작용하게 한다. 실제 읽을 수 있는 UI나 텍스트는 만들지 않는다.
FOOD_PICK: 음식이 가장 큰 주인공. 윤기, 김, 질감, 단면 등 식욕을 자극하는 디테일을 강조하고, 필요할 때만 실제 식사 중인 성인 여성/친구들을 보조 피사체로 사용한다. 특정 식당 사진을 복제하지 않는다.
HOT_ISSUE: 핵심 사물/상징/장소가 주인공인 프리미엄 편집기사형 비주얼. 인물은 맥락상 자연스러울 때만 사용하며 실제 보도사진, 피해자, 특정 현장 사진으로 오인되지 않게 한다.
재생성 번호가 달라지면 카메라 앵글, 인물 유무, 구도, 시각적 은유 중 최소 2가지를 확실히 바꾼다.
영어 이미지 프롬프트만 출력.`;

  const j=await geminiGenerate(key,{
    model:TEXT_MODEL,
    prompt,
    temperature:.8
  });

  return textFromGemini(j).slice(0,3000);
}

function extractInlineImage(j){
  const parts=j?.candidates?.[0]?.content?.parts||[];
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
    const prompt=await imageDirector(key,candidate,variation);
    if(!prompt)throw new Error('IMAGE_DIRECTOR_EMPTY');

    let referenceImage=null;
    try{
      const master=await readFile(join(process.cwd(),'voa-character-master.png'));
      referenceImage={mimeType:'image/png',data:master.toString('base64')};
    }catch(e){
      console.error('[VOA_MASTER_LOAD_FAILED]',e?.message||String(e));
      throw new Error('VOA_CHARACTER_MASTER_MISSING');
    }

    const j=await geminiGenerate(key,{
      model:IMAGE_MODEL,
      prompt,
      image:true,
      referenceImage
    });

    const img=extractInlineImage(j);

    if(!img){
      const parts=j?.candidates?.[0]?.content?.parts||[];
      console.error('[GEMINI_IMAGE_MISSING]',JSON.stringify({
        candidate_count:j?.candidates?.length||0,
        parts_count:parts.length,
        part_types:parts.map(p=>p?.inlineData?'inlineData':p?.text?'text':'unknown'),
        finish_reason:j?.candidates?.[0]?.finishReason||null
      }));
      throw new Error('GEMINI_IMAGE_MISSING');
    }

    return send(res,200,{
      ok:true,
      ...img,
      director_prompt:prompt
    });
  }catch(e){
    console.error('[CONTENT_IMAGE_FAILED]',JSON.stringify({
      message:e?.message||String(e)
    }));
    return send(res,502,{
      ok:false,
      error:'CONTENT_IMAGE_FAILED',
      detail:e?.message||String(e)
    });
  }
}

function decodeImage(dataUrl=''){
  const m=String(dataUrl).match(
    /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/
  );
  if(!m)return null;
  return {
    mime:m[1],
    buffer:Buffer.from(m[2],'base64')
  };
}

async function actionStoreImage(req,res){
  const d=decodeImage(req.body?.data_url);

  if(!d)return send(res,400,{ok:false,error:'IMAGE_DATA_REQUIRED'});
  if(d.buffer.length>4_000_000){
    return send(res,413,{ok:false,error:'IMAGE_TOO_LARGE'});
  }

  const id=String(req.body?.candidate_id||Date.now())
    .replace(/[^a-zA-Z0-9_-]/g,'')
    .slice(0,70);

  const ext=
    d.mime==='image/png'?'png':
    d.mime==='image/webp'?'webp':'jpg';

  try{
    const blob=await put(
      `threads-growth/${Date.now()}-${id}.${ext}`,
      d.buffer,
      {
        access:'public',
        addRandomSuffix:true,
        contentType:d.mime,
        cacheControlMaxAge:31536000
      }
    );

    return send(res,200,{
      ok:true,
      url:blob.url,
      pathname:blob.pathname
    });
  }catch(e){
    console.error('[BLOB_UPLOAD_FAILED]',JSON.stringify({
      message:e?.message||String(e)
    }));
    return send(res,502,{
      ok:false,
      error:'BLOB_UPLOAD_FAILED',
      detail:e?.message||String(e)
    });
  }
}

async function actionVariant(req,res){
  const key=process.env.GEMINI_API_KEY;
  const x=req.body?.candidate;

  if(!key)return send(res,503,{ok:false,error:'GEMINI_NOT_CONFIGURED'});
  if(!x)return send(res,400,{ok:false,error:'CANDIDATE_REQUIRED'});

  const prompt=`같은 카테고리와 핵심 소재는 유지하되 완전히 다른 각도로 Threads 콘텐츠를 재작성해.
본문은 자연스러운 한국어 반말로 작성하고 딱딱한 기사체·보도자료체·존댓말을 피한다.
짧은 문장과 줄바꿈을 활용하고 이모지는 보통 1~3개만 자연스럽게 사용한다.
사건사고·재난·피해자가 있는 내용은 장난스럽게 표현하지 않는다.
AI_TIP이면 짧은 전문 용어 + 영어 한 줄 명령어가 필수.
AI_PROMPT와 AI_TIP은 body에는 한국어 설명만 쓰고 reply_prompt에는 실제 복붙용 프롬프트만 쓴다. 둘을 절대 섞지 않는다.
FOOD_PICK이면 기존 검증된 식당/메뉴 사실을 바꾸거나 지어내지 말 것.
HOT_ISSUE이면 source_notes의 사실 범위를 넘지 말 것.
hook 6~10자 우선 최대 14자.
본문 500자 이내.
이미지 브리프도 새 각도에 맞게 변경.
기존:${JSON.stringify(x).slice(0,6000)}

JSON만:
{"hook":"...","hook_candidates":["...","...","...","...","..."],"body":"...","reply_prompt":"AI_PROMPT는 상세 영문 이미지 프롬프트, AI_TIP은 짧은 영문 명령형 프롬프트","reason":"...","image_brief":"..."}`;

  try{
    const v=await generateJson(key,prompt,1);

    return send(res,200,{
      ok:true,
      item:{
        ...x,
        hook:clampHook(v.hook||x.hook),
        hook_candidates:Array.isArray(v.hook_candidates)
          ?v.hook_candidates.slice(0,5)
          :x.hook_candidates,
        body:String(v.body||x.body).slice(0,500),
        reply_prompt:['AI_PROMPT','AI_TIP'].includes(x.category)?String(v.reply_prompt||x.reply_prompt||'').trim():'',
        reason:String(v.reason||x.reason).slice(0,180),
        image_brief:String(v.image_brief||x.image_brief).slice(0,1200)
      }
    });
  }catch(e){
    return send(res,502,{
      ok:false,
      error:'VARIANT_FAILED',
      detail:e?.message||String(e)
    });
  }
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');

  if(req.method!=='POST'){
    return send(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
  }

  const action=String(
    req.query?.action||
    req.body?.action||
    ''
  ).trim();

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
