# Nilambur Vaidyasala – Supabase + Vercel

Files: `index.html` (public site), `products.html` (featured product storefront), `admin.html` (staff dashboard), `supabase.js` (your keys), `schema.sql` (database + security), `doctor_directory.sql` (poster doctor records), `vercel.json`, `logo.png`.

## 1. Supabase (about 15 minutes)
1. supabase.com → **New project** (pick the Mumbai region, `ap-south-1`).
2. **SQL Editor** → open `schema.sql`, make sure the admin email at the bottom is yours, paste, **Run**.
3. **Authentication → Users → Add user**: create the admin with the same email and a strong password (tick auto-confirm).
4. **Project Settings → API**: copy the Project URL and the `anon` public key into `supabase.js`. Never use the `service_role` key in these files.
5. To enable customer accounts, run `customer_accounts.sql` in **SQL Editor** after `schema.sql`. Under **Authentication → Sign In / Providers**, enable email/password sign-ups. Under **Authentication → URL Configuration**, allow `http://127.0.0.1:8000/**` for local testing and your deployed site URL for password-reset links.
6. To add the poster's doctors to the admin-managed doctor list, run `doctor_directory.sql` in **SQL Editor**.
7. Run `security_hardening.sql` in **SQL Editor** after the other SQL files. This enforces appointment schedules in the database and moves order creation to a trusted database function that looks up current product prices. Re-run this file after deploying its changes.

## 2. Vercel
- Easiest: put this folder in a GitHub repo → vercel.com → **Add New → Project** → import it → Framework **Other**, no build command, leave output directory empty → **Deploy**.
- Or CLI: `npm i -g vercel`, then run `vercel` in this folder, and `vercel --prod`.
- Add your own domain under **Project → Settings → Domains**.

## Using it
- Public site `/`: customers can create accounts, sign in, manage a profile, and see bookings/orders made while signed in. Patients can also book without an account; double booking is blocked by the database. Customers can place cash-on-delivery orders.
- Appointment booking uses the poster's departments and published schedules: General Physician Monday–Saturday; Orthopaedics & Sports Injury Monday/Thursday 10 am–12 pm; Spine & Back Care Sunday 3–5 pm. Skin & Beauty Care offers regular Monday–Saturday request slots, but its hours are not specified on the poster and customers are asked to confirm with the clinic.
- Admin `/admin`: sign in to manage products and doctors (with photo upload), see charts, update order/booking status, search and export CSV. Cancelling a booking frees its slot.
- `vercel.json` adds browser security headers and a Content Security Policy for the current Supabase project. If the Supabase project URL or external assets change, update that policy too.

Existing anonymous bookings and orders are not automatically associated with customer accounts; only new bookings and orders made while signed in appear in an account.

## Good to know
- Free Supabase projects can pause after a period of inactivity, and Vercel's free Hobby plan is for non-commercial use. See SUPABASE+VERCEL notes in the chat reply and check both pricing pages.
- Online payments (Razorpay/UPI) need a small server function; ask me to add it.
- The browser Supabase publishable key is public by design. Never put a Supabase secret/service-role key in frontend files. Set production Auth redirect URLs in Supabase to the deployed HTTPS domain only, require MFA for staff accounts, and keep the admin allowlist limited to current staff.
