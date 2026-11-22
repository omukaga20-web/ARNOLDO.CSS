# MySupermarket authentication email setup

The HTML files in this folder are copy-ready Supabase Auth templates. They keep Supabase's required `{{ .ConfirmationURL }}` action link intact and use the MySupermarket name and green storefront style. The password-change and security-alert files are branded notification drafts; they are not sent by Supabase's built-in signup/reset templates. Enable the corresponding Auth notification or a Send Email Hook before expecting those alerts to send.

## Configure SMTP and the sender

SMTP credentials are external account secrets and are intentionally not stored in this repository or the website.

1. In the Supabase dashboard, open **Authentication → SMTP Settings** (or **Settings → Authentication → SMTP** in the current dashboard) and enable custom SMTP.
2. Set **Sender name** to `MySupermarket` and **Sender email** to `faidiagrostores@gmail.com` if sending from the existing Gmail account.
3. To keep that exact Gmail address, use Gmail SMTP: enable 2-Step Verification on the business Google account, create a Google **App Password**, and use `smtp.gmail.com`, port `465` with SSL (or `587` with STARTTLS), the full Gmail address as username, and the App Password as the password. Paste it only into Supabase's SMTP settings; never into this repository. Google may require an eligible Workspace/account configuration for app passwords.
4. Save and use Supabase's email test/send-a-test flow to check delivery, spam placement, and branding at an inbox you control.

### If using Resend instead

Resend cannot send mail with a free `@gmail.com` From address. To use Resend, verify a domain you own in Resend (the domain used by the store is a suitable candidate only after it is added and verified), publish Resend's requested SPF/DKIM DNS records, then use an address on that verified domain such as `orders@your-verified-domain`. In Supabase's custom SMTP settings use host `smtp.resend.com`, port `465` (SSL) or `587` (STARTTLS), username `resend`, and the Resend SMTP/API credential as the password. Store the credential only in the Supabase provider settings. Do not mix a Gmail From address with Resend SMTP.

## Install the templates

In Supabase open **Authentication → Email Templates** and paste the matching file contents into the HTML/template field:

| Supabase template | File |
| --- | --- |
| Confirm signup (account registration and email verification) | `confirm-signup.html` |
| Reset password | `reset-password.html` |
| Change email address | `confirm-email-change.html` |
| Magic link, if enabled in the project | `magic-link.html` |

Keep each template's `{{ .ConfirmationURL }}` placeholder unchanged. The app sends signup confirmations to `/account` and recovery links to `/reset-password`; verify those redirect destinations are present in **Authentication → URL Configuration → Redirect URLs** for the production storefront and its preview hosts before testing. Do not disable email confirmation or weaken the redirect allowlist.

Supabase does not send a password-changed or generic login-alert email through the signup/recovery templates automatically. `password-changed-notification.html` and `security-alert.html` are visual starting points only. Wire a supported Supabase Auth notification or Send Email Hook and its provider before enabling those sends; do not paste either draft into a one-time action template.

## Safe end-to-end check

After SMTP credentials are saved and the templates installed, register with an inbox you own, open the confirmation email, and verify it returns to the storefront. Then request a password reset for that same account and complete the flow. Check the sender name/address, mobile rendering, link destinations, expiration, and spam folder. Never test by sharing SMTP credentials or sending to an address you do not control.
