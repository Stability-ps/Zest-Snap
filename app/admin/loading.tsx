export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "grid", gap: 20 }}>
      <div className="ad-skel" style={{ height: 34, width: 260 }} />
      <div className="ad-kpis">
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="ad-skel" style={{ height: 96 }} />)}
      </div>
      <div className="ad-grid ad-grid-2">
        <div className="ad-skel" style={{ height: 300 }} />
        <div className="ad-skel" style={{ height: 300 }} />
      </div>
    </div>
  );
}
