# Gradari Mireris — Auth delivery checklist

The frontend uses Supabase Auth (project `tgszdvvitdijzkkbrlpl`). Authentication is shared with production even when testing the development repository.

## Before production rollout

1. In Supabase Dashboard → Authentication → SMTP Settings, configure a verified custom sender/domain with a transactional provider. Keep SMTP credentials in Supabase; never commit them.
2. In Authentication → URL Configuration, ensure `https://gradarimireris.com/login/` is an allowed redirect URL, along with any actual dev preview origin used for acceptance testing. The current frontend constructs auth links for the production login route.
3. Verify confirmation and recovery email templates link through Supabase’s confirmation URL and preserve the auth callback.
4. Test signup, email verification, resend (including 429 throttling), password reset, expired links, sign-in, and sign-out with dedicated test accounts.
5. Check Auth Logs and SMTP provider delivery logs if emails delay or bounce. Successful signup API response does not prove email delivery.
6. Ensure password reset links never appear in application logs, analytics, or error reporting.
7. Verify map editor tools against a test hex only. Do not execute destructive map commands on production data during development tests.

## Notes

- New frontend controls: `login/index.html`, `auth-20261007-v3.js`.
- Map UI shell: `admin/index.html`, `admin-map-workspace.css`, `admin-map-workspace.js`.
- No database migration is needed for the standard Supabase recovery/resend APIs.
- Custom SMTP cannot be completed without provider credentials and a verified sending domain.
- A browser validation with an actual email-delivery round trip is required before production promotion.
