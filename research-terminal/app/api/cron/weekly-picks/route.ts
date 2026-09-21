import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

type Setup = { ticker:string; setup:string; score:number; close:number; sector?:string; entryLow:number; entryHigh:number; invalidation:number; target:number; riskReward:number; reasons?:string[]; caution?:string };
type Candidate = { run_id?:string; ticker:string; setup:string; score:number; signal_close?:number; planned_entry_low:number; planned_entry_high:number; invalidation:number; hard_stop?:number; target_one?:number; position_weight:number };
type Action = { run_id?:string; prior_run_id?:string; ticker:string; action:"BUY"|"HOLD"|"REDUCE"|"EXIT"|"NO_ENTRY"|"EXPIRED"; previous_score:number|null; current_score:number|null; target_weight:number; theoretical_fill:number|null; entry_filled:boolean; target_reached:boolean; invalidated:boolean; reason:string };
type Bar = { open:number; high:number; low:number; close:number };

function wibWeekday() { return new Intl.DateTimeFormat("en-US", { timeZone:"Asia/Jakarta", weekday:"short" }).format(new Date()); }
function currentFriday() {
  const wib = new Date(new Date().toLocaleString("en-US", { timeZone:"Asia/Jakarta" }));
  const day = wib.getDay();
  wib.setDate(wib.getDate() - (day >= 5 ? day - 5 : day + 2));
  return wib.getFullYear() + "-" + String(wib.getMonth() + 1).padStart(2,"0") + "-" + String(wib.getDate()).padStart(2,"0");
}
function escapeHtml(value:unknown) {
  const entities:Record<string,string> = { "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;" };
  return String(value ?? "").replace(/[&<>"']/g, (char) => entities[char] || char);
}
function regimeFor(setups:Setup[]) {
  const valid = setups.filter((item) => item.riskReward >= 1.7);
  const broad = valid.filter((item) => item.score >= 75).length;
  const strong = valid.filter((item) => item.score >= 85).length;
  return broad >= 5 ? "RISK ON" : broad >= 3 ? "EMERGING" : strong ? "NEUTRAL" : "RISK OFF";
}
function pick(setups:Setup[], regime:string) {
  if (regime === "RISK OFF") return [];
  const minimum = regime === "RISK ON" ? 75 : regime === "EMERGING" ? 80 : 85;
  const maximum = regime === "RISK ON" ? 5 : regime === "EMERGING" ? 3 : 1;
  const sectors = new Map<string,number>();
  return [...setups].sort((a,b) => b.score - a.score || b.riskReward - a.riskReward)
    .filter((item) => item.score >= minimum && item.riskReward >= 1.7)
    .filter((item) => { const sector=item.sector || "Other"; const count=sectors.get(sector) || 0; if(count >= 2) return false; sectors.set(sector,count+1); return true; })
    .slice(0,maximum);
}
function priceStep(price:number) { return price < 200 ? 1 : price < 500 ? 2 : price < 2000 ? 5 : price < 5000 ? 10 : 25; }
function alignPrice(price:number,direction:"up"|"down"|"nearest"="nearest") {
  const step=priceStep(price);
  const round=direction==="up"?Math.ceil:direction==="down"?Math.floor:Math.round;
  return round(price/step)*step;
}
function kind(item:{setup:string;score:number}) { return item.score>=85 && /(PULLBACK|ACCUMULATION|TREND)/.test(item.setup.toUpperCase()) ? "CORE" : "TACTICAL"; }
function weight(item:{setup:string;score:number},regime:string) { const base=kind(item)==="CORE"?(item.score>=90?15:12.5):(item.score>=90?10:7.5); const multiplier=regime==="RISK ON"?1:regime==="EMERGING"?.8:.6; return Math.max(5,Math.round(base*multiplier/2.5)*2.5); }
async function getBars(ticker:string, since:string):Promise<Bar[]> {
  try {
    const period1 = Math.floor(new Date(since + "T00:00:00+07:00").getTime()/1000);
    const url = "https://query2.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + ".JK?period1=" + period1 + "&period2=" + (Math.floor(Date.now()/1000)+86400) + "&interval=1d";
    const response = await fetch(url,{cache:"no-store"});
    if(!response.ok) return [];
    const json:any = await response.json();
    const quote = json?.chart?.result?.[0]?.indicators?.quote?.[0];
    if(!quote) return [];
    return (quote.open ?? []).map((open:number|null,index:number) => ({ open:Number(open), high:Number(quote.high?.[index]), low:Number(quote.low?.[index]), close:Number(quote.close?.[index]) })).filter((bar:Bar) => Object.values(bar).every(Number.isFinite));
  } catch { return []; }
}
async function buildLifecycle(runId:string, priorRun:any, prior:any[], current:Candidate[]):Promise<Action[]> {
  const currentByTicker = new Map(current.map((item) => [item.ticker,item]));
  const actions:Action[] = [];
  if(priorRun) for(const old of prior) {
    const bars = await getBars(old.ticker,priorRun.week_of);
    const touch = bars.findIndex((bar) => bar.high >= Number(old.planned_entry_low) && bar.low <= Number(old.planned_entry_high));
    const filled = touch >= 0;
    const fill = filled ? alignPrice(Math.min(Number(old.planned_entry_high),Math.max(Number(old.planned_entry_low),bars[touch].open)),"nearest") : null;
    const active = filled ? bars.slice(touch) : [];
    const hardStop = Number.isFinite(Number(old.hard_stop)) ? Number(old.hard_stop) : -Infinity;
    const stopLevel = Math.max(hardStop, Number(old.invalidation));
    const invalidationIndex = active.findIndex((bar) => bar.low <= stopLevel);
    const targetIndex = active.findIndex((bar) => bar.high >= Number(old.target_one));
    const invalidated = invalidationIndex >= 0 && (targetIndex < 0 || invalidationIndex <= targetIndex);
    const targetReached = targetIndex >= 0 && (invalidationIndex < 0 || targetIndex < invalidationIndex);
    const next = currentByTicker.get(old.ticker);
    let action:Action["action"] = "HOLD";
    let targetWeight = Number(old.position_weight) || 12.5;
    let reason = "Setup remains selected and its score is stable.";
    if(!filled && !next) { action="EXPIRED"; targetWeight=0; reason="Entry was not filled and the stock left this week's picks."; }
    else if(invalidated) { action="EXIT"; targetWeight=0; reason="Price traded through the hard-stop level."; }
    else if(targetReached) { action="REDUCE"; targetWeight/=2; reason="First target was reached; reduce and trail the remainder."; }
    else if(!next) { action="EXIT"; targetWeight=0; reason="The stock is no longer selected by V5."; }
    else if(Number(next.score) < Number(old.score)-5) { action="REDUCE"; targetWeight/=2; reason="Score deteriorated by more than five points."; }
    else if(!filled) { action="NO_ENTRY"; targetWeight=0; reason="Entry range was not traded; do not chase."; }
    actions.push({ run_id:runId, prior_run_id:priorRun.id, ticker:old.ticker, action, previous_score:Number(old.score), current_score:next?Number(next.score):null, target_weight:targetWeight, theoretical_fill:fill, entry_filled:filled, target_reached:targetReached, invalidated, reason });
  }
  const oldTickers = new Set(prior.map((item) => item.ticker));
  for(const item of current) if(!oldTickers.has(item.ticker)) actions.push({ run_id:runId, prior_run_id:priorRun?.id, ticker:item.ticker, action:"BUY", previous_score:null, current_score:Number(item.score), target_weight:Number(item.position_weight)||12.5, theoretical_fill:null, entry_filled:false, target_reached:false, invalidated:false, reason:priorRun?"New V5 qualifier; use the stated entry range.":"Initial V5 Weekly Pick; do not chase." });
  return actions;
}
async function weeklyRecipients(supabase:any) {
  const configured=(process.env.JARVIS_EMAIL_TO || "iggerzefanya@gmail.com").split(",").map((email)=>email.trim().toLowerCase()).filter(Boolean);
  try {
    const {data,error}=await supabase.auth.admin.listUsers({page:1,perPage:1000});
    if(error) return [...new Set(configured)];
    const signedIn=(data?.users || []).filter((user:any)=>user.email).map((user:any)=>String(user.email).trim().toLowerCase());
    return [...new Set([...configured,...signedIn])];
  } catch { return [...new Set(configured)]; }
}

type MarketAlert = { ticker:string; action:"STOP / EXIT"|"TAKE PROFIT"; sessionLow:number; sessionHigh:number; trigger:number };

async function sendMarketAlerts(items:MarketAlert[], recipients:string[]) {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey) return {sent:false,reason:"not_configured"};
  if(!items.length) return {sent:false,reason:"no_new_actions"};
  const fromAddress=process.env.JARVIS_EMAIL_FROM||"Jarvis Research <onboarding@resend.dev>";
  const rows=items.map((item)=>"<tr><td><b>"+escapeHtml(item.ticker)+"</b></td><td><b>"+escapeHtml(item.action)+"</b></td><td>"+item.sessionLow.toLocaleString("id-ID")+" / "+item.sessionHigh.toLocaleString("id-ID")+"</td><td>"+item.trigger.toLocaleString("id-ID")+"</td></tr>").join("");
  const html="<!doctype html><html><body style='margin:0;background:#f4f5f7;font-family:Arial;color:#111827'><div style='max-width:720px;margin:auto;padding:28px 16px'><header style='background:#111827;color:white;padding:24px'><small>JARVIS RESEARCH</small><h1>Market-close action</h1><p>A new Weekly Picks trigger was confirmed after market close.</p></header><main style='background:white;padding:22px'><table style='width:100%;border-collapse:collapse' cellpadding='9'><tr style='background:#1f3c52;color:white'><th>Ticker</th><th>Action</th><th>Day low / high</th><th>Trigger</th></tr>"+rows+"</table><p style='color:#6b7280;font-size:12px'>This is an automated rules-based monitoring alert, not investment advice.</p></main></div></body></html>";
  const senderAddress=fromAddress.match(/<([^>]+)>/)?.[1] || "onboarding@resend.dev";
  const deliveryRecipients=[...new Set([...recipients.map((email)=>email.toLowerCase()),senderAddress.toLowerCase()])];
  const deliveries=await Promise.all(deliveryRecipients.map(async (email)=>{
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({from:fromAddress,to:[email],subject:"JARVIS · Market-close action · "+items.length+" new",html})});
    const data:any=await response.json().catch(()=>({}));
    return {email,ok:response.ok,status:response.status,id:data.id||null,error:data.message||null};
  }));
  const failures=deliveries.filter((item)=>!item.ok);
  return {sent:failures.length===0,ids:deliveries.filter((item)=>item.ok).map((item)=>item.id),recipients:deliveryRecipients.length,failures};
}

async function sendDigest(weekOf:string, regime:string, candidates:Candidate[], actions:Action[], recipientOverride?:string[]) {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey) return {sent:false,reason:"not_configured"};
  const recipients=recipientOverride || (process.env.JARVIS_EMAIL_TO || "iggerzefanya@gmail.com").split(",").map((email)=>email.trim()).filter(Boolean);
  const actionRows=actions.length?actions.map((item)=>"<tr><td>"+escapeHtml(item.ticker)+"</td><td><b>"+item.action+"</b></td><td>"+Number(item.target_weight || 0).toFixed(1)+"%</td><td>"+escapeHtml(item.reason)+"</td></tr>").join(""):"<tr><td colspan='4'>No prior-position action this week.</td></tr>";
  const pickRows=candidates.length?candidates.map((item)=>"<tr><td><b>"+escapeHtml(item.ticker)+"</b></td><td>"+escapeHtml(item.setup)+"</td><td>"+Number(item.score).toFixed(1)+"</td><td>"+Number(item.planned_entry_low).toLocaleString("id-ID")+"–"+Number(item.planned_entry_high).toLocaleString("id-ID")+"</td></tr>").join(""):"<tr><td colspan='4'>No qualified setup. Capital remains in cash.</td></tr>";
  const html="<!doctype html><html><body style='margin:0;background:#f4f5f7;font-family:Arial;color:#111827'><div style='max-width:760px;margin:auto;padding:28px 16px'><header style='background:#111827;color:white;padding:24px'><small>JARVIS RESEARCH</small><h1>Weekly Picks</h1><p>Week of "+escapeHtml(weekOf)+" · V5 "+escapeHtml(regime)+"</p></header><main style='background:white;padding:22px'><h2>Last week's positions</h2><table style='width:100%;border-collapse:collapse' cellpadding='9'><tr style='background:#1f3c52;color:white'><th>Ticker</th><th>Action</th><th>Weight</th><th>Reason</th></tr>"+actionRows+"</table><h2>This week's picks</h2><table style='width:100%;border-collapse:collapse' cellpadding='9'><tr style='background:#1f3c52;color:white'><th>Ticker</th><th>Setup</th><th>Score</th><th>Entry</th></tr>"+pickRows+"</table><p style='color:#6b7280;font-size:12px'>Rules-based research, not investment advice. Every pick is reviewed next week as HOLD, REDUCE, EXIT, NO_ENTRY, or EXPIRED.</p></main></div></body></html>";
  const fromAddress=process.env.JARVIS_EMAIL_FROM||"Jarvis Research <onboarding@resend.dev>";
  const senderAddress=fromAddress.match(/<([^>]+)>/)?.[1] || "onboarding@resend.dev";
  const deliveryRecipients=[...new Set([...recipients.map((email)=>email.toLowerCase()),senderAddress.toLowerCase()])];
  const deliveries=await Promise.all(deliveryRecipients.map(async (email)=>{
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json"},body:JSON.stringify({from:fromAddress,to:[email],subject:"JARVIS V5 · Weekly Picks · "+weekOf,html})});
    const data:any=await response.json().catch(()=>({}));
    return {email,ok:response.ok,status:response.status,id:data.id||null,error:data.message||null};
  }));
  const failures=deliveries.filter((item)=>!item.ok);
  return {sent:failures.length===0,ids:deliveries.filter((item)=>item.ok).map((item)=>item.id),recipients:deliveryRecipients.length,failures};
}

export async function GET(request:NextRequest) {
  if(!process.env.CRON_SECRET || request.headers.get("authorization") !== "Bearer "+process.env.CRON_SECRET) return NextResponse.json({error:"Unauthorized"},{status:401});
  const searchParams=new URL(request.url).searchParams;
  const dryRun=searchParams.get("dryRun") === "1";
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key) return NextResponse.json({error:"Server database credentials are missing."},{status:503});
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const recipients=await weeklyRecipients(supabase);
  const weekOf=currentFriday();
  const {data:existing}=await supabase.from("jarvis_weekly_runs").select("id,week_of,market_regime,note").eq("week_of",weekOf).maybeSingle();
  if(!dryRun && wibWeekday() !== "Fri" && existing) {
    const [{data:watch},{data:currentActions}]=await Promise.all([
      supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",existing.id).order("rank"),
      supabase.from("jarvis_weekly_actions").select("ticker,invalidated,target_reached,reason").eq("run_id",existing.id),
    ]);
    const actionState=new Map((currentActions || []).map((item:any)=>[item.ticker,item]));
    const alerts:MarketAlert[]=[];
    for(const item of watch || []) {
      const bars=await getBars(item.ticker,existing.week_of);
      const touch=bars.findIndex((bar)=>bar.high>=Number(item.planned_entry_low)&&bar.low<=Number(item.planned_entry_high));
      const active=touch>=0?bars.slice(touch):[];
      if(!active.length) continue;
      const state:any=actionState.get(item.ticker) || {};
      const sessionLow=Math.min(...active.map((bar)=>bar.low));
      const sessionHigh=Math.max(...active.map((bar)=>bar.high));
      const hardStop=Number.isFinite(Number(item.hard_stop))?Number(item.hard_stop):-Infinity;
      const stopLevel=Math.max(hardStop,alignPrice(Number(item.invalidation),"up"));
      const targetLevel=alignPrice(Number(item.target_one),"down");
      if(sessionLow<=stopLevel && (!String(state.reason || "").includes("[stop-alert:sent]") || item.ticker === "LSIP")) {
        await supabase.from("jarvis_weekly_actions").update({action:"EXIT",target_weight:0,entry_filled:true,invalidated:true,reason:"Price traded through the active stop level."}).eq("run_id",existing.id).eq("ticker",item.ticker);
        alerts.push({ticker:item.ticker,action:"STOP / EXIT",sessionLow,sessionHigh,trigger:stopLevel});
      } else if(Number.isFinite(targetLevel) && sessionHigh>=targetLevel && !String(state.reason || "").includes("[target-alert:sent]")) {
        await supabase.from("jarvis_weekly_actions").update({action:"REDUCE",target_weight:Number(item.position_weight || 0)/2,entry_filled:true,target_reached:true,reason:"First target reached; take profit and reduce exposure."}).eq("run_id",existing.id).eq("ticker",item.ticker);
        alerts.push({ticker:item.ticker,action:"TAKE PROFIT",sessionLow,sessionHigh,trigger:targetLevel});
      }
    }
    let email:any={sent:false,reason:"no_new_actions"};
    if(alerts.length) {
      try { email=await sendMarketAlerts(alerts,recipients); console.log("MARKET_ALERT_RESULT",JSON.stringify({alerts,email,recipients:recipients.length})); }
      catch(error) { console.error("Market alert email failed",error); email={sent:false,reason:"send_failed"}; }
      if(email.sent) {
        for(const alert of alerts) {
          const marker=alert.action === "STOP / EXIT" ? "[stop-alert:sent]" : "[target-alert:sent]";
          const reason=alert.action === "STOP / EXIT" ? "Price traded through the active stop level. " : "First target reached; take profit and reduce exposure. ";
          await supabase.from("jarvis_weekly_actions").update({reason:reason+marker}).eq("run_id",existing.id).eq("ticker",alert.ticker);
        }
      }
    }
    return NextResponse.json({ok:true,monitored:true,runId:existing.id,actions:alerts.length,email});
  }
  if(existing) {
    if(String(existing.note || "").includes("[email:sent]")) return NextResponse.json({ok:true,alreadyLocked:true,emailAlreadySent:true,runId:existing.id});
    const [candidateResult,actionResult]=await Promise.all([
      supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",existing.id).order("rank"),
      supabase.from("jarvis_weekly_actions").select("*").eq("run_id",existing.id),
    ]);
    const savedCandidates=(candidateResult.data || []) as Candidate[];
    const savedActions=(actionResult.data || []) as Action[];
    const savedRegime=String(existing.market_regime || "V5 NEUTRAL").replace(/^V5\s+/,"");
    let email;
    try { email=await sendDigest(weekOf,savedRegime,savedCandidates,savedActions,recipients); }
    catch(error) { console.error("Weekly Picks retry failed", error); return NextResponse.json({error:"Weekly Picks email failed.",detail:error instanceof Error?error.message:"unknown"},{status:502}); }
    const cleanNote=String(existing.note || "").replace(/\s*\[email:(?:sent|failed:[^\]]+)\]\s*/g," ").trim();
    const marker=email.sent?"[email:sent]":"[email:failed:"+String(email.reason || email.failures?.[0]?.status || "unknown")+"]";
    await supabase.from("jarvis_weekly_runs").update({note:(cleanNote+" "+marker).trim()}).eq("id",existing.id);
    return NextResponse.json({ok:email.sent,alreadyLocked:true,retriedEmail:true,runId:existing.id,email},{status:email.sent?200:502});
  }
  const scannerResponse=await fetch("https://jarvisfinance.my.id"+"/api/swing-setups",{cache:"no-store",headers:{Authorization:"Bearer "+process.env.JARVIS_READONLY_API_KEY}});
  if(!scannerResponse.ok) return NextResponse.json({error:"Screener unavailable."},{status:503});
  const scanner:any=await scannerResponse.json();
  const setups=Array.isArray(scanner?.setups)?scanner.setups as Setup[]:[];
  const regime=regimeFor(setups);
  const selected=pick(setups,regime);
  if(dryRun) return NextResponse.json({ok:true,dryRun:true,weekOf,regime,picks:selected.map((item)=>item.ticker)});
  const {data:priorRun}=await supabase.from("jarvis_weekly_runs").select("*").lt("week_of",weekOf).order("week_of",{ascending:false}).limit(1).maybeSingle();
  const {data:priorCandidates}=priorRun?await supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",priorRun.id).order("rank"):{data:[]};
  const {data:run,error:runError}=await supabase.from("jarvis_weekly_runs").insert({week_of:weekOf,snapshot_kind:"forward",methodology_version:"v5",status:"locked",market_regime:"V5 "+regime,note:selected.length?"Automated Friday Weekly Picks with lifecycle actions.":"No qualified setup this week."}).select().single();
  if(runError||!run) return NextResponse.json({error:"Unable to create weekly run."},{status:500});
  const candidates=selected.map((item,index)=>({run_id:run.id,rank:index+1,ticker:item.ticker.slice(0,12),setup:item.setup.slice(0,30),score:Number(item.score),signal_close:alignPrice(Number(item.close),"nearest"),planned_entry_low:alignPrice(Number(item.entryLow),"up"),planned_entry_high:alignPrice(Number(item.entryHigh),"down"),invalidation:alignPrice(Number(item.invalidation),"up"),hard_stop:alignPrice(Number(item.close)*.94,"up"),target_one:alignPrice(Number(item.target),"down"),risk_reward:Number(item.riskReward),position_size_idr:Math.min(1250000,75000/Math.max(.01,(Number(item.close)-Number(item.invalidation))/Number(item.close))),position_weight:weight(item,regime),reasons:Array.isArray(item.reasons)?item.reasons.slice(0,4):[],caution:String(item.caution||"").slice(0,500)}));
  if(candidates.length) { const {error}=await supabase.from("jarvis_weekly_candidates").insert(candidates); if(error) return NextResponse.json({error:"Run created, but picks could not be saved."},{status:500}); }
  const actions=await buildLifecycle(run.id,priorRun,priorCandidates||[],candidates);
  if(actions.length) { const {error}=await supabase.from("jarvis_weekly_actions").insert(actions); if(error) return NextResponse.json({error:"Run created, but actions could not be saved."},{status:500}); }
  let email;
  try { email=await sendDigest(weekOf,regime,candidates,actions,recipients); }
  catch(error) { console.error("Weekly Picks email failed", error); return NextResponse.json({error:"Weekly Picks email failed.",detail:error instanceof Error?error.message:"unknown"},{status:502}); }
  const baseNote=selected.length?"Automated Friday Weekly Picks with lifecycle actions.":"No qualified setup this week.";
  const marker=email.sent?"[email:sent]":"[email:failed:"+String(email.reason || email.failures?.[0]?.status || "unknown")+"]";
  await supabase.from("jarvis_weekly_runs").update({note:baseNote+" "+marker}).eq("id",run.id);
  return NextResponse.json({ok:email.sent,runId:run.id,regime,picks:candidates.length,actions:actions.length,email},{status:email.sent?200:502});
}
