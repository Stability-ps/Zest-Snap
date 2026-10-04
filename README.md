# Zest Snap

**Anything with a date becomes actionable.**

Zest Snap is an international AI-powered calendar assistant by StabiFlow. It turns photos, screenshots, PDFs and shared documents into reviewed, actionable calendar events, reminders and deadlines.

## Product principles
- International-first: locale, timezone and currency aware.
- Capture -> AI understands -> Review -> Add to calendar.
- Never silently save uncertain dates.
- Useful retention: upcoming agenda, proactive reminders, weekly recap and history.
- Meaningful rewards: Zest Credits, milestones and referrals without manipulative engagement.
- Admin-configurable pricing, allowances, rewards, feature flags, content and policies.
- Privacy and security by design.

## Planned integrations
Apple Calendar / ICS, Google Calendar, Microsoft Outlook, AI document extraction, authentication, payments and transactional email.

## Platforms
One codebase ships as the web app, the installable PWA, and native **iOS** and **Android** apps (Capacitor 8, bundle/application id `app.zestsnap`).
The apps load `https://app.zestsnap.app` and add native camera, device calendar, local reminder notifications, share sheet,
deep links and store billing. See **[docs/mobile/README.md](docs/mobile/README.md)** for setup, builds, release and QA.

```bash
npm run mobile:sync          # sync native projects (production server)
npm run mobile:open:ios      # Xcode
npm run mobile:open:android  # Android Studio
```

## Domains
Primary: zestsnap.app  
Regional/defensive: zestsnap.co.za and zest-snap.co.za

Contact: hello@zestsnap.app  
Support: support@zestsnap.app  
Privacy: privacy@zestsnap.app

The app can be developed and previewed before the custom domains are connected.
