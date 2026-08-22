const INSTAGRAM_API='https://graph.instagram.com/v25.0';
const PROFILE_FIELDS='user_id,username,account_type';

function safeMetaError(error,token){
  const code=Number(error?.code)||null;
  const type=String(error?.type||'').slice(0,80)||null;
  let message=String(error?.message||'').trim();
  if(token)message=message.split(token).join('[REDACTED]');
  message=message
    .replace(/(access[_\s-]?token\s*[=:]\s*)[^\s,;]+/gi,'$1[REDACTED]')
    .slice(0,300);
  return {
    ...(code?{code}:{}),
    ...(type?{type}:{}),
    ...(message?{message}:{})
  };
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Pragma','no-cache');

  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({
      ok:false,
      connected:false,
      error:'METHOD_NOT_ALLOWED'
    });
  }

  const token=String(process.env.INSTAGRAM_ACCESS_TOKEN||'').trim();
  if(!token){
    return res.status(503).json({
      ok:false,
      connected:false,
      error:'INSTAGRAM_ACCESS_TOKEN_NOT_CONFIGURED'
    });
  }

  let response;
  let body;
  try{
    const url=new URL(`${INSTAGRAM_API}/me`);
    url.searchParams.set('fields',PROFILE_FIELDS);
    response=await fetch(url,{
      method:'GET',
      headers:{
        Accept:'application/json',
        Authorization:`Bearer ${token}`
      }
    });
    body=await response.json().catch(()=>({}));
  }catch{
    return res.status(502).json({
      ok:false,
      connected:false,
      error:'INSTAGRAM_API_ERROR',
      meta:{message:'INSTAGRAM_REQUEST_FAILED'}
    });
  }

  if(!response.ok){
    const metaError=body?.error||{};
    const authenticationFailed=
      response.status===401||
      Number(metaError?.code)===190||
      String(metaError?.type||'').toLowerCase()==='oauthexception';
    return res.status(authenticationFailed?401:502).json({
      ok:false,
      connected:false,
      error:authenticationFailed?'INSTAGRAM_AUTH_FAILED':'INSTAGRAM_API_ERROR',
      meta:safeMetaError(metaError,token)
    });
  }

  const id=body?.user_id??body?.id;
  const username=String(body?.username||'').trim();
  if(id==null||!username){
    return res.status(502).json({
      ok:false,
      connected:false,
      error:'INSTAGRAM_API_INVALID_RESPONSE'
    });
  }

  return res.status(200).json({
    ok:true,
    connected:true,
    account:{
      id:String(id),
      username,
      ...(body?.account_type?{account_type:String(body.account_type)}:{})
    }
  });
}
