"use client";
import { useEffect, useMemo, useState } from "react";

type Setup={ticker:string;setup:string;score:number;entryLow:number;entryHigh:number;invalidation:number;target:number;riskReward:number;sector?:string};
type Run={id:string;week_of:string;snapshot_kind:"pilot"|"forward"};
type Candidate={id:string;run_id:string;rank:number;ticker:string;setup:string;score:number;planned_entry_low:number;planned_entry_high:number;invalidation:number;target_one:number;position_size_idr:number};
type Action={id:string;ticker:string;action:"BUY"|"HOLD"|"REDUCE"|"EXIT"|"REPLACE"|"NO_ENTRY"|"EXPIRED";previous_score:number|null;current_score:number|null;target_weight:number;theoretical_fill:number|null;entry_filled:boolean;target_reached:boolean;invalidated:boolean;reason:string};
type WeeklyState={run:Run|null;candidates:Candidate[];actions:Action[];canLock:boolean;currentWeek?:string};
type V5Regime="RISK ON"|"EMERGING"|"NEUTRAL"|"RISK OFF";
const money=(v:number)=>new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(v);

function getV5Regime(setups:Setup[]):V5Regime {
  const tradable=setups.filter((item)=>item.riskReward>=1.7);
  const strong=tradable.filter((item)=>item.score>=75);
  const elite=tradable.filter((item)=>item.score>=85);
  if(strong.length>=5)return "RISK ON";
  if(strong.length>=3)return "EMERGING";
  if(elite.length>=1)return "NEUTRAL";
  return "RISK OFF";
}
function selectV5(setups:Setup[],regime:V5Regime){
  if(regime==="RISK OFF")return [];
  const minimumScore=regime==="RISK ON"?75:regime==="EMERGING"?80:85;
  const maximumNames=regime==="RISK ON"?5:regime==="EMERGING"?3:1;
  const sectorCount=new Map<string,number>();
  return setups.filter((item)=>item.score>=minimumScore&&item.riskReward>=1.7).filter((item)=>{const sector=item.sector??"Other";const count=sectorCount.get(sector)??0;if(count>=2)return false;sectorCount.set(sector,count+1);return true}).slice(0,maximumNames);
}
const actionColor:Record<Action["action"],string>={BUY:"#0f766e",HOLD:"#2563eb",REDUCE:"#b45309",EXIT:"#b91c1c",REPLACE:"#7c3aed",NO_ENTRY:"#6b7280",EXPIRED:"#6b7280"};

export default function WeeklyShortlist({setups}:{setups:Setup[]}){
  const[state,setState]=useState<WeeklyState|null>(null);
  const[busy,setBusy]=useState(false);
  const load=()=>fetch("/api/weekly-shortlist",{cache:"no-store"}).then((r)=>r.ok?r.json():Promise.reject()).then((value)=>setState(value as WeeklyState)).catch(()=>setState(null));
  useEffect(()=>{void load()},[]);
  const regime=useMemo(()=>getV5Regime(setups),[setups]);
  const proposed=useMemo(()=>selectV5(setups,regime),[setups,regime]);
  useEffect(()=>{if(!state?.canLock||busy||state.currentWeek===state.run?.week_of||!setups.length)return;setBusy(true);fetch("/api/weekly-shortlist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({candidates:proposed,marketRegime:`V5 ${regime}`})}).then(()=>load()).finally(()=>setBusy(false))},[state?.canLock,state?.currentWeek,state?.run?.week_of,setups.length,regime]); // eslint-disable-line react-hooks/exhaustive-deps
  return <article className="panel weekly-shortlist">
    <div className="weekly-head"><div><span>WEEKLY SHORTLIST · V5</span><h3>Regime-aware portfolio decisions</h3><p>Rp10m model capital · current regime {regime} · decisions update after Friday close</p></div><div className="weekly-lock">{busy?"LOCKING…":state?.run?.snapshot_kind==="pilot"?"PILOT INCEPTION":"IMMUTABLE SNAPSHOT"}<small>{state?.run?.week_of??"—"}</small></div></div>
    {state?.actions?.length?<section style={{margin:"14px 0 20px"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"end",marginBottom:8}}><div><strong>LAST PORTFOLIO — ACTIONS</strong><p style={{margin:"3px 0",opacity:.65,fontSize:12}}>This is what V5 says to do now, before considering new entries.</p></div></div><div style={{display:"grid",gap:8}}>{state.actions.map((item)=><div key={item.id} style={{display:"grid",gridTemplateColumns:"80px 90px 100px 1fr",gap:12,alignItems:"center",padding:"12px 14px",border:"1px solid rgba(127,127,127,.2)",borderRadius:10}}><strong>{item.ticker}</strong><b style={{color:actionColor[item.action]}}>{item.action.replace("_"," ")}</b><span style={{fontSize:12}}>TARGET {item.target_weight.toFixed(1)}%</span><span style={{fontSize:12,opacity:.8}}>{item.reason}{item.entry_filled&&item.theoretical_fill?` · filled ~${money(item.theoretical_fill)}`:""}</span></div>)}</div></section>:<div className="weekly-empty"><strong>PORTFOLIO LIFECYCLE STARTED</strong><p>This is the first saved V5 basket. HOLD, REDUCE, EXIT, or NO ENTRY decisions begin after it has one full weekly observation.</p></div>}
    {!state?<div className="weekly-empty">WEEKLY RECORD UNAVAILABLE</div>:!state.candidates.length?<div className="weekly-empty"><strong>NO QUALIFIED SETUP</strong><p>Cash is a valid position. V5 did not force a weekly pick in the current regime.</p></div>:<><div style={{margin:"8px 0",fontSize:12,fontWeight:700}}>NEW WEEKLY BASKET</div><div className="weekly-list">{state.candidates.map((item)=><div className="weekly-row" key={item.id}><div className="weekly-rank">{String(item.rank).padStart(2,"0")}</div><div><strong>{item.ticker}</strong><small>{item.setup.toUpperCase()} · SCORE {item.score}</small></div><div><span>ENTRY</span><b>{money(item.planned_entry_low)}–{money(item.planned_entry_high)}</b></div><div><span>INVALID</span><b>{money(item.invalidation)}</b></div><div><span>TARGET 1</span><b>{money(item.target_one)}</b></div><div><span>SIZE</span><b>Rp{money(item.position_size_idr)}</b></div></div>)}</div></>}
    <footer><span>NO ENTRY = DO NOT CHASE · EXIT OVERRIDES NEW IDEAS</span><span>V5 RESEARCH MODEL · CASH ALLOWED · NO FORCED SIGNAL</span></footer>
  </article>
}
