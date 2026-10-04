import Link from "next/link";
import { productConfig } from "@/lib/product-config";
export default function Terms() {
  return (
    <main className="legalPage">
      <div className="legalWrap">
        <Link className="brand" href="https://zestsnap.app" aria-label="Zest Snap home">
          Zest <span>Snap</span>
        </Link>
        <Link href="/">← Home</Link>
        <h1>Terms</h1>
        <p className="legalLead">
          Zest Snap helps users extract and organise dates. AI output can be
          imperfect, so users remain responsible for reviewing dates, times and
          details before relying on them.
        </p>
        <h2>AI-assisted results</h2>
        <p>
          Zest Snap is designed to flag uncertainty and require review rather
          than silently adding questionable dates. Users should verify important
          appointments, deadlines, travel and payment information against the
          original source.
        </p>
        <h2>Plans and usage</h2>
        <p>
          AI processing is metered. Plan allowances, pricing and rewards may
          evolve during the pre-launch period and will be displayed before
          purchase.
        </p>
        <h2>Contact</h2>
        <p>{productConfig.contactEmail}</p>
        <div className="legalNotice">
          Pre-launch notice: final terms will undergo legal review before
          commercial launch.
        </div>
      </div>
    </main>
  );
}
