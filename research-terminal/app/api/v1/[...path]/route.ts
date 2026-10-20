import { fetchUpstream } from "@/lib/upstream";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deriveStatus, type LifecycleActionName } from "@/lib/weekly-lifecycle";
import { regimeFor } from "@/lib/setup-model";

export const maxDuration = 30;
type WindowState = { count:number; resetAt:number };
const windows = new Map<string,WindowState>();
const LIMIT = 60;
const WINDOW_MS = 60_000;
const ALLOWED_ORIGIN = "https://glabs-ghazaems.vercel.app";

function corsHeaders() { return {"Access-Control-Allow-Origin":ALLOWED_ORIGIN,"Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"GET, OPTIONS","Vary":"Origin"}; }
function json(body:unknown,status=200,extra:Record<string,string>={}) { return NextResponse.json(body,{status,headers:{...corsHeaders(),...extra}}); }
function authorize(request:NextRequest) {
  const configured=process.env.JARVIS_READONLY_API_KEY;
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")||"";
  if(!configured||supplied!==configured) return {ok:false as const,response:json({error:"Unauthorized"},401)};
  const client=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"unknown";
  const now=Date.now(); const prior=windows.get(client); const state=!prior||prior.resetAt<=now?{count:0,resetAt:now+WINDOW_MS}:prior;
  state.count+=1; windows.set(client,state);
  const headers={"X-RateLimit-Limit":String(LIMIT),"X-RateLimit-Remaining":String(Math.max(0,LIMIT-state.count)),"X-RateLimit-Reset":String(Math.ceil(state.resetAt/1000))};
  if(state.count>LIMIT) return {ok:false as const,response:json({error:"Rate limit exceeded"},429,{...headers,"Retry-After":String(Math.ceil((state.resetAt-now)/1000))})};
  return {ok:true as const,headers};
}
async function scanner(origin:string) {
  const response=await fetchUpstream(origin+"/api/swing-setups",{cache:"no-store",headers:{Authorization:"Bearer "+(process.env.JARVIS_READONLY_API_KEY||"")}});
  if(!response.ok) throw new Error("Screener upstream unavailable");
  const payload:any=await response.json(); return Array.isArray(payload?.setups)?payload.setups:[];
}
export async function OPTIONS(){return new NextResponse(null,{status:204,headers:corsHeaders()});}
export async function GET(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
  const auth=authorize(request); if(!auth.ok)return auth.response;
  const {path=[]}=await params; const route=path.join("/"); const origin=new URL(request.url).origin; const common={...auth.headers,"Cache-Control":"public, s-maxage=300, stale-while-revalidate=600"};
  try{
    if(route==="market-regime"){const setups=await scanner(origin);return json({asOf:new Date().toISOString(),methodology:"V5",regime:regimeFor(setups),universeSize:setups.length},200,common);}
    if(route.startsWith("stocks/")&&route.endsWith("/signals")){
      const ticker=route.split("/")[1]?.toUpperCase().replace(/\.JK$/,""); if(!ticker||!/^[A-Z0-9]{1,12}$/.test(ticker))return json({error:"Invalid ticker"},400,common);
      const setups=await scanner(origin); const item=setups.find((candidate:any)=>String(candidate.ticker).toUpperCase()===ticker);
      if(!item)return json({ticker,signal:null,asOf:new Date().toISOString()},200,common);
      return json({ticker,asOf:new Date().toISOString(),signal:{setup:item.setup,score:Number(item.score),close:Number(item.close),sector:item.sector||null,entryLow:Number(item.entryLow),entryHigh:Number(item.entryHigh),invalidation:Number(item.invalidation),target:Number(item.target),riskReward:Number(item.riskReward),reasons:Array.isArray(item.reasons)?item.reasons:[],caution:item.caution||null}},200,common);
    }
    if(route==="weekly-picks"){
      const url=process.env.NEXT_PUBLIC_SUPABASE_URL; const key=process.env.SUPABASE_SERVICE_ROLE_KEY; if(!url||!key)return json({error:"Weekly data unavailable"},503,common);
      const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data:run,error}=await supabase.from("jarvis_weekly_runs").select("id,week_of,methodology_version,market_regime,status,note").order("week_of",{ascending:false}).limit(1).maybeSingle();
      if(error){const setups=await scanner("https://jarvisfinance.my.id");const regime=regimeFor(setups);const minimum=regime==="RISK ON"?75:regime==="EMERGING"?80:85;const live=setups.filter((item:any)=>Number(item.riskReward)>=1.7&&Number(item.score)>=minimum).sort((a:any,b:any)=>Number(b.score)-Number(a.score)).slice(0,5);return json({run:{weekOf:null,methodology:"V5",regime,status:"live",note:"Live screener fallback; no locked weekly snapshot was available."},picks:live.map((item:any,index:number)=>({rank:index+1,ticker:item.ticker,setup:item.setup,score:Number(item.score),signal_close:Number(item.close),planned_entry_low:Number(item.entryLow),planned_entry_high:Number(item.entryHigh),invalidation:Number(item.invalidation),target_one:Number(item.target),risk_reward:Number(item.riskReward),position_weight:12.5,reasons:Array.isArray(item.reasons)?item.reasons:[],caution:item.caution||null})),actions:[]},200,common);} if(!run)return json({run:null,picks:[],actions:[]},200,common);
      const [{data:picks},{data:actions}]=await Promise.all([supabase.from("jarvis_weekly_candidates").select("rank,ticker,setup,score,signal_close,planned_entry_low,planned_entry_high,invalidation,target_one,risk_reward,position_weight,reasons,caution").eq("run_id",run.id).order("rank"),supabase.from("jarvis_weekly_actions").select("ticker,action,previous_score,current_score,target_weight,entry_filled,target_reached,invalidated,reason").eq("run_id",run.id)]);
      const cleanedActions=(actions||[]).map((item:{action:LifecycleActionName;entry_filled:unknown;target_reached:unknown;invalidated:unknown;reason:unknown})=>({...item,reason:String(item.reason||"").replace(/\s*\[(?:stop|target)-alert:sent\]\s*/g," ").trim(),status:deriveStatus({action:item.action,entryFilled:Boolean(item.entry_filled),targetReached:Boolean(item.target_reached),invalidated:Boolean(item.invalidated)})}));
      return json({run:{weekOf:run.week_of,methodology:run.methodology_version,regime:run.market_regime,status:run.status,note:run.note},picks:picks||[],actions:cleanedActions},200,common);
    }
    return json({error:"Not found",available:["weekly-picks","market-regime","stocks/{ticker}/signals"]},404,common);
  }catch{return json({error:"Upstream data unavailable"},503,common);}
}
