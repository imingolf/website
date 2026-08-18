10's In — Shared Version

FILES
- index.html       The app
- config.js        Add your Supabase URL + Publishable/Anon key here
- supabase-setup.sql  Run once in Supabase SQL Editor

STARTING PLAYERS
Greg A, Greg R, Tony, Billy

DEFAULT GROUP PIN
1010

IMPORTANT
This version does not collect or hold real money. "Paid" is a shared status that you mark manually.
The PIN protects access through the app's database functions. Keep the PIN within your group.
Never put a Supabase service_role/secret key in config.js — use the Publishable/Anon key only.

HOW SHARING WORKS
Everyone opens the same Netlify URL and enters the same PIN.
Changes are stored in Supabase and the app refreshes the shared state every 5 seconds.
