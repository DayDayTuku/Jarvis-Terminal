import type { Metadata } from 'next';
import PricingView from '../../components/PricingView';

export const metadata: Metadata = {
  title: 'Plans & Pricing | Jarvis',
  description: 'Free daily research, Pro workflow depth, and white-label Desk plans for IDX investors and research teams.',
};

export default function PricingPage() {
  return <main className="pricing-shell"><PricingView /></main>;
}
