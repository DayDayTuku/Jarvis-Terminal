import type {Metadata,Viewport} from 'next';
import {Geist,Geist_Mono} from 'next/font/google';
import './globals.css';
import SessionTimeout from '../components/SessionTimeout';
import ThemeToggle from '../components/ThemeToggle';
const geistSans=Geist({variable:'--font-geist-sans',subsets:['latin']});
const geistMono=Geist_Mono({variable:'--font-geist-mono',subsets:['latin']});
export const metadata:Metadata={title:'Jarvis | Personal Macro Terminal',description:'A focused workspace for macro regimes, market signals, geopolitical risk, and research notes.',metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL??'http://localhost:3000'),icons:{icon:'/jarvis-logo.png',apple:'/jarvis-logo.png'},manifest:'/manifest.webmanifest',appleWebApp:{capable:true,title:'Jarvis',statusBarStyle:'black-translucent'},openGraph:{title:'Jarvis | Personal Macro Terminal',description:'Macro regimes, market signals, geopolitical risk, and research notes in one focused workspace.',images:[{url:'/og.png',width:1672,height:941,alt:'Jarvis personal macro terminal'}]},twitter:{card:'summary_large_image',title:'Jarvis | Personal Macro Terminal',description:'Macro regimes, market signals, geopolitical risk, and research notes in one focused workspace.',images:['/og.png']}};
export const viewport:Viewport={themeColor:'#000000',colorScheme:'dark light',viewportFit:'cover'};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en" suppressHydrationWarning><body className={geistSans.variable+' '+geistMono.variable}><SessionTimeout/><ThemeToggle/>{children}</body></html>}
