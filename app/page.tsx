import {
  Camera,
  CalendarDays,
  Sparkles,
  Gift,
  ShieldCheck,
} from "lucide-react";

export default function Home() {
  const features = [
    [
      "01",
      "Capture anything",
      "Take a photo or upload a screenshot, PDF, notice, booking, invoice or schedule.",
    ],
    [
      "02",
      "AI understands the dates",
      "Zest Snap extracts events, deadlines, times, locations and multiple dates from one document.",
    ],
    [
      "03",
      "Review, then add",
      "Confirm what was detected before adding it to Google, Apple or Outlook calendar.",
    ],
  ];
  return (
    <main>
      <div className="wrap">
        <nav className="nav">
          <div className="brand">
            Zest <span>Snap</span>
          </div>
          <div className="navlinks">
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#security">Security</a>
            <a className="button" href="/app">
              Open Zest Snap
            </a>
          </div>
        </nav>
      </div>
      <div className="wrap">
        <section className="hero">
          <div>
            <div className="eyebrow">
              <Sparkles size={15} /> &nbsp;AI-powered calendar assistant
            </div>
            <h1>
              Anything with a date becomes <span>actionable.</span>
            </h1>
            <p>
              Snap it. Upload it. Share it. Zest Snap finds the important dates,
              lets you review them, and turns them into calendar events and
              smart reminders in seconds.
            </p>
            <div className="actions">
              <a className="button" href="/app">
                Try Zest Snap
              </a>
              <a className="button alt" href="#how">
                See how it works
              </a>
            </div>
          </div>
          <div className="phone">
            <div className="screen">
              <div className="hello">YOUR DAY</div>
              <h2>Good morning 👋</h2>
              <div className="scan">
                <div className="scanIcon">
                  <Camera />
                </div>
                <b>Snap something with a date</b>
                <p>Photo, screenshot or PDF</p>
                <a className="button" href="/app">
                  Capture or upload
                </a>
              </div>
              <div className="agenda">
                <b>Coming up</b>
                <div className="event">
                  <div className="date">TODAY</div>
                  <div>
                    <b>Team meeting</b>
                    <small>09:00 · Work</small>
                  </div>
                </div>
                <div className="event">
                  <div className="date">3 DAYS</div>
                  <div>
                    <b>Flight check-in opens</b>
                    <small>Smart reminder</small>
                  </div>
                </div>
                <div className="event">
                  <div className="date">7 DAYS</div>
                  <div>
                    <b>Appointment</b>
                    <small>Calendar synced</small>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="trust">
        Built for people everywhere · Locale & timezone aware · Review before
        saving
      </div>
      <section id="how" className="section">
        <div className="wrap">
          <h2>From document to calendar in seconds.</h2>
          <p>No more typing dates from screenshots, notices and PDFs.</p>
          <div className="cards">
            {features.map((x) => (
              <div className="card" key={x[0]}>
                <div className="num">{x[0]}</div>
                <h3>{x[1]}</h3>
                <p>{x[2]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="section">
        <div className="wrap">
          <h2>A reason to come back every day.</h2>
          <p>Zest Snap keeps helping after the scan.</p>
          <div className="cards">
            <div className="card">
              <CalendarDays />
              <h3>Your intelligent agenda</h3>
              <p>
                Upcoming events, deadlines, follow-ups and weekly recaps in one
                calm view.
              </p>
            </div>
            <div className="card">
              <Gift />
              <h3>Zest Rewards</h3>
              <p>
                Earn useful credits, bonus scans and referral rewards through
                meaningful activity.
              </p>
            </div>
            <div id="security" className="card">
              <ShieldCheck />
              <h3>You stay in control</h3>
              <p>
                Uncertain dates are flagged for review. Zest Snap does not
                silently add questionable events.
              </p>
            </div>
          </div>
        </div>
      </section>
      <section id="pricing" className="section pricing">
        <div className="wrap">
          <h2>Start free. Upgrade when Zest becomes essential.</h2>
          <p>
            International pricing will display in supported local currencies
            where available.
          </p>
          <div className="cards">
            <div className="card">
              <h3>Free</h3>
              <div className="price">$0</div>
              <p>
                AI scans to get started, event review, calendar export and your
                upcoming agenda.
              </p>
              <a className="button alt" href="/app">
                Get started
              </a>
            </div>
            <div className="card">
              <h3>Zest Snap+</h3>
              <div className="price">
                $4.99 <small>/ month</small>
              </div>
              <p>
                More AI scans, PDFs, multiple-event extraction, smart reminders
                and richer AI understanding.
              </p>
              <a className="button" href="/app">
                Start with Free
              </a>
            </div>
            <div className="card">
              <h3>Business</h3>
              <div className="price">
                $11.99 <small>/ month</small>
              </div>
              <p>
                Higher allowances, business deadlines, advanced document
                workflows and future team tools.
              </p>
              <a className="button alt" href="/app">
                Explore Business
              </a>
            </div>
          </div>
        </div>
      </section>
      <footer className="footer">
        <div className="wrap">
          <p>
            <b>Zest Snap</b> · by StabiFlow
          </p>
          <p>hello@zestsnap.app · support@zestsnap.app · © 2026 Zest Snap</p>
        </div>
      </footer>
    </main>
  );
}
