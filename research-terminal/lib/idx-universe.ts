export type IDXStock = {
  ticker: string;
  name: string;
  sector: string;
};

export const IDX_UNIVERSE: IDXStock[] = [
  { ticker: "ADRO.JK", name: "Adaro Energy Indonesia", sector: "Energy" },
  { ticker: "PTBA.JK", name: "Bukit Asam", sector: "Energy" },
  { ticker: "ITMG.JK", name: "Indo Tambangraya Megah", sector: "Energy" },
  { ticker: "BUMI.JK", name: "Bumi Resources", sector: "Energy" },
  { ticker: "MEDC.JK", name: "Medco Energi Internasional", sector: "Energy" },
  { ticker: "AMMN.JK", name: "Amman Mineral Internasional", sector: "Basic Materials" },
  { ticker: "INCO.JK", name: "Vale Indonesia", sector: "Basic Materials" },
  { ticker: "ANTM.JK", name: "Aneka Tambang", sector: "Basic Materials" },
  { ticker: "MDKA.JK", name: "Merdeka Copper Gold", sector: "Basic Materials" },
  { ticker: "INTP.JK", name: "Indocement Tunggal Prakarsa", sector: "Basic Materials" },
  { ticker: "SMGR.JK", name: "Semen Indonesia", sector: "Basic Materials" },
  { ticker: "UNTR.JK", name: "United Tractors", sector: "Industrials" },
  { ticker: "ASII.JK", name: "Astra International", sector: "Industrials" },
  { ticker: "ERAA.JK", name: "Erajaya Swasembada", sector: "Consumer Cyclicals" },
  { ticker: "MAPI.JK", name: "Mitra Adiperkasa", sector: "Consumer Cyclicals" },
  { ticker: "ICBP.JK", name: "Indofood CBP Sukses Makmur", sector: "Consumer Non-Cyclicals" },
  { ticker: "INDF.JK", name: "Indofood Sukses Makmur", sector: "Consumer Non-Cyclicals" },
  { ticker: "UNVR.JK", name: "Unilever Indonesia", sector: "Consumer Non-Cyclicals" },
  { ticker: "MYOR.JK", name: "Mayora Indah", sector: "Consumer Non-Cyclicals" },
  { ticker: "TAPG.JK", name: "Triputra Agro Persada", sector: "Consumer Non-Cyclicals" },
  { ticker: "KLBF.JK", name: "Kalbe Farma", sector: "Healthcare" },
  { ticker: "SIDO.JK", name: "Industri Jamu dan Farmasi Sido Muncul", sector: "Healthcare" },
  { ticker: "BBCA.JK", name: "Bank Central Asia", sector: "Financials" },
  { ticker: "BBRI.JK", name: "Bank Rakyat Indonesia", sector: "Financials" },
  { ticker: "BMRI.JK", name: "Bank Mandiri", sector: "Financials" },
  { ticker: "BBNI.JK", name: "Bank Negara Indonesia", sector: "Financials" },
  { ticker: "BRIS.JK", name: "Bank Syariah Indonesia", sector: "Financials" },
  { ticker: "BSDE.JK", name: "Bumi Serpong Damai", sector: "Properties & Real Estate" },
  { ticker: "CTRA.JK", name: "Ciputra Development", sector: "Properties & Real Estate" },
  { ticker: "SMRA.JK", name: "Summarecon Agung", sector: "Properties & Real Estate" },
  { ticker: "GOTO.JK", name: "GoTo Gojek Tokopedia", sector: "Technology" },
  { ticker: "BUKA.JK", name: "Bukalapak.com", sector: "Technology" },
  { ticker: "WIFI.JK", name: "Solusi Sinergi Digital", sector: "Technology" },
  { ticker: "TLKM.JK", name: "Telkom Indonesia", sector: "Infrastructures" },
  { ticker: "EXCL.JK", name: "XL Axiata", sector: "Infrastructures" },
  { ticker: "PGAS.JK", name: "Perusahaan Gas Negara", sector: "Infrastructures" },
  { ticker: "JSMR.JK", name: "Jasa Marga", sector: "Infrastructures" },
  { ticker: "ASSA.JK", name: "Adi Sarana Armada", sector: "Transportation & Logistics" },
  { ticker: "BIRD.JK", name: "Blue Bird", sector: "Transportation & Logistics" },
];

export function searchIDXStocks(query: string): IDXStock[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  return IDX_UNIVERSE.filter(
    (s) => s.ticker.replace(".JK", "").includes(q) || s.name.toUpperCase().includes(q)
  ).slice(0, 15);
}
