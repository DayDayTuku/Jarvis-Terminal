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

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error:"Unauthorized" }, { status:401 });
  const { data: run, error } = await supabase.from("jarvis_weekly_runs").select("*").order("week_of",{ascending:false}).limit(1).maybeSingle();
  if (error) return NextResponse.json({ error:"Weekly tracking is unavailable." }, { status:503 });
  if (!run) return NextResponse.json({ run:null, candidates:[], reviews:[], canLock:isAdmin(user) && mayLockNow() });
  const [{ data:candidates },{ data:reviews }] = await Promise.all([
    supabase.from("jarvis_weekly_candidates").select("*").eq("run_id",run.id).order("rank"),
    supabase.from("jarvis_weekly_reviews").select("*").eq("run_id",run.id).eq("user_id",user.id),
  ]);
  return NextResponse.json({ run, candidates:candidates??[], reviews:reviews??[], canLock:isAdmin(user) && mayLockNow(), currentWeek:fridayOfCurrentWeek() });
}

export async function POST(request:NextRequest) {
  const supabase = await createClient();
  const { data:{ user } } = await supabase.auth.getUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error:"Admin required" },{status:403});
  if (!mayLockNow()) return NextResponse.json({ error:"Forward snapshots can only be locked after Friday 16:00 WIB." },{status:400});
  const body:any = await request.json();
  const rows = Array.isArray(body?.candidates) ? body.candidates.slice(0,5) : [];
  const weekOf=fridayOfCurrentWeek();
  const { data:existing }=await supabase.from("jarvis_weekly_runs").select("id").eq("week_of",weekOf).maybeSingle();
  if (existing) return NextResponse.json({ ok:true, alreadyLocked:true });
  const { data:run,error:runError }=await supabase.from("jarvis_weekly_runs").insert({ week_of:weekOf,snapshot_kind:"forward",status:"locked",market_regime:String(body?.marketRegime??"UNKNOWN").slice(0,40),note:rows.length ? "Methodology-driven weekly shortlist." : "No qualified setup this week." }).select().single();
  if (runError || !run) return NextResponse.json({error:"Unable to lock weekly run."},{status:500});
  if (rows.length) {
    const candidates=rows.map((item:any,index:number)=>({
      run_id:run.id,rank:index+1,ticker:String(item.ticker).slice(0,12),setup:String(item.setup).slice(0,30),
      score:Number(item.score),signal_close:Number(item.close),planned_entry_low:Number(item.entryLow),planned_entry_high:Number(item.entryHigh),
      invalidation:Number(item.invalidation),hard_stop:Number(item.close)*.94,target_one:Number(item.target),
      risk_reward:Number(item.riskReward),position_size_idr:Math.min(1250000,75000/Math.max(.01,(Number(item.close)-Number(item.invalidation))/Number(item.close))),
      position_weight:12.5,reasons:Array.isArray(item.reasons)?item.reasons.slice(0,4):[],caution:String(item.caution??"").slice(0,500),
    }));
    const {error}=await supabase.from("jarvis_weekly_candidates").insert(candidates);
    if(error) return NextResponse.json({error:"Run locked, but candidates could not be saved."},{status:500});
  }
  return NextResponse.json({ok:true,runId:run.id},{status:201});
}

export async function PATCH(request:NextRequest) {
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) return NextResponse.json({error:"Unauthorized"},{status:401});
  const body:any=await request.json();
  const decision=["approved","rejected","pending"].includes(body?.decision)?body.decision:"pending";
  const payload={run_id:String(body.runId),candidate_id:String(body.candidateId),user_id:user.id,decision,checklist:body.checklist??{},note:String(body.note??"").slice(0,800),reviewed_at:new Date().toISOString()};
  const {error}=await supabase.from("jarvis_weekly_reviews").upsert(payload,{onConflict:"candidate_id,user_id"});
  if(error) return NextResponse.json({error:"Review could not be saved."},{status:500});
  return NextResponse.json({ok:true});
}
