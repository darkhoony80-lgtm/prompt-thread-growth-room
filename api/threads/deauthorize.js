import {clearSession} from '../../lib-threads-session.js';
export default function handler(req,res){res.setHeader('Cache-Control','no-store');clearSession(res);res.status(200).json({ok:true,deauthorized:true,storedServerUserData:false})}
