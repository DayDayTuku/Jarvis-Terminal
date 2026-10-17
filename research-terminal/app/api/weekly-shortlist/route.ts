import { NextRequest, NextResponse } from "next/server";
import { createClient } from "../../../utils/supabase/server";
import {
  deriveStatus,
  isShortSetup,
  type LifecycleActionName,
  type PriceBar,
} from "@/lib/weekly-lifecycle";
import { buildLifecycle, carriedPositions, recentRunsBefore } from "@/lib/weekly-positions";

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
// Internal dedupe markers are stored inside the reason; never show them to users.
function stripAlertMarkers(value: unknown) {
  return String(value ?? "").replace(/\s*\[(?:stop|target)-alert:sent\]\s*/g, " ").trim();
}
type EmailCandidate = {
  run_id?: string; ticker: string; setup: string; score: number; signal_close?: number;
  planned_entry_low: number; planned_entry_high: number; invalidation: number; hard_stop?: number;
  target_one?: number; position_weight: number;
};
type LifecycleAction = {
  run_id?: string; prior_run_id?: string|null; ticker: string;
  action: LifecycleActionName;
  previous_score: number|null; current_score: number|null; target_weight: number;
  theoretical_fill: number|null; entry_filled: boolean; target_reached: boolean;
  invalidated: boolean; reason: string;
};
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

async function sendWeeklyDigest(weekOf:string,marketRegime:string,candidates:EmailCandidate[],actions:LifecycleAction[]) {
  const apiKey=process.env.RESEND_API_KEY;
  const recipients=(process.env.JARVIS_EMAIL_TO||"iggerzefanya@gmail.com,ghazaerland@gmail.com").split(",").map((email)=>email.trim()).filter(Boolean);
  if(!apiKey) return {sent:false,reason:"not_configured"};
  const candidateByTicker=new Map(candidates.map((item)=>[item.ticker,item]));
  const actionRows=actions.length?actions.map((item)=>`<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700">${escapeHtml(item.ticker)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700">${item.action==="BUY"&&isShortSetup(candidateByTicker.get(item.ticker)??{})?"SHORT":item.action}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right">${item.target_weight.toFixed(1)}%</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(stripAlertMarkers(item.reason))}</td></tr>`).join(""):'<tr><td colspan="4" style="padding:16px;color:#6b7280">No prior-position action this week.</td></tr>';
  const rows=candidates.length?candidates.map((item)=>`<tr><td style="padding:9px;border-bottom:1px solid #e5e7eb;font-weight:700">${escapeHtml(item.ticker)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.setup)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(item.score).toFixed(1)}</td><td style="padding:9px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(item.planned_entry_low).toLocaleString("id-ID")}–${Number(item.planned_entry_high).toLocaleString("id-ID")}</td></tr>`).join(""):'<tr><td colspan="4" style="padding:16px;color:#6b7280">No qualified setup. Capital remains in cash.</td></tr>';
  const html=`<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#111827"><div style="max-width:760px;margin:auto;padding:28px 16px"><div style="background:#111827;color:#fff;padding:24px;border-radius:14px 14px 0 0"><div style="font-size:12px;letter-spacing:2px;color:#9ca3af">JARVIS RESEARCH TERMINAL</div><h1 style="margin:8px 0 6px">V5 Weekly Picks</h1><div style="color:#d1d5db">Week of ${escapeHtml(weekOf)} · ${escapeHtml(marketRegime)}</div></div><div style="background:#fff;padding:22px;border-radius:0 0 14px 14px"><h2 style="font-size:16px">What to do with last week</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#1f3c52;color:white"><th style="padding:9px;text-align:left">Ticker</th><th style="padding:9px;text-align:left">Action</th><th style="padding:9px;text-align:right">Target weight</th><th style="padding:9px;text-align:left">Why</th></tr></thead><tbody>${actionRows}</tbody></table><h2 style="font-size:16px;margin-top:24px">This week's picks</h2><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#1f3c52;color:white"><th style="padding:9px;text-align:left">Ticker</th><th style="padding:9px;text-align:left">Setup</th><th style="padding:9px;text-align:right">Score</th><th style="padding:9px;text-align:right">Entry range</th></tr></thead><tbody>${rows}</tbody></table><p style="margin-top:20px;color:#6b7280;font-size:12px">Rules-based research output, not investment advice. Every pick will be reviewed in the following weekly update with a HOLD, REDUCE, EXIT, NO_ENTRY, or EXPIRED status. NO_ENTRY means do not chase above the range.</p></div></div></body></html>`;
  try { const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.JARVIS_EMAIL_FROM||"Jarvis Beta <onboarding@resend.dev>",to:process.env.JARVIS_EMAIL_FROM?recipients:recipients.slice(0,1),subject:`JARVIS V5 · Weekly Picks · ${weekOf}`,html})}); if(!response.ok)return{sent:false,reason:"provider_error",status:response.status}; const data=await response.json() as {id?:string}; return{sent:true,id:data.id??null}; } catch{return{sent:false,reason:"network_error"};}
}

export async function GET(){
  const supabase=await createClient(); const{data:{user}}=await supabase.auth.getUser();
  if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  const{data:run,error}=await supabase.from("jarvis_weekly_runs").select("*").order("week_of",{ascending:false}).limit(1).maybeSingle();
  if(error)return NextResponse.json({error:"Weekly tracking is unavailable."},{status:503});
  if(!run)return NextResponse.json({run:null,candidates:[],reviews:[],actions:[],canLock:isAdmin(user)&&mayLockNow()});
  const[{data:candidates},{data:reviews},{data:actions}]=await Promise.all([supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",run.id).order("rank"),supabase.from("jarvis_weekly_reviews").select("*").eq("run_id",run.id).eq("user_id",user.id),supabase.from("jarvis_weekly_actions").select("*").eq("run_id",run.id).order("created_at")]);
  const actionsWithStatus=(actions??[]).map((action:LifecycleAction)=>({...action,status:deriveStatus({action:action.action,entryFilled:Boolean(action.entry_filled),targetReached:Boolean(action.target_reached),invalidated:Boolean(action.invalidated)})}));
  return NextResponse.json({run,candidates:candidates??[],reviews:reviews??[],actions:actionsWithStatus,canLock:isAdmin(user)&&mayLockNow(),currentWeek:fridayOfCurrentWeek()});
}

export async function POST(request:NextRequest){
  const supabase=await createClient(); const{data:{user}}=await supabase.auth.getUser();
  if(!user||!isAdmin(user))return NextResponse.json({error:"Admin required"},{status:403});
  if(!mayLockNow())return NextResponse.json({error:"Forward snapshots can only be locked after Friday 16:00 WIB."},{status:400});
  const body:any=await request.json(); const incoming=Array.isArray(body?.candidates)?body.candidates:[]; let shortSeen=false,longCount=0; const rows=incoming.filter((item:any)=>{if(isShortSetup(item)){if(shortSeen)return false;shortSeen=true;return Number(item.score)>=85&&Number(item.riskReward)>=2&&Number(item.positionWeight)<=8;}if(longCount>=5)return false;longCount+=1;return true;}).slice(0,6); const weekOf=fridayOfCurrentWeek();
  const{data:existing}=await supabase.from("jarvis_weekly_runs").select("id").eq("week_of",weekOf).maybeSingle(); if(existing)return NextResponse.json({ok:true,alreadyLocked:true});
  const{data:priorRun}=await supabase.from("jarvis_weekly_runs").select("*").lt("week_of",weekOf).order("week_of",{ascending:false}).limit(1).maybeSingle();
  const{data:priorCandidates}=priorRun?await supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",priorRun.id).order("rank"):{data:[]};
  const marketRegime=String(body?.marketRegime??"UNKNOWN").slice(0,40);
  const{data:run,error:runError}=await supabase.from("jarvis_weekly_runs").insert({week_of:weekOf,snapshot_kind:"forward",methodology_version:"v5",status:"locked",market_regime:marketRegime,note:rows.length?"V5 Weekly Picks with lifecycle actions.":"No qualified setup this week."}).select().single();
  if(runError||!run)return NextResponse.json({error:"Unable to lock weekly run."},{status:500});
  let candidates:EmailCandidate[]=[];
  if(rows.length){candidates=rows.map((item:any,index:number)=>({run_id:run.id,rank:index+1,ticker:String(item.ticker).slice(0,12),setup:String(item.setup).slice(0,30),score:Number(item.score),signal_close:Number(item.close),planned_entry_low:Number(item.entryLow),planned_entry_high:Number(item.entryHigh),invalidation:Number(item.invalidation),hard_stop:isShortSetup(item)?Number(item.close)*1.06:Number(item.close)*.94,target_one:Number(item.target),risk_reward:Number(item.riskReward),position_size_idr:Math.min(1250000,75000/Math.max(.01,Math.abs(Number(item.close)-Number(item.invalidation))/Number(item.close))),position_weight:Number.isFinite(Number(item.positionWeight))?Math.max(0,Math.min(100,Number(item.positionWeight))):12.5,reasons:Array.isArray(item.reasons)?item.reasons.slice(0,4):[],caution:String(item.caution??"").slice(0,500)})); const{error}=await supabase.from("jarvis_weekly_candidates").insert(candidates); if(error)return NextResponse.json({error:"Run locked, but candidates could not be saved."},{status:500});}
  const carryRuns=await recentRunsBefore(supabase,weekOf);
  const carried=await carriedPositions(supabase,carryRuns,new Set([...(priorCandidates??[]).map((item:any)=>item.ticker),...candidates.map((item)=>item.ticker)]));
  const actions=await buildLifecycle({runId:run.id,priorRun,prior:priorCandidates??[],current:candidates,carried,getBars});
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
