import type {Metadata,Viewport} from 'next';
import {Geist,Geist_Mono} from 'next/font/google';
import './globals.css';
import SessionTimeout from '../components/SessionTimeout';
import ServiceWorkerRegister from '../components/ServiceWorkerRegister';
import ThemeToggle from '../components/ThemeToggle';
import UsageTracker from '../components/UsageTracker';
const geistSans=Geist({variable:'--font-geist-sans',subsets:['latin']});
const geistMono=Geist_Mono({variable:'--font-geist-mono',subsets:['latin']});
export const metadata:Metadata={title:'Jarvis | Personal Macro Terminal',description:'A focused workspace for macro regimes, market signals, geopolitical risk, and research notes.',metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL??'http://localhost:3000'),icons:{icon:[{url:'/icon-192.png',sizes:'192x192',type:'image/png'},{url:'/icon-512.png',sizes:'512x512',type:'image/png'}],apple:'/apple-icon.png'},manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'Jarvis',statusBarStyle:'black-translucent'},openGraph:{title:'Jarvis | Personal Macro Terminal',description:'Macro regimes, market signals, geopolitical risk, and research notes in one focused workspace.',images:[{url:'/og-1200.png',width:1200,height:675,alt:'Jarvis personal macro terminal'}]},twitter:{card:'summary_large_image',title:'Jarvis | Personal Macro Terminal',description:'Macro regimes, market signals, geopolitical risk, and research notes in one focused workspace.',images:['/og-1200.png']}};
export const viewport:Viewport={themeColor:'#000000',colorScheme:'dark light',viewportFit:'cover'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en" suppressHydrationWarning><body className={geistSans.variable+' '+geistMono.variable}><SessionTimeout/><ThemeToggle/><UsageTracker/><ServiceWorkerRegister/>{children}</body></html>}
