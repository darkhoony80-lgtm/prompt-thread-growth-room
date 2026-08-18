export default function handler(req,res){res.setHeader('Cache-Control','no-store');res.status(200).json({status:'completed',message:'서버 DB에 사용자별 Threads 데이터를 저장하지 않는 현재 버전에서는 삭제할 서버 레코드가 없습니다.'})}
