/**
 * Curated IDX universe.
 *
 * `sector` is the app's own 11-way taxonomy and drives the one-name-per-sector
 * cap. `industry` is the finer TradingView industry, taken from their public
 * scanner for the exchange snapshot dated 2026-11-10; it is metadata for the
 * audit and for reading peers, not a live quote. Seven names still trade but
 * are not returned by the exchange-filtered scan (the scanner only sees them by
 * exact symbol), so their industry comes from that symbol lookup. `null` means
 * the source had no industry for the name; it is never guessed.
 *
 * Run `npm run audit-universe` to re-check coverage, duplicates and liquidity
 * against a fresh snapshot instead of trusting this list forever.
 */
export type IDXStock = {
  ticker: string;
  name: string;
  sector: string;
  /** TradingView industry as of the 2026-11-10 snapshot, or null if unavailable. */
  industry: string | null;
};

export const IDX_UNIVERSE: IDXStock[] = [
  { ticker: "ADRO.JK", name: "Alamtri Resources Indonesia", sector: "Energy", industry: "Coal" },
  { ticker: "PTBA.JK", name: "Bukit Asam", sector: "Energy", industry: "Coal" },
  { ticker: "ITMG.JK", name: "Indo Tambangraya Megah", sector: "Energy", industry: "Coal" },
  { ticker: "BUMI.JK", name: "Bumi Resources", sector: "Energy", industry: "Precious Metals" },
  { ticker: "MEDC.JK", name: "Medco Energi Internasional", sector: "Energy", industry: "Oil & Gas Production" },
  { ticker: "AMMN.JK", name: "Amman Mineral Internasional", sector: "Basic Materials", industry: "Precious Metals" },
  { ticker: "INCO.JK", name: "Vale Indonesia", sector: "Basic Materials", industry: "Other Metals/Minerals" },
  { ticker: "ANTM.JK", name: "Aneka Tambang", sector: "Basic Materials", industry: "Precious Metals" },
  { ticker: "MDKA.JK", name: "Merdeka Copper Gold", sector: "Basic Materials", industry: "Precious Metals" },
  { ticker: "INTP.JK", name: "Indocement Tunggal Prakarsa", sector: "Basic Materials", industry: "Construction Materials" },
  { ticker: "SMGR.JK", name: "Semen Indonesia", sector: "Basic Materials", industry: "Construction Materials" },
  { ticker: "UNTR.JK", name: "United Tractors", sector: "Industrials", industry: "Coal" },
  { ticker: "ASII.JK", name: "Astra International", sector: "Industrials", industry: "Information Technology Services" },
  { ticker: "ERAA.JK", name: "Erajaya Swasembada", sector: "Consumer Cyclicals", industry: "Electronics Distributors" },
  { ticker: "MAPI.JK", name: "Mitra Adiperkasa", sector: "Consumer Cyclicals", industry: "Department Stores" },
  { ticker: "ICBP.JK", name: "Indofood CBP Sukses Makmur", sector: "Consumer Non-Cyclicals", industry: "Food: Specialty/Candy" },
  { ticker: "INDF.JK", name: "Indofood Sukses Makmur", sector: "Consumer Non-Cyclicals", industry: "Food: Specialty/Candy" },
  { ticker: "UNVR.JK", name: "Unilever Indonesia", sector: "Consumer Non-Cyclicals", industry: "Household/Personal Care" },
  { ticker: "MYOR.JK", name: "Mayora Indah", sector: "Consumer Non-Cyclicals", industry: "Food: Specialty/Candy" },
  { ticker: "TAPG.JK", name: "Triputra Agro Persada", sector: "Consumer Non-Cyclicals", industry: "Agricultural Commodities/Milling" },
  { ticker: "KLBF.JK", name: "Kalbe Farma", sector: "Healthcare", industry: "Pharmaceuticals: Major" },
  { ticker: "SIDO.JK", name: "Industri Jamu dan Farmasi Sido Muncul", sector: "Healthcare", industry: "Pharmaceuticals: Other" },
  { ticker: "BBCA.JK", name: "Bank Central Asia", sector: "Financials", industry: "Major Banks" },
  { ticker: "BBRI.JK", name: "Bank Rakyat Indonesia", sector: "Financials", industry: "Regional Banks" },
  { ticker: "BMRI.JK", name: "Bank Mandiri", sector: "Financials", industry: "Regional Banks" },
  { ticker: "BBNI.JK", name: "Bank Negara Indonesia", sector: "Financials", industry: "Major Banks" },
  { ticker: "BRIS.JK", name: "Bank Syariah Indonesia", sector: "Financials", industry: "Major Banks" },
  { ticker: "BSDE.JK", name: "Bumi Serpong Damai", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "CTRA.JK", name: "Ciputra Development", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "SMRA.JK", name: "Summarecon Agung", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "GOTO.JK", name: "GoTo Gojek Tokopedia", sector: "Technology", industry: "Packaged Software" },
  { ticker: "BUKA.JK", name: "Bukalapak.com", sector: "Technology", industry: "Internet Retail" },
  { ticker: "WIFI.JK", name: "Solusi Sinergi Digital", sector: "Technology", industry: "Packaged Software" },
  { ticker: "TLKM.JK", name: "Telkom Indonesia", sector: "Infrastructures", industry: "Wireless Telecommunications" },
  { ticker: "EXCL.JK", name: "XL Axiata", sector: "Infrastructures", industry: "Major Telecommunications" },
  { ticker: "PGAS.JK", name: "Perusahaan Gas Negara", sector: "Infrastructures", industry: "Integrated Oil" },
  { ticker: "JSMR.JK", name: "Jasa Marga", sector: "Infrastructures", industry: "Other Transportation" },
  { ticker: "ASSA.JK", name: "Adi Sarana Armada", sector: "Transportation & Logistics", industry: "Other Transportation" },
  { ticker: "BIRD.JK", name: "Blue Bird", sector: "Transportation & Logistics", industry: "Other Transportation" },
  // Expanded liquid and sector-representative IDX universe
  { ticker: "AADI.JK", name: "Adaro Andalan Indonesia", sector: "Energy", industry: "Coal" },
  { ticker: "ADMR.JK", name: "Adaro Minerals Indonesia", sector: "Energy", industry: "Coal" },
  { ticker: "AKRA.JK", name: "AKR Corporindo", sector: "Energy", industry: "Wholesale Distributors" },
  { ticker: "ABMM.JK", name: "ABM Investama", sector: "Energy", industry: "Coal" },
  { ticker: "BYAN.JK", name: "Bayan Resources", sector: "Energy", industry: "Coal" },
  { ticker: "CUAN.JK", name: "Petrindo Jaya Kreasi", sector: "Energy", industry: "Other Metals/Minerals" },
  { ticker: "DEWA.JK", name: "Darma Henwa", sector: "Energy", industry: "Coal" },
  { ticker: "DOID.JK", name: "BUMA Internasional Grup", sector: "Energy", industry: "Coal" },
  { ticker: "ELSA.JK", name: "Elnusa", sector: "Energy", industry: "Oil & Gas Production" },
  { ticker: "ENRG.JK", name: "Energi Mega Persada", sector: "Energy", industry: "Oil & Gas Production" },
  { ticker: "GEMS.JK", name: "Golden Energy Mines", sector: "Energy", industry: "Coal" },
  { ticker: "HRUM.JK", name: "Harum Energy", sector: "Energy", industry: "Coal" },
  { ticker: "INDY.JK", name: "Indika Energy", sector: "Energy", industry: "Coal" },

  { ticker: "BRPT.JK", name: "Barito Pacific", sector: "Basic Materials", industry: "Forest Products" },
  { ticker: "TPIA.JK", name: "Chandra Asri Pacific", sector: "Basic Materials", industry: "Chemicals: Specialty" },
  { ticker: "INKP.JK", name: "Indah Kiat Pulp & Paper", sector: "Basic Materials", industry: "Pulp & Paper" },
  { ticker: "TKIM.JK", name: "Pabrik Kertas Tjiwi Kimia", sector: "Basic Materials", industry: "Pulp & Paper" },
  { ticker: "MBMA.JK", name: "Merdeka Battery Materials", sector: "Basic Materials", industry: "Other Metals/Minerals" },
  { ticker: "NCKL.JK", name: "Trimegah Bangun Persada", sector: "Basic Materials", industry: "Other Metals/Minerals" },
  { ticker: "ESSA.JK", name: "ESSA Industries Indonesia", sector: "Basic Materials", industry: "Oil Refining/Marketing" },
  { ticker: "HRTA.JK", name: "Hartadinata Abadi", sector: "Basic Materials", industry: "Other Consumer Specialties" },
  { ticker: "ARNA.JK", name: "Arwana Citramulia", sector: "Basic Materials", industry: "Building Products" },

  { ticker: "HEXA.JK", name: "Hexindo Adiperkasa", sector: "Industrials", industry: "Wholesale Distributors" },
  { ticker: "LTLS.JK", name: "Lautan Luas", sector: "Industrials", industry: "Wholesale Distributors" },
  { ticker: "MARK.JK", name: "Mark Dynamics Indonesia", sector: "Industrials", industry: "Other Metals/Minerals" },
  { ticker: "SPTO.JK", name: "Surya Pertiwi", sector: "Industrials", industry: "Wholesale Distributors" },
  { ticker: "TIRA.JK", name: "Tira Austenite", sector: "Industrials", industry: "Wholesale Distributors" },

  { ticker: "ACES.JK", name: "Aspirasi Hidup Indonesia", sector: "Consumer Cyclicals", industry: "Home Improvement Chains" },
  { ticker: "AUTO.JK", name: "Astra Otoparts", sector: "Consumer Cyclicals", industry: "Auto Parts: OEM" },
  { ticker: "GJTL.JK", name: "Gajah Tunggal", sector: "Consumer Cyclicals", industry: "Automotive Aftermarket" },
  { ticker: "LPPF.JK", name: "Matahari Department Store", sector: "Consumer Cyclicals", industry: "Department Stores" },
  { ticker: "MAPA.JK", name: "Map Aktif Adiperkasa", sector: "Consumer Cyclicals", industry: "Specialty Stores" },
  { ticker: "MNCN.JK", name: "Media Nusantara Citra", sector: "Consumer Cyclicals", industry: "Commercial Printing/Forms" },
  { ticker: "SCMA.JK", name: "Surya Citra Media", sector: "Consumer Cyclicals", industry: "Broadcasting" },

  { ticker: "AMRT.JK", name: "Sumber Alfaria Trijaya", sector: "Consumer Non-Cyclicals", industry: "Food Retail" },
  { ticker: "CPIN.JK", name: "Charoen Pokphand Indonesia", sector: "Consumer Non-Cyclicals", industry: "Agricultural Commodities/Milling" },
  { ticker: "JPFA.JK", name: "Japfa Comfeed Indonesia", sector: "Consumer Non-Cyclicals", industry: "Agricultural Commodities/Milling" },
  { ticker: "HMSP.JK", name: "H.M. Sampoerna", sector: "Consumer Non-Cyclicals", industry: "Tobacco" },
  { ticker: "GGRM.JK", name: "Gudang Garam", sector: "Consumer Non-Cyclicals", industry: "Tobacco" },
  { ticker: "CMRY.JK", name: "Cisarua Mountain Dairy", sector: "Consumer Non-Cyclicals", industry: "Food Distributors" },
  { ticker: "ULTJ.JK", name: "Ultrajaya Milk Industry", sector: "Consumer Non-Cyclicals", industry: "Food: Meat/Fish/Dairy" },
  { ticker: "GOOD.JK", name: "Garudafood Putra Putri Jaya", sector: "Consumer Non-Cyclicals", industry: "Food: Specialty/Candy" },

  { ticker: "MIKA.JK", name: "Mitra Keluarga Karyasehat", sector: "Healthcare", industry: "Hospital/Nursing Management" },
  { ticker: "HEAL.JK", name: "Medikaloka Hermina", sector: "Healthcare", industry: "Hospital/Nursing Management" },
  { ticker: "SILO.JK", name: "Siloam International Hospitals", sector: "Healthcare", industry: "Hospital/Nursing Management" },
  { ticker: "TSPC.JK", name: "Tempo Scan Pacific", sector: "Healthcare", industry: "Medical Distributors" },
  { ticker: "KAEF.JK", name: "Kimia Farma", sector: "Healthcare", industry: "Pharmaceuticals: Major" },
  { ticker: "SOHO.JK", name: "Soho Global Health", sector: "Healthcare", industry: "Pharmaceuticals: Major" },

  { ticker: "BBTN.JK", name: "Bank Tabungan Negara", sector: "Financials", industry: "Major Banks" },
  { ticker: "BNGA.JK", name: "Bank CIMB Niaga", sector: "Financials", industry: "Major Banks" },
  { ticker: "NISP.JK", name: "Bank OCBC NISP", sector: "Financials", industry: "Major Banks" },
  { ticker: "PNBN.JK", name: "Bank Pan Indonesia", sector: "Financials", industry: "Regional Banks" },
  { ticker: "ARTO.JK", name: "Bank Jago", sector: "Financials", industry: "Major Banks" },
  { ticker: "BTPS.JK", name: "Bank BTPN Syariah", sector: "Financials", industry: "Major Banks" },
  { ticker: "MEGA.JK", name: "Bank Mega", sector: "Financials", industry: "Regional Banks" },
  { ticker: "ADMF.JK", name: "Adira Dinamika Multi Finance", sector: "Financials", industry: "Finance/Rental/Leasing" },

  { ticker: "PWON.JK", name: "Pakuwon Jati", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "ASRI.JK", name: "Alam Sutera Realty", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "DMAS.JK", name: "Puradelta Lestari", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "LPCK.JK", name: "Lippo Cikarang", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "LPKR.JK", name: "Lippo Karawaci", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "KIJA.JK", name: "Kawasan Industri Jababeka", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "PANI.JK", name: "Pantai Indah Kapuk Dua", sector: "Properties & Real Estate", industry: "Food: Meat/Fish/Dairy" },

  { ticker: "EMTK.JK", name: "Elang Mahkota Teknologi", sector: "Technology", industry: "Broadcasting" },
  { ticker: "DCII.JK", name: "DCI Indonesia", sector: "Technology", industry: "Data Processing Services" },
  { ticker: "EDGE.JK", name: "Indointernet", sector: "Technology", industry: "Information Technology Services" },
  { ticker: "MLPT.JK", name: "Multipolar Technology", sector: "Technology", industry: "Information Technology Services" },
  { ticker: "BELI.JK", name: "Global Digital Niaga", sector: "Technology", industry: "Specialty Stores" },
  { ticker: "DMMX.JK", name: "Digital Mediatama Maxima", sector: "Technology", industry: "Advertising/Marketing Services" },
  { ticker: "MCAS.JK", name: "M Cash Integrasi", sector: "Technology", industry: "Information Technology Services" },

  { ticker: "ISAT.JK", name: "Indosat", sector: "Infrastructures", industry: "Wireless Telecommunications" },
  { ticker: "TOWR.JK", name: "Sarana Menara Nusantara", sector: "Infrastructures", industry: "Finance/Rental/Leasing" },
  { ticker: "TBIG.JK", name: "Tower Bersama Infrastructure", sector: "Infrastructures", industry: "Real Estate Development" },
  { ticker: "MTEL.JK", name: "Dayamitra Telekomunikasi", sector: "Infrastructures", industry: "Specialty Telecommunications" },
  { ticker: "BREN.JK", name: "Barito Renewables Energy", sector: "Infrastructures", industry: "Electric Utilities" },
  { ticker: "PGEO.JK", name: "Pertamina Geothermal Energy", sector: "Infrastructures", industry: "Alternative Power Generation" },
  { ticker: "WIKA.JK", name: "Wijaya Karya", sector: "Infrastructures", industry: "Engineering & Construction" },
  { ticker: "PTPP.JK", name: "PP (Persero)", sector: "Infrastructures", industry: "Engineering & Construction" },

  { ticker: "GIAA.JK", name: "Garuda Indonesia", sector: "Transportation & Logistics", industry: "Airlines" },
  { ticker: "SMDR.JK", name: "Samudera Indonesia", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "TMAS.JK", name: "Temas", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "BULL.JK", name: "Buana Lintas Lautan", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "NELY.JK", name: "Pelayaran Nelly Dwi Putri", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "SOCI.JK", name: "Soechi Lines", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "WEHA.JK", name: "WEHA Transportasi Indonesia", sector: "Transportation & Logistics", industry: "Other Transportation" },

  // Second-liner expansion — sector-diverse names for discovery, peers, and portfolio tools
  { ticker: "SGER.JK", name: "Sumber Global Energy", sector: "Energy", industry: "Other Metals/Minerals" },
  { ticker: "KKGI.JK", name: "Resource Alam Indonesia", sector: "Energy", industry: "Coal" },
  { ticker: "MYOH.JK", name: "Samindo Resources", sector: "Energy", industry: "Coal" },
  { ticker: "TOBA.JK", name: "TBS Energi Utama", sector: "Energy", industry: "Environmental Services" },
  { ticker: "SMMT.JK", name: "Golden Eagle Energy", sector: "Energy", industry: "Coal" },

  { ticker: "TINS.JK", name: "Timah", sector: "Basic Materials", industry: "Other Metals/Minerals" },
  { ticker: "NICL.JK", name: "PAM Mineral", sector: "Basic Materials", industry: "Precious Metals" },
  { ticker: "CITA.JK", name: "Cita Mineral Investindo", sector: "Basic Materials", industry: "Home Furnishings" },
  { ticker: "IMPC.JK", name: "Impack Pratama Industri", sector: "Basic Materials", industry: "Miscellaneous Manufacturing" },
  { ticker: "AVIA.JK", name: "Avia Avian", sector: "Basic Materials", industry: "Industrial Specialties" },

  { ticker: "VKTR.JK", name: "VKTR Teknologi Mobilitas", sector: "Industrials", industry: "Motor Vehicles" },
  { ticker: "SCCO.JK", name: "Supreme Cable Manufacturing & Commerce", sector: "Industrials", industry: "Electrical Products" },
  { ticker: "KOBX.JK", name: "Kobexindo Tractors", sector: "Industrials", industry: "Wholesale Distributors" },
  { ticker: "GMFI.JK", name: "Garuda Maintenance Facility Aero Asia", sector: "Industrials", industry: "Other Transportation" },
  { ticker: "KUAS.JK", name: "Ace Oldfields", sector: "Industrials", industry: "Miscellaneous Manufacturing" },

  { ticker: "RALS.JK", name: "Ramayana Lestari Sentosa", sector: "Consumer Cyclicals", industry: "Department Stores" },
  { ticker: "WOOD.JK", name: "Integra Indocabinet", sector: "Consumer Cyclicals", industry: "Home Furnishings" },
  { ticker: "CARS.JK", name: "Industri dan Perdagangan Bintraco Dharma", sector: "Consumer Cyclicals", industry: "Specialty Stores" },
  { ticker: "BOGA.JK", name: "Bintang Oto Global", sector: "Consumer Cyclicals", industry: "Specialty Stores" },

  { ticker: "CLEO.JK", name: "Sariguna Primatirta", sector: "Consumer Non-Cyclicals", industry: "Beverages: Non-Alcoholic" },
  { ticker: "ROTI.JK", name: "Nippon Indosari Corpindo", sector: "Consumer Non-Cyclicals", industry: "Food: Specialty/Candy" },
  { ticker: "STTP.JK", name: "Siantar Top", sector: "Consumer Non-Cyclicals", industry: "Food: Specialty/Candy" },
  { ticker: "DMND.JK", name: "Diamond Food Indonesia", sector: "Consumer Non-Cyclicals", industry: "Food: Meat/Fish/Dairy" },
  { ticker: "MIDI.JK", name: "Midi Utama Indonesia", sector: "Consumer Non-Cyclicals", industry: "Food Retail" },
  { ticker: "MLBI.JK", name: "Multi Bintang Indonesia", sector: "Consumer Non-Cyclicals", industry: "Beverages: Alcoholic" },

  { ticker: "PRDA.JK", name: "Prodia Widyahusada", sector: "Healthcare", industry: "Medical/Nursing Services" },
  { ticker: "DVLA.JK", name: "Darya-Varia Laboratoria", sector: "Healthcare", industry: "Pharmaceuticals: Major" },
  { ticker: "MERK.JK", name: "Merck", sector: "Healthcare", industry: "Pharmaceuticals: Major" },
  { ticker: "PYFA.JK", name: "Pyridam Farma", sector: "Healthcare", industry: "Pharmaceuticals: Major" },

  { ticker: "BFIN.JK", name: "BFI Finance Indonesia", sector: "Financials", industry: "Finance/Rental/Leasing" },
  { ticker: "WOMF.JK", name: "Wahana Ottomitra Multiartha", sector: "Financials", industry: "Finance/Rental/Leasing" },
  { ticker: "TUGU.JK", name: "Asuransi Tugu Pratama Indonesia", sector: "Financials", industry: "Multi-Line Insurance" },
  { ticker: "BJBR.JK", name: "Bank Pembangunan Daerah Jawa Barat dan Banten", sector: "Financials", industry: "Major Banks" },
  { ticker: "BJTM.JK", name: "Bank Pembangunan Daerah Jawa Timur", sector: "Financials", industry: "Major Banks" },

  { ticker: "JRPT.JK", name: "Jaya Real Property", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "MTLA.JK", name: "Metropolitan Land", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "RDTX.JK", name: "Roda Vivatex", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "BEST.JK", name: "Bekasi Fajar Industrial Estate", sector: "Properties & Real Estate", industry: "Engineering & Construction" },

  { ticker: "MTDL.JK", name: "Metrodata Electronics", sector: "Technology", industry: "Computer Peripherals" },
  { ticker: "CHIP.JK", name: "Pelita Teknologi Global", sector: "Technology", industry: "Packaged Software" },
  { ticker: "AXIO.JK", name: "Tera Data Indonusa", sector: "Technology", industry: "Computer Processing Hardware" },
  { ticker: "WIRG.JK", name: "WIR Asia", sector: "Technology", industry: "Medical/Nursing Services" },

  { ticker: "CMNP.JK", name: "Citra Marga Nusaphala Persada", sector: "Infrastructures", industry: "Other Transportation" },
  { ticker: "RAJA.JK", name: "Rukun Raharja", sector: "Infrastructures", industry: "Gas Distributors" },
  { ticker: "KEEN.JK", name: "Kencana Energi Lestari", sector: "Infrastructures", industry: "Electric Utilities" },
  { ticker: "POWR.JK", name: "Cikarang Listrindo", sector: "Infrastructures", industry: "Electric Utilities" },

  { ticker: "MBSS.JK", name: "Mitrabahtera Segara Sejati", sector: "Transportation & Logistics", industry: "Other Transportation" },
  { ticker: "HATM.JK", name: "Habco Trans Maritima", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "IPCM.JK", name: "Jasa Armada Indonesia", sector: "Transportation & Logistics", industry: "Other Transportation" },
  { ticker: "WINS.JK", name: "Wintermar Offshore Marine", sector: "Transportation & Logistics", industry: "Marine Shipping" },

  // Broader investable universe — additional sector coverage
  { ticker: "BSSR.JK", name: "Baramulti Suksessarana", sector: "Energy", industry: "Coal" },
  { ticker: "ARII.JK", name: "Atlas Resources", sector: "Energy", industry: "Coal" },
  { ticker: "MCOL.JK", name: "Prima Andalan Mandiri", sector: "Energy", industry: "Coal" },
  { ticker: "ITMA.JK", name: "Sumber Energi Andalan", sector: "Energy", industry: "Coal" },
  { ticker: "DSSA.JK", name: "Dian Swastatika Sentosa", sector: "Energy", industry: "Coal" },
  { ticker: "FASW.JK", name: "Fajar Surya Wisesa", sector: "Basic Materials", industry: "Pulp & Paper" },
  { ticker: "ALDO.JK", name: "Alkindo Naratama", sector: "Basic Materials", industry: "Containers/Packaging" },
  { ticker: "EKAD.JK", name: "Ekadharma International", sector: "Basic Materials", industry: "Pulp & Paper" },
  { ticker: "IGAR.JK", name: "Champion Pacific Indonesia", sector: "Basic Materials", industry: "Containers/Packaging" },
  { ticker: "SRSN.JK", name: "Indo Acidatama", sector: "Basic Materials", industry: "Apparel/Footwear" },
  { ticker: "TRST.JK", name: "Trias Sentosa", sector: "Basic Materials", industry: "Containers/Packaging" },
  { ticker: "INRU.JK", name: "Toba Pulp Lestari", sector: "Basic Materials", industry: "Pulp & Paper" },
  { ticker: "ADHI.JK", name: "Adhi Karya", sector: "Infrastructures", industry: "Engineering & Construction" },
  { ticker: "TOTL.JK", name: "Total Bangun Persada", sector: "Infrastructures", industry: "Engineering & Construction" },
  { ticker: "NRCA.JK", name: "Nusa Raya Cipta", sector: "Infrastructures", industry: "Engineering & Construction" },
  { ticker: "SSIA.JK", name: "Surya Semesta Internusa", sector: "Infrastructures", industry: "Engineering & Construction" },
  { ticker: "SMSM.JK", name: "Selamat Sempurna", sector: "Consumer Cyclicals", industry: "Auto Parts: OEM" },
  { ticker: "MPMX.JK", name: "Mitra Pinasthika Mustika", sector: "Consumer Cyclicals", industry: "Wholesale Distributors" },
  { ticker: "IMAS.JK", name: "Indomobil Sukses Internasional", sector: "Consumer Cyclicals", industry: "Motor Vehicles" },
  { ticker: "FILM.JK", name: "MD Pictures", sector: "Consumer Cyclicals", industry: "Movies/Entertainment" },
  { ticker: "FAST.JK", name: "Fast Food Indonesia", sector: "Consumer Cyclicals", industry: "Restaurants" },
  { ticker: "AALI.JK", name: "Astra Agro Lestari", sector: "Consumer Non-Cyclicals", industry: "Agricultural Commodities/Milling" },
  { ticker: "LSIP.JK", name: "PP London Sumatra Indonesia", sector: "Consumer Non-Cyclicals", industry: "Agricultural Commodities/Milling" },
  { ticker: "DSNG.JK", name: "Dharma Satya Nusantara", sector: "Consumer Non-Cyclicals", industry: "Forest Products" },
  { ticker: "SIMP.JK", name: "Salim Ivomas Pratama", sector: "Consumer Non-Cyclicals", industry: "Food: Specialty/Candy" },
  { ticker: "TBLA.JK", name: "Tunas Baru Lampung", sector: "Consumer Non-Cyclicals", industry: "Agricultural Commodities/Milling" },
  { ticker: "CAMP.JK", name: "Campina Ice Cream Industry", sector: "Consumer Non-Cyclicals", industry: "Food: Meat/Fish/Dairy" },
  { ticker: "KEJU.JK", name: "Mulia Boga Raya", sector: "Consumer Non-Cyclicals", industry: "Food: Meat/Fish/Dairy" },
  { ticker: "CEKA.JK", name: "Wilmar Cahaya Indonesia", sector: "Consumer Non-Cyclicals", industry: "Food: Specialty/Candy" },
  { ticker: "SAME.JK", name: "Sarana Meditama Metropolitan", sector: "Healthcare", industry: "Hospital/Nursing Management" },
  { ticker: "BMHS.JK", name: "Bundamedik", sector: "Healthcare", industry: "Hospital/Nursing Management" },
  { ticker: "SRAJ.JK", name: "Sejahteraraya Anugrahjaya", sector: "Healthcare", industry: "Hospital/Nursing Management" },
  { ticker: "BDMN.JK", name: "Bank Danamon Indonesia", sector: "Financials", industry: "Major Banks" },
  { ticker: "BNII.JK", name: "Bank Maybank Indonesia", sector: "Financials", industry: "Major Banks" },
  { ticker: "CFIN.JK", name: "Clipan Finance Indonesia", sector: "Financials", industry: "Finance/Rental/Leasing" },
  { ticker: "LPGI.JK", name: "Lippo General Insurance", sector: "Financials", industry: "Multi-Line Insurance" },
  { ticker: "DUTI.JK", name: "Duta Pertiwi", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "GPRA.JK", name: "Perdana Gapuraprima", sector: "Properties & Real Estate", industry: "Homebuilding" },
  { ticker: "BKSL.JK", name: "Sentul City", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "MDLN.JK", name: "Modernland Realty", sector: "Properties & Real Estate", industry: "Real Estate Development" },
  { ticker: "DIVA.JK", name: "Distribusi Voucher Nusantara", sector: "Technology", industry: "Packaged Software" },
  { ticker: "NFCX.JK", name: "NFC Indonesia", sector: "Technology", industry: "Internet Software/Services" },
  { ticker: "GLVA.JK", name: "Galva Technologies", sector: "Technology", industry: "Electronics Distributors" },
  { ticker: "IPCC.JK", name: "Indonesia Kendaraan Terminal", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "LEAD.JK", name: "Logindo Samudramakmur", sector: "Transportation & Logistics", industry: "Oilfield Services/Equipment" },
  { ticker: "SHIP.JK", name: "Sillo Maritime Perdana", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "TCPI.JK", name: "Transcoal Pacific", sector: "Transportation & Logistics", industry: "Marine Shipping" },
  { ticker: "HUMI.JK", name: "Humpuss Maritim Internasional", sector: "Transportation & Logistics", industry: "Other Transportation" },

  // Major Indonesian business-group coverage
  // Bakrie Group
  { ticker: "BNBR.JK", name: "Bakrie & Brothers", sector: "Industrials", industry: "Engineering & Construction" },
  { ticker: "BRMS.JK", name: "Bumi Resources Minerals", sector: "Basic Materials", industry: "Precious Metals" },

  // Prajogo Pangestu / Barito Group
  { ticker: "PTRO.JK", name: "Petrosea", sector: "Energy", industry: "Engineering & Construction" },
  { ticker: "CDIA.JK", name: "Chandra Daya Investasi", sector: "Infrastructures", industry: "Electric Utilities" },

  // Salim Group
  { ticker: "DNET.JK", name: "Indoritel Makmur Internasional", sector: "Technology", industry: "Wireless Telecommunications" },
  { ticker: "IMJS.JK", name: "Indomobil Multi Jasa", sector: "Financials", industry: "Finance/Rental/Leasing" },

  // Happy Hapsoro Group
  { ticker: "RATU.JK", name: "Raharja Energi Cepu", sector: "Energy", industry: "Miscellaneous" },
  { ticker: "BUVA.JK", name: "Bukit Uluwatu Villa", sector: "Consumer Cyclicals", industry: "Movies/Entertainment" },
  { ticker: "MINA.JK", name: "Sanurhasta Mitra", sector: "Properties & Real Estate", industry: "Hotels/Resorts/Cruise lines" },
  { ticker: "SINI.JK", name: "Singaraja Putra", sector: "Energy", industry: "Hotels/Resorts/Cruise lines" },
  { ticker: "UANG.JK", name: "Pakuan", sector: "Properties & Real Estate", industry: "Real Estate Development" },

  // Haji Isam / Jhonlin Group
  { ticker: "JARR.JK", name: "Jhonlin Agro Raya", sector: "Consumer Non-Cyclicals", industry: "Agricultural Commodities/Milling" },

  // Verified liquid additions (see scripts/audit-universe.ts).
  // Each cleared the same bar on the 2026-11-10 TradingView snapshot: at least
  // Rp 2T market cap and Rp 5B average daily turnover over 10 sessions, was
  // already trading on Yahoo, and was missing from the curated list.
  { ticker: "PACK.JK", name: "Abadi Nusantara Hijau Investama", sector: "Basic Materials", industry: "Containers/Packaging" },
  { ticker: "INET.JK", name: "Sinergi Inti Andalan Prima", sector: "Infrastructures", industry: "Specialty Telecommunications" },
  { ticker: "EMAS.JK", name: "Merdeka Gold Resources", sector: "Basic Materials", industry: "Precious Metals" },
  { ticker: "ARCI.JK", name: "Archi Indonesia", sector: "Basic Materials", industry: "Precious Metals" },
  { ticker: "ALII.JK", name: "Ancara Logistics Indonesia", sector: "Transportation & Logistics", industry: null },
  { ticker: "NATO.JK", name: "Olympus Strategic Indonesia", sector: "Consumer Cyclicals", industry: "Hotels/Resorts/Cruise lines" },
  { ticker: "PSAB.JK", name: "J Resources Asia Pasifik", sector: "Basic Materials", industry: "Precious Metals" },
  { ticker: "BIPI.JK", name: "Astrindo Nusantara Infrastruktur", sector: "Energy", industry: "Coal" },
  { ticker: "SMIL.JK", name: "Sarana Mitra Luas", sector: "Financials", industry: "Finance/Rental/Leasing" },
  { ticker: "FORU.JK", name: "Fortune Indonesia", sector: "Consumer Cyclicals", industry: "Advertising/Marketing Services" },
  { ticker: "ARKO.JK", name: "Arkora Hydro", sector: "Infrastructures", industry: "Engineering & Construction" },
  { ticker: "PKPK.JK", name: "Paragon Karya Perkasa", sector: "Infrastructures", industry: "Engineering & Construction" },
  { ticker: "CMNT.JK", name: "Cemindo Gemilang", sector: "Basic Materials", industry: "Construction Materials" },
  { ticker: "MMIX.JK", name: "Multi Medika Internasional", sector: "Healthcare", industry: "Medical Distributors" },
  { ticker: "RMKE.JK", name: "RMK Energy", sector: "Energy", industry: "Wholesale Distributors" },
  { ticker: "DKFT.JK", name: "Central Omega Resources", sector: "Basic Materials", industry: "Other Metals/Minerals" },
  { ticker: "MSIN.JK", name: "MNC Digital Entertainment", sector: "Consumer Cyclicals", industry: "Movies/Entertainment" },
  { ticker: "SSMS.JK", name: "Sawit Sumbermas Sarana", sector: "Consumer Non-Cyclicals", industry: "Agricultural Commodities/Milling" },
  { ticker: "CYBR.JK", name: "ITSEC Asia", sector: "Technology", industry: "Information Technology Services" },
  { ticker: "CNMA.JK", name: "Nusantara Sejahtera Raya", sector: "Consumer Cyclicals", industry: "Movies/Entertainment" },
  { ticker: "SRTG.JK", name: "Saratoga Investama Sedaya", sector: "Financials", industry: "Financial Conglomerates" },
  { ticker: "RLCO.JK", name: "Abadi Lestari Indonesia", sector: "Healthcare", industry: "Pharmaceuticals: Other" },

];

export function searchIDXStocks(query: string): IDXStock[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  // Rank exact ticker matches first, then ticker prefixes, then names. Without
  // this, searching "EMAS" returns TMAS ahead of EMAS because the list order is
  // the only tie-breaker and every ticker that contains "EMAS" matches.
  const rank = (stock: IDXStock): number => {
    const ticker = stock.ticker.replace(".JK", "");
    if (ticker === q) return 0;
    if (ticker.startsWith(q)) return 1;
    if (ticker.includes(q)) return 2;
    return 3;
  };
  return IDX_UNIVERSE.filter(
    (s) => s.ticker.replace(".JK", "").includes(q) || s.name.toUpperCase().includes(q)
  )
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 15);
}
