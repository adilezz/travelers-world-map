# User service

Accounts and the traveler's own records. **Place data is not here.** The
published bundle stays static files; visits, trips and profile are private
rows. They do not meet (document 4 §1).

Document 5 wins on product behaviour: magic link and Google are linked
identities on one user, merge on sign-in is last-write-wins per `place_id` by
`marked_at`, the product works signed out, and signing out keeps the local
copy.

## Run it

```bash
# from this directory
set TWM_AUTH_MODE=dev
python -m twm_server
# http://127.0.0.1:8787/health
```

`TWM_AUTH_MODE=dev` returns the magic-link token in the JSON so local work
does not need a mailer. Production never does that.

```bash
pytest            # from this directory
```

## Postgres

`sql/001_init.sql` is the schema for a managed Postgres (Supabase fits
document 4 §2; the hosting region is Adil's call and is parked). It enables
row-level security on every traveler table. Apply it as the table owner,
connect the app as `twm_app`, and set `twm.user_id` per request:

```sql
SELECT set_config('twm.user_id', '<uuid>', true);
```

```
DATABASE_URL=postgres://twm_app:.../twm
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://your.origin/api/auth/google/callback
TWM_APP_ORIGIN=https://your.origin
TWM_AUTH_MODE=prod
```

Do not put credentials in `webapp/`.

The Python process in this folder uses an in-memory store that implements the
same contract, so tests and a laptop do not need Postgres. Point production at
the SQL.

## API (document 4 §4)

| Method | Path | Notes |
|---|---|---|
| GET | `/visits` | The record |
| PUT | `/visits/{place_id}` | Idempotent mark or unmark. Never a DELETE. |
| POST | `/visits/bulk` | Onboarding path |
| GET, POST, PATCH | `/trips` | Trip lifecycle |
| GET | `/export` | Everything the traveler owns |
| POST | `/import` | Merge restore |
| POST | `/feedback/place` | Disputed place, review queue |
| POST | `/auth/magic-link` | Email a one-time link |
| POST | `/auth/session` | Consume the link **and merge** local visits |
| GET/POST | `/auth/google` | OAuth; POST in `dev` with `{email, sub}` |
| DELETE | `/account` | Removes server rows. Backups: 30 days. |

Unmarking sets `visited=false` and keeps the row. Account deletion is the
exception that removes rows; the client must offer an export first.
