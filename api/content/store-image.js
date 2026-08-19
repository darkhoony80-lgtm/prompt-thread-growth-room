import {put} from '@vercel/blob';

function decode(dataUrl=''){
  const m=String(dataUrl).match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if(!m)return null;
  return {mime:m[1],buffer:Buffer.from(m[2],'base64')};
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const d=decode(req.body?.data_url);
  if(!d)return res.status(400).json({ok:false,error:'IMAGE_DATA_REQUIRED'});
  if(d.buffer.length>4_000_000)return res.status(413).json({ok:false,error:'IMAGE_TOO_LARGE'});
  const id=String(req.body?.candidate_id||Date.now()).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,70);
  const ext=d.mime==='image/png'?'png':d.mime==='image/webp'?'webp':'jpg';
  try{
    // Latest @vercel/blob uses the Vercel project's connected Blob credentials/OIDC automatically.
    const blob=await put(`threads-growth/${Date.now()}-${id}.${ext}`,d.buffer,{
      access:'public',
      addRandomSuffix:true,
      contentType:d.mime,
      cacheControlMaxAge:31536000
    });
    return res.status(200).json({ok:true,url:blob.url,pathname:blob.pathname});
  }catch(e){
    console.error('[BLOB_UPLOAD_FAILED]',JSON.stringify({message:e.message,name:e.name}));
    return res.status(502).json({ok:false,error:'BLOB_UPLOAD_FAILED',detail:e.message});
  }
}
