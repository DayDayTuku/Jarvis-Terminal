"use client";
import { useEffect, useMemo, useState } from "react";

type Setup={ticker:string;setup:string;score:number;entryLow:number;entryHigh:number;invalidation:number;target:number;riskReward:number;sector?:string};
type Run={id:string;week_of:string;snapshot_kind:"pilot"|"forward"};
type Candidate={id:string;run_id:string;rank:number;ticker:string;setup:string;score:number;planned_entry_low:number;planned_entry_high:number;invalidation:number;target_one:number;position_size_idr:number};
type Decision="approved"|"rejected"|"pending";
type Review={candidate_id:string;decision:Decision};
type WeeklyState={run:Run|null;candidates:Candidate[];reviews:Review[];canLock:boolean;currentWeek?:string};
type V5Regime="RISK ON"|"EMERGING"|"NEUTRAL"|"RISK OFF";
const money=(v:number)=>new Intl.NumberFormat("id-ID",{maximumFractionDigits:0}).format(v);

function getV5Regime(setups:Setup[]):V5Regime {
  const tradable=setups.filter((item)=>item.riskReward>=1.7);
  const strong=tradable.filter((item)=>item.score>=75);
  const elite=tradable.filter((item)=>item.score>=85);
  if(strong.length>=5) return "RISK ON";
  if(strong.length>=3) return "EMERGING";
  if(elite.length>=1) return "NEUTRAL";
  return "RISK OFF";
}

function selectV5(setups:Setup[],regime:V5Regime) {
  if(regime==="RISK OFF") return [];
  const minimumScore=regime==="RISK ON"?75:regime==="EMERGING"?80:85;
  const maximumNames=regime==="RISK ON"?5:regime==="EMERGING"?3:1;
  const sectorCount=new Map<string,number>();
  return setups.filter((item)=>item.score>=minimumScore&&item.riskReward>=1.7).filter((item)=>{
    const sector=item.sector??"Other"; const count=sectorCount.get(sector)??0;
    if(count>=2) return false; sectorCount.set(sector,count+1); return true;
  }).slice(0,maximumNames);
}

function withDecision(current:WeeklyState,candidateId:string,decision:Decision):WeeklyState {
  const existing=current.reviews.some((item)=>item.candidate_id===candidateId);
  const reviews=existing
    ? current.reviews.map((item)=>item.candidate_id===candidateId?{...item,decision}:item)
    : [...current.reviews,{candidate_id:candidateId,decision}];
  return {...current,reviews};
}

export default function WeeklyShortlist({setups}:{setups:Setup[]}) {
  const [state,setState]=useState<WeeklyState|null>(null);
  const [busy,setBusy]=useState(false);
  const [saving,setSaving]=useState<Set<string>>(()=>new Set());
  const [reviewError,setReviewError]=useState<string|null>(null);
  const load=()=>fetch("/api/weekly-shortlist",{cache:"no-store"}).then(r=>r.ok?r.json():Promise.reject()).then((value)=>setState(value as WeeklyState)).catch(()=>setState(null));
  useEffect(()=>{void load()},[]);
  const regime=useMemo(()=>getV5Regime(setups),[setups]);
  const proposed=useMemo(()=>selectV5(setups,regime),[setups,regime]);
  useEffect(()=>{
    if(!state?.canLock||busy||state.currentWeek===state.run?.week_of||!setups.length) return;
    setBusy(true);
    fetch("/api/weekly-shortlist",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({candidates:proposed,marketRegime:`V5 ${regime}`})})
      .then(()=>load()).finally(()=>setBusy(false));
  },[state?.canLock,state?.currentWeek,state?.run?.week_of,setups.length,regime]); // eslint-disable-line react-hooks/exhaustive-deps
  const reviews=new Map((state?.reviews??[]).map((item)=>[item.candidate_id,item]));
  const review=async(candidate:Candidate,decision:"approved"|"rejected")=>{
    if(saving.has(candidate.id)) return;
    const previous=state?.reviews.find((item)=>item.candidate_id===candidate.id);
    setReviewError(null);
    setSaving((current)=>new Set(current).add(candidate.id));
    setState((current)=>current?withDecision(current,candidate.id,decision):current);
    try {
      const response=await fetch("/api/weekly-shortlist",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({runId:candidate.run_id,candidateId:candidate.id,decision,checklist:{chart:true,news:true,liquidity:true}})});
      if(!response.ok) throw new Error("review failed");
    } catch {
      setState((current)=>{
        if(!current) return current;
        if(previous) return withDecision(current,candidate.id,previous.decision);
        return {...current,reviews:current.reviews.filter((item)=>item.candidate_id!==candidate.id)};
      });
      setReviewError("Gagal menyimpan keputusan. Coba lagi.");
    } finally {
      setSaving((current)=>{const next=new Set(current);next.delete(candidate.id);return next});
    }
  };
  return <article className="panel weekly-shortlist">
    <div className="weekly-head"><div><span>WEEKLY SHORTLIST · V5</span><h3>Regime aware research basket</h3><p>Rp10m model capital · up to five names · current regime {regime}</p></div><div className="weekly-lock">{busy?"LOCKING…":state?.run?.snapshot_kind==="pilot"?"PILOT INCEPTION":"IMMUTABLE SNAPSHOT"}<small>{state?.run?.week_of??"—"}</small></div></div>
    {!state?<div className="weekly-empty">WEEKLY RECORD UNAVAILABLE</div>:state.run?.snapshot_kind==="pilot"&&!state.candidates.length?<div className="weekly-empty"><strong>Pilot started 4 Sep 2026</strong><p>No positions were backfilled using future information. The first complete forward shortlist locks automatically after the next Friday close.</p><span>{proposed.length} candidates currently pass the V5 gate</span></div>:!state.candidates.length?<div className="weekly-empty"><strong>NO QUALIFIED SETUP</strong><p>Cash is a valid position. V5 did not force a weekly pick in the current regime.</p></div>:<div className="weekly-list">{state.candidates.map((item)=>{
      const current=reviews.get(item.id); const isSaving=saving.has(item.id); return <div className="weekly-row" key={item.id}><div className="weekly-rank">{String(item.rank).padStart(2,"0")}</div><div><strong>{item.ticker}</strong><small>{item.setup.toUpperCase()} · SCORE {item.score}</small></div><div><span>ENTRY</span><b>{money(item.planned_entry_low)}–{money(item.planned_entry_high)}</b></div><div><span>INVALID</span><b>{money(item.invalidation)}</b></div><div><span>TARGET 1</span><b>{money(item.target_one)}</b></div><div><span>SIZE</span><b>Rp{money(item.position_size_idr)}</b></div><div className="weekly-decision"><button disabled={isSaving} aria-pressed={current?.decision==="approved"} className={current?.decision==="approved"?"active approve":""} onClick={()=>review(item,"approved")}>{isSaving?"SAVING…":"✓ APPROVE"}</button><button disabled={isSaving} aria-pressed={current?.decision==="rejected"} className={current?.decision==="rejected"?"active reject":""} onClick={()=>review(item,"rejected")}>{isSaving?"SAVING…":"× REJECT"}</button></div></div>})}</div>}
    <footer><span>ENTRY: NEXT SESSION OPEN · GAP-SIZE RULE APPLIES</span><span>V5 RESEARCH MODEL · CASH ALLOWED · NO FORCED SIGNAL</span>{reviewError&&<span role="status">{reviewError}</span>}</footer>
  </article>;
}
