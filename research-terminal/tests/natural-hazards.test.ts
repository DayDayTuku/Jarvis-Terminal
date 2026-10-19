import test from "node:test";
import assert from "node:assert/strict";
import {
  INDONESIA_BOX,
  MAX_FIRE_CELLS,
  inIndonesiaBox,
  parseBmkg,
  parseFirmsCsv,
  regionFor,
  worldRegionFor,
} from "../lib/natural-hazards.ts";

/* ------------------------------------------------------------------ geography */

test("inIndonesiaBox: accepts the archipelago, rejects neighbours", () => {
  assert.equal(inIndonesiaBox(-2.2, 118.0), true); // Sulawesi
  assert.equal(inIndonesiaBox(-8.6, 115.2), true); // Bali
  assert.equal(inIndonesiaBox(INDONESIA_BOX.minLat, INDONESIA_BOX.minLng), true);
  assert.equal(inIndonesiaBox(INDONESIA_BOX.maxLat, INDONESIA_BOX.maxLng), true);
  assert.equal(inIndonesiaBox(15.0, 100.5), false); // Thailand
  assert.equal(inIndonesiaBox(-3.0, 143.0), false); // PNG, east of the box
  assert.equal(inIndonesiaBox(9.5, 100.0), false); // north of the box
});

test("regionFor: buckets each archipelago region", () => {
  assert.equal(regionFor(-2.2, 118.0), "SULAWESI");
  assert.equal(regionFor(-2.4, 140.1), "PAPUA");
  assert.equal(regionFor(-1.0, 114.0), "KALIMANTAN");
  assert.equal(regionFor(-6.9, 107.6), "JAVA");
  assert.equal(regionFor(-8.9, 117.0), "NUSA TENGGARA");
  assert.equal(regionFor(0.2, 101.3), "SUMATRA");
  assert.equal(regionFor(20.0, 100.0), "OTHER");
});

test("worldRegionFor: buckets the globe, not just the archipelago", () => {
  assert.equal(worldRegionFor(0.2, 101.3), "SOUTHEAST ASIA"); // Sumatra
  assert.equal(worldRegionFor(15.0, 100.5), "SOUTHEAST ASIA"); // Indochina
  assert.equal(worldRegionFor(-14.0, 133.0), "OCEANIA"); // Northern Territory
  assert.equal(worldRegionFor(-3.0, -60.0), "SOUTH AMERICA"); // Amazon
  assert.equal(worldRegionFor(-8.0, 25.0), "AFRICA"); // Congo
  assert.equal(worldRegionFor(39.0, -98.0), "NORTH AMERICA"); // Kansas
  assert.equal(worldRegionFor(48.0, 2.0), "EUROPE"); // France
  assert.equal(worldRegionFor(35.0, 139.0), "EAST ASIA"); // Japan
  assert.equal(worldRegionFor(28.0, 77.0), "SOUTH ASIA"); // Delhi
});

/* ------------------------------------------------------------------ wildfire */

const FIRMS_HEADER =
  "country_id,latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight";

const firesCsv = [
  FIRMS_HEADER,
  // Two hotspots in the same 1-degree cell over Sumatra.
  "ID,0.2,101.3,330,1,1,2026-10-18,0130,N,VIIRS,n,2.0N,290,12.5,D",
  "ID,0.6,101.9,331,1,1,2026-10-18,0140,N,VIIRS,n,2.0N,289,5.5,D",
  // Two in the same cell over Papua, the later date carrying the peak FRP.
  "ID,-2.4,140.1,335,1,1,2026-10-18,0200,N,VIIRS,n,2.0N,300,30,D",
  "ID,-2.9,140.4,340,1,1,2026-10-19,0205,N,VIIRS,n,2.0N,305,40,D",
  // Outside the Indonesia box but still a fire: Thailand, and Brazil.
  "TH,15.0,100.5,320,1,1,2026-10-19,0300,N,VIIRS,n,2.0N,285,9,D",
  "BR,-3.0,-60.0,340,1,1,2026-10-19,0300,N,VIIRS,n,2.0N,300,55,D",
].join("\n");

test("parseFirmsCsv: clusters hotspots into 1-degree cells worldwide", () => {
  const read = parseFirmsCsv(firesCsv);
  assert.equal(read.total, 6, "every hotspot counts, not only the in-box ones");
  assert.equal(read.cells.length, 4);
  assert.equal(read.truncated, false);
  assert.equal(read.latest, "2026-10-19");

  const [papua, sumatra, amazon] = read.cells;
  assert.equal(papua.id, "fire--3:140");
  assert.equal(papua.region, "SOUTHEAST ASIA");
  assert.equal(papua.indonesiaRegion, "PAPUA");
  assert.equal(papua.count, 2);
  assert.equal(papua.maxFrp, 40);
  assert.equal(papua.totalFrp, 70);
  assert.equal(papua.date, "2026-10-19");
  // Cell centre is the mean of its detections, not the grid corner.
  assert.ok(Math.abs(papua.lat - -2.65) < 1e-9, `centre lat ${papua.lat}`);
  assert.ok(Math.abs(papua.lng - 140.25) < 1e-9, `centre lng ${papua.lng}`);

  assert.equal(sumatra.id, "fire-0:101");
  assert.equal(sumatra.region, "SOUTHEAST ASIA");
  assert.equal(sumatra.indonesiaRegion, "SUMATRA");
  assert.equal(sumatra.maxFrp, 12.5);
  assert.equal(sumatra.totalFrp, 18);

  // Brazil is a world region but not the archipelago read.
  assert.equal(amazon.region, "SOUTH AMERICA");
  assert.equal(amazon.indonesiaRegion, null);
});

test("parseFirmsCsv: buckets world regions and the archipelago subset separately", () => {
  const read = parseFirmsCsv(firesCsv);
  assert.deepEqual(
    Object.fromEntries(read.regions.map((region) => [region.name, region.count])),
    { "SOUTHEAST ASIA": 5, "SOUTH AMERICA": 1 },
  );
  assert.equal(read.indonesiaTotal, 4, "only the in-box hotspots");
  assert.deepEqual(
    Object.fromEntries(read.indonesiaRegions.map((region) => [region.name, region.count])),
    { PAPUA: 2, SUMATRA: 2 },
  );
});

test("parseFirmsCsv: tolerates malformed input without throwing", () => {
  for (const input of ["", "   \n  ", "latitude,longitude\n", "a,b\n1,2", "country_id,frp\nID,5"]) {
    const read = parseFirmsCsv(input);
    assert.equal(read.total, 0, `total for ${JSON.stringify(input)}`);
    assert.deepEqual(read.cells, []);
    assert.deepEqual(read.regions, []);
    assert.equal(read.indonesiaTotal, 0);
    assert.deepEqual(read.indonesiaRegions, []);
    assert.equal(read.latest, null);
  }
});

test("parseFirmsCsv: caps the number of plotted cells", () => {
  const rows = [FIRMS_HEADER];
  // One hotspot in each of many distinct 1-degree cells, spread worldwide.
  for (let index = 0; index < MAX_FIRE_CELLS + 100; index += 1) {
    const lat = -60 + (index % 120);
    const lng = -170 + Math.floor(index / 120) * 3;
    rows.push(`X,${lat}.1,${lng}.1,330,1,1,2026-10-18,0130,N,VIIRS,n,2.0N,290,10,D`);
  }
  const read = parseFirmsCsv(rows.join("\n"));
  assert.equal(read.total, MAX_FIRE_CELLS + 100);
  assert.equal(read.cells.length, MAX_FIRE_CELLS);
  assert.equal(read.truncated, true);
});

/* ------------------------------------------------------------------ BMKG */

test("parseBmkg: maps felt earthquakes and strips the prose prefix", () => {
  const reads = parseBmkg({
    Infogempa: {
      gempa: [
        {
          Tanggal: "18 Okt 2026",
          Jam: "06:23:26 WIB",
          DateTime: "2026-10-18T06:23:26+07:00",
          Coordinates: "-4.12,130.25",
          Magnitude: "5.4",
          Kedalaman: "12 km",
          Wilayah: "Pusat gempa berada di Laut Banda",
          Dirasakan: "III Ambon",
        },
        {
          DateTime: "2026-10-17T22:10:04+07:00",
          Coordinates: "-8.20,115.30",
          Magnitude: "3.1",
          Kedalaman: "10 km",
          Wilayah: "Bali",
          Dirasakan: "",
        },
      ],
    },
  });
  assert.equal(reads.length, 2);
  // Sorted newest first.
  assert.equal(reads[0].date, "2026-10-18T06:23:26+07:00");
  assert.equal(reads[0].region, "Laut Banda");
  assert.equal(reads[0].magnitude, 5.4);
  assert.equal(reads[0].depthKm, 12);
  assert.equal(reads[0].felt, "III Ambon");
  assert.equal(reads[0].lat, -4.12);
  assert.equal(reads[0].lng, 130.25);
  assert.equal(reads[0].id, "bmkg-2026-10-18T06:23:26+07:00--4.12-130.25");
  assert.equal(reads[1].region, "Bali");
});

test("parseBmkg: skips rows without usable coordinates or magnitude", () => {
  const reads = parseBmkg({
    Infogempa: {
      gempa: [
        { DateTime: "2026-10-18T06:00:00+07:00", Magnitude: "5.0", Wilayah: "No coordinates" },
        { DateTime: "2026-10-18T06:00:00+07:00", Coordinates: "abc,def", Magnitude: "5.0", Wilayah: "Junk" },
        { DateTime: "2026-10-18T06:00:00+07:00", Coordinates: "1.0,120.0", Magnitude: "-", Wilayah: "No magnitude" },
      ],
    },
  });
  assert.deepEqual(reads, []);
});

test("parseBmkg: accepts a single-object gempa list and empty payloads", () => {
  const single = parseBmkg({
    Infogempa: { gempa: { DateTime: "2026-10-18T06:00:00+07:00", Coordinates: "1.0,120.0", Magnitude: "4.2", Wilayah: "Laut Sulawesi" } },
  });
  assert.equal(single.length, 1);
  assert.equal(single[0].magnitude, 4.2);

  assert.deepEqual(parseBmkg(null), []);
  assert.deepEqual(parseBmkg({}), []);
  assert.deepEqual(parseBmkg({ Infogempa: {} }), []);
});
