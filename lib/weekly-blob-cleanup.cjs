'use strict';
const {timingSafeEqual}=require('node:crypto');

const STORE_ID='store_ZYN0abaBjaklf71q';
const PROJECT_ID='prj_4qeb1U0iqmZ7soxcqiRKfNO7WTAq';
const RETENTION_MS=7*24*60*60*1000;
const MEDIA_PATH=/^(?:threads-growth|content-master|instagram-webtoon-cuts|instagram-carousel)\/.+\.(?:jpe?g|png|webp|gif|mp4|mov)$/i;

function createHandler({env=process.env,loadBlob=()=>import('@vercel/blob'),now=Date.now,log=console}={}){
  return async function handler(req,res){
    res.setHeader('Cache-Control','no-store');
    const send=(status,body)=>res.status(status).json(body);
    if(req.method!=='GET'){res.setHeader('Allow','GET');return send(405,{ok:false,error:'METHOD_NOT_ALLOWED'})}
    const secret=env.CRON_SECRET;
    const actual=Buffer.from(String(req.headers?.authorization||''));
    const expected=Buffer.from(`Bearer ${secret||''}`);
    if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return send(401,{ok:false,error:'UNAUTHORIZED'});
    // Fail closed if this route is copied, the connected store changes, or it runs in preview.
    if(env.VERCEL_ENV!=='production'||env.VERCEL_PROJECT_ID!==PROJECT_ID||env.BLOB_STORE_ID!==STORE_ID)return send(503,{ok:false,error:'CLEANUP_TARGET_MISMATCH'});
    const dryRun=req.query?.dry_run==='1';
    const cutoff=now()-RETENTION_MS;
    let deleted=0;
    try{
      const blob=await loadBlob();
      const files=[],seen=new Set();let cursor;
      // Collect all pages BEFORE deleting: deletion must not invalidate pagination.
      for(let page=0;page<100;page++){
        const result=await blob.list({storeId:STORE_ID,limit:1000,...(cursor?{cursor}:{})});
        if(!Array.isArray(result.blobs))throw new Error('BLOB_LIST_INVALID');
        files.push(...result.blobs);
        if(!result.hasMore)break;
        if(!result.cursor||seen.has(result.cursor)||page===99)throw new Error('BLOB_LIST_INCOMPLETE');
        seen.add(result.cursor);cursor=result.cursor;
      }
      const report=files.map(file=>{
        const uploaded=typeof file.uploadedAt==='string'||file.uploadedAt instanceof Date?new Date(file.uploadedAt).getTime():NaN;
        let safeUrl=false;
        try{const u=new URL(file.url);safeUrl=u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/i.test(u.hostname)&&decodeURIComponent(u.pathname.slice(1))===file.pathname}catch{}
        const eligible=safeUrl&&MEDIA_PATH.test(String(file.pathname))&&Number.isFinite(uploaded)&&uploaded<=cutoff;
        return {pathname:file.pathname,size:file.size,uploaded_at:Number.isFinite(uploaded)?new Date(uploaded).toISOString():null,eligible,url:file.url,etag:file.etag};
      });
      const eligible=report.filter(file=>file.eligible);
      if(!dryRun){
        for(const file of eligible){
          // No per-file head polling. If the object changed since listing, retain it.
          if(!file.etag)continue;
          try{await blob.del(file.url,{storeId:STORE_ID,ifMatch:file.etag});deleted++}
          catch(error){if(error.name==='BlobPreconditionFailedError')continue;throw error}
        }
      }
      const summary={ok:true,dry_run:dryRun,store_id:STORE_ID,cutoff:new Date(cutoff).toISOString(),scanned:report.length,eligible:eligible.length,deleted,retained:report.length-deleted};
      log.info('[WEEKLY_BLOB_CLEANUP]',JSON.stringify(summary));
      return send(200,{...summary,...(dryRun?{files:report.map(({etag,...file})=>file)}:{})});
    }catch(error){
      // Never log credentials, request headers or full provider error bodies.
      log.error('[WEEKLY_BLOB_CLEANUP_FAILED]',JSON.stringify({type:String(error?.name||'Error'),deleted}));
      return send(502,{ok:false,error:'WEEKLY_BLOB_CLEANUP_FAILED',deleted});
    }
  };
}
module.exports={createHandler,STORE_ID,PROJECT_ID,RETENTION_MS};

