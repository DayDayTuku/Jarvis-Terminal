import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const rows = [
  { ticker: "AMMN", setup: "BREAKOUT", score: 92, entry: "4.861–4.959", invalidation: "4.615", target: "5.352", size: "Rp1.250.000", decision: "APPROVED" },
  { ticker: "POWR", setup: "MOMENTUM", score: 92, entry: "995–1.015", invalidation: "945", target: "1.095", size: "Rp1.250.000", decision: "APPROVED" },
  { ticker: "ENRG", setup: "MOMENTUM", score: 87, entry: "1.450–1.480", invalidation: "1.377", target: "1.597", size: "Rp1.250.000", decision: "REJECTED" },
  { ticker: "AKRA", setup: "BREAKOUT", score: 86, entry: "1.535–1.566", invalidation: "1.457", target: "1.690", size: "Rp1.250.000", decision: "REJECTED" },
  { ticker: "DMAS", setup: "MOMENTUM", score: 86, entry: "198–202", invalidation: "188", target: "218", size: "Rp1.250.000", decision: "APPROVED" },
];

export async function GET() {
  const apiKey=process.env.RESEND_API_KEY;
  if(!apiKey) return NextResponse.json({ok:false,error:"Email is not configured"},{status:503});
  const table=rows.map((row)=>`<tr><td style="padding:14px;border-bottom:1px solid #26313d"><strong>${row.ticker}</strong><br><span style="color:#91a1b2;font-size:12px">${row.setup} · SCORE ${row.score}</span></td><td style="padding:14px;border-bottom:1px solid #26313d">${row.entry}</td><td style="padding:14px;border-bottom:1px solid #26313d">${row.invalidation}</td><td style="padding:14px;border-bottom:1px solid #26313d">${row.target}</td><td style="padding:14px;border-bottom:1px solid #26313d">${row.size}</td><td style="padding:14px;border-bottom:1px solid #26313d;color:${row.decision==="APPROVED"?"#69d39b":"#ff8d8d"}">${row.decision}</td></tr>`).join("");
  const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({from:process.env.JARVIS_EMAIL_FROM??"Jarvis Beta <onboarding@resend.dev>",to:[process.env.JARVIS_EMAIL_TO??"iggerzefanya@gmail.com"],subject:"[TEST] JARVIS Weekly Basket · 9 Sep 2026",html:`<div style="font-family:Arial,sans-serif;background:#0b1016;color:#eef3f7;padding:30px;max-width:900px;margin:auto"><div style="letter-spacing:2px;color:#92a2b3;font-size:12px">JARVIS TERMINAL · TRIAL EMAIL</div><h1 style="margin:12px 0 6px">Weekly Basket</h1><p style="color:#aab7c4">Snapshot 9 Sep 2026 · Rp10m model · 0.75% risk per position</p><table style="width:100%;border-collapse:collapse;margin-top:24px"><thead><tr style="text-align:left;color:#8fa0b0;font-size:12px"><th style="padding:14px">STOCK</th><th>ENTRY</th><th>INVALID</th><th>TARGET 1</th><th>SIZE</th><th>DECISION</th></tr></thead><tbody>${table}</tbody></table><div style="margin-top:24px;padding:16px;background:#121a23;color:#bac5cf">ENTRY: NEXT SESSION OPEN · GAP-SIZE RULE APPLIES<br>TP1: SELL 65% AT 1.5R · 35% TRAILING</div><p style="font-size:12px;color:#748391;margin-top:20px">Trial delivery only. This email does not create a new basket or alter any decision.</p></div>`})});
  const result=await response.json().catch(()=>null);
  return NextResponse.json({ok:response.ok,status:response.status,id:response.ok?result?.id:undefined},{status:response.ok?200:502});
}
