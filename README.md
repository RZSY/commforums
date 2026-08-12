# CommForums — Library Community Forum

A community discussion forum for the library. Runs entirely on the **free Firebase Spark plan** + **GitHub Pages** — no Cloud Functions, no billing account required.

## What's included

| File | Purpose |
|---|---|
| `index.html` | Page shell — header, auth modal, compose box, category tabs, feed |
| `style.css` | Library-themed styling (warm cream/green palette) |
| `script.js` | Auth, posting, live feed, replies, voting, client-side moderation, and the self-inserting admin Moderation Queue |
| `database.rules.json` | Basic Realtime Database rules (signed-in users can read/write) |
| `firebase.json` | Firebase CLI project config (database rules only) |

## Categories

Set up for a library forum out of the box: **Book Discussions**, **Recommendations**, **Events & Programs**, **Library Help**, **General**. Edit the `<option>` list in `index.html`, the tab buttons below it, and the `categoryLabels` object in `script.js` to change these.

## How the moderation flow works

Moderation now runs **in the browser**, right when someone hits "Post" or "Reply" — there's no Cloud Function step to deploy or pay for.

1. A signed-in user submits a post or reply.
2. `moderateText()` in `script.js` runs instantly (blocked words, link/spam count, empty content, excessive capitalization).
3. The post/reply is written straight to the database as `"approved"` (shows in the public feed right away) or `"flagged"` (only visible in the admin **Moderation Queue**).
4. The Moderation Queue panel inserts itself above the thread list automatically when a signed-in admin loads the page.

## Data shape

```
/users/{uid}
    username, email, joinedAt
    isAdmin: boolean   (set manually — see step 5 below)

/forum/posts/{postId}
    author, uid, category, subject, body, score, replies, ts
    status: "approved" | "flagged"
    moderation: { flagged, reason, checkedAt, automatic }

/forum/replies/{postId}/{replyId}
    author, uid, text, ts
    status: "approved" | "flagged"
    moderation: { flagged, reason, checkedAt, automatic }
```

## Setup

### 1. Create a Firebase project
- [Firebase console](https://console.firebase.google.com) → create a project (the free **Spark** plan is all you need).
- Enable **Authentication → Email/Password**.
- Enable **Realtime Database**.

### 2. Fill in your config
Copy your web app config (including `databaseURL`) from **Project settings → Your apps** into the top of `script.js`, replacing the `YOUR_...` placeholders.

### 3. Deploy database rules
```bash
npm install -g firebase-tools
firebase login
firebase init            # select Realtime Database, point at this folder,
                          # say NO to overwriting database.rules.json
firebase deploy --only database
```
(You can also just paste the contents of `database.rules.json` into **Realtime Database → Rules** in the Firebase console and hit Publish — no CLI needed.)

### 4. Make yourself an admin
Register through the app, then in the Firebase console (Realtime Database) manually set:
```
users/{your-uid}/isAdmin = true
```
Refresh the page — the Moderation Queue panel will appear above the thread list.

### 5. Deploy to GitHub Pages
Push `index.html`, `style.css`, and `script.js` to a repo and enable GitHub Pages on the `main` branch.

That's it — no Cloud Functions to deploy, no Blaze billing plan needed.

## ⚠️ Security note

This setup trades away server-side enforcement for simplicity:

- **Database rules only require a signed-in user** — any logged-in user can technically read/write any post, reply, or vote (not just their own), and could set their own `isAdmin` flag directly in the database if they knew to look for it.
- **Moderation runs client-side.** A user could bypass `moderateText()` entirely by writing straight to the database with the SDK, since the rules don't check content.

For a small, trusted library community this is usually a fine trade-off. If you later want real enforcement (users can only edit their own content, `isAdmin` can't be self-granted, moderation can't be bypassed), that requires either tighter Realtime Database rules referencing `auth.uid` per-field, or moving moderation into a Cloud Function — which needs the paid Blaze plan.

## Extending this
- Swap `BLOCKED_WORDS` / `moderateText()` in `script.js` for a real moderation API call.
- Add a "Report post" flow so patrons can flag content for re-review.
- Add pagination once thread volume grows past what one `onValue` listener comfortably handles.
- Pin/announce posts for library staff notices (e.g. a `pinned: true` flag sorted to the top).
