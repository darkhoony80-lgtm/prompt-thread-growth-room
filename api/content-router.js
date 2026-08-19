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
    hook,
    hook_candidates:hooks.slice(0,5),
    body:String(x?.body||'').trim().slice(0,500),
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
  image=false
}){
  const url=model===IMAGE_MODEL?IMAGE_URL:TEXT_URL;
  const body={
    contents:[{parts:[{text:prompt}]}]
  };

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

async function researchHotIssues(key){
  return groundedResearch(key,`현재 한국 시간 기준으로 오늘 가장 화제가 큰 이슈를 조사해.
AI 뉴스에 편향하지 말고 환율/증시/물가/정책/사회/사건사고/전쟁/국제/날씨/태풍/폭우/폭염/지진/스포츠/연예/자동차/부동산/과학/테크 전체를 살펴봐.
최근 24시간을 최우선, 필요하면 48시간까지만.
여러 출처로 교차 확인되는 사실만 사용하고 루머는 제외.
오늘 Threads에서 사람들이 가장 많이 궁금해하거나 대화할 가치가 큰 것 위주로 최대 8개.
각 이슈마다 핵심 사실, 왜 오늘 중요한지, 숫자/시간 등 주의할 팩트를 짧게 정리해.
피해자가 있는 사건은 선정적 묘사를 피하고 공익적 정보 중심으로.`);
}

async function researchFood(key){
  return groundedResearch(key,`한국 전국에서 실제 영업 중인 것으로 확인되는 식당/맛집 후보를 조사해.
서울에 편향하지 말고 부산/대구/대전/광주/인천/울산/제주/강릉/전주/수원 등 전국을 넓게 고려해.
점심, 저녁, 혼밥, 해장, 회식, 술자리 안주, 여행 한 끼 같은 상황별로 추천할 만한 곳을 최대 12곳.
각 항목은 정확한 식당명, 지역, 대표적으로 알려진 메뉴, 왜 추천할 만한지까지만.
검색으로 실제 존재와 현재 정보를 확인하기 어려운 곳은 제외.
가격/영업시간은 변동 가능성이 크므로 확실하지 않으면 쓰지 마.`);
}

function pillarPrompt({pillar,research='',feedback='',performance=''}){
  const common=`너는 한국 Threads 계정을 팔로워 성장시키는 콘텐츠 편집장이다.\n목표는 광고가 아니라 저장, 공유, 댓글, 팔로우를 부르는 원본 콘텐츠다.\n본문은 스레드에서 실제 사람이 말하듯 자연스러운 반말로 쓴다. 딱딱한 기사체, 보도자료체, 존댓말, 교과서식 설명은 피한다.\n짧은 문장과 줄바꿈을 활용하고, 귀엽고 친근한 리액션을 자연스럽게 섞는다. 이모지는 보통 1~3개만 사용하고 과하게 도배하지 않는다.\n사건사고·재난·피해자가 있는 내용에서는 장난스러운 표현을 피하고 친근하지만 차분한 반말을 사용한다.\n후킹은 6~10자 우선, 최대 14자. 기사 제목이나 흔한 문구를 복사하지 않는다.\n이미지는 4:5 세로형이며 글자/로고/워터마크 없이 상단 30%를 후킹 합성 여백으로 둔다.\n최근 피드백: ${feedback||'없음'}\n실제 성과: ${performance||'없음'}`;

  const rules={
    AI_TIP:`AI_TIP 하나만 만든다. 일반인이 잘 모르는 짧은 전문 개념/명령어를 오늘의 명령어처럼 소개한다. RED TEAM, STEELMAN, PRE-MORTEM, EDGE CASES, COUNTEREXAMPLE, RUBRIC, FIRST PRINCIPLES 같은 수준이지만 예시를 재탕하지 말고 더 넓게 발굴한다. '전문가처럼 답해줘', '결론부터', '예시 2개' 같은 초급 팁은 금지. 본문은 ① 낯선 용어 ② 복붙 가능한 짧은 영어 명령어 ③ 쉬운 한국어 설명 ④ 언제 쓰면 좋은지. 영어 명령어 필수. 말투는 '이거 한번 써봐 👀', '생각보다 꽤 쓸만해'처럼 짧고 영리한 반말로 쓴다.`,
    AI_PROMPT:`AI_PROMPT 하나만 만든다. 사람들이 '이 프롬프트로 이런 결과가?'라고 저장하고 싶은 상세 영문 프롬프트를 제공한다. 한국어 소개 1~2문장은 친근한 반말로 쓰고, 복붙용 영어 프롬프트는 전문적인 영어 문장으로 유지한다. 피사체/행동/환경/시간/카메라/렌즈/구도/조명/색감/질감/현실성/금지요소 중 필요한 요소를 구체화한다. 흔한 cinematic, warm lighting 나열 수준은 금지. 영어 프롬프트 자체에는 귀여운 말투나 이모지를 넣지 않는다.`,
    FOOD_PICK:`FOOD_PICK 하나만 만든다. '오늘 점심은 내가 정해줄게 😋', '오늘 저녁은 이거 먹자', '오늘 술안주는 이걸로 가자'처럼 우리가 먼저 결론을 준다. 아래 검색 결과에서 실제 확인된 전국 식당 하나를 골라 식당명/지역/대표 메뉴/추천 이유를 간결하게 쓴다. 존재, 지역, 메뉴를 지어내지 않는다. 음식은 먹고 싶게 느껴지는 가볍고 맛깔나는 반말로 추천한다. 마지막에 '※ 이미지는 메뉴 이해를 돕는 AI 연출 이미지'를 넣는다.\n검색 결과:\n${research}`,
    HOT_ISSUE:`HOT_ISSUE 하나만 만든다. AI에 편향하지 말고 오늘 실제 뉴스 중 대화 가치와 화제성이 가장 큰 하나를 고른다. 환율/증시/정책/사회/사건사고/전쟁/국제/날씨/태풍/스포츠/연예/자동차/부동산/과학/테크 모두 동등하게 본다. 아래 검색 결과만 사실 재료로 사용한다. 기사 제목 복사 금지. 본문은 '무슨 일인데? → 쉽게 말하면 왜 중요한데? → 앞으로 뭘 보면 돼?' 흐름으로 친근한 반말로 풀어준다. 뉴스 앵커처럼 딱딱하게 쓰지 않는다. 다만 재난·전쟁·피해자가 있는 사건은 가벼운 농담 없이 차분하게 쓴다. 루머와 확인 안 된 숫자 금지.\n검색 결과:\n${research}`
  };

  return `${common}\n\n${rules[pillar]}\n\nJSON만 반환:\n{"candidate":{"category":"${pillar}","topic":"...","hook":"...","hook_candidates":["...","...","...","...","..."],"body":"...","reason":"...","image_brief":"...","source_notes":[],"score":{"stop":0,"save":0,"share":0,"comment":0,"follow":0,"novelty":0,"visual":0,"total":0}}}`;
}

async function actionGenerate(req,res){
  const key=process.env.GEMINI_API_KEY;
  if(!key)return send(res,503,{ok:false,error:'GEMINI_NOT_CONFIGURED'});

  const pillar=String(req.body?.pillar||'').trim();
  const allowed=['AI_TIP','AI_PROMPT','FOOD_PICK','HOT_ISSUE'];
  if(!allowed.includes(pillar))return send(res,400,{ok:false,error:'PILLAR_REQUIRED',allowed});

  const feedback=String(req.body?.feedback||'').slice(0,4000);
  const performance=String(req.body?.performance||'').slice(0,5000);

  try{
    let research='';
    if(pillar==='HOT_ISSUE')research=await researchHotIssues(key);
    if(pillar==='FOOD_PICK')research=await researchFood(key);

    const out=await generateJson(key,pillarPrompt({pillar,research,feedback,performance}),.88);
    const raw=out?.candidate||out?.item||out;
    const item=cleanCandidate({...raw,category:pillar},0);
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

    const j=await geminiGenerate(key,{
      model:IMAGE_MODEL,
      prompt,
      image:true
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
AI_PROMPT면 상세 영어 프롬프트가 핵심.
FOOD_PICK이면 기존 검증된 식당/메뉴 사실을 바꾸거나 지어내지 말 것.
HOT_ISSUE이면 source_notes의 사실 범위를 넘지 말 것.
hook 6~10자 우선 최대 14자.
본문 500자 이내.
이미지 브리프도 새 각도에 맞게 변경.
기존:${JSON.stringify(x).slice(0,6000)}

JSON만:
{"hook":"...","hook_candidates":["...","...","...","...","..."],"body":"...","reason":"...","image_brief":"..."}`;

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
