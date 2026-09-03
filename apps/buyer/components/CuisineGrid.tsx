import Link from "next/link";
import { LogoMark } from "@afrimart/ui";

const cuisines = [
  { name: "Nigerian", region: "West Africa", gradient: "linear-gradient(165deg,#2c5940,#1f3d2b)" },
  { name: "Ghanaian", region: "West Africa", gradient: "linear-gradient(165deg,#c0662f,#8a4419)" },
  { name: "Ethiopian", region: "Horn of Africa", gradient: "linear-gradient(165deg,#7a3b2e,#4a2018)" },
  { name: "Somali", region: "Horn of Africa", gradient: "linear-gradient(165deg,#3f6d63,#254a44)" },
  { name: "Kenyan", region: "East Africa", gradient: "linear-gradient(165deg,#4c7c60,#274b39)" },
  { name: "Cameroonian", region: "Central Africa", gradient: "linear-gradient(165deg,#a2461a,#5f2810)" },
];

/** "Shop by cuisine" horizontal scroll (AfriMart Buyer App.html). */
export function CuisineGrid() {
  return (
    <section style={{ padding: "34px 0 0" }}>
      <div className="pad" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 15 }}>
        <h3 className="serif" style={{ fontSize: 25 }}>
          Shop by cuisine
        </h3>
        <Link href="/shop" style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--green)" }}>
          See all
        </Link>
      </div>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", padding: "0 20px 4px" }}>
        {cuisines.map((c) => (
          <Link
            key={c.name}
            href={`/shop?cuisine=${encodeURIComponent(c.name)}`}
            style={{
              flex: "none",
              width: 138,
              height: 186,
              borderRadius: "var(--r-lg)",
              position: "relative",
              overflow: "hidden",
              border: "1px solid rgba(0,0,0,.06)",
              display: "block",
            }}
          >
            <div style={{ position: "absolute", inset: 0, background: c.gradient }} />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(180deg, rgba(17,35,24,0) 30%, rgba(17,35,24,.7) 100%)",
              }}
            />
            <div style={{ position: "absolute", top: 14, right: 12, opacity: 0.5 }}>
              <LogoMark tone="on-dark" size={34} />
            </div>
            <div style={{ position: "absolute", left: 14, bottom: 13, color: "#f6efe2" }}>
              <div className="serif" style={{ fontWeight: 600, fontSize: 21, lineHeight: 1.05 }}>
                {c.name}
              </div>
              <div style={{ fontSize: "10.5px", letterSpacing: "0.06em", color: "rgba(246,239,226,.72)", marginTop: 2 }}>{c.region}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
