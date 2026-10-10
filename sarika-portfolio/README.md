# Sarika Maurya's portfolio

Run the portfolio and its private admin dashboard:

```sh
npm install
copy .env.example .env
npm start
```

- Portfolio: http://localhost:5500/
- Admin login: http://localhost:5500/admin
- Dashboard after login: http://localhost:5500/admin/dashboard

Account settings in the dashboard lets you edit the public name, email and social
links and customize the live chat welcome message. Live chat stays enabled. These
settings persist in the private `.admin/settings.json` file. Blank social links
are hidden on the portfolio. Refresh public pages to see profile updates.

You can also change your login username, show or hide password fields, and sign
out all devices. Username and password changes require the current password and
sign out every admin session, including connected admin chat sockets. New
passwords require at least 12 characters. Keep `ADMIN_PASSWORD` unset during
normal startup: setting it explicitly resets credentials on each server start.

On first start, the server creates username `admin` and a random password. Open
`.admin/login-details.txt` locally for the credentials. The password hash is stored
in `.admin/credentials.json`; the whole `.admin` folder is excluded from Git and is
never served over HTTP. Keep the login-details file private; it can be removed
after saving the password in a password manager.

The dashboard includes Add, Edit, and Delete for projects, skills, experience, and certificates,
plus a searchable contact inbox. Open a section in the sidebar and use its Add
button or the Edit/Delete buttons on an item. Deletion requires confirmation.
Use **Resumes** to upload multiple PDF versions, set the active resume shown by the
public Resume button, or remove old versions. Resume files are stored in MongoDB
GridFS; PDF files up to 15 MB are supported.
Sign out
returns to the login page. Sessions expire after eight hours or a server restart.
The old `/showdata.html` address redirects to the protected inbox.

Portfolio content and contact submissions are stored in MongoDB. Start a local
MongoDB server (`mongod`) on its default address, `mongodb://127.0.0.1:27017`, or
set `MONGODB_URI` to your MongoDB connection string and optionally `MONGODB_DB`
(defaults to `portfolio`). Copy `.env.example` to `.env` to configure these values
for both `npm start` and `npm run dev`; production can provide them as environment
variables instead. For MongoDB Atlas, use the `mongodb+srv://` connection string
from Atlas, ensure the database user has read/write access, and allow your server's
IP address in Atlas Network Access. URL-encode special characters in the database
username or password. If your network's DNS resolver refuses Atlas SRV lookups,
set `MONGODB_DNS_SERVERS` to a comma-separated list of reachable DNS servers
(for example, `1.1.1.1,1.0.0.1`); this changes DNS resolution only for the server
process. On first startup, existing `projects.json`,
`skills.json`, `experience.json`, `certificates.json`, and `contacts.json` records
are imported once; subsequent reads and writes use MongoDB. The homepage, Projects
page, and Experience page continue to load the same public JSON endpoints. Education
is fixed HTML in `index.html` and is not managed through the admin panel or MongoDB.
Refresh the public page after saving an admin change.

Project images, skill icons, and certificate images accept an `/assets/...` path or
a full http(s) image URL. Cloudinary-hosted images can be used by pasting their
complete secure delivery URL (for example, `https://res.cloudinary.com/<cloud>/image/upload/<asset>`).
The image field also accepts that Cloudinary URL without the leading `https://`.
The dashboard does not upload files; upload images to Cloudinary separately and
paste the returned URL/path into the relevant field. A Cloudinary public ID alone
is not a display URL; use the full `res.cloudinary.com/<cloud>/image/upload/...` path.

To publish a certificate, open **Certificates** in the dashboard and choose **Add
certificate**. Enter its title and issuer, then optionally add the issue date,
credential ID, description, a certificate image link (`/assets/...` or http(s)),
and a certificate or verification URL. Certificates appear on the homepage;
Edit updates them and Delete removes them. The section starts empty.

To set or reset the account, stop the server and start it with `ADMIN_USERNAME`
(optional, defaults to the existing username or `admin`) and `ADMIN_PASSWORD`
(12 to 1024 characters) as environment variables. These replace the stored
credentials and remove the initial login-details file. There is no public sign-up.

`PORT` overrides port 5500. `npm run dev` restarts the server on source changes;
this also clears login sessions. For HTTPS hosting, use `NODE_ENV=production` so
session cookies have the Secure flag. Admin credentials remain in the private `.admin` directory. Login sessions remain
in memory and expire after a server restart.

```sh
npm test
```

Tests use isolated temporary records and credentials. They cover login/logout,
protected routes, cookies, login throttling, contact submission, private file
access, credential persistence, existing public routes, and all four editable content
sections' create/edit/delete flows, validation, persistence, and concurrent writes.
