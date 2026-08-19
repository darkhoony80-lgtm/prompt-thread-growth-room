const MODEL='gemini-3.6-flash';
const URL=`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
function strip(s=''){return String(s).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim()}
function parse(s=''){try{return JSON.parse(strip(s))}catch{const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(s.slice(a,b+1));throw new Error('INVALID_JSON')}}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const key=process.env.GEMINI_API_KEY,x=req.body?.candidate;
  if(!key)return res.status(503).json({ok:false,error:'GEMINI_NOT_CONFIGURED'});
  if(!x)return res.status(400).json({ok:false,error:'CANDIDATE_REQUIRED'});
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
    const r=await fetch(`${URL}?key=${encodeURIComponent(key)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:1,responseMimeType:'application/json'}})});
    const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error?.message||'VARIANT_FAILED');
    const t=(j?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join(''),v=parse(t);
    return res.status(200).json({ok:true,item:{...x,hook:[...String(v.hook||x.hook)].slice(0,14).join(''),hook_candidates:Array.isArray(v.hook_candidates)?v.hook_candidates.slice(0,5):x.hook_candidates,body:String(v.body||x.body).slice(0,500),reason:String(v.reason||x.reason).slice(0,180),image_brief:String(v.image_brief||x.image_brief).slice(0,1200)}});
  }catch(e){return res.status(502).json({ok:false,error:'VARIANT_FAILED',detail:e.message})}
}
