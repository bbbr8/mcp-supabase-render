# Testing Instructions

This project does not include automated tests. To manually verify the `/tools/supabase_insert` endpoint behaves correctly for both response representations:

1. **Start the server** with environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `ALLOWED_TABLES` (comma separated list containing the target table)
   - `ALLOW_WRITES=true`

   ```bash
   SUPABASE_URL=... SUPABASE_ANON_KEY=... ALLOWED_TABLES=my_table ALLOW_WRITES=true node index.js
   ```

2. **Insert with representation** (`returnRepresentation: true`).

   ```bash
   curl -X POST http://localhost:3000/tools/supabase_insert \
     -H 'Content-Type: application/json' \
     -d '{"table":"my_table","rows":[{"col":"value"}],"returnRepresentation":true}'
   ```

   Expect a JSON response containing the inserted row.

3. **Insert without representation** (`returnRepresentation: false`).

   ```bash
   curl -X POST http://localhost:3000/tools/supabase_insert \
     -H 'Content-Type: application/json' \
     -d '{"table":"my_table","rows":[{"col":"value"}],"returnRepresentation":false}'
   ```

   Expect a response of:

   ```json
   {"success": true}
   ```

These steps confirm that the handler returns the inserted rows when requested and a simple success status when no representation is needed.
