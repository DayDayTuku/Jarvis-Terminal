import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  alignPrice,
  isShortSetup,
  positionTriggers,
  type LifecycleActionName,
  type PriceBar,
} from "@/lib/weekly-lifecycle";
import { buildLifecycle, carriedPositions, recentRunsBefore } from "@/lib/weekly-positions";
import { pickLongs as pick, pickShort, positionWeight as weight, regimeFor, shortWeight } from "@/lib/setup-model";
import { loadMacroExposure } from "@/lib/macro-risk";
import { YAHOO_HEADERS } from "@/lib/yahoo";

export const maxDuration = 60;

type Setup = { ticker:string; setup:string; score:number; close:number; sector?:string; entryLow:number; entryHigh:number; invalidation:number; target:number; riskReward:number; reasons?:string[]; caution?:string };
type Candidate = { run_id?:string; ticker:string; setup:string; score:number; signal_close?:number; planned_entry_low:number; planned_entry_high:number; invalidation:number; hard_stop?:number; target_one?:number; position_weight:number };
type Action = { run_id?:string; prior_run_id?:string|null; ticker:string; action:LifecycleActionName; previous_score:number|null; current_score:number|null; target_weight:number; theoretical_fill:number|null; entry_filled:boolean; target_reached:boolean; invalidated:boolean; reason:string };
type Bar = PriceBar;

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
// Internal dedupe markers live inside the stored reason so a trigger only fires
// once. They must never reach users, so strip them before rendering or sending.
function stripAlertMarkers(value:unknown) {
  return String(value ?? "").replace(/\s*\[(?:stop|target)-alert:sent\]\s*/g," ").trim();
}
async function getBars(ticker:string, since:string):Promise<Bar[]> {
  try {
    const period1 = Math.floor(new Date(since + "T00:00:00+07:00").getTime()/1000);
    const url = "https://query2.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(ticker) + ".JK?period1=" + period1 + "&period2=" + (Math.floor(Date.now()/1000)+86400) + "&interval=1d";
    const response = await fetch(url,{headers:YAHOO_HEADERS,cache:"no-store"});
    if(!response.ok) return [];
    const json:any = await response.json();
    const quote = json?.chart?.result?.[0]?.indicators?.quote?.[0];
    if(!quote) return [];
    return (quote.open ?? []).map((open:number|null,index:number) => ({ open:Number(open), high:Number(quote.high?.[index]), low:Number(quote.low?.[index]), close:Number(quote.close?.[index]) })).filter((bar:Bar) => Object.values(bar).every(Number.isFinite));
  } catch { return []; }
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

type DeliveryType = "weekly_digest"|"market_alert";
async function deliveryState(supabase:any,eventKey:string,email:string) {
  const recipient=email.trim().toLowerCase();
  const {data}=await supabase.from("jarvis_email_deliveries").select("status,provider_id").eq("event_key",eventKey).eq("recipient",recipient).maybeSingle();
  return {recipient,sent:data?.status==="sent",providerId:data?.provider_id||null};
}
async function markDelivery(supabase:any,eventKey:string,eventType:DeliveryType,email:string,status:"pending"|"sent"|"failed",providerId?:string|null,error?:string|null) {
  const now=new Date().toISOString();
  await supabase.from("jarvis_email_deliveries").upsert({event_key:eventKey,event_type:eventType,recipient:email.trim().toLowerCase(),status,provider_id:providerId||null,error:error||null,attempted_at:now,sent_at:status==="sent"?now:null,updated_at:now},{onConflict:"event_key,recipient"});
}

type MarketAlert = { ticker:string; action:"STOP / EXIT"|"TAKE PROFIT"; sessionLow:number; sessionHigh:number; trigger:number };

async function sendMarketAlerts(items:MarketAlert[], recipients:string[], supabase:any) {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey) return {sent:false,reason:"not_configured"};
  if(!items.length) return {sent:false,reason:"no_new_actions"};
  const fromAddress=process.env.JARVIS_EMAIL_FROM||"Jarvis Research <onboarding@resend.dev>";
  const rows=items.map((item)=>"<tr><td><b>"+escapeHtml(item.ticker)+"</b></td><td><b>"+escapeHtml(item.action)+"</b></td><td>"+item.sessionLow.toLocaleString("id-ID")+" / "+item.sessionHigh.toLocaleString("id-ID")+"</td><td>"+item.trigger.toLocaleString("id-ID")+"</td></tr>").join("");
  const html="<!doctype html><html><body style='margin:0;background:#f4f5f7;font-family:Arial;color:#111827'><div style='max-width:720px;margin:auto;padding:28px 16px'><header style='background:#111827;color:white;padding:24px'><small>JARVIS RESEARCH</small><h1>Market-close action</h1><p>A new Weekly Picks trigger was confirmed after market close.</p></header><main style='background:white;padding:22px'><table style='width:100%;border-collapse:collapse' cellpadding='9'><tr style='background:#1f3c52;color:white'><th>Ticker</th><th>Action</th><th>Day low / high</th><th>Trigger</th></tr>"+rows+"</table><p style='color:#6b7280;font-size:12px'>This is an automated rules-based monitoring alert, not investment advice.</p></main></div></body></html>";
  const senderAddress=fromAddress.match(/<([^>]+)>/)?.[1] || "onboarding@resend.dev";
  const deliveryRecipients=[...new Set([...recipients.map((email)=>email.toLowerCase()),senderAddress.toLowerCase()])];
  const eventKey="market-alert/"+items.map((item)=>[item.ticker,item.action,item.trigger].join("-")).sort().join("_").replace(/[^a-zA-Z0-9_-]/g,"").slice(0,140);
  const deliveries:Array<{email:string;ok:boolean;status:number;id:any;error:any}>=[];
  for(const email of deliveryRecipients) {
    const state=await deliveryState(supabase,eventKey,email);
    if(state.sent) { deliveries.push({email:state.recipient,ok:true,status:208,id:state.providerId,error:null}); continue; }
    await markDelivery(supabase,eventKey,"market_alert",email,"pending");
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json","Idempotency-Key":eventKey+"/"+email},body:JSON.stringify({from:fromAddress,to:[email],subject:"JARVIS · Market-close action · "+items.length+" new",html})});
    const data:any=await response.json().catch(()=>({}));
    await markDelivery(supabase,eventKey,"market_alert",email,response.ok?"sent":"failed",data.id||null,data.message||null);
    deliveries.push({email,ok:response.ok,status:response.status,id:data.id||null,error:data.message||null});
    await new Promise((resolve)=>setTimeout(resolve,150));
  }
  const failures=deliveries.filter((item)=>!item.ok);
  return {sent:failures.length===0,ids:deliveries.filter((item)=>item.ok).map((item)=>item.id),recipients:deliveryRecipients.length,failures};
}

async function sendDigest(weekOf:string, regime:string, candidates:Candidate[], actions:Action[], supabase:any, recipientOverride?:string[]) {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey) return {sent:false,reason:"not_configured"};
  const recipients=recipientOverride || (process.env.JARVIS_EMAIL_TO || "iggerzefanya@gmail.com").split(",").map((email)=>email.trim()).filter(Boolean);
  // A week the macro overlay stood down to 0% deploys no capital: the names are
  // recorded but must not read as actionable picks, so the digest says so plainly.
  const standAside=candidates.length>0 && candidates.every((item)=>Number(item.position_weight||0)===0);
  const actionRows=actions.length?actions.map((item)=>"<tr><td>"+escapeHtml(item.ticker)+"</td><td><b>"+item.action+"</b></td><td>"+Number(item.target_weight || 0).toFixed(1)+"%</td><td>"+escapeHtml(stripAlertMarkers(item.reason))+"</td></tr>").join(""):"<tr><td colspan='4'>No prior-position action this week.</td></tr>";
  const pickRows=candidates.length?candidates.map((item)=>"<tr><td><b>"+escapeHtml(item.ticker)+"</b></td><td>"+escapeHtml(item.setup)+"</td><td>"+Number(item.score).toFixed(1)+"</td><td>"+Number(item.planned_entry_low).toLocaleString("id-ID")+"–"+Number(item.planned_entry_high).toLocaleString("id-ID")+"</td></tr>").join(""):"<tr><td colspan='4'>No qualified setup. Capital remains in cash.</td></tr>";
  const html="<!doctype html><html><body style='margin:0;background:#f4f5f7;font-family:Arial;color:#111827'><div style='max-width:760px;margin:auto;padding:28px 16px'><header style='background:#111827;color:white;padding:24px'><small>JARVIS RESEARCH</small><h1>Weekly Picks</h1><p>Week of "+escapeHtml(weekOf)+" · V5 "+escapeHtml(regime)+"</p></header><main style='background:white;padding:22px'><h2>Last week's positions</h2><table style='width:100%;border-collapse:collapse' cellpadding='9'><tr style='background:#1f3c52;color:white'><th>Ticker</th><th>Action</th><th>Weight</th><th>Reason</th></tr>"+actionRows+"</table>"+(standAside?"<h2>This week's picks — standing aside</h2><p style='background:#fff7ed;border:1px solid #f59e0b;border-radius:8px;padding:10px;color:#7c2d12'><b>No new positions this week.</b> The macro risk overlay is at 0% deployed, so the names below qualified but are <b>not entered</b>; capital remains in cash.</p>":"<h2>This week's picks</h2>")+"<table style='width:100%;border-collapse:collapse' cellpadding='9'><tr style='background:#1f3c52;color:white'><th>Ticker</th><th>Setup</th><th>Score</th><th>Entry</th></tr>"+pickRows+"</table><p style='color:#6b7280;font-size:12px'>Rules-based research, not investment advice. Every pick is reviewed next week as HOLD, REDUCE, EXIT, NO_ENTRY, or EXPIRED.</p></main></div></body></html>";
  const fromAddress=process.env.JARVIS_EMAIL_FROM||"Jarvis Research <onboarding@resend.dev>";
  const senderAddress=fromAddress.match(/<([^>]+)>/)?.[1] || "onboarding@resend.dev";
  const deliveryRecipients=[...new Set([...recipients.map((email)=>email.toLowerCase()),senderAddress.toLowerCase()])];
  const deliveries:Array<{email:string;ok:boolean;status:number;id:any;error:any}>=[];
  const eventKey="weekly-digest/"+weekOf;
  for(const email of deliveryRecipients) {
    const state=await deliveryState(supabase,eventKey,email);
    if(state.sent) { deliveries.push({email:state.recipient,ok:true,status:208,id:state.providerId,error:null}); continue; }
    await markDelivery(supabase,eventKey,"weekly_digest",email,"pending");
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+apiKey,"Content-Type":"application/json","Idempotency-Key":eventKey+"/"+email},body:JSON.stringify({from:fromAddress,to:[email],subject:"JARVIS V5 · Weekly Picks · "+weekOf,html})});
    const data:any=await response.json().catch(()=>({}));
    await markDelivery(supabase,eventKey,"weekly_digest",email,response.ok?"sent":"failed",data.id||null,data.message||null);
    deliveries.push({email,ok:response.ok,status:response.status,id:data.id||null,error:data.message||null});
    await new Promise((resolve)=>setTimeout(resolve,150));
  }
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
    const candidateTickers=new Set((watch||[]).map((item:any)=>item.ticker));
    const carryRuns=[{id:existing.id,week_of:existing.week_of},...await recentRunsBefore(supabase,existing.week_of)];
    const carried=await carriedPositions(supabase,carryRuns,candidateTickers);
    // Monitor this week's candidates AND every position still held off the list,
    // so a carried trade's stop is caught intraday exactly like a fresh pick's.
    const monitor:Array<{plan:any;state:{entered?:boolean;targetReached?:boolean}}>=[
      ...(watch||[]).map((item:any)=>({plan:item,state:{}})),
      ...carried.map((item)=>({plan:item.plan,state:{entered:item.entryFilled,targetReached:item.targetReached}})),
    ];
    const alerts:MarketAlert[]=[];
    for(const {plan,state:carryState} of monitor) {
      const ticker=plan.ticker;
      const bars=await getBars(ticker,existing.week_of);
      // Same window and same level maths as the Friday rollover (lib/weekly-lifecycle),
      // so the monitor and the rollover can never disagree on the same trade.
      const triggers=positionTriggers(plan,bars,carryState);
      if(!triggers.entered) continue;
      const state:any=actionState.get(ticker) || {};
      const stopAlerted=String(state.reason || "").includes("[stop-alert:sent]");
      const targetAlerted=String(state.reason || "").includes("[target-alert:sent]");
      const sessionLow=triggers.sessionLow ?? 0;
      const sessionHigh=triggers.sessionHigh ?? 0;
      // A stop-out closes the position for the rest of the week and is terminal.
      // Once stopped we never re-open it, and we never let a later target touch
      // relabel the same trade as a take-profit. A "cut" must stay "cut".
      if(state.invalidated || triggers.stopped) {
        if(triggers.stopped && !stopAlerted) {
          if(!state.invalidated) await supabase.from("jarvis_weekly_actions").update({action:"EXIT",target_weight:0,entry_filled:true,invalidated:true,reason:"Price traded through the active stop level."}).eq("run_id",existing.id).eq("ticker",ticker);
          alerts.push({ticker,action:"STOP / EXIT",sessionLow,sessionHigh,trigger:triggers.stopTrigger});
        }
        continue;
      }
      // First target is a one-shot partial take-profit and is only evaluated
      // while the position is still open (skipped entirely after a stop-out above).
      if(triggers.targetHit && !state.target_reached && !targetAlerted) {
        await supabase.from("jarvis_weekly_actions").update({action:"REDUCE",target_weight:Number(plan.position_weight || 0)/2,entry_filled:true,target_reached:true,invalidated:false,reason:"First target reached; take profit and reduce exposure."}).eq("run_id",existing.id).eq("ticker",ticker);
        alerts.push({ticker,action:"TAKE PROFIT",sessionLow,sessionHigh,trigger:triggers.targetTrigger});
      }
    }
    let email:any={sent:false,reason:"no_new_actions"};
    if(alerts.length) {
      try { email=await sendMarketAlerts(alerts,recipients,supabase); console.log("MARKET_ALERT_RESULT",JSON.stringify({alerts,email,recipients:recipients.length})); }
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
    const [candidateResult,actionResult]=await Promise.all([
      supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",existing.id).order("rank"),
      supabase.from("jarvis_weekly_actions").select("*").eq("run_id",existing.id),
    ]);
    const savedCandidates=(candidateResult.data || []) as Candidate[];
    const savedActions=(actionResult.data || []) as Action[];
    const savedRegime=String(existing.market_regime || "V5 NEUTRAL").replace(/^V5\s+/,"");
    let email;
    try { email=await sendDigest(weekOf,savedRegime,savedCandidates,savedActions,supabase,recipients); }
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
  const longs=pick(setups,regime);
  const shorts=pickShort(setups).filter((item)=>shortWeight(item,longs,regime)>=3);
  const selected=[...longs,...shorts];
  // Macro / regional overlay: trim NEW risk when the external backdrop is
  // hostile. Held positions are not resized. Fails open to full size on bad data.
  const macro=await loadMacroExposure(weekOf);
  const macroLabel=macro.exposure<1?" · MACRO "+Math.round(macro.exposure*100)+"%"+(macro.flags.length?" ("+macro.flags.join(", ")+")":""):"";
  // A 0%-exposure week is a recorded stand-aside, not "no qualified setup".
  const baseNote=selected.length?(macro.exposure<=0?"Macro risk-off: the week stood aside at 0% deployed. Qualified setups are recorded but are not entered.":"Automated Friday Weekly Picks with lifecycle actions and an optional risk-capped short overlay."):"No qualified setup this week.";
  if(dryRun) return NextResponse.json({ok:true,dryRun:true,weekOf,regime,macro,picks:selected.map((item)=>item.ticker)});
  const {data:priorRun}=await supabase.from("jarvis_weekly_runs").select("*").lt("week_of",weekOf).order("week_of",{ascending:false}).limit(1).maybeSingle();
  const {data:priorCandidates}=priorRun?await supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",priorRun.id).order("rank"):{data:[]};
  const {data:run,error:runError}=await supabase.from("jarvis_weekly_runs").insert({week_of:weekOf,snapshot_kind:"forward",methodology_version:"v5",status:"locked",market_regime:"V5 "+regime+(shorts.length?" · OPTIONAL SHORT":"")+macroLabel,note:baseNote}).select().single();
  if(runError||!run) return NextResponse.json({error:"Unable to create weekly run."},{status:500});
  const candidates=selected.map((item,index)=>({run_id:run.id,rank:index+1,ticker:item.ticker.slice(0,12),setup:item.setup.slice(0,30),score:Number(item.score),signal_close:alignPrice(Number(item.close),"nearest"),planned_entry_low:alignPrice(Number(item.entryLow),"up"),planned_entry_high:alignPrice(Number(item.entryHigh),"down"),invalidation:alignPrice(Number(item.invalidation),"up"),hard_stop:alignPrice(Number(item.close)*(isShortSetup(item)?1.06:.94),"up"),target_one:alignPrice(Number(item.target),isShortSetup(item)?"up":"down"),risk_reward:Number(item.riskReward),position_size_idr:Math.min(1250000,75000/Math.max(.01,Math.abs(Number(item.close)-Number(item.invalidation))/Number(item.close)))*macro.exposure,position_weight:(isShortSetup(item)?shortWeight(item,longs,regime):weight(item,regime))*macro.exposure,reasons:Array.isArray(item.reasons)?item.reasons.slice(0,4):[],caution:String(item.caution||"").slice(0,500)}));
  if(candidates.length) { const {error}=await supabase.from("jarvis_weekly_candidates").insert(candidates); if(error) return NextResponse.json({error:"Run created, but picks could not be saved."},{status:500}); }
  const carryRuns=await recentRunsBefore(supabase,weekOf);
  const carried=await carriedPositions(supabase,carryRuns,new Set([...(priorCandidates||[]).map((item:any)=>item.ticker),...candidates.map((item)=>item.ticker)]));
  const actions=await buildLifecycle({runId:run.id,priorRun,prior:priorCandidates||[],current:candidates,carried,getBars});
  if(actions.length) { const {error}=await supabase.from("jarvis_weekly_actions").insert(actions); if(error) return NextResponse.json({error:"Run created, but actions could not be saved."},{status:500}); }
  let email;
  try { email=await sendDigest(weekOf,regime+macroLabel,candidates,actions,supabase,recipients); }
  catch(error) { console.error("Weekly Picks email failed", error); return NextResponse.json({error:"Weekly Picks email failed.",detail:error instanceof Error?error.message:"unknown"},{status:502}); }
  const marker=email.sent?"[email:sent]":"[email:failed:"+String(email.reason || email.failures?.[0]?.status || "unknown")+"]";
  await supabase.from("jarvis_weekly_runs").update({note:baseNote+" "+marker}).eq("id",run.id);
  return NextResponse.json({ok:email.sent,runId:run.id,regime,picks:candidates.length,actions:actions.length,email},{status:email.sent?200:502});
}
