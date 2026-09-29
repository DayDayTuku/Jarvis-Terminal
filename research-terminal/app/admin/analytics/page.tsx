'use client'

import { useEffect, useState, type CSSProperties } from 'react'

type Analytics = {
  generatedAt: string
  overview: { registeredUsers:number; dau:number; wau:number; mau:number; sessions30d:number; pageViews30d:number; activationRate:number }
  featureUsage: Array<{ name:string; count:number }>
  topPages: Array<{ path:string; count:number }>
  dailyActive: Array<{ date:string; users:number }>
  weekly: null | { weekOf:string; regime:string; status:string; picks:number; invalidated:number; targetsReached:number; actions:Record<string,number> }
}

const styles: Record<string, CSSProperties> = {
  page:{minHeight:'100vh',background:'#f3f1ec',color:'#172230',padding:'28px',fontFamily:'var(--font-mono, ui-monospace, monospace)'},
  shell:{maxWidth:1240,margin:'0 auto'},
  header:{display:'flex',justifyContent:'space-between',gap:24,alignItems:'flex-start',padding:'26px 28px',background:'#0b1b28',color:'#edf4fa',border:'1px solid #253b4b'},
  eyebrow:{fontSize:12,letterSpacing:2,color:'#48a9ff',fontWeight:800},
  title:{fontFamily:'var(--font-sans, Arial, sans-serif)',fontSize:'clamp(30px,5vw,54px)',lineHeight:1,margin:'12px 0 10px'},
  sub:{margin:0,color:'#aab9c7',maxWidth:680,lineHeight:1.6},
  back:{color:'#edf4fa',textDecoration:'none',border:'1px solid #6c7d8a',padding:'10px 14px',whiteSpace:'nowrap'},
  grid:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,margin:'18px 0'},
  card:{background:'#fffdfa',border:'1px solid #d6d0c5',padding:'18px'},
  label:{fontSize:11,letterSpacing:1.2,color:'#6d7c8c',textTransform:'uppercase'},
  value:{fontFamily:'var(--font-sans, Arial, sans-serif)',fontSize:32,fontWeight:800,marginTop:8},
  split:{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:16},
  panel:{background:'#fffdfa',border:'1px solid #d6d0c5',padding:22},
  panelTitle:{fontSize:13,letterSpacing:1.5,margin:'0 0 18px',textTransform:'uppercase'},
  row:{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,borderTop:'1px solid #e4ded4',padding:'12px 0'},
  badge:{background:'#e6f3ff',color:'#0875c1',padding:'5px 8px',fontWeight:800},
  chart:{height:170,display:'flex',alignItems:'flex-end',gap:7,borderBottom:'1px solid #b9b2a7',paddingTop:14},
  bar:{flex:1,minWidth:6,background:'#248fd8',position:'relative'},
  note:{fontSize:11,color:'#778493',lineHeight:1.5},
  error:{maxWidth:700,margin:'90px auto',padding:28,background:'#fff',border:'1px solid #d6d0c5'}
}

const featureLabel: Record<string,string> = {
  weekly_picks_view:'Weekly Picks',
  research_paper_open:'Research Papers',
  stock_detail_open:'Stock Detail',
}

export default function AdminAnalyticsPage() {
  const [data,setData]=useState<Analytics|null>(null)
  const [error,setError]=useState('')

  useEffect(()=>{
    fetch('/api/admin/analytics',{cache:'no-store'})
      .then(async(response)=>{ const body=await response.json(); if(!response.ok) throw new Error(body.error||'Unable to load analytics.'); return body })
      .then(setData)
      .catch((cause)=>setError(cause instanceof Error?cause.message:'Unable to load analytics.'))
  },[])

  if(error) return <main style={styles.page}><section style={styles.error}><p style={styles.eyebrow}>ADMIN ONLY</p><h1>Analytics unavailable</h1><p>{error}</p><a href='/' style={{color:'#0875c1'}}>Return to Jarvis</a></section></main>
  if(!data) return <main style={styles.page}><section style={styles.error}><p style={styles.eyebrow}>JARVIS ADMIN</p><h1>Loading product signals…</h1></section></main>

  const metrics=[
    ['REGISTERED',data.overview.registeredUsers],['DAU',data.overview.dau],['WAU',data.overview.wau],['MAU',data.overview.mau],
    ['ACTIVATION',data.overview.activationRate+'%'],['SESSIONS · 30D',data.overview.sessions30d],['PAGE VIEWS · 30D',data.overview.pageViews30d],
  ]
  const maxDaily=Math.max(1,...data.dailyActive.map((item)=>item.users))

  return <main style={styles.page}><div style={styles.shell}>
    <header style={styles.header}><div><div style={styles.eyebrow}>ADMIN · PRODUCT INTELLIGENCE</div><h1 style={styles.title}>Jarvis Analytics</h1><p style={styles.sub}>Usage, activation, and Weekly Picks health. Private operational data—visible only to administrators.</p></div><a href='/' style={styles.back}>BACK TO TERMINAL ↗</a></header>

    <section style={styles.grid}>{metrics.map(([label,value])=><article key={String(label)} style={styles.card}><div style={styles.label}>{label}</div><div style={styles.value}>{value}</div></article>)}</section>

    <section style={styles.split}>
      <article style={styles.panel}><h2 style={styles.panelTitle}>14-Day Active Users</h2><div style={styles.chart}>{data.dailyActive.map((item)=><div key={item.date} title={item.date+' · '+item.users+' users'} style={{...styles.bar,height:Math.max(4,(item.users/maxDaily)*150),opacity:item.users?1:.18}} />)}</div><p style={styles.note}>Daily unique authenticated users, WIB. Hover each bar for the exact date and count.</p></article>
      <article style={styles.panel}><h2 style={styles.panelTitle}>Feature Engagement · 30D</h2>{data.featureUsage.map((item)=><div key={item.name} style={styles.row}><span>{featureLabel[item.name]||item.name}</span><strong style={styles.badge}>{item.count}</strong></div>)}<p style={styles.note}>Activation means a registered user opened at least one decision feature during the last 30 days.</p></article>
    </section>

    <section style={{...styles.split,marginTop:16}}>
      <article style={styles.panel}><h2 style={styles.panelTitle}>Most-Visited Routes · 30D</h2>{data.topPages.length?data.topPages.map((item)=><div key={item.path} style={styles.row}><code>{item.path}</code><strong>{item.count}</strong></div>):<p style={styles.note}>No page-view events yet.</p>}</article>
      <article style={styles.panel}><h2 style={styles.panelTitle}>Latest Weekly Picks Health</h2>{data.weekly?<><div style={styles.row}><span>Week</span><strong>{data.weekly.weekOf}</strong></div><div style={styles.row}><span>Regime</span><strong>{data.weekly.regime}</strong></div><div style={styles.row}><span>Picks</span><strong>{data.weekly.picks}</strong></div><div style={styles.row}><span>Invalidated</span><strong>{data.weekly.invalidated}</strong></div><div style={styles.row}><span>Targets reached</span><strong>{data.weekly.targetsReached}</strong></div><p style={styles.note}>Actions: {Object.entries(data.weekly.actions).map(([key,value])=>key+' '+value).join(' · ')||'No actions yet'}</p></>:<p style={styles.note}>No Weekly Picks run is available.</p>}</article>
    </section>
    <p style={{...styles.note,marginTop:16}}>Generated {new Date(data.generatedAt).toLocaleString('en-GB',{timeZone:'Asia/Jakarta'})} WIB · Metrics begin accumulating from analytics activation.</p>
  </div></main>
}
