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
  ticker: string;
  setup: string;
  score: number;
  planned_entry_low: number;
  planned_entry_high: number;
  invalidation: number;
  position_weight: number;
};
async function sendWeeklyDigest(weekOf: string, marketRegime: string, candidates: EmailCandidate[]) {
  const apiKey = process.env.RESEND_API_KEY;
  const recipients = (process.env.JARVIS_EMAIL_TO || "iggerzefanya@gmail.com,ghazaerland@gmail.com").split(",").map((email) => email.trim()).filter(Boolean);
  if (!apiKey) return { sent:false, reason:"not_configured" };
  const rows = candidates.length ? candidates.map((item) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;font-weight:700">${escapeHtml(item.ticker)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.setup)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(item.score).toFixed(1)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(item.planned_entry_low).toLocaleString("id-ID")} - ${Number(item.planned_entry_high).toLocaleString("id-ID")}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(item.invalidation).toLocaleString("id-ID")}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${Number(item.position_weight).toFixed(1)}%</td>
    </tr>`).join("") : '<tr><td colspan="6" style="padding:20px;text-align:center;color:#6b7280">No qualified setup this week. Capital remains in cash.</td></tr>';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,sans-serif;color:#111827"><div style="max-width:760px;margin:0 auto;padding:28px 16px"><div style="background:#111827;color:#fff;padding:24px;border-radius:14px 14px 0 0"><div style="font-size:12px;letter-spacing:2px;color:#9ca3af">JARVIS RESEARCH TERMINAL</div><h1 style="margin:8px 0 6px;font-size:25px">Weekly Basket Beta</h1><div style="color:#d1d5db">Week of ${escapeHtml(weekOf)} · ${escapeHtml(marketRegime)}</div></div><div style="background:#fff;padding:22px;border-radius:0 0 14px 14px"><p style="margin-top:0;line-height:1.55">This is the frozen weekly decision set. Review the thesis and execution range before taking any action.</p><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="background:#1f3c52;color:#fff"><th style="padding:10px;text-align:left">Ticker</th><th style="padding:10px;text-align:left">Setup</th><th style="padding:10px;text-align:right">Score</th><th style="padding:10px;text-align:right">Entry range</th><th style="padding:10px;text-align:right">Invalidation</th><th style="padding:10px;text-align:right">Size</th></tr></thead><tbody>${rows}</tbody></table></div><p style="margin:22px 0 0;color:#6b7280;font-size:12px;line-height:1.5">Beta research output, not investment advice. Normal decisions are weekly; urgent alerts are not enabled in this version.</p></div></div></body></html>`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method:"POST",
      headers:{ Authorization:`Bearer ${apiKey}`, "Content-Type":"application/json" },
      body:JSON.stringify({
        from:process.env.JARVIS_EMAIL_FROM || "Jarvis Beta <onboarding@resend.dev>",
        to:recipients,
        subject:`JARVIS Beta Weekly Basket · ${weekOf}`,
        html,
      }),
    });
    if (!response.ok) return { sent:false, reason:"provider_error", status:response.status };
    const data = await response.json() as { id?: string };
    return { sent:true, id:data?.id ?? null };
  } catch {
    return { sent:false, reason:"network_error" };
  }
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
  const marketRegime=String(body?.marketRegime??"UNKNOWN").slice(0,40);
  const { data:run,error:runError }=await supabase.from("jarvis_weekly_runs").insert({ week_of:weekOf,snapshot_kind:"forward",status:"locked",market_regime:marketRegime,note:rows.length ? "Methodology-driven weekly shortlist." : "No qualified setup this week." }).select().single();
  if (runError || !run) return NextResponse.json({error:"Unable to lock weekly run."},{status:500});
  let candidates:EmailCandidate[]=[];
  if (rows.length) {
    candidates=rows.map((item:any,index:number)=>({
      run_id:run.id,rank:index+1,ticker:String(item.ticker).slice(0,12),setup:String(item.setup).slice(0,30),
      score:Number(item.score),signal_close:Number(item.close),planned_entry_low:Number(item.entryLow),planned_entry_high:Number(item.entryHigh),
      invalidation:Number(item.invalidation),hard_stop:Number(item.close)*.94,target_one:Number(item.target),
      risk_reward:Number(item.riskReward),position_size_idr:Math.min(1250000,75000/Math.max(.01,(Number(item.close)-Number(item.invalidation))/Number(item.close))),
      position_weight:12.5,reasons:Array.isArray(item.reasons)?item.reasons.slice(0,4):[],caution:String(item.caution??"").slice(0,500),
    }));
    const {error}=await supabase.from("jarvis_weekly_candidates").insert(candidates);
    if(error) return NextResponse.json({error:"Run locked, but candidates could not be saved."},{status:500});
  }
  const email=await sendWeeklyDigest(weekOf,marketRegime,candidates);
  return NextResponse.json({ok:true,runId:run.id,email},{status:201});
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
