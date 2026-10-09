import Link from "next/link";

export default function VerifiedEmailPage() {
  return (
    <main className="authPage">
      <div className="authCard">
        <div className="authBrandRow">
          <Link href="https://zestsnap.app" className="brand">
            Zest <span>Snap</span>
          </Link>
        </div>
        <h1>Email verified successfully.</h1>
        <p className="authIntro">
          Your email has been confirmed. You can now sign in and continue planning with Zest Snap.
        </p>
        <Link className="button authSubmit" href="/login">
          Continue to Zest Snap
        </Link>
      </div>
    </main>
  );
}
