# Deployment Notes

Set the following environment variables before running the server:

- `SUPABASE_URL` – Base URL of your Supabase project.
- `SUPABASE_ANON_KEY` – Anon key for your Supabase project.
- `ALLOWED_TABLES` – Comma-separated list of tables the server can access.
- `ALLOW_WRITES` – Set to `true` to enable insert operations.
- `ALLOWED_ORIGINS` – Comma-separated list of allowed origins for CORS.

