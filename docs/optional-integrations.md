# Disabled integration activation

- **Cloud:** follow `supabase-activation.md`. No development should be required for the implemented account, persistence, metering, rewards, admin and migration flows.
- **Local-mode distributed abuse limits:** create a Zest-specific Redis REST-compatible store, set the two `UPSTASH_REDIS_REST_*` variables, redeploy. The Lua reservation is atomic, uses hashed network identity, and fails closed when configured but unavailable. Without this, per-instance memory limits protect bursts but do not cap an attacker across Vercel instances. Configure OpenAI project budget controls and Vercel WAF as additional limits.
- **Push:** worker handlers and private subscription/schedule tables are prepared. Push remains disabled in public UX. No notifications are claimed to have been delivered. VAPID keys and scheduler/provider activation are required before enabling delivery.
- **Calendar OAuth:** ICS is the supported production integration. Direct Google/Outlook OAuth flags remain off; provider credentials and reviewed consent/scopes are required for a separate direct-sync rollout. Apple uses file import; no fake account connection is displayed.
- **Billing:** no provider selected; no payment UI or fake subscription activation. Free/Plus/Business rules are centralized; public paid-plan availability remains off. Owner selects pricing and a provider before commercial activation.
- **Legal:** owner/legal reviewer must approve entity information, international notices, processor terms and support contact deliverability before commercial launch.
