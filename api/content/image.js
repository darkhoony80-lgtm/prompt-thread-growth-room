const MODEL='gemini-3.1-flash-image';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const key=process.env.GEMINI_API_KEY;
  if(!key)return res.status(503).json({ok:false,error:'GEMINI_NOT_CONFIGURED'});
  const prompt=String(req.body?.prompt||'').trim();
  if(!prompt)return res.status(400).json({ok:false,error:'PROMPT_REQUIRED'});
  const input=`${prompt}
STRICT DESIGN RULES: portrait 4:5 composition. Do not draw any words, letters, captions, logos, watermarks, UI or fake headlines. Reserve calm negative space across the upper 28% for a Korean headline that will be overlaid later. Put the strongest visual subject in the center/lower area. Editorial, premium, mobile-feed readable.`;
  const r=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{
    method:'POST',
    headers:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify({model:MODEL,input,response_format:{type:'image',mime_type:'image/jpeg',aspect_ratio:'4:5',image_size:'1K'}})
  });
  const j=await r.json().catch(()=>({}));
  if(!r.ok)return res.status(502).json({ok:false,error:'GEMINI_IMAGE_FAILED',detail:j?.error||j});
  const data=j?.output_image?.data;
  if(!data)return res.status(502).json({ok:false,error:'GEMINI_IMAGE_MISSING'});
  return res.status(200).json({ok:true,mime_type:j?.output_image?.mime_type||'image/jpeg',data});
}
