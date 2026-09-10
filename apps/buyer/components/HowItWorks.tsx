const steps = [
  { n: "01", title: "Choose your market", body: "Browse verified sellers and home cooks across the diaspora." },
  { n: "02", title: "We pack with care", body: "Each seller packs your order fresh. One total, even across sellers." },
  { n: "03", title: "Delivered to your door", body: "Ships in one to two days. Track every parcel to your doorstep." },
];

/** "How it works" three-step block (AfriMart Buyer App.html). */
export function HowItWorks() {
  return (
    <div className="container">
      <div className="home-how">
        <div className="eyebrow" style={{ color: "var(--ink-3)", marginBottom: 6 }}>
          How it works
        </div>
        <div className="home-steps">
          {steps.map((s) => (
            <div key={s.n} className="home-hstep">
              <div className="serif n">{s.n}</div>
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
    </div>
  );
}
