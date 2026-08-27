import {getValidSession} from '../lib-threads-session.js';

export default async function handler(req,res){
  const s=await getValidSession(req,res);
  res.setHeader('Cache-Control','no-store');
  res.status(200).json({
    threads:Boolean(s?.accessToken&&s?.userId),
    threadsAppConfigured:Boolean(process.env.THREADS_APP_ID&&process.env.THREADS_APP_SECRET),
    threadsUserId:s?.userId||null,
    threadsTokenType:s?.tokenType||null,
    threadsTokenExpiresAt:s?.expiresAt||null,
    gemini:Boolean(process.env.GEMINI_API_KEY),
    youtubeConfigured:Boolean(process.env.YOUTUBE_CLIENT_ID&&process.env.YOUTUBE_CLIENT_SECRET&&process.env.YOUTUBE_REFRESH_TOKEN),
    database:false,
    mode:'approval-first',
    backgroundAutomation:false,
    timezone:'Asia/Seoul'
  });
}
