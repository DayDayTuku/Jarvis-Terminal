"use client";
import { useEffect, useMemo, useState } from "react";

type Setup={ticker:string;setup:string;score:number;close:number;entryLow:number;entryHigh:number;invalidation:number;target:number;riskReward:number;reasons:string[];caution:string;sector?:string};
type Run={id:string;week_of:string;snapshot_kind:"pilot"|"forward";generated_at:string;capital_idr:number;note:string|null};
type Candidate={id:string;run_id:string;rank:number;ticker:string;setup:string;score:number;signal_close:number;planned_entry_low:number;planned_entry_high:number;invalidation:number;hard_stop:number;target_one:number;risk_reward:number;position_size_idr:number;status:string;reasons:string[];caution:string};
type Review={candidate_id:string;decision:"approved"|"rejected"|"pending";checklist:Record<string,boolean>;note:string|null};
const money=(v:number)=>new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(v);

function selectStrict(setups:Setup[]) {
  const sectorCount=new Map<string,number>();
  return setups.filter((item)=>item.score>=75&&item.riskReward>=1.7).filter((item)=>{
    const sector=item.sector??"Other"; const count=sectorCount.get(sector)??0;
    if(count>=2) return false; sectorCount.set(sector,count+1); return true;
  }).slice(0,5);
}

export default function WeeklyShortlist({setups}:{setups:Setup[]}) {
  const [state,setState]=useState<{run:Run|null;candidates:Candidate[];reviews:Review[];canLock:boolean;currentWeek?:string}|null>(null);
  const [busy,setBusy]=useState(false);
  const load=()=>fetch("/api/weekly-shortlist",{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then(setState).catch(()=>setState(null));
  useEffect(()=>{void load()},[]);
  const proposed=useMemo(()=>selectStrict(setups),[setups]);
  useEffect(()=>{
    if(!state?.canLock||busy||state.currentWeek===state.run?.week_of||!setups.length) return;
    setBusy(true);
    fetch("/api/weekly-shortlist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({candidates:proposed,marketRegime:"SYSTEMATIC"})})
      .then(()=>load()).finally(()=>setBusy(false));
  },[state?.canLock,state?.currentWeek,state?.run?.week_of,setups.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviews=new Map((state?.reviews??[]).map((item)=>[item.candidate_id,item]));
  const review=async(candidate:Candidate,decision:"approved"|"rejected")=>{
    const checklist={chart:true,news:true,liquidity:true};
    await fetch("/api/weekly-shortlist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({runId:candidate.run_id,candidateId:candidate.id,decision,checklist})}); await load();
  };
  return <article className="panel weekly-shortlist">
    <div className="weekly-head"><div><span>WEEKLY SHORTLIST · V1</span><h3>Forward research record</h3><p>Rp10m model capital · 0.75% risk per position · maximum five names</p></div><div className="weekly-lock">{busy?"LOCKING…":state?.run?.snapshot_kind==="pilot"?"PILOT INCEPTION":"IMMUTABLE SNAPSHOT"}<small>{state?.run?.week_of??"—"}</small></div></div>
    {!state?<div className="weekly-empty">WEEKLY RECORD UNAVAILABLE</div>:state.run?.snapshot_kind==="pilot"&&!state.candidates.length?<div className="weekly-empty"><strong>Pilot started 4 Sep 2026</strong><p>No positions were backfilled using future information. The first complete forward shortlist locks automatically after the next Friday close.</p><span>{proposed.length} candidates currently pass the strict preliminary gate</span></div>:!state.candidates.length?<div className="weekly-empty"><strong>NO QUALIFIED SETUP</strong><p>Cash is a valid position. The methodology did not force a weekly pick.</p></div>:<div className="weekly-list">{state.candidates.map((item)=>{
      const current=reviews.get(item.id); return <div className="weekly-row" key={item.id}><div className="weekly-rank">{String(item.rank).padStart(2,"0")}</div><div><strong>{item.ticker}</strong><small>{item.setup.toUpperCase()} · SCORE {item.score}</small></div><div><span>ENTRY</span><b>{money(item.planned_entry_low)}–{money(item.planned_entry_high)}</b></div><div><span>INVALID</span><b>{money(item.invalidation)}</b></div><div><span>TARGET 1</span><b>{money(item.target_one)}</b></div><div><span>SIZE</span><b>Rp{money(item.position_size_idr)}</b></div><div className="weekly-decision"><button className={current?.decision==="approved"?"active approve":""} onClick={()=>review(item,"approved")}>✓ APPROVE</button><button className={current?.decision==="rejected"?"active reject":""} onClick={()=>review(item,"rejected")}>× REJECT</button></div></div>})}</div>}
    <footer><span>ENTRY: NEXT SESSION OPEN · GAP-SIZE RULE APPLIES</span><span>TP1: SELL 65% AT 1.5R · 35% TRAILING</span></footer>
  </article>;
}
