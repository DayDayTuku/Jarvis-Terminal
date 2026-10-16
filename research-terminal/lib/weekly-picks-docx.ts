type WeeklyPick = {
  ticker: string;
  setup: string;
  score: number;
  planned_entry_low: number;
  planned_entry_high: number;
  invalidation: number;
  target_one?: number;
  position_weight: number;
  reasons?: string[];
};

type WeeklyAction = {
  ticker: string;
  action: string;
  target_weight: number;
  reason: string;
};

type WeeklyReportInput = {
  weekOf: string;
  regime: string;
  picks: WeeklyPick[];
  actions: WeeklyAction[];
};

const encoder = new TextEncoder();
const stripAlertMarkers = (value: string) => String(value ?? "").replace(/\s*\[(?:stop|target)-alert:sent\]\s*/g, " ").trim();
const u16 = (n:number) => Buffer.from([n & 255, (n >>> 8) & 255]);
const u32 = (n:number) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data:Buffer) {
  let c = 0xffffffff;
  for (const byte of data) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries:Array<[string,string|Buffer]>) {
  const local:Buffer[] = [];
  const central:Buffer[] = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(encoder.encode(name));
    const data = Buffer.isBuffer(value) ? value : Buffer.from(encoder.encode(value));
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes,
    ]);
    local.push(localHeader, data);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), nameBytes,
    ]));
    offset += localHeader.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBuffer.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...local, centralBuffer, end]);
}

const esc = (value:unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
} as Record<string,string>)[c]);
const run = (text:string, { bold = false, color = "17212B", size = 22 }:{bold?:boolean;color?:string;size?:number} = {}) =>
  `<w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const p = (text = "", { style, bold, color, size, before = 0, after = 120, align }:{style?:string;bold?:boolean;color?:string;size?:number;before?:number;after?:number;align?:string} = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${before ? `<w:spacing w:before="${before}" w:after="${after}"/>` : `<w:spacing w:after="${after}"/>`}${align ? `<w:jc w:val="${align}"/>` : ""}</w:pPr>${run(text, { bold, color, size })}</w:p>`;
const pageBreak = () => `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
const cell = (text:string, width:number, { header = false, align = "left" }:{header?:boolean;align?:string} = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar>${header ? '<w:shd w:fill="1F3C52"/>' : ""}<w:vAlign w:val="center"/></w:tcPr>${p(text, { bold: header, color: header ? "FFFFFF" : "17212B", size: header ? 18 : 19, after: 0, align })}</w:tc>`;
function table(headers:string[], rows:string[][], widths:number[]) {
  const borders = `<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideH w:val="single" w:sz="4" w:color="D9D9D9"/><w:insideV w:val="single" w:sz="4" w:color="D9D9D9"/></w:tblBorders>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}</w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid><w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((h, i) => cell(h, widths[i], { header: true, align: "center" })).join("")}</w:tr>${rows.map((row) => `<w:tr>${row.map((v, i) => cell(v, widths[i], { align: i === 0 ? "left" : "center" })).join("")}</w:tr>`).join("")}</w:tbl>`;
}

export function generateWeeklyPicksDocx({ weekOf, regime, picks, actions }:WeeklyReportInput) {
  const actionRows = actions.length ? actions.map((a) => [a.ticker, a.action, `${a.target_weight.toFixed(1)}%`, stripAlertMarkers(a.reason)]) : [["-", "NO CHANGE", "0%", "No prior-position action this week."]];
  const pickRows = picks.length ? picks.map((x) => [x.ticker, x.setup, Number(x.score).toFixed(1), `${Number(x.planned_entry_low).toLocaleString("id-ID")} - ${Number(x.planned_entry_high).toLocaleString("id-ID")}`, Number(x.invalidation).toLocaleString("id-ID")]) : [["-", "CASH", "-", "-", "-"]];
  let body = "";
  body += p("JARVIS WEEKLY PICKS", { style: "Title", bold: true, size: 44, after: 180 });
  body += p(`Technical Portfolio Review for the Week of ${weekOf}`, { style: "Subtitle", size: 25, color: "526170", after: 360 });
  body += p(`V5 Regime ${regime}`, { bold: true, size: 26, color: regime === "RISK OFF" ? "A33A3A" : "1F6B57", after: 180 });
  body += p("This report converts the frozen weekly screener output into an execution plan and reviews the prior portfolio before presenting new candidates.", { size: 22, after: 260 });
  body += p("Research Purpose", { style: "Heading1", bold: true, size: 30, before: 200, after: 100 });
  body += p("Use the entry range rather than chasing price. Treat invalidation as the point where the setup is wrong, and reassess every position in the following weekly review.", { size: 22, after: 260 });
  body += pageBreak();
  body += p("Portfolio Review", { style: "Heading1", bold: true, size: 32, after: 150 });
  body += table(["Ticker", "Action", "Target Weight", "Reason"], actionRows, [1300, 1400, 1600, 4700]);
  body += p("Current Weekly Picks", { style: "Heading1", bold: true, size: 32, before: 320, after: 150 });
  body += table(["Ticker", "Setup", "Score", "Entry Range", "Invalidation"], pickRows, [1200, 1500, 1100, 3000, 2200]);
  for (const item of picks) {
    body += pageBreak();
    body += p(`${item.ticker} Technical Deep Dive`, { style: "Heading1", bold: true, size: 34, after: 100 });
    body += p(`${item.setup.toUpperCase()} | SCORE ${Number(item.score).toFixed(1)}`, { bold: true, color: "2F80C9", size: 22, after: 220 });
    body += p("Decision Plan", { style: "Heading2", bold: true, size: 26, after: 100 });
    body += table(["Entry Range", "Invalidation", "First Target", "Target Weight"], [[`${Number(item.planned_entry_low).toLocaleString("id-ID")} - ${Number(item.planned_entry_high).toLocaleString("id-ID")}`, Number(item.invalidation).toLocaleString("id-ID"), item.target_one ? Number(item.target_one).toLocaleString("id-ID") : "-", `${Number(item.position_weight).toFixed(1)}%`]], [2600, 2200, 2200, 2000]);
    body += p("Why It Appeared", { style: "Heading2", bold: true, size: 26, before: 280, after: 90 });
    const reasons = Array.isArray(item.reasons) && item.reasons.length ? item.reasons : ["The V5 technical score and risk reward threshold were satisfied."];
    for (const reason of reasons) body += p(`• ${reason}`, { size: 21, after: 80 });
    body += p("Risk Interpretation", { style: "Heading2", bold: true, size: 26, before: 220, after: 90 });
    body += p(`A weekly close or decisive trade below ${Number(item.invalidation).toLocaleString("id-ID")} invalidates the setup. If the entry range is not traded, classify it as NO ENTRY and do not chase.`, { size: 21, after: 120 });
  }
  body += p("Methodology Note", { style: "Heading1", bold: true, size: 30, before: 320, after: 100 });
  body += p("This is a rules-based technical research output, not an order or investment recommendation. Position actions are determined from entry fills, invalidation, target achievement, score deterioration, and continued V5 selection.", { size: 20, color: "526170", after: 160 });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="540" w:footer="540"/></w:sectPr></w:body></w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="17212B"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`;
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p("J  |  JARVIS RESEARCH", { bold: true, size: 18, color: "17212B", after: 0 })}</w:hdr>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p("Research Purpose  |  V5 Weekly Picks", { size: 16, color: "687786", after: 0, align: "right" })}</w:ftr>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
  return zip([
    ["[Content_Types].xml", contentTypes],
    ["_rels/.rels", rootRels],
    ["word/document.xml", documentXml],
    ["word/styles.xml", stylesXml],
    ["word/header1.xml", headerXml],
    ["word/footer1.xml", footerXml],
    ["word/_rels/document.xml.rels", docRels],
  ]);
}
