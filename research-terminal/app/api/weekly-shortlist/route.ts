import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../utils/supabase/server";

function isAdmin(user: { app_metadata?: Record<string, unknown> } | null) {
  return user?.app_metadata?.role === "admin";
}
function fridayOfCurrentWeek() {
  const now = new Date();
  const wib = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const day = wib.getDay();
  const diff = day >= 5 ? day - 5 : day + 2;
  wib.setDate(wib.getDate() - diff);
  return `${wib.getFullYear()}-${String(wib.getMonth()+1).padStart(2,"0")}-${String(wib.getDate()).padStart(2,"0")}`;
}
function mayLockNow() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone:"Asia/Jakarta", weekday:"short", hour:"2-digit", minute:"2-digit", hour12:false }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return value.weekday === "Fri" && Number(value.hour) >= 16;
}
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[char] ?? char));
}
type EmailCandidate = {
  run_id?: string; ticker: string; setup: string; score: number; signal_close?: number;
  planned_entry_low: number; planned_entry_high: number; invalidation: number; hard_stop?: number;
  target_one?: number; position_weight: number;
};
type LifecycleAction = {
  run_id?: string; prior_run_id?: string; ticker: string;
  action: "BUY"|"HOLD"|"REDUCE"|"EXIT"|"REPLACE"|"NO_ENTRY"|"EXPIRED";
  previous_score: number|null; current_score: number|null; target_weight: number;
  theoretical_fill: number|null; entry_filled: boolean; target_reached: boolean;
  invalidated: boolean; reason: string;
};
type PriceBar = { open:number; high:number; low:number; close:number };

async function getBars(ticker:string, since:string):Promise<PriceBar[]> {
  try {
    const period1=Math.floor(new Date(`${since}T00:00:00+07:00`).getTime()/1000);
    const response=await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.JK?period1=${period1}&period2=${Math.floor(Date.now()/1000)+86400}&interval=1d`,{cache:"no-store"});
    if(!response.ok) return [];
    const json:any=await response.json();
    const quote=json?.chart?.result?.[0]?.indicators?.quote?.[0];
    if(!quote) return [];
    return (quote.open??[]).map((open:number|null,index:number)=>({open:Number(open),high:Number(quote.high?.[index]),low:Number(quote.low?.[index]),close:Number(quote.close?.[index])})).filter((bar:PriceBar)=>Object.values(bar).every(Number.isFinite));
  } catch { return []; }
}

async function buildLifecycle(runId:string, priorRun:any, priorCandidates:any[], currentCandidates:EmailCandidate[]):Promise<LifecycleAction[]> {
  const currentByTicker=new Map(currentCandidates.map((item)=>[item.ticker,item]));
  const actions:LifecycleAction[]=[];
  if(priorRun) {
    for(const prior of priorCandidates) {
      const bars=await getBars(prior.ticker,priorRun.week_of);
      const touchIndex=bars.findIndex((bar)=>bar.high>=Number(prior.planned_entry_low)&&bar.low<=Number(prior.planned_entry_high));
      const entryFilled=touchIndex>=0;
      const fill=entryFilled ? Math.min(Number(prior.planned_entry_high),Math.max(Number(prior.planned_entry_low),bars[touchIndex].open)) : null;
      const activeBars=entryFilled ? bars.slice(touchIndex) : [];
      const invalidated=activeBars.some((bar)=>bar.low<=Number(prior.invalidation));
      const targetReached=activeBars.some((bar)=>bar.high>=Number(prior.target_one));
      const current=currentByTicker.get(prior.ticker);
      let action:LifecycleAction["action"]="HOLD";
      let targetWeight=Number(prior.position_weight)||12.5;
      let reason="Setup remains selected and its score is stable.";
      if(!entryFilled&&!current){ action="EXPIRED"; targetWeight=0; reason="Entry range was not filled and the name left the new basket."; }
      else if(invalidated){ action="EXIT"; targetWeight=0; reason="Price traded through the stated invalidation level; the thesis is no longer valid."; }
      else if(targetReached){ action="REDUCE"; targetWeight=Math.max(0,targetWeight/2); reason="First target was reached; lock part of the gain and trail the remainder."; }
      else if(!current){ action="EXIT"; targetWeight=0; reason="The name is no longer selected by V5; close the theoretical position at the next liquid session."; }
      else if(Number(current.score)<Number(prior.score)-5){ action="REDUCE"; targetWeight=Math.max(0,targetWeight/2); reason="Still selected, but score deteriorated by more than 5 points; reduce exposure."; }
      else if(!entryFilled){ action="NO_ENTRY"; targetWeight=0; reason="Setup is still valid, but the planned entry range has not traded; do not chase."; }
      actions.push({run_id:runId,prior_run_id:priorRun.id,ticker:prior.ticker,action,previous_score:Number(prior.score),current_score:current?Number(current.score):null,target_weight:targetWeight,theoretical_fill:fill,entry_filled:entryFilled,target_reached:targetReached,invalidated,reason});
    }
  }
  const priorTickers=new Set(priorCandidates.map((item)=>item.ticker));
  for(const item of currentCandidates) if(!priorTickers.has(item.ticker)) actions.push({run_id:runId,prior_run_id:priorRun?.id,ticker:item.ticker,action:"BUY",previous_score:null,current_score:Number(item.score),target_weight:Number(item.position_weight)||12.5,theoretical_fill:null,entry_filled:false,target_reached:false,invalidated:false,reason:priorRun?"New V5 qualifier replacing capacity released from the prior basket; use the stated entry range.":"Initial V5 forward basket; use the stated entry range and do not chase."});
  return actions;
}

async function sendWeeklyDigest(weekOf:string,marketRegime:string,candidates:EmailCandidate[],actions:LifecycleAction[]) {
  const apiKey=process.env.RESEND_API_KEY;
  const recipients=(process.env.JARVIS_EMAIL_TO||"iggerzefanya@gmail.com,ghazaerland@gmail.com").split(",").map((email)=>email.trim()).filter(Boolean);
  if(!apiKey) return {sent:false,reason:"not_configured"};
  const actionRows=actions.length?actions.map((item)=>`<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700">${escapeHtml(item.ticker)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700">${item.action}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right">${item.target_weight.toFixed(1)}%</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.reason)}</td></tr>`).join(""):"<tr><td colspan="4" style="padding:16px;color:#6b7280">No prior-position action this week.</td></tr>";
  const rows=candidates.length?candidates.map((item)=>`<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700">${escapeHtml(item.ticker)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.setup)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(item.score).toFixed(1)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(item.planned_entry_low).toLocaleString("id-ID")}–${Number(item.planned_entry_high).toLocaleString("id-ID")}</td></tr>`).join(""):"<tr><td colspan="4" style="padding:16px;color:#6b7280">No qualified setup. Capital remains in cash.</td></tr>";
  const html=`<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#111827"><div style="max-width:760px;margin:auto;padding:28px 16px"><div style="background:#111827;color:#fff;padding:24px;border-radius:14px 14px 0 0"><div style="font-size:12px;letter-spacing:2px;color:#9ca3af">JARVIS RESEARCH TERMINAL</div><h1 style="margin:8px 0 6px">V5 Weekly Portfolio Decision</h1><div style="color:#d1d5db">Week of ${escapeHtml(weekOf)} · ${escapeHtml(marketRegime)}</div></div><div style="background:#fff;padding:22px;border-radius:0 0 14px 14px"><h2 style="font-size:16px">What to do with last week</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#1f3c52;color:white"><th style="padding:9px;text-align:left">Ticker</th><th style="padding:9px;text-align:left">Action</th><th style="padding:9px;text-align:right">Target weight</th><th style="padding:9px;text-align:left">Why</th></tr></thead><tbody>${actionRows}</tbody></table><h2 style="font-size:16px;margin-top:24px">New weekly basket</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#1f3c52;color:white"><th style="padding:9px;text-align:left">Ticker</th><th style="padding:9px;text-align:left">Setup</th><th style="padding:9px;text-align:right">Score</th><th style="padding:9px;text-align:right">Entry range</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:20px;color:#6b7280;font-size:12px">Rules-based research output, not investment advice. NO_ENTRY means do not chase above the range.</p></div></div></body></html>`;
  try { const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.JARVIS_EMAIL_FROM||"Jarvis Beta <onboarding@resend.dev>",to:process.env.JARVIS_EMAIL_FROM?recipients:recipients.slice(0,1),subject:`JARVIS V5 · Portfolio actions · ${weekOf}`,html})}); if(!response.ok)return{sent:false,reason:"provider_error",status:response.status}; const data=await response.json() as {id?:string}; return{sent:true,id:data.id??null}; } catch{return{sent:false,reason:"network_error"};}
}

export async function GET(){
  const supabase=await createClient(); const{data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  const{data:run,error}=await supabase.from("jarvis_weekly_runs").select("*").order("week_of",{ascending:false}).limit(1).maybeSingle();
  if(error)return NextResponse.json({error:"Weekly tracking is unavailable."},{status:503});
  if(!run)return NextResponse.json({run:null,candidates:[],reviews:[],actions:[],canLock:isAdmin(user)&&mayLockNow()});
  const[{data:candidates},{data:reviews},{data:actions}]=await Promise.all([supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",run.id).order("rank"),supabase.from("jarvis_weekly_reviews").select("*").eq("run_id",run.id).eq("user_id",user.id),supabase.from("jarvis_weekly_actions").select("*").eq("run_id",run.id).order("created_at")]);
  return NextResponse.json({run,candidates:candidates??[],reviews:reviews??[],actions:actions??[],canLock:isAdmin(user)&&mayLockNow(),currentWeek:fridayOfCurrentWeek()});
}

export async function POST(request:NextRequest){
  const supabase=await createClient(); const{data:{user}}=await supabase.auth.getUser();
  if(!user||!isAdmin(user))return NextResponse.json({error:"Admin required"},{status:403});
  if(!mayLockNow())return NextResponse.json({error:"Forward snapshots can only be locked after Friday 16:00 WIB."},{status:400});
  const body:any=await request.json(); const rows=Array.isArray(body?.candidates)?body.candidates.slice(0,5):[]; const weekOf=fridayOfCurrentWeek();
  const{data:existing}=await supabase.from("jarvis_weekly_runs").select("id").eq("week_of",weekOf).maybeSingle(); if(existing)return NextResponse.json({ok:true,alreadyLocked:true});
  const{data:priorRun}=await supabase.from("jarvis_weekly_runs").select("*").lt("week_of",weekOf).order("week_of",{ascending:false}).limit(1).maybeSingle();
  const{data:priorCandidates}=priorRun?await supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",priorRun.id).order("rank"):{data:[]};
  const marketRegime=String(body?.marketRegime??"UNKNOWN").slice(0,40);
  const{data:run,error:runError}=await supabase.from("jarvis_weekly_runs").insert({week_of:weekOf,snapshot_kind:"forward",methodology_version:"v5",status:"locked",market_regime:marketRegime,note:rows.length?"V5 weekly portfolio decision with lifecycle actions.":"No qualified setup this week."}).select().single();
  if(runError||!run)return NextResponse.json({error:"Unable to lock weekly run."},{status:500});
  let candidates:EmailCandidate[]=[];
  if(rows.length){candidates=rows.map((item:any,index:number)=>({run_id:run.id,rank:index+1,ticker:String(item.ticker).slice(0,12),setup:String(item.setup).slice(0,30),score:Number(item.score),signal_close:Number(item.close),planned_entry_low:Number(item.entryLow),planned_entry_high:Number(item.entryHigh),invalidation:Number(item.invalidation),hard_stop:Number(item.close)*.94,target_one:Number(item.target),risk_reward:Number(item.riskReward),position_size_idr:Math.min(1250000,75000/Math.max(.01,(Number(item.close)-Number(item.invalidation))/Number(item.close))),position_weight:12.5,reasons:Array.isArray(item.reasons)?item.reasons.slice(0,4):[],caution:String(item.caution??"").slice(0,500)})); const{error}=await supabase.from("jarvis_weekly_candidates").insert(candidates); if(error)return NextResponse.json({error:"Run locked, but candidates could not be saved."},{status:500});}
  const actions=await buildLifecycle(run.id,priorRun,priorCandidates??[],candidates);
  if(actions.length){const{error}=await supabase.from("jarvis_weekly_actions").insert(actions); if(error)return NextResponse.json({error:"Run locked, but portfolio actions could not be saved."},{status:500});}
  const email=await sendWeeklyDigest(weekOf,marketRegime,candidates,actions);
  return NextResponse.json({ok:true,runId:run.id,actions,email},{status:201});
}

export async function PATCH(request:NextRequest){
  const supabase=await createClient(); const{data:{user}}=await supabase.auth.getUser(); if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  const body:any=await request.json(); const decision=["approved","rejected","pending"].includes(body?.decision)?body.decision:"pending";
  const payload={run_id:String(body.runId),candidate_id:String(body.candidateId),user_id:user.id,decision,checklist:body.checklist??{},note:String(body.note??"").slice(0,800),reviewed_at:new Date().toISOString()};
  const{error}=await supabase.from("jarvis_weekly_reviews").upsert(payload,{onConflict:"candidate_id,user_id"}); if(error)return NextResponse.json({error:"Review could not be saved."},{status:500}); return NextResponse.json({ok:true});
}
