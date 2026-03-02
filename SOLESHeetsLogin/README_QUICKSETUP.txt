SOLE SHEETS AUTH (NETLIFY)

What this is:
- index.html = login + signup UI
- netlify/functions = backend API (login/signup/me/logout)
- Google Sheets is the user database (tab named "Users")

Required Netlify Environment Variables:
1) SHEET_ID
   - Your Google Spreadsheet ID (from the URL)

2) AUTH_SECRET
   - A long random string (used to sign session tokens)

3) Google service account credentials (choose ONE option):

Option A (recommended): GOOGLE_SERVICE_ACCOUNT_JSON_B64
- Base64 of the entire service-account JSON file.

Option B: GOOGLE_SERVICE_ACCOUNT_JSON
- The raw JSON string of the service-account JSON.

Option C: GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY
- GOOGLE_PRIVATE_KEY must include real newlines OR use \n and this code will normalize.

Optional:
- ADMIN_EMAILS = comma-separated emails that should be admins (role=admin on signup)

Google Setup (once):
1) Create a Google Sheet
2) Create a tab named: Users
   Put headers in row 1:
   user_id | email | password_hash | role | created_at
3) In Google Cloud:
   - Enable Google Sheets API
   - Create Service Account
   - Create key (JSON)
4) Share the Sheet with the service account email (Editor)

Deploy:
- Drop this folder into a Netlify site (Git or drag/drop)
- Set env vars above
- Deploy

Endpoints:
- POST /.netlify/functions/signup  {email,password}
- POST /.netlify/functions/login   {email,password}
- POST /.netlify/functions/logout  {}
- GET  /.netlify/functions/me      (cookie-based session)
