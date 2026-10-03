export default function Offline() {
  return (
    <main className="offlinePage">
      <div className="offlineCard">
        <div className="brand">
          Zest <span>Snap</span>
        </div>
        <div className="offlineMark">Z</div>
        <h1>You’re offline</h1>
        <p>
          Your saved Zest agenda and scan history remain on this device.
          Scanning new files needs an internet connection.
        </p>
        <a className="button" href="/app">
          Try again
        </a>
      </div>
    </main>
  );
}
