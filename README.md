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
4. **Invite yourself.** From the Identity tab, invite your own email, accept the email invitation, and set a password. Sign in — you'll land on the statewide view.
5. **Add CRPs and people.** In the app, open **People**: add each CRP, then add each person's email with their CRP and role. **Adding a new person emails them their invitation automatically** — no Netlify step. They click the link, set a password, and land in their CRP.

> CRP admins add and invite their own supervisors the same way; WVARF doesn't need to be involved. Each person on the People screen has a **Send invite** button to resend an invitation that was missed or expired. The invitation comes from a Netlify address, so ask people to check their spam folder.
>
> If someone was added before automatic invitations were turned on, use **Send invite** next to their name.

## How the rules work

- **Call schedule:** each CRP picks weekly, every 2 weeks (default) or monthly. A contract is "call due" once that time has passed since its last answered call. A "no answer" attempt is logged but leaves the contract due.
- **Visit due dates:** red — 2 business days after it turned red; yellow — 14 days after it turned yellow; green — a walkthrough every 90 days (the queue shows greens due in the next 30 days).
- **Changing color:** a call sets the color. A visit only changes the color when the customer confirms the fix, and the supervisor must enter **which customer contact confirmed it and the date** (not in the future, not before the visit). Both are saved with the visit and shown in the contract's history.

## Working on the code

```
npm install
npm test                      # API tests against an in-memory Postgres (privacy rules included)
node test/dev-server.mjs      # local preview at http://localhost:8888 with a stand-in sign-in
```

The local preview uses a fake sign-in where you type any email; `admin@wvarf.test` is the WVARF admin. Nothing is saved after it stops. To run against Netlify's real services instead, use `netlify dev`.

| Path | What it is |
| --- | --- |
| `public/` | The app people use (HTML, CSS, JavaScript — no build step) |
| `netlify/functions/api.mjs` | The API endpoint: connects the database and verifies sign-in |
| `lib/api-core.mjs` | All API rules: who can see what, colors, due dates |
| `netlify/database/migrations/` | Database tables. Add new numbered files for changes; never edit old ones |
| `test/` | Automated tests and the local preview server |
