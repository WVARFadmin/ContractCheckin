# Contract Check-In

The Green / Yellow / Red tool for CRP janitorial supervisors, as a web app.

Supervisors call every janitorial customer, mark a color from what the customer says, and work a visit queue: **red first, yellow next, green on a regular rotation.** WVARF sees a combined statewide view of **WVARF / State contracts only**; every other contract stays private to the CRP that owns it.

- **Hosting:** Netlify (static site + one serverless function)
- **Code:** this GitHub repository — every push to `main` redeploys
- **Data:** Netlify Database (Postgres), created automatically on the first deploy
- **Sign-in:** Netlify Identity — one login per person, by invitation

## Who can do what

| Role | Sees | Can do |
| --- | --- | --- |
| Supervisor | All contracts, calls and visits for their CRP, whoever entered them | Add/edit contracts, log calls and visits |
| CRP admin | Same as supervisor | Also add/remove people at their CRP and set the call schedule |
| WVARF admin | Statewide view of WVARF / State contracts across all CRPs | Add CRPs and people anywhere. Cannot open a CRP's individual contracts or see private ones |

Every call and visit records who logged it and when.

## One-time setup (about 15 minutes)

1. **Create the Netlify site.** In Netlify, add a new site by importing this GitHub repository. Netlify reads `netlify.toml`, so leave the build settings as they are and deploy. The database and its tables are created during this first deploy.
2. **Turn on sign-in.** In the site's settings, enable **Identity**. Set registration to **Invite only** so only people you invite can create a login.
3. **Name the WVARF administrators.** In the project's settings, open **Environment variables** and choose **Add a variable**. Enter:
   - **Key:** `ADMIN_EMAILS`
   - **Secret:** leave unchecked
   - **Scopes:** All scopes
   - **Values:** Same value for all deploy contexts, then type the email, for example `nshippy@wvarf.org`. For more than one, separate them with commas and no spaces.

   Click **Create variable**. These people are always WVARF admins. Then go to **Deploys** and use **Trigger deploy** so the app picks up the setting.
4. **Invite yourself.** From the Identity tab, invite your own email. Open the invitation, enter your email and choose a password, and you're signed in on the statewide view.
5. **Add CRPs and people.** In the app, open **People**: add each CRP, then add each person's email with their CRP and role. **Adding a new person emails them their invitation automatically** — no Netlify step. They click the link, set a password, and land in their CRP.

> CRP admins add and invite their own supervisors the same way; WVARF doesn't need to be involved. Each person on the People screen has a **Send invite** button to resend an invitation that was missed or expired. The invitation comes from a Netlify address, so ask people to check their spam folder.
>
> If someone was added before automatic invitations were turned on, use **Send invite** next to their name.

## Signing in and passwords

- Sign-in, "Forgot your password?", invitations and **Account → Change password** all happen on the app's own screens, so browsers and password managers (such as Google Password Manager) offer to save the password.
- **Reset and invitation links are only used when the person submits their new password**, not when the link is opened. Email security scanners that open links first (common with Microsoft 365) no longer break them.
- Each link works once, and asking for a new reset email cancels the older one. If someone uses an old or used link, the app says so and lets them request a new one on the spot.
- **Signed in but bounced back to the sign-in screen?** That was a leftover cookie from the old Netlify sign-in pop-up. The app now clears it automatically on sign-in. If it ever happens anyway, a private/incognito window, or clearing this site's cookies, gets around it.
- **Locked out with no working email?** In Netlify, open **Identity → Users**, delete that person's login (their app access and history are kept — they live in the app's database), then add them again with **Send invite** on the People screen, or invite them from the Identity tab.

## Trends

The Contracts page (for each CRP) and the Statewide page (for WVARF) show the **last 12 weeks**:

- A chart of the share of contracts that were green, yellow and red each week. Hover a bar, or open **Show as a table**, for the counts.
- A **service score**: green = 100, yellow = 50, red = 0, averaged across contracts.
- A trend word for the CRP and for every contract: **Improving**, **Steady** or **Slipping**. It compares the average score over the last 4 weeks with the first 4 weeks of the 12, about 2–3 months earlier. A change of 10 points or more counts as a trend. Contracts with under about 5 weeks of history show **New — not enough history**.
- Each contract's page shows a 12-week color strip, one square per week. The Contracts list has a **Slipping** filter.

A week's color is the contract's color at the end of that week: the most recent answered call, or a fix the customer confirmed on a visit.

## Demo (practice) data

WVARF admins have a **Demo** tab, a safe place for staff to try every feature.

1. Add one or two test CRPs on the People page (or use ones you already made). They must have no real contracts.
2. On **Demo**, tick them and click **Load demo data**. Each gets 10 made-up contracts with 6 months of calls and visits in every color. The first CRP's service is improving and the second's is slipping.
3. Click **Practice as …** to work inside that CRP as its CRP admin. A yellow banner shows you're in practice mode; **Exit practice** takes you back.
4. Compare the demo CRPs on **Statewide → Demo CRPs**. Demo CRPs never appear in the real statewide numbers.

**Reload demo data** resets everything staff changed. **Remove all demo data** deletes the made-up contracts (the CRPs themselves stay). People can't be added in practice mode, so no invitation emails go out. All demo names, phone numbers (555-01xx) and caller addresses (example.org) are fictional.

## How the rules work

- **Call schedule:** each CRP picks weekly, every 2 weeks (default) or monthly. A contract is "call due" once that time has passed since its last answered call. A "no answer" attempt is logged but leaves the contract due.
- **Visit due dates:** red — 2 business days after it turned red; yellow — 14 days after it turned yellow; green — a walkthrough every 90 days (the queue shows greens due in the next 30 days).
- **Changing color:** a call sets the color. A visit only changes the color when the customer confirms the fix, and the supervisor must enter **which customer contact confirmed it and the date** (not in the future, not before the visit). Both are saved with the visit and shown in the contract's history.

## Working on the code

```
npm install
npm test                      # API tests against an in-memory Postgres (privacy rules included)
node test/dev-server.mjs      # local preview at http://localhost:8888 with a stand-in sign-in service
npm run build:vendor          # only when upgrading @netlify/identity: rebuilds public/vendor/
```

In the local preview, any new email signs in with whatever password you type; `admin@wvarf.test` is the WVARF admin. Reset and invitation "emails" are printed in the terminal instead of sent. Nothing is saved after it stops. To run against Netlify's real services instead, use `netlify dev`.

| Path | What it is |
| --- | --- |
| `public/` | The app people use (HTML, CSS, JavaScript — no build step) |
| `public/vendor/netlify-identity.js` | Netlify's sign-in library, packaged with `npm run build:vendor` |
| `netlify/functions/api.mjs` | The API endpoint: connects the database and verifies sign-in |
| `lib/api-core.mjs` | All API rules: who can see what, colors, due dates |
| `netlify/database/migrations/` | Database tables. Add new numbered files for changes; never edit old ones |
| `test/` | Automated tests and the local preview server |
