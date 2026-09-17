# Activate Google sign-in

Status: app implementation ready; Google Cloud credentials and Supabase provider activation are still required. Do not merge/deploy the button to production until the provider is enabled. Keep email sign-in available.

## Google Cloud

1. Open https://console.cloud.google.com/ and select or create a project named Tasks.
2. In Google Auth Platform, configure Branding with app name Tasks and your support/contact email. Choose an External audience for a personal Gmail account. If in Testing, add your own Gmail address as a test user.
3. Configure only the basic scopes: openid, userinfo.email, userinfo.profile. No Gmail, Drive, Calendar, or offline access is needed.
4. Under Clients, create an OAuth client of type Web application.
5. Authorized JavaScript origin: `https://tasks-alpha-neon.vercel.app`.
6. Authorized redirect URI: `https://ifotjmlgldzsfydvjulu.supabase.co/auth/v1/callback`.
7. Copy the client ID and secret directly into Supabase below. Never commit the secret, put it in a VITE variable, or paste it into chat.

## Supabase

1. Open the todo-tracker project, Authentication → Sign In / Providers → Google.
2. Enable Google and enter the Google client ID and client secret. Keep nonce checks enabled. Save.
3. Under URL Configuration, retain Site URL `https://tasks-alpha-neon.vercel.app` and redirect allowlist entry `https://tasks-alpha-neon.vercel.app/`.
4. For a PR preview test, explicitly add that preview's origin in Google and its full return URL in Supabase. Avoid broad wildcard allowlists; remove temporary entries when finished.

## Verify before completing rollout

- On a configured preview, click Continue with Google and choose the exact verified email used for the existing account.
- Supabase automatically links matching verified email identities. Confirm the original user ID is retained and the existing lists appear. Do not reassign list ownership or merge accounts through client code.
- The existing browser Supabase client uses PKCE and automatic URL session detection/code exchange; do not add a competing manual exchange handler.
- Check navigation back to a selected list, add/refresh/delete/refresh, sign out, and cancel/retry Google consent.
- A different Google account must not see the owner's lists. Existing RLS remains in force; there are no schema or policy changes in this PR.
- Merge after provider setup and preview verification, then repeat sign-in on the main site. Until then the working email session remains usable.

Automated component tests cover OAuth arguments, duplicate submission suppression, email/Google request exclusion, error recovery, callback errors, and session gating. They do not replace a live Google consent and account-linking test.

References:
- https://supabase.com/docs/guides/auth/social-login/auth-google
- https://supabase.com/docs/guides/auth/auth-identity-linking
