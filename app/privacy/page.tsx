import Link from "next/link";
import { productConfig } from "@/lib/product-config";
export default function Privacy() {
  return (
    <main className="legalPage">
      <div className="legalWrap">
        <Link href="/">← Home</Link>
        <h1>Privacy</h1>
        <p>Last updated: 8 October 2026.</p>
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
          Apple’s speech recognition; on Android and in Chrome, Google’s). Only
          the resulting text reaches Zest Snap; Plan with Zest audio is not sent
          to or stored by Zest Snap. The text is sent to OpenAI to suggest
          events, which you review before anything is saved. The microphone is
          used only while you are speaking to Plan with Zest. Voice notes you
          send in a Shared plan are different: they are recorded and stored as
          described under Shared plans.
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
          Scan history is removed according to your retention preference; the
          default is 90 days. For signed-in accounts this runs on our servers
          once a day; for guest history it runs when you open the app. Results
          held temporarily while a scan is processed are cleared after two
          days. Agenda and Planner items remain until you remove them. Shared
          plan messages, attachments and voice notes remain until they are
          deleted as described under Shared plans. Settings lets you export
          records, clear device data or delete a cloud account. Cloud account
          deletion removes your Zest records, revokes your sessions, deletes
          the Shared plans you own (including their messages and files, for
          every member) and deletes your messages and uploads in other
          people’s Shared plans. Provider backups may persist under the
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
          are not saved by Zest Snap); disconnect at any time in Settings.
          Reminders, the optional Daily Briefing and Shared plan message alerts
          are delivered as notifications you turn on. In the iOS and Android
          apps, reminders are scheduled on your device. In a browser or the
          installed web app, notifications are sent through your browser’s
          push service (for example Apple, Google or Mozilla), and their text
          can include item titles or, for Shared messages, the sender’s name,
          the plan name and the first 140 characters of the message. You can
          turn notifications off in your device or browser settings. Zest Snap
          does not send marketing messages.
        </p>
        <h2>Shared plans</h2>
        <p>
          When you share an event or plan, its members can see its items, the
          group’s member list with display names and roles, and who is
          assigned to each task. Owners can rename the group and revoke
          invitation links; members can leave at any time. An invitation sent
          to an email address stores that address so only that account can
          accept it. Invitation links can be opened by
          anyone who has them until they expire or are revoked, and before
          signing in they show the plan’s name, the role offered and one item
          from the plan.
        </p>
        <p>
          Members can send messages, reactions, replies, photos, files and
          voice notes in a Shared plan. A voice note is recorded by your device
          from when you start recording until you stop, and is then uploaded
          as an audio file. Photos, files and voice notes (up to 25 MB each)
          are stored in a private Zest Snap storage area in our Supabase project; other
          members of that plan can open them through links that expire after
          one hour, and people outside the plan cannot. Messages and
          attachments are not sent to OpenAI. Your read position in each plan
          is stored to show unread counts and is visible only to you.
        </p>
        <p>
          You can edit or delete your own messages. Deleting a message replaces
          its text with “Message deleted”, removes its reactions and deletes
          its attachment; the sender and time of the message remain. Leaving a
          plan does not delete messages you sent there; the group can still see
          them. When the owner deletes a plan, its items, members, invitations,
          messages and stored files are deleted for everyone. Anything a member
          has already downloaded or copied is outside Zest’s deletion
          control.
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
          servers, and a hashed form of your network address is used for rate
          limiting; the hashed network address kept with guest scans is
          cleared after two days. No advertising or third-party analytics
          tracker is included.
        </p>
        <h2>Service providers</h2>
        <p>
          Zest Snap uses these providers to run the service: Supabase
          (accounts, database, file storage and scheduled jobs; our project is
          hosted in the EU, in Stockholm, Sweden), Vercel (web hosting and
          server functions), OpenAI (reading scans and suggesting events from
          Plan with Zest text), Upstash (rate limiting using hashed
          identifiers), Google (Google Calendar, if you connect it, and speech
          recognition on Android and in Chrome), Apple (speech recognition on
          Apple devices and App Store purchases), Google Play (purchases on
          Android), RevenueCat (subscription status, when in-app purchases are
          available) and browser push services (web notifications). Vercel,
          OpenAI and other providers may process data outside your country,
          including in the United States.
        </p>
        <h2>Your choices</h2>
        <p>
          In Settings you can export your records, change how long scan history
          is kept, clear data on this device, disconnect Google Calendar and
          delete your cloud account. You can turn notifications off at any
          time, leave a Shared plan, and delete your own Shared messages. For
          any other request about your personal data, contact us at the address
          below.
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
