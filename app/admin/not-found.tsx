import Link from "next/link";
export default function NotFound() {
  return (
    <div className="zadm-card">
      <div className="zadm-empty">
        <h3>Not found</h3>
        <p>That record doesn&apos;t exist or was deleted.</p>
        <Link className="zadm-btn" href="/admin">Back to overview</Link>
      </div>
    </div>
  );
}
