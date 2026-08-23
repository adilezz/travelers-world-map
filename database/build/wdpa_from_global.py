"""Read protected-area centroids out of the global WDPA shapefile archive.

Protected Planet's CSV export carries every attribute but no geometry, so the
coordinates have to come from the shapefiles. This reads them with nothing but
the standard library: the `.dbf` gives the attributes, the `.shp` gives each
record's bounding box, and the centre of that box is accurate to far better
than the 60 km catchment the model uses.

The archive nests three zips (`_shp_0`, `_shp_1`, `_shp_2`) that hold the same
records at three levels of geometric detail. Only `_shp_0` is read.

Usage:
    python wdpa_from_global.py /path/to/WDPA_WDOECM_..._all_shp.zip out.csv
"""
import csv
import struct
import sys
import tempfile
import zipfile
from pathlib import Path

IUCN_OK = {"IA", "IB", "II", "III", "IV"}
MIN_AREA_KM2 = 25.0


def read_dbf(fh):
    """Yield dicts from a DBF stream. Returns (fields, record_iterator)."""
    head = fh.read(32)
    nrec, hlen, rlen = struct.unpack("<I", head[4:8])[0], \
        struct.unpack("<H", head[8:10])[0], struct.unpack("<H", head[10:12])[0]
    fields = []
    pos = 32
    while pos < hlen - 1:
        d = fh.read(32)
        pos += 32
        if not d or d[0] == 0x0D:
            break
        name = d[:11].split(b"\x00")[0].decode("latin-1").strip()
        fields.append((name, d[16]))
    fh.read(max(0, hlen - pos))

    def rows():
        for _ in range(nrec):
            rec = fh.read(rlen)
            if len(rec) < rlen:
                return
            out, off = {}, 1
            for name, ln in fields:
                out[name] = rec[off:off + ln].decode("utf-8", "replace").strip()
                off += ln
            yield out
    return fields, rows()


def read_shp_centroids(fh):
    """Yield (lat, lon) per record, from each record's bounding box."""
    fh.read(100)
    while True:
        hdr = fh.read(8)
        if len(hdr) < 8:
            return
        clen = struct.unpack(">i", hdr[4:8])[0] * 2
        body = fh.read(clen)
        if len(body) < 4:
            return
        stype = struct.unpack("<i", body[:4])[0]
        if stype in (3, 5, 13, 15, 23, 25) and len(body) >= 36:
            x0, y0, x1, y1 = struct.unpack("<4d", body[4:36])
            yield ((y0 + y1) / 2.0, (x0 + x1) / 2.0)
        elif stype in (1, 11, 21) and len(body) >= 20:
            x, y = struct.unpack("<2d", body[4:20])
            yield (y, x)
        else:
            yield None


def main(archive, out_path):
    archive = Path(archive)
    with zipfile.ZipFile(archive) as outer:
        inner_name = next((n for n in outer.namelist() if n.endswith("_shp_0.zip")), None)
        if not inner_name:
            sys.exit(f"no _shp_0.zip inside {archive.name}: {outer.namelist()[:6]}")
        print(f"extracting {inner_name} ...", flush=True)
        with tempfile.TemporaryDirectory() as tmp:
            inner_path = Path(tmp) / "shp0.zip"
            with outer.open(inner_name) as src, open(inner_path, "wb") as dst:
                while True:
                    chunk = src.read(1 << 22)
                    if not chunk:
                        break
                    dst.write(chunk)
            print(f"  {inner_path.stat().st_size / 1e9:.2f} GB", flush=True)

            with zipfile.ZipFile(inner_path) as inner:
                names = inner.namelist()
                dbf_n = next(n for n in names if n.lower().endswith(".dbf"))
                shp_n = next(n for n in names if n.lower().endswith(".shp"))
                print(f"  reading {Path(dbf_n).name} + {Path(shp_n).name}", flush=True)

                with inner.open(dbf_n) as dfh:
                    _fields, recs = read_dbf(dfh)
                    attrs = list(recs)
                print(f"  {len(attrs)} attribute records", flush=True)

                with inner.open(shp_n) as sfh:
                    cents = list(read_shp_centroids(sfh))
                print(f"  {len(cents)} geometries", flush=True)

    if len(cents) != len(attrs):
        print(f"  WARNING: {len(attrs)} records vs {len(cents)} geometries — "
              "pairing by index may be wrong", flush=True)

    kept, seen = 0, set()
    with open(out_path, "w", encoding="utf-8", newline="") as fo:
        w = csv.writer(fo)
        w.writerow(["WDPAID", "NAME", "IUCN_CAT", "GIS_AREA", "ISO3",
                    "latitude", "longitude"])
        for row, c in zip(attrs, cents, strict=False):
            if c is None:
                continue
            cat = (row.get("IUCN_CAT") or "").upper().replace(" ", "")
            if cat not in IUCN_OK:
                continue
            try:
                area = float(row.get("GIS_AREA") or 0)
            except ValueError:
                continue
            if area < MIN_AREA_KM2:
                continue
            lat, lon = c
            if not (-90 <= lat <= 90) or not (-180 <= lon <= 180) or (lat == 0 and lon == 0):
                continue
            wid = row.get("WDPAID") or row.get("SITE_ID") or ""
            if not wid or wid in seen:
                continue
            seen.add(wid)
            name = (row.get("NAME_ENG") or row.get("NAME") or "").replace("\n", " ").strip()
            iso = (row.get("ISO3") or "").split(";")[0].strip()
            w.writerow([wid, name, cat, f"{area:.2f}", iso, f"{lat:.5f}", f"{lon:.5f}"])
            kept += 1
    print(f"wrote {kept} protected areas -> {out_path}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
