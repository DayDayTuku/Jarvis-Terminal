import { NextResponse } from 'next/server';

type Raw = Record<string,string|undefined>;
const tffFields='report_date_as_yyyy_mm_dd,dealer_positions_long_all,dealer_positions_short_all,asset_mgr_positions_long,asset_mgr_positions_short,lev_money_positions_long,lev_money_positions_short';
const assets = [
  { key:'USD', label:'USD INDEX', dataset:'gpe5-46if', contract:'USD INDEX', fields:tffFields, groups:[['Dealer','dealer_positions_long_all','dealer_positions_short_all'],['Asset Manager','asset_mgr_positions_long','asset_mgr_positions_short'],['Leveraged Funds','lev_money_positions_long','lev_money_positions_short']] },
  { key:'GOLD', label:'GOLD', dataset:'72hh-3qpy', contract:'GOLD', fields:'report_date_as_yyyy_mm_dd,swap_positions_long_all,swap__positions_short_all,m_money_positions_long_all,m_money_positions_short_all,prod_merc_positions_long,prod_merc_positions_short', groups:[['Swap Dealer','swap_positions_long_all','swap__positions_short_all'],['Managed Money','m_money_positions_long_all','m_money_positions_short_all'],['Producer/Merchant','prod_merc_positions_long','prod_merc_positions_short']] },
  { key:'US10Y', label:'US 10Y', dataset:'gpe5-46if', contract:'UST 10Y NOTE', fields:tffFields, groups:[['Dealer','dealer_positions_long_all','dealer_positions_short_all'],['Asset Manager','asset_mgr_positions_long','asset_mgr_positions_short'],['Leveraged Funds','lev_money_positions_long','lev_money_positions_short']] },
  { key:'BTC', label:'BITCOIN', dataset:'gpe5-46if', contract:'BITCOIN', fields:tffFields, groups:[['Dealer','dealer_positions_long_all','dealer_positions_short_all'],['Asset Manager','asset_mgr_positions_long','asset_mgr_positions_short'],['Leveraged Funds','lev_money_positions_long','lev_money_positions_short']] },
] as const;

async function load(asset: typeof assets[number]) {
  const params=new URLSearchParams({'$select':asset.fields,'$where':`contract_market_name='${asset.contract}'`,'$order':'report_date_as_yyyy_mm_dd DESC','$limit':'156'});
  const response=await fetch(`https://publicreporting.cftc.gov/resource/${asset.dataset}.json?${params}`,{headers:{accept:'application/json','user-agent':'Jarvis Research Terminal'},cache:'no-store'});if(!response.ok)throw new Error(`${asset.key} returned ${response.status}`);
  const raw=await response.json() as Raw[];const points=raw.map((row)=>({date:(row.report_date_as_yyyy_mm_dd??'').slice(0,10),values:Object.fromEntries(asset.groups.map(([label,longKey,shortKey])=>[label,Number(row[longKey]??0)-Number(row[shortKey]??0)]))})).reverse();
  if(!points.length)throw new Error(`${asset.key} returned no observations`);return {key:asset.key,label:asset.label,groups:asset.groups.map(([label])=>label),points,latest:points.at(-1)?.date};
}

export async function GET(){const settled=await Promise.allSettled(assets.map(load));const series=settled.flatMap((result)=>result.status==='fulfilled'?[result.value]:[]);const failures=settled.flatMap((result,index)=>result.status==='rejected'?[assets[index].key]:[]);if(!series.length)return NextResponse.json({status:'stale',source:'CFTC COT',failures},{status:503});return NextResponse.json({status:failures.length?'partial':'live',source:'CFTC public COT · weekly',series,failures,freshness:series.map((item)=>item.latest).sort().at(-1)},{headers:{'cache-control':'public, max-age=3600'}})}
