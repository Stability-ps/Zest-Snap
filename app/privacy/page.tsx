import Link from "next/link";
import { productConfig } from "@/lib/product-config";
export default function Privacy() {
  return (
    <main className="legalPage">
      <div className="legalWrap">
        <Link href="/">← Home</Link>
        <h1>Privacy</h1>
        <p>Last updated: 3 October 2026.</p>
        <h2>Uploads and AI processing</h2>
        <p>
          When you scan, Zest Snap sends your image or PDF to OpenAI to extract
          dates and event details. Review the result before relying on it. Zest
          does not save the original upload in its database or browser storage.
          Requests disable OpenAI response storage; the provider’s own security
          and abuse retention policies may still apply. Do not upload content
          you are not entitled to share.
        </p>
        <h2>Saved data</h2>
        <p>
          Guest history, agenda and reward progress are stored in this browser.
          Clearing browser data or changing devices can remove access. When
          cloud accounts are enabled, signed-in records are saved to the
          dedicated Zest Snap Supabase project, with a separate device copy for
          offline access. You can explicitly merge guest history and agenda in
          Settings. Original images are never included in that merge. Local
          reward progress is not accepted as spendable cloud credits.
        </p>
        <h2>Retention and deletion</h2>
        <p>
          Scan history is removed according to your retention preference when
          you open the app; the default is 90 days. Agenda items remain until
          you remove them. Settings lets you export records, clear device data
          or delete a cloud account. Cloud account deletion removes Zest records
          and revokes sessions. Provider backups may persist under the
          provider’s backup retention schedule. Downloaded files and external
          calendar events are outside Zest’s deletion control.
        </p>
        <h2>Calendar and notifications</h2>
        <p>
          Calendar files are prepared only when requested. You choose whether to
          import them into another application. Preparing a file does not
          confirm that an event was added there. Push notifications, direct
          calendar connections and marketing messages are not active.
        </p>
        <h2>Operations and international processing</h2>
        <p>
          We record request identifiers, outcome, usage and error categories to
          operate the service. We do not intentionally log document contents or
          extracted text. No advertising or third-party analytics tracker is
          included. Hosting, AI and database providers may process data outside
          your country.
        </p>
        <h2>Contact</h2>
        <p>Privacy enquiries: {productConfig.privacyEmail}</p>
        <p>
          Owner legal review, legal entity details and applicable international
          notices remain required before commercial launch.
        </p>
      </div>
    </main>
  );
}
