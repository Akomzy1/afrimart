const steps = [
  { n: "01", title: "Choose your market", body: "Browse verified sellers and home cooks across the diaspora." },
  { n: "02", title: "We pack with care", body: "Each seller packs your order fresh. One total, even across sellers." },
  { n: "03", title: "Delivered to your door", body: "Ships in one to two days. Track every parcel to your doorstep." },
];

/** "How it works" three-step block (AfriMart Buyer App.html). */
export function HowItWorks() {
  return (
    <div style={{ margin: "36px 20px 0", background: "var(--panel)", border: "1px solid var(--line)", borderRadius: "var(--r-lg)", padding: "24px 22px" }}>
      <div className="eyebrow" style={{ color: "var(--ink-3)", marginBottom: 6 }}>
        How it works
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {steps.map((s, i) => (
          <div
            key={s.n}
            style={{
              display: "grid",
              gridTemplateColumns: "34px 1fr",
              gap: 15,
              padding: "13px 0",
              alignItems: "start",
              borderTop: i > 0 ? "1px solid var(--line-soft)" : undefined,
            }}
          >
            <div className="serif" style={{ fontStyle: "italic", fontSize: 17, color: "var(--gold)", paddingTop: 2 }}>
              {s.n}
            </div>
            <div>
              <h4 className="serif" style={{ fontSize: 19, marginBottom: 2 }}>
                {s.title}
              </h4>
              <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
