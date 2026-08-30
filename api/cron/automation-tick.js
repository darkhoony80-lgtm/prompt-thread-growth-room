const crypto = require('node:crypto');
const { createCard } = require('../_lib/cards');
const { rest } = require('../_lib/supabase');
const { publishImage, serializeError } = require('../_lib/facebook');
const { generateWithGemini, isRecentDuplicate } = require('../cards/ai-generate');
const { authorized, getSettings, dueSlots, chooseCategory, chooseCharacterMap, stableUuid } = require('../_lib/automation');
const { renderServerCardPng } = require('../_lib/server-card-renderer');
const { revealOne } = require('./reveal-answers');

async function recentHistory() {
  return rest('voara_fb_contents?select=question,fingerprint&content_type=eq.quiz&order=created_at.desc&limit=30');
}
async function claimRun(slot) {
  const id = stableUuid(`automation-run:${slot.localDate}:${slot.time}:${slot.index}`);
  const rows = await rest('voara_fb_contents?on_conflict=id', { method:'POST', prefer:'resolution=ignore-duplicates,return=representation', body:{ id, content_type:'media', status:'ready', body:`VOARA automation ${slot.localDate} #${slot.index}`, metadata:{ system_record:'automation_run', local_date:slot.localDate, slot_index:slot.index, scheduled_time:slot.time, run_status:'processing', started_at:new Date().toISOString() } } });
  if (rows[0]) return rows[0];
  const existing = (await rest(`voara_fb_contents?select=*&id=eq.${encodeURIComponent(id)}&limit=1`))[0];
  if (!existing || existing.status !== 'failed') return null;
  const reclaimed = await rest(`voara_fb_contents?id=eq.${encodeURIComponent(id)}&status=eq.failed`, { method:'PATCH', body:{ status:'ready', metadata:{ ...(existing.metadata||{}), run_status:'processing', restarted_at:new Date().toISOString() }, updated_at:new Date().toISOString() } });
  return reclaimed[0] || null;
}
async function saveContentAndPublish({ card, localization, characterId, category, answerDelayHours }) {
  const imageBase64 = await renderServerCardPng({ card, localization, language:card.language, characterId, category });
  await rest('voara_fb_contents?on_conflict=id', { method:'POST', prefer:'resolution=merge-duplicates,return=representation', body:{ id:card.id, content_type:'quiz', language:card.language, status:'ready', question:card.question, choices:card.choices, correct_answer:card.correct_answer, fingerprint:card.fingerprint, metadata:{ category, localization, character_id:characterId, automated:true }, updated_at:new Date().toISOString() } });
  const pubRows = await rest('voara_fb_publications?on_conflict=content_id', { method:'POST', prefer:'resolution=ignore-duplicates,return=representation', body:{ content_id:card.id, status:'pending', answer_delay_hours:answerDelayHours } });
  let pub = pubRows[0];
  if (!pub) pub = (await rest(`voara_fb_publications?select=*&content_id=eq.${encodeURIComponent(card.id)}&limit=1`))[0];
  if (pub?.status==='published') return { language:card.language, post_id:pub.facebook_post_id, reused:true };
  const claimed = await rest(`voara_fb_publications?id=eq.${encodeURIComponent(pub.id)}&status=in.(pending,failed)`, { method:'PATCH', body:{ status:'publishing', updated_at:new Date().toISOString(), error_code:null, error_message:null } });
  if (!claimed.length) throw Object.assign(new Error('자동 발행 선점 실패'),{ code:'AUTO_PUBLICATION_NOT_CLAIMED' });
  let posted;
  try {
    const caption = localization.caption || '정답 번호를 댓글로 남겨주세요 💗';
    posted = await publishImage({ caption, imageBase64, fileName:`voara-${card.language}-${card.id}.png` });
    const publishedAt = new Date(); const revealAt = new Date(publishedAt.getTime()+answerDelayHours*3600000);
    await rest(`voara_fb_publications?id=eq.${encodeURIComponent(pub.id)}&status=eq.publishing`, { method:'PATCH', body:{ facebook_post_id:posted.post_id, page_id:posted.page_id, status:'published', published_at:publishedAt.toISOString(), answer_delay_hours:answerDelayHours, answer_reveal_at:revealAt.toISOString(), answer_revealed:false, answer_reveal_status:'pending', updated_at:publishedAt.toISOString() } });
    return { language:card.language, post_id:posted.post_id, answer_reveal_at:revealAt.toISOString() };
  } catch (error) {
    if (!posted) { const d=serializeError(error); await rest(`voara_fb_publications?id=eq.${encodeURIComponent(pub.id)}&status=eq.publishing`,{method:'PATCH',body:{status:'failed',error_code:String(d.code),error_message:d.message,updated_at:new Date().toISOString()}}).catch(()=>null); }
    throw error;
  }
}
async function processSlot(slot, settings) {
  const run = await claimRun(slot); if (!run) return { slot:slot.index, status:'duplicate_skipped' };
  const category = chooseCategory(settings.categoryMode, slot.localDate, slot.index);
  const characters = chooseCharacterMap(slot.localDate, slot.index);
  try {
    const recent = await recentHistory();
    let generated = await generateWithGemini(category, recent, false); let calls=1;
    if (isRecentDuplicate(generated.quiz,recent)) { generated=await generateWithGemini(category,recent,true); calls++; }
    const quiz = generated.quiz;
    const master = createCard({ type:'quiz', question:quiz.question, choices:quiz.choices, correct_index:quiz.correctAnswer-1, last_language:'vi' });
    const results=[];
    for (const language of ['en','ar','th','vi']) {
      const card = { ...master, id:stableUuid(`automation-card:${slot.localDate}:${slot.time}:${slot.index}:${language}`), language, category, master_id:master.id };
      try {
        results.push(await saveContentAndPublish({ card, localization:quiz.localizations[language], characterId:characters[language], category, answerDelayHours:settings.answerDelayHours }));
      } catch (error) {
        results.push({ language, status:'failed', error:serializeError(error) });
      }
    }
    const failed = results.filter(r=>r.status==='failed');
    const completed = failed.length===0;
    await rest(`voara_fb_contents?id=eq.${encodeURIComponent(run.id)}`, { method:'PATCH', body:{ status:completed?'published':'failed', metadata:{ ...(run.metadata||{}), system_record:'automation_run', local_date:slot.localDate, slot_index:slot.index, scheduled_time:slot.time, run_status:completed?'completed':'failed', gemini_calls:calls, published_count:results.length-failed.length, failed_languages:failed.map(r=>r.language), category, characters, results, completed_at:new Date().toISOString() }, updated_at:new Date().toISOString() } });
    return { slot:slot.index, status:completed?'completed':'partial_failed', category, gemini_calls:calls, results };
  } catch (error) {
    const d=serializeError(error); await rest(`voara_fb_contents?id=eq.${encodeURIComponent(run.id)}`, { method:'PATCH', body:{ status:'failed', metadata:{ ...(run.metadata||{}), system_record:'automation_run', local_date:slot.localDate, slot_index:slot.index, scheduled_time:slot.time, run_status:'failed', error_code:String(d.code), error_message:d.message, completed_at:new Date().toISOString() }, updated_at:new Date().toISOString() } }).catch(()=>null);
    return { slot:slot.index, status:'failed', error:d };
  }
}
async function processReveals(limit = 1) {
  const now = new Date().toISOString();
  const safeLimit = Math.min(3, Math.max(0, Number(limit) || 0));
  if (!safeLimit) return [];
  const pubs = await rest(`voara_fb_publications?select=*&status=eq.published&answer_revealed=eq.false&answer_reveal_at=lte.${encodeURIComponent(now)}&answer_reveal_status=in.(pending,failed)&answer_reveal_attempts=lt.3&order=answer_reveal_at.asc&limit=${safeLimit}`);
  const results=[];
  for (const p of pubs) results.push(await revealOne(p));
  return results;
}
module.exports = async function handler(req,res) {
  if (req.method!=='GET') return res.status(405).json({ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'GET만 지원합니다.'}});
  if (!authorized(req)) return res.status(401).json({ok:false,error:{code:'UNAUTHORIZED',message:'Cron 인증 실패'}});
  try {
    const settings=await getSettings();
    if (!settings.enabled) {
      const reveals=await processReveals(1);
      return res.status(200).json({ok:true, enabled:false, publications:[], reveals});
    }

    const slots=dueSlots(settings,new Date(),45);
    const publications=[];

    // Scheduled publishing always gets the function budget first.
    // Old answer-reveal retries must never block a due Facebook publish slot.
    for (const slot of slots) publications.push(await processSlot(slot,settings));

    // Reveal at most one due answer only when there is no publish slot to process.
    // This prevents stale Graph API failures from consuming the whole invocation.
    const reveals=slots.length ? [] : await processReveals(1);

    return res.status(200).json({ok:true, enabled:true, checked_at:new Date().toISOString(), publications, reveals});
  } catch(error) { const d=serializeError(error); return res.status(d.status||500).json({ok:false,error:d}); }
};
module.exports.processSlot = processSlot;
