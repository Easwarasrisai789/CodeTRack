# CodeTrack

CodeTrack is a personal coding revision and task management platform built with vanilla HTML, CSS, and JavaScript.

## Features

- Student authentication with registration, login, logout, and password reset
- Individual user dashboards with metrics and quick actions
- Section-based organization for coding topics and tasks
- Checkbox-based task components: description, coding problem, code solution, platform link, and notes
- Sequential task list inside each section
- Per-section daily task targets with a seven-day activity view
- Bookmarking and revision tracking
- Sharing sections with registered users as read-only
- Responsive mobile layout
- Student profile management
- Admin panel for managing student records
- Local demo mode for preview without Firebase configuration

## Run locally

1. Open the project folder.
2. Start a local server:
   ```bash
   python -m http.server 8000
   ```
3. Visit `http://localhost:8000` in the browser. In VS Code, you can also run the **Run CodeTrack local server** task.

## Firebase setup

1. The Firebase Web app config is set in `app.js` for project `my-ae-b4bf9`.
2. In **Authentication → Sign-in method**, enable **Email/Password**.
3. Create a Cloud Firestore database in the same project if one does not already exist. Choose a location and finish database creation.
4. Publish the included `firestore.rules` using the Firebase Console **Firestore Database → Rules** tab, or run `firebase deploy --only firestore:rules` from this folder with the Firebase CLI installed and signed in. These rules allow signed-in users to see the registered-user directory for section sharing.
5. Add the app's local or deployed host under **Authentication → Settings → Authorized domains** if Firebase requests it. If the Google Cloud API key uses website restrictions, also allow `http://localhost:8000/*` for local testing and allow the Identity Toolkit API under API restrictions.
6. Register a new account. It should appear in **Authentication → Users**; its profile document is stored at `users/{uid}` in Firestore. Sections, tasks, and bookmarks are stored under that user's document.

If the page says **Demo mode only**, registrations are stored in browser local storage and will not appear in Firebase. Do not use demo mode for real accounts. Accounts created in demo mode are not migrated automatically.

If registration creates an Authentication user but reports a Firestore error, check that the database exists and the rules above are published. The account can then sign in again; the app will retry creating its profile.

If registration reports `API_KEY_INVALID`, confirm the Web API key in **Project settings → General → Your apps** belongs to `my-ae-b4bf9` and is active. In **Google Cloud Console → APIs & Services → Credentials**, check that its application restrictions allow the app's host and that its API restrictions allow the Identity Toolkit API. Replace the `apiKey` in `app.js` with the correct Web API key if necessary.

The Firebase web config is intended to identify the Firebase project; protect the data with appropriate Firestore Security Rules and provider settings. Never put service-account credentials in this frontend.

## Admin account

To grant admin access, first register and verify the admin account. In Firestore Data, open `users/{uid}` for that account and set `isAdmin` to boolean `true`. Then sign out and back in. The rules prevent users from granting admin access to themselves.

```text
eswarvenky931@gmail.com
```

The password is not stored in the project. Set or reset it directly in Firebase Authentication. Admin access is based on the protected Firestore profile role, not just the email address.

## Notes

- If Firebase is not configured, the app automatically provides a local demo mode using browser storage.
- This is useful for previewing the UI and validating flows before connecting to a live Firebase backend.
