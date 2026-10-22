# Society Mode v8 handover

V8 extends the fixture planning and booking concepts from `society-mode-9736`
commit `7944a74`. Work is confined to `society-mode-v8`. V7 remains byte-for-byte
unchanged. No production app, configuration, Supabase schema, function, database
or payment service is used or changed by the v8 demo.

## Open the demo

Serve this repository with a static HTTP server (ES modules require HTTP):

```sh
python -m http.server 8765 --bind 127.0.0.1
```

- Admin: `http://127.0.0.1:8765/app/society-v8.html`
- Player: `http://127.0.0.1:8765/app/society-v8.html?view=player`

The selector defaults to Fairway Golf Society; Alfie Noakes Society is an optional
example label, using the same fictional demo records. Only the v8 localStorage
key `imingolf_society_v8_demo_1` is read or written. Reset Demo restores v8 seed
data and does not touch v7 or the earlier society showcase.

## Implemented

- Collapsible navigation, compact status dashboard, outstanding actions with age,
  latest private comment and follow-up date; desktop split CRM and mobile views.
- Club create/edit/search/remove, contacts, indicative green/catering/buggy costs,
  yes/no facilities, winter greens, Saturday competition and late tee availability,
  configurable rating maximum up to 10, preferred/reserve clubs and visit notes.
  Referenced clubs cannot be removed until fixtures are reassigned.
- Competition create/edit/archive/restore, Stableford or Net format and sponsors.
- Season ranges, one/two events monthly, Saturday/Sunday and ordinal weekend
  preferences, shortlist rotation, explicit date exclusions and written rule
  checklist. Generated drafts can be edited and reordered by drag or buttons.
  Explicit draft → approved → published workflow; edits return fixtures to draft.
  Captain's Day/Weekend and special events are optional event types.
- Planner-generated CRM records preserve existing notes/history on repeated sync.
  Statuses retain the v7 stages and add Confirmed. CRM records include club contact,
  availability, follow-up, tee time, capacity, expected/actual fees, deposit due/paid,
  dated private comments, activity, Treasurer approval, confirmation and cancellation.
  Positive deposits need recorded payment and approval before confirmation.
- Treasurer budget, expected and actual costs, weighted expected fee per allocated
  place, paid/outstanding/average deposits, remaining budget, event cost summaries,
  annual subscriptions and member/event payment records. No funds are handled.
- Admin toggles for member/guest bookings, capacity limits, waiting lists, league,
  Twos, fines, prizes, honours, tee draws, special events, illustrated gallery,
  buggy/diet requests, Treasurer and subscriptions. Disabled sections are hidden.
- Simple separate Player demo: next published confirmed day, one-tap attendance,
  own confirmation/payment record, optional guests and requests, final score,
  fixtures/results and league. Capacity checks and automatic waiting-list promotion
  on cancellation. Results rank Net ascending and Stableford descending; league
  awards 10 points down to 1, with ties receiving equal points.
- Confirmed demo registration tee draws, fine nominations/approval, illustrated
  albums, example honours and event prize winners.

## Validation

```sh
node tests/society-v8-model.test.mjs
node tests/sync-regression.cjs
# With the HTTP server above running and Playwright + Chromium installed:
node tests/society-v8-browser.cjs
```

The model suite covers date generation/exclusions, invalid inputs, CRM idempotence,
approval and cancellation, financial arithmetic, public field projection, capacity,
waiting-list promotion, feature restrictions and identity-preserving reordering.
Browser checks cover CRUD/persistence, CRM status/private notes, budget updates,
player bookings/guests/scores/league, feature toggles, draft privacy, generation and
publication, mobile overflow, reset, unchanged v7 interactions and no external
requests. Existing production sync regression checks also pass.

V7's Git blob must remain `3cc71d01a9cfa193d01e717c3f7528c5181c22e0`:

```sh
git hash-object app/society-v7.html
git diff 7944a74 -- app/society-v7.html app/index.html app/config.js supabase
```

## Separate Netlify preview (no production deployment)

Create a demo-only bundle:

```sh
python scripts/package-society-v8.py
```

1. Extract `work/society-v8-preview.zip` into a new folder. Its root must contain
   `index.html`, `_headers` and `app/`.
2. Sign in to Netlify and choose **Add new project → Deploy manually** (Netlify
   Drop). Create a **new standalone project**, for example
   `imingolf-society-v8-preview`. Upload that extracted folder.
3. Do not select the existing live website project, attach the live custom domain,
   connect a production branch, or use `netlify deploy --prod` against a live site.
   This bundle contains only v8 demonstration assets, not the real app or config.
4. Open the newly assigned `https://<new-project-name>.netlify.app/` and verify
   Admin and Player links. Share `/app/society-v8.html?view=player` for the Player
   demo and `/app/society-v8.html` for organiser feedback. Choose Alfie Noakes
   Society in Admin before demonstrating it on that browser.

No preview URL has been provisioned by this implementation. The project name and
URL are assigned by Netlify when uploaded. No merge to main or change to v7 is
needed. V8 settings remain local to each visitor's browser/origin.

## Outstanding / demo boundaries

- This is an interactive standalone demonstration, not a production authenticated
  multi-user service. The mode switch is deliberate demo navigation, not an access
  control boundary. Player rendering uses a public allowlist and never renders CRM
  notes, club contacts, budgets or drafts; those fictional records still exist in
  the same browser's demo storage. Do not enter real private data.
- Written society scheduling rules and holidays require manual review; explicit
  excluded dates and recurring weekend preferences are automated. There is no
  external availability checking or club communication.
- Real photo uploads, editable historical honours, shared data, server-side roles,
  auditing, and cross-device persistence remain future production work.
- Real iPhone/Android, Safari and assistive technology acceptance remain to be
  done. No live or test Supabase changes, App Store submission, payments,
  production deployment, merge or PR #6 changes have been made.
