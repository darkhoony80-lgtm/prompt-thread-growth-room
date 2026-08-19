const MODEL='gemini-2.5-flash';
const ENDPOINT=`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function stripFence(s=''){
  return String(s).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
}
function cleanCandidate(x,i){
  const allowed=['AI_PROMPT','AI_TIP','HOT_ISSUE','FUN_RELATABLE','EXPERIMENT'];
  const category=allowed.includes(x?.category)?x.category:'EXPERIMENT';
  return {
    id:`candidate-${Date.now()}-${i}`,
    category,
    category_label:x?.category_label||({
      AI_PROMPT:'AI 프롬프트',AI_TIP:'AI 활용 팁',HOT_ISSUE:'🔥 오늘의 핫이슈',
      FUN_RELATABLE:'재미·공감형',EXPERIMENT:'실험적인 콘텐츠'
    }[category]),
    hook:String(x?.hook||'').trim().slice(0,14),
    body:String(x?.body||'').trim().slice(0,500),
    reason:String(x?.reason||'').trim().slice(0,140),
    image_needed:Boolean(x?.image_needed),
    image_prompt:String(x?.image_prompt||'').trim().slice(0,1200),
    source_notes:Array.isArray(x?.source_notes)?x.source_notes.slice(0,4):[]
  };
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const key=process.env.GEMINI_API_KEY;
  if(!key)return res.status(503).json({ok:false,error:'GEMINI_NOT_CONFIGURED'});
  const mode=String(req.body?.mode||'fresh');
  const feedback=String(req.body?.feedback||'').slice(0,1200);
  const prompt=`너는 한국 Threads 계정의 콘텐츠 편집장이다.
목표는 팔로워, 좋아요, 리포스트, 댓글 증가다. 직접 판매 CTA는 넣지 않는다.
후보를 정확히 5개 만든다. 다음 5축을 기반으로 하되 매번 하나씩 강제 배정하지 말고 오늘 가치가 높은 축은 2개여도 된다.
1 AI_PROMPT: 저장하고 직접 써보고 싶은 고품질 이미지 생성 프롬프트
2 AI_TIP: ChatGPT/Gemini 등에서 "이거 몰랐네?"가 나오는 실용 팁
3 HOT_ISSUE: 오늘 화제의 뉴스/사건/사회/테크/AI/연예/생활 이슈. 사실처럼 꾸며내지 말고 불확실하면 제외
4 FUN_RELATABLE: 직장/일상/AI/SNS 자연스러운 공감과 대화 유도
5 EXPERIMENT: 새로운 후킹/참여형/비주얼 포맷 실험
Threads 본문은 한국어로 자연스럽고 복붙 가능한 완성본. 과장 낚시와 허위사실 금지.
hook은 기사 제목 복사가 아니라 호기심/반전/의문/놀라움 중 최적 방식으로 새로 작성. 6~10자 우선, 절대 14자 초과 금지.
이미지가 효과적인 경우 image_needed=true. image_prompt에는 4:5 세로형, 텍스트/로고/워터마크 없는 중앙·하단 핵심 비주얼을 영어로 상세히 작성.
AI_PROMPT는 실제 사용자가 복사할 상세 프롬프트를 body에 반드시 포함.
HOT_ISSUE는 네가 최신성을 확신하지 못하면 일반 상식으로 지어내지 말고 다른 축으로 대체.
추천 이유 reason은 한 줄.
source_notes는 사실 확인이 필요한 HOT_ISSUE에만 짧은 검색/검증 메모를 넣고 그 외 빈 배열.
사용자 피드백: ${feedback||'없음'}
재생성 모드: ${mode}
JSON만 반환:
{"candidates":[{"category":"AI_PROMPT","category_label":"AI 프롬프트","hook":"...","body":"...","reason":"...","image_needed":true,"image_prompt":"...","source_notes":[]}]}`
  const r=await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:1,responseMimeType:'application/json'}})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok)return res.status(502).json({ok:false,error:'GEMINI_GENERATE_FAILED',detail:j?.error||j});
  const text=j?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
  let parsed;try{parsed=JSON.parse(stripFence(text))}catch{return res.status(502).json({ok:false,error:'GEMINI_INVALID_JSON'})}
  const items=(Array.isArray(parsed?.candidates)?parsed.candidates:[]).slice(0,5).map(cleanCandidate);
  if(items.length!==5)return res.status(502).json({ok:false,error:'GEMINI_CANDIDATE_COUNT_INVALID',count:items.length});
  return res.status(200).json({ok:true,items});
}
