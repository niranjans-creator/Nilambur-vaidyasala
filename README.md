# Nilambur Vaidyasala – Supabase + Vercel

Files: `index.html` (public site), `admin.html` (staff dashboard), `supabase.js` (your keys), `schema.sql` (database + security), `vercel.json`, `logo.png`.

## 1. Supabase (about 15 minutes)
1. supabase.com → **New project** (pick the Mumbai region, `ap-south-1`).
2. **SQL Editor** → open `schema.sql`, make sure the admin email at the bottom is yours, paste, **Run**.
3. **Authentication → Users → Add user**: create the admin with the same email and a strong password (tick auto-confirm).
4. **Project Settings → API**: copy the Project URL and the `anon` public key into `supabase.js`. Never use the `service_role` key in these files.
5. To enable customer accounts, run `customer_accounts.sql` in **SQL Editor** after `schema.sql`. Under **Authentication → Sign In / Providers**, enable email/password sign-ups. Under **Authentication → URL Configuration**, allow `http://127.0.0.1:8000/**` for local testing and your deployed site URL for password-reset links.

## 2. Vercel
- Easiest: put this folder in a GitHub repo → vercel.com → **Add New → Project** → import it → Framework **Other**, no build command, leave output directory empty → **Deploy**.
- Or CLI: `npm i -g vercel`, then run `vercel` in this folder, and `vercel --prod`.
- Add your own domain under **Project → Settings → Domains**.

## Using it
- Public site `/`: customers can create accounts, sign in, manage a profile, and see bookings/orders made while signed in. Patients can also book without an account; double booking is blocked by the database. Customers can place cash-on-delivery orders.
- Admin `/admin`: sign in to manage products and doctors (with photo upload), see charts, update order/booking status, search and export CSV. Cancelling a booking frees its slot.

Existing anonymous bookings and orders are not automatically associated with customer accounts; only new bookings and orders made while signed in appear in an account.

## Good to know
- Free Supabase projects can pause after a period of inactivity, and Vercel's free Hobby plan is for non-commercial use. See SUPABASE+VERCEL notes in the chat reply and check both pricing pages.
- Online payments (Razorpay/UPI) need a small server function; ask me to add it.
