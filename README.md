# Nilambur Vaidyasala – Supabase + Vercel

Files: `index.html` (public site), `products.html` (featured product storefront), `admin.html` (staff dashboard), `supabase.js` (your keys), `schema.sql` (database + security), `doctor_directory.sql` (poster doctor records), `order_tracking.sql` (order tracking and cancellation), `vercel.json`, `logo.png`.

## 1. Supabase (about 15 minutes)
1. supabase.com → **New project** (pick the Mumbai region, `ap-south-1`).
2. **SQL Editor** → open `schema.sql`, make sure the admin email at the bottom is yours, paste, **Run**.
3. **Authentication → Users → Add user**: create the admin with the same email and a strong password (tick auto-confirm).
4. **Project Settings → API**: copy the Project URL and the `anon` public key into `supabase.js`. Never use the `service_role` key in these files.
5. To enable customer accounts, run `customer_accounts.sql` in **SQL Editor** after `schema.sql`. Under **Authentication → Sign In / Providers**, enable email/password sign-ups. Under **Authentication → URL Configuration**, allow `http://127.0.0.1:8000/**` for local testing and your deployed site URL for password-reset links.
6. To add the poster's doctors to the admin-managed doctor list, run `doctor_directory.sql` in **SQL Editor**.
7. Run `security_hardening.sql` in **SQL Editor** after the other SQL files. This enforces appointment schedules in the database and moves order creation to a trusted database function that looks up current product prices. Re-run this file after deploying its changes.
8. Run `order_tracking.sql` in **SQL Editor** after `security_hardening.sql`. It adds status history, secure tracking/cancellation RPCs, the admin status RPC, and revokes direct order updates. Run it once; it is safe to re-run.
   Existing orders have no earlier audit trail, so their present status is recorded as a setup baseline; new status changes are dated automatically.

## 2. Vercel
- Easiest: put this folder in a GitHub repo → vercel.com → **Add New → Project** → import it → Framework **Other**, no build command, leave output directory empty → **Deploy**.
- Or CLI: `npm i -g vercel`, then run `vercel` in this folder, and `vercel --prod`.
- Add your own domain under **Project → Settings → Domains**.
- After updating the static files, deploy the project on Vercel with no build command or framework preset (or run `vercel --prod` from the project directory). No build step is needed. Keep `supabase.js` publishable-key-only and keep `vercel.json` so the CSP remains active.

## Order feature checklist
- Guest tracking: correct order code and phone display the order; a wrong phone shows only “We couldn't find an order with those details”.
- Signed-in customer: each own order has a Track button and an eligible order can be cancelled.
- Guest can cancel an eligible guest order after matching both its code and phone.
- Cancellation is idempotent: cancelling the same eligible order twice leaves it cancelled.
- A shipped or delivered order cannot be cancelled and shows the support phone number.
- A customer cannot cancel another customer's order, even with its order code and phone.
- Admin sees the cancellation timestamp/reason; cancelled status controls are locked and the database RPC refuses reopening.
- Verify bookings and new COD order placement still work after the migration and deployment.

## Using it
- Public site `/`: customers can create accounts, sign in, manage a profile, and see bookings/orders made while signed in. Patients can also book without an account; double booking is blocked by the database. Customers can place cash-on-delivery orders.
- Appointment schedules: General Physician and Skin & Beauty Care Monday–Saturday, 9 am–5 pm; Orthopaedics & Sports Injury Monday/Thursday 10 am–12 pm; Spine & Back Care Sunday 3–5 pm. Weekday 30-minute booking slots run through 4:30 pm. Re-run `security_hardening.sql` in Supabase after updating the schedule validator.
- Admin `/admin`: sign in to manage products and doctors (with photo upload), see charts, update order/booking status, search and export CSV. Cancelling a booking frees its slot.
- `vercel.json` adds browser security headers and a Content Security Policy for the current Supabase project. If the Supabase project URL or external assets change, update that policy too.

Existing anonymous bookings and orders are not automatically associated with customer accounts; only new bookings and orders made while signed in appear in an account.

## Good to know
- Free Supabase projects can pause after a period of inactivity, and Vercel's free Hobby plan is for non-commercial use. See SUPABASE+VERCEL notes in the chat reply and check both pricing pages.
- The browser Supabase publishable key is public by design. Never put a Supabase secret/service-role key in frontend files. Set production Auth redirect URLs in Supabase to the deployed HTTPS domain only, require MFA for staff accounts, and keep the admin allowlist limited to current staff.

## Online video consultations

The consultation feature lives in `consult.html`, `privacy.html`, `online_consultations.sql`, and `api/`. The checkout did not contain the existing `/api/create-booking`, `/api/verify-payment`, or `/api/_pay.js` files described in the request, so this feature uses its own Razorpay order, verification, and webhook handlers. Existing clinic visit booking code was left in place. The consultation email sender uses Resend's transactional API because it supports authenticated domain sending and idempotency keys; verify `nilamburvaidyasala.com` with SPF, DKIM, and DMARC before enabling patient mail.

### Setup order

1. In Supabase SQL Editor, run `online_consultations.sql` after `schema.sql`, `customer_accounts.sql` (if enabled), and `security_hardening.sql`. It creates private consultation tables and RPCs; re-running the same file is supported.
2. Confirm the four current doctors are in `public.doctors`. In `/admin`, sign in and open **Online consultations** to set the fee and each doctor's weekly video availability. Video slots are independent of clinic visit hours.
3. In Razorpay, enable UPI checkout and create a webhook pointing to `https://YOUR_DOMAIN/api/razorpay-webhook`. Subscribe to `payment.captured` and `order.paid`, and copy the webhook secret.
4. Verify `nilamburvaidyasala.com` with Resend and configure SPF/DKIM/DMARC. The sender and clinic-copy inbox must both be `niranjans@nilamburvaidyasala.com`.
5. Add these **names only** under Vercel Project → Settings → Environment Variables, for Preview/Production as needed:

   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
   - `RAZORPAY_WEBHOOK_SECRET`
   - `CLINIC_EMAIL`
   - `RESEND_API_KEY`
   - `CRON_SECRET`
   - `APP_URL`
   - Optional: `MEETING_PROVIDER`, `JITSI_DOMAIN`

   Set `CLINIC_EMAIL` to the single clinic address above. Never put any secret in `supabase.js` or another browser file. `APP_URL` should be the canonical HTTPS site URL. The default meeting provider is Jitsi; use a managed/private meeting provider for consultations that require authenticated room access.
6. Redeploy on Vercel with no build command. `vercel.json` retains the existing CSP and adds Razorpay Checkout/API script, frame, connection, and form destinations. It also schedules the reminder/cleanup endpoint every five minutes; ensure the Vercel plan/project supports Cron Jobs at that cadence.
7. Publish `privacy.html` and have the clinic review the retention/deletion terms and telemedicine notice before collecting health information. Supabase, Vercel, Resend, and the meeting provider must be configured for the clinic's privacy and retention obligations.

### Consultation checklist

- Complete a guest consultation: select a live doctor, complete consent/questionnaire, upload a permitted report, choose an available slot, pay by UPI, and see the confirmation and calendar file.
- Close checkout and resume the saved payment; also check a failed payment and choose another time.
- Simulate two patients selecting the same slot; only one reservation should succeed.
- Let a payment hold expire and confirm the time becomes available again.
- Close the browser after payment and confirm the signed webhook completes the booking; resend a duplicate webhook and confirm there is no duplicate confirmation email.
- Select a red-flag symptom and confirm payment is blocked.
- Temporarily misconfigure email delivery and confirm the booking still becomes confirmed and the failed email is queued for retry.
- Sign in as one customer and confirm they can read only their own consultation; try a second account and anonymous table/storage access to confirm denial.
- In admin, filter by doctor/date/status, open reports, copy the meeting link, resend mail, reschedule, cancel, mark completed/no-show, export CSV, and mark a Razorpay-refunded payment as refunded.
- Verify existing clinic booking, product/order checkout, and admin flows still work after deployment.

### Security and privacy review notes

Consultation and payment records have RLS enabled, with client writes revoked and only the authenticated owner allowed to select their own consultation row. Public slot lookup returns times only. All payment confirmation, admin actions, and private file links use server-side endpoints; reports are in a private bucket and signed for short periods. Payment verification checks the Razorpay HMAC, fetches payment details server-side, and uses a unique attempt record plus an idempotent database RPC. Email delivery is queued separately so provider failure does not reverse a paid booking. Request attempts are limited by a keyed IP hash over a ten-minute window. Meeting links are high entropy, but default public Jitsi rooms do not provide identity-based access control; use a private provider/managed tenant for sensitive sessions. The privacy page describes a three-year target retention period; the clinic should verify legal applicability and deletion obligations before launch.
