import Link from "next/link";
import { productConfig } from "@/lib/product-config";
export default function Privacy() {
  return (
    <main className="legalPage">
      <div className="legalWrap">
        <Link href="/">← Home</Link>
        <h1>Privacy</h1>
        <p>Last updated: 7 October 2026.</p>
        <h2>Uploads and AI processing</h2>
        <p>
          When you scan, Zest Snap sends your image or PDF to OpenAI to extract
          dates and event details. Review the result before relying on it. Zest
          does not save the original upload in its database or browser storage.
          Requests disable OpenAI response storage; the provider’s own security
          and abuse retention policies may still apply. Do not upload content
          you are not entitled to share.
        </p>
        <h2>Plan with Zest (voice and typed plans)</h2>
        <p>
          When you speak to Plan with Zest, your phone or browser’s own speech
          recogniser turns your words into text (on Apple devices this is
          Apple’s speech recognition; on Android and in Chrome, Google’s). Zest
          Snap does not receive or store audio. The text is sent to OpenAI to
          suggest events, which you review before anything is saved. The
          microphone is used only while you are speaking to Plan with Zest.
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
          confirm that an event was added there. In the apps, adding to your
          calendar opens your phone’s calendar editor and you confirm each
          event; Zest Snap does not read your existing calendar. If you connect
          Google Calendar, Zest Snap stores an access token to add and update
          the Planner items you choose in your Google Calendar and to show your
          Google events alongside your Planner while you view it (those events
          are not saved by Zest Snap); disconnect at any time in Settings. Reminders and the optional Daily Briefing are
          delivered as notifications you turn on; you can turn them off in your
          device or browser settings. Zest Snap does not send marketing
          messages.
        </p>
        <h2>Shared plans</h2>
        <p>
          When you share an event or plan, the people you invite can see its
          items and your display name. Owners can remove members and revoke
          invitation links; members can leave at any time. Invitation links can
          be opened by anyone who has them until they expire or are revoked.
        </p>
        <h2>Subscriptions</h2>
        <p>
          Subscriptions bought in the iOS or Android app are processed by Apple
          or Google. Zest Snap uses RevenueCat to confirm your subscription
          status and receives your plan, renewal and expiry details, never your
          payment card details.
        </p>
        <h2>Operations and international processing</h2>
        <p>
          We record request identifiers, outcome, usage and error categories to
          operate the service. We do not intentionally log document contents or
          extracted text. To limit abuse of free scans, the app creates a
          random install identifier that is stored only in hashed form on our
          servers. No advertising or third-party analytics tracker is
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
