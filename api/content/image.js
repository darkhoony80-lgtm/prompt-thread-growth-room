import {GoogleGenAI} from '@google/genai';

const TEXT_MODEL='gemini-3.6-flash';
const IMAGE_MODEL='gemini-3.1-flash-image';

function textFromResponse(response){
  return (response?.candidates?.[0]?.content?.parts||[])
    .map(part=>part?.text||'')
    .join('')
    .trim();
}

async function director(ai,candidate,variation){
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
    config:{temperature:0.8}
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

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});

  const key=process.env.GEMINI_API_KEY;
  const candidate=req.body?.candidate;
  if(!key)return res.status(503).json({ok:false,error:'GEMINI_NOT_CONFIGURED'});
  if(!candidate)return res.status(400).json({ok:false,error:'CANDIDATE_REQUIRED'});

  const variation=Number(req.body?.variation)||1;

  try{
    const ai=new GoogleGenAI({apiKey:key});
    const prompt=await director(ai,candidate,variation);
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
        model:IMAGE_MODEL,
        candidate_count:response?.candidates?.length||0,
        parts_count:parts.length,
        part_types:parts.map(p=>p?.inlineData?'inlineData':p?.text?'text':'unknown'),
        finish_reason:response?.candidates?.[0]?.finishReason||null
      }));
      throw new Error('GEMINI_IMAGE_MISSING');
    }

    return res.status(200).json({
      ok:true,
      ...img,
      director_prompt:prompt
    });
  }catch(e){
    console.error('[IMAGE_V4_FAILED]',JSON.stringify({
      message:e?.message||String(e),
      name:e?.name||null
    }));
    return res.status(502).json({
      ok:false,
      error:'IMAGE_V4_FAILED',
      detail:e?.message||String(e)
    });
  }
}
