#!/usr/bin/env node
'use strict';
/**
 * Attach media (provider/id/start) to daily_auto.json pick for a given date.
 * Priority: already-present > enriched JSONL > dataset.json. Provider priority: apple > youtube.
 */
const fs = require('fs');

function readJSON(p){ return JSON.parse(fs.readFileSync(p,'utf-8')); }
function exists(p){ try{ return p && fs.existsSync(p);}catch(_){ return false; } }
function readJSONL(p){
  return fs.readFileSync(p,'utf-8')
    .split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(l=>JSON.parse(l));
}
function norm(s){ return String(s||'').normalize('NFKC').trim().toLowerCase(); }
function sameCore(a,b){
  const at = a?.norm?.title ?? a?.title, ag = a?.norm?.game ?? a?.game, ac = a?.norm?.composer ?? a?.composer;
  const bt = b?.norm?.title ?? b?.title, bg = b?.norm?.game ?? b?.game, bc = b?.norm?.composer ?? b?.composer;
  return norm(at)===norm(bt) && norm(ag)===norm(bg) && norm(ac)===norm(bc);
}

function parseYoutubeId(v){
  if (!v) return null;
  if (/^[\w-]{11}$/.test(String(v))) return String(v);
  try {
    const s = String(v);
    const m = s.match(/(?:v=|youtu\.be\/|\/embed\/)([\w-]{11})/);
    return m ? m[1] : null;
  } catch { return null; }
}
function parseAppleId(v){
  if (!v) return null;
  try {
    const u = new URL(String(v));
    const i = u.searchParams.get('i');
    if (i && /^\d+$/.test(i)) return i;
    const segs = u.pathname.split('/').filter(Boolean);
    const last = segs[segs.length-1];
    if (/^\d+$/.test(last)) return last;
    return null;
  } catch {
    return /^\d+$/.test(String(v)) ? String(v) : null;
  }
}

function extractMediaFromObj(o){
  if (!o || typeof o!=='object') return null;
  if (o.media && o.media.provider && o.media.id) {
    return { provider:o.media.provider, id:o.media.id, start:o.media.start };
  }
  const yt = o.youtube_id || o.youtubeId || o.yt || o.videoId || o.youtube_url || o.youtubeUrl || (o.links && o.links.youtube);
  const ap = o.apple_id || o.appleId || o.apple_url || o.appleUrl || (o.links && o.links.apple) || o.apple_music_id || o.appleMusicId;
  const out = {};
  const yid = parseYoutubeId(yt);
  const aid = parseAppleId(ap);
  if (aid) out.apple = { provider:'apple', id:aid };
  if (yid) out.youtube = { provider:'youtube', id:yid };
  let start = undefined;
  if (o.media && typeof o.media.start==='number') start = o.media.start;
  if (typeof o.start==='number') start = o.start;
  if (o.start_seconds && Number.isFinite(+o.start_seconds)) start = +o.start_seconds;
  return (out.apple || out.youtube) ? ({ ...(out.apple || out.youtube), start }) : null;
}

function tryFromEnriched(enrichedPath, chosen){
  if (!exists(enrichedPath)) return null;
  try {
    const rows = readJSONL(enrichedPath);
    const hit = rows.find(r => sameCore(r, chosen));
    return extractMediaFromObj(hit);
  } catch (e) {
    console.warn('[attach-media] enriched read fail:', e.message);
    return null;
  }
}
function tryFromDataset(datasetPath, chosen){
  if (!exists(datasetPath)) return null;
  try {
    const data = readJSON(datasetPath);
    const tracks = Array.isArray(data) ? data : (Array.isArray(data.tracks) ? data.tracks : []);
    const hit = tracks.find(t => norm(t.title)===norm(chosen.title));
    if (hit && hit.media && hit.media.provider && hit.media.id) {
      const m = { provider: hit.media.provider, id: String(hit.media.id), start: hit.media.start };
      return m;
    }
    return null;
  } catch (e) {
    console.warn('[attach-media] dataset read fail:', e.message);
    return null;
  }
}

function main(){
  const args = process.argv.slice(2);
  function arg(name, def){ const i=args.indexOf(name); return i>=0 ? args[i+1] : def; }
  const date = arg('--date', (new Date(Date.now()+9*3600*1000)).toISOString().slice(0,10));
  const dailyPath = arg('--daily', 'public/app/daily_auto.json');
  const datasetPath = arg('--dataset', 'public/build/dataset.json');
  const enrichedPath = arg('--enriched', 'public/app/daily_candidates_scored_enriched.jsonl');

  if (!exists(dailyPath)) { console.error('[attach-media] not found:', dailyPath); process.exit(0); }
  const daily = readJSON(dailyPath);
  daily.by_date = daily.by_date || {};
  const pick = daily.by_date[date];
  if (!pick) { console.warn('[attach-media] no entry for', date); process.exit(0); }

  if (pick.media && pick.media.provider && pick.media.id) {
    console.log('[attach-media] media already present for', date, pick.media);
    process.exit(0);
  }
  let media = null;
  media = media || tryFromEnriched(enrichedPath, pick);
  media = media || tryFromDataset(datasetPath, pick);
  if (!media) {
    console.warn('[attach-media] no media found for', date, pick.title, '/', pick.game, '/', pick.composer);
  } else {
    pick.media = { provider: media.provider, id: media.id };
    if (Number.isFinite(media.start)) pick.media.start = media.start;
    console.log('[attach-media] media attached:', pick.media);
    fs.writeFileSync(dailyPath, JSON.stringify(daily, null, 2));
  }
}

if (require.main === module) main();
