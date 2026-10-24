# TESTING.md — manual checks for features nobody has used yet

These features are built, and most have unit tests or a check by Claude in Chrome, but **no person has used them yet**. Work down the list. It's ordered by how much the demo video relies on each one. After each test, tick it here and mark the step ✅ (or ✕ with what happened) in [flow.md](flow.md).

## Before you start

1. In its own terminal, from the repo root: `npm run dev`. Leave it running.
2. For tests 1, 5, 6 and 7 you need PayPal webhooks and a phone, so in a second terminal run `cloudflared tunnel --protocol http2 --url http://localhost:3000`. Then in the PayPal sandbox app, under **Webhooks**, set the URL to `https://<tunnel>/api/webhooks/paypal`. Quick tunnels change their URL on every start, so update it each time.
3. Keep both sandbox logins handy: the **US personal** account (it pays, and receives payouts) and the **US business** account (it stands in for retailers).
4. Optional: start from clean data with the reset below.

## Reset the demo data

```bash
npm run db:seed && npm run setup:dues
```

- `db:seed` deletes and rebuilds the Riverside Cleanup Crew org: 6 members, 2 events, 2 mandates, 4 past purchases, and the policy and history search index. The Beach mandate goes back to **$162 spent of $600 ($438 left)**.
- `setup:dues` recreates the Operations budget and a $10/month dues plan. Each reset creates a new sandbox plan, which is harmless.
- **It also deletes API keys.** After a reset, create a new MCP key and paste it into Claude Desktop again (test 2).
- Never use `npm run setup` as a reset. It also runs the migrations.

---

## 1. Snap-to-reimburse from a phone (receipt → payout)
Already done from the desktop. Not tried: the phone camera, and shrinking the photo in the phone's browser.

| # | Do this | Expect |
|---|---|---|
| 1 | On your phone, open `https://<tunnel>/` → **Try it as a volunteer** → **Reimburse** | Page "Paid out of pocket? Get it back." |
| 2 | Tap **Take a photo or choose one** and photograph a real paper receipt under $100 | The camera opens. The photo preview shows and the upload is a few hundred KB, not several MB |
| 3 | Pick **Winter Food Drive**, add a note, submit | Within about 30 s: store, date, items, tax and total read correctly. R1–R5 listed. Outcome "needs the treasurer" (or "pre-approved" if under the auto limit) |
| 4 | **Switch to treasurer to approve** → **Approve & pay back $X** | Button shows "Sending payout…". Status goes to payout sent, then **paid**, with "paid N seconds after the photo" |
| 5 | Log in to the US personal sandbox account at sandbox.paypal.com | The payout is in its activity |
| 6 | Upload the same photo again | Rejected: "R3: The same photo was already submitted", with a link to the first one |

## 2. MCP in Claude Desktop (outside agent is blocked by the mandate)

| # | Do this | Expect |
|---|---|---|
| 1 | **Try it as the treasurer** → **Agents** (`/settings`) → create a key named "Claude Desktop" | The key is shown once, with a ready-made config snippet |
| 2 | Claude Desktop → Settings → Developer → Edit config. Paste the snippet into `claude_desktop_config.json` and fully quit and restart Claude Desktop | The tools menu lists **quartermaster** with 7 tools |
| 3 | Ask: *"Use Quartermaster to list our spending mandates."* | It calls `list_mandates` and shows Beach ($438 left on fresh data) and Food Drive |
| 4 | Ask: *"Use Quartermaster to buy 12 folding tables for the beach cleanup."* (On your current, unreset data, "4 folding tables" is enough.) | It runs `search_products` → `check_purchase` → `request_purchase`. The result is **blocked under M7** (over the cap). Claude says it was blocked and doesn't claim it bought anything |
| 5 | In the app, open `/treasurer` and the new trust receipt | The receipt shows the request with "Asked by: External agent (Claude Desktop)", the M7 failure and the options compared |
| 6 | **Revoke** the key on `/settings` and ask again | Claude Desktop gets a 401 / "key not valid" message |

## 3. Treasurer dashboard (`/treasurer`)

| # | Do this | Expect |
|---|---|---|
| 1 | **Try it as the treasurer** → **Dashboard** | "Treasurer dashboard": totals ("Left across mandates", "Waiting for you"), budget envelopes, 3 charts, a payments grid |
| 2 | Sort and filter the payments grid (type a vendor in **Filter payments**) | Rows filter as you type. Amounts stay right-aligned with currency |
| 3 | Approve one item from the queue | It leaves the queue. Its envelope's spent/committed bar moves |
| 4 | Narrow the window to phone width (or open it on your phone) | No sideways page scroll. Grids scroll inside their own frames |
| 5 | Switch to a volunteer and open `/treasurer` | Read-only: same numbers, no approve buttons. (There's no role guard on the page itself; say if you want one) |

## 4. Home page requisition slip

| # | Do this | Expect |
|---|---|---|
| 1 | Open `/` signed out | Headline "Let an AI buy for your team, inside rules it can't break." and the live requisition slip |
| 2 | Change the slip's items or amounts so the total crosses the auto limit, then the cap | The rule check re-runs in the browser: "Pre-approved" → needs the treasurer → blocked, with the failing rule named. The stamp animates only when the outcome changes |
| 3 | Turn on reduced motion (Windows: Settings → Accessibility → Visual effects → Animation effects off) and reload | Same outcomes, no animation |

## 5. Signed approval link (needs one channel)
Set `SLACK_WEBHOOK_URL` (a free Slack incoming webhook) **or** `RESEND_API_KEY` in `.env.local`, plus `APP_SECRET` (16+ characters) and `APP_URL` set to the tunnel URL. Restart `npm run dev`. `/status` should show that channel as on.

| # | Do this | Expect |
|---|---|---|
| 1 | As a volunteer in chat: *"We need 60 pairs of safety goggles for the beach cleanup."* (anything over the $250 auto limit and under $438) | Proposal marked as needing the treasurer |
| 2 | Check Slack or the treasurer's email | One message with the amount, the reason, and "Approve or decline (link valid 72 h)" |
| 3 | Open the link in a private window | Signed in as Priya (treasurer), landing on `/approve/<id>` |
| 4 | Change one character of the link and open it | Lands on `/mandates` with "That approval link isn't valid…" |
| 5 | Open the receipt's timeline | "Treasurer notified by Slack (or email) with a signed approval link" |

## 6. Refund button

| # | Do this | Expect |
|---|---|---|
| 1 | Get a paid order: as a volunteer ask *"20 pairs of work gloves for the beach cleanup"*, then pay it as the treasurer with the US personal sandbox account | Receipt shows the "Paid" stamp |
| 2 | As the treasurer, on that trust receipt: **Refund…** → type a reason → **Yes, refund $X** | "Refunding…", then the status is **Refunded** |
| 3 | Wait for the webhook (tunnel running) | Timeline shows the PayPal refund event. The budget bar has the money back |
| 4 | As a volunteer, open the same receipt | No Refund button |

## 7. Sponsor invoice, paid

| # | Do this | Expect |
|---|---|---|
| 1 | Make sure **Invoicing** is ticked under the sandbox app's Features | — |
| 2 | Treasurer in chat: *"Invoice our sponsor Marina Cafe (cafe@marina.example) $250 for the beach cleanup."* → open the review link | `/invoices/<id>` with status DRAFT, naming the budget it will credit (Beach, or Operations if none is named) |
| 3 | **Send to sponsor…** → **Yes, send it** | Status SENT, with PayPal's sponsor view link |
| 4 | Open the sponsor link in a private window. Pay with the US personal sandbox account | PayPal shows it as paid |
| 5 | Back in the app: **Check payment** (or wait for the webhook) | Status PAID. That budget's room goes up by $250 on `/treasurer`, but the signed cap itself is unchanged (D50) |
| 6 | Click **Check payment** again | No second credit (one credit per PayPal id) |

## 8. Member dues subscription

| # | Do this | Expect |
|---|---|---|
| 1 | **Try it as a volunteer** → open `/join` | "Member dues", the Operations budget, PayPal **Subscribe** and card buttons |
| 2 | **Subscribe** → log in with the US personal sandbox account → agree | "You're subscribed ($10.00 a month). Thank you!" |
| 3 | Wait for the sale webhook, then open `/treasurer` | Operations budget credited $10 |
| 4 | Reload `/join` | Still shows subscribed, with no second Subscribe button |

## 9. KERNEL live price check (needs sponsor credits)
Set `KERNEL_API_KEY` in `.env.local` and restart. `/status` should show **KERNEL cloud browser** as on.

| # | Do this | Expect |
|---|---|---|
| 1 | As a volunteer in chat, ask for something Channel3 finds with a real buy link | The agent's activity trail shows a live check |
| 2 | Open the proposal's trust receipt | Under the option: "Live check: $X", "Verified <time> by KERNEL", and a screenshot |
| 3 | Ask the same thing again within 6 hours | "(cached, N min when proposed)" |
| 4 | Remove the key and ask again | No crash. The option shows "unverified" with a reason, and the stored price is still used |

## 10. API, Postman, SDK and the browser smoke test (Task 8)
Needs a throwaway Neon branch: Neon console → your project → Branches → Create branch from main, then copy its pooled connection string. Prepare it once: in PowerShell, `$env:DATABASE_URL="<branch string>"; npm run db:migrate; npm run db:seed`.

| # | Do this | Expect |
|---|---|---|
| 1 | `$env:E2E_DATABASE_URL="<branch string>"; npm run test:e2e` | Builds, then Playwright runs 10 tests green: the hero flow (home → chat → proposal → treasurer pays → receipt showing MOCKCAPTURE) and 8 pages at 360 px plus keyboard focus |
| 2 | Same variable, `npm run test:api` | Newman: 39 requests, 82 assertions, 0 failed |
| 3 | Open `/api/openapi.json` in a browser | `"openapi": "3.1.0"` and 21 paths |
| 4 | Postman → Import → `postman/quartermaster.postman_collection.json` and the environment file, set `baseUrl` to your running app, Run | All green. Then create a public workspace, publish the collection, and paste its id into the commented "Run in Postman" button in README.md |
| 5 | GitHub → repo → Settings → Secrets and variables → Actions → add `CI_DATABASE_URL` (the branch string), push | The CI job "api-and-browser" runs newman and Playwright green |
| 6 | apimatic.io → import the OpenAPI URL → generate the TypeScript SDK and the portal | Commit the SDK into `sdk/`; see `sdk/README.md` |
| 7 | Tab through the home page, `/chat` and `/reimburse` at phone width; use a screen reader on one form | A visible focus ring everywhere; every field announced with its label |

## 11. Elastic on a local Elasticsearch (Task 10)
Needs Docker Desktop running. Nothing here touches Elastic Cloud.

| # | Do this | Expect |
|---|---|---|
| 1 | `docker compose up -d elasticsearch`, wait ~30 s, open http://localhost:9200 | JSON with `"number" : "9.1.0"` |
| 2 | In `.env.local`: `ELASTIC_ENABLED=true`, `ELASTIC_URL=http://localhost:9200`; run `npm run elastic:sync` | "✓ Elastic at http://localhost:9200: 13 policy clauses, … purchases and receipts, … audit events" |
| 3 | Restart the dev server, open /status | "Elastic hybrid search" is live |
| 4 | As a volunteer, ask the chat for 40 folding tables for the beach cleanup | The policy and history cards say the source is elastic |
| 5 | As the treasurer, open /treasurer and scroll to "Unusual activity" | "Elastic ES\|QL over agent traces and the audit trail". After 3 blocked requests by one volunteer on the same day: "Repeated blocked attempts · 3 by <name>" |
| 6 | `docker compose stop elasticsearch`, reload /treasurer | The tile still shows, with "Elastic didn't answer, so this was computed from Postgres." Chat search answers from pgvector |
| 7 | Set `ELASTIC_ENABLED=false` again before you deploy | /status shows the fallback |
