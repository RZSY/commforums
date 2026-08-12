// ============================================================
//  FORUM SCRIPT — CommForums
//  A community forum for the library, with automatic moderation.
//  Depends on: Firebase compat SDK (app + auth + database)
// ============================================================

// ──────────────────────────────────────────────
// STEP 1 — REPLACE WITH YOUR FIREBASE CONFIG
// Firebase Console → Project Settings → Your apps
// ──────────────────────────────────────────────
var firebaseConfig = {
    apiKey:            "AIzaSyB_9JF7v-gMN4_q176PUgZjaGy6RjWhV4Y",
    authDomain:        "commforums.firebaseapp.com",
    databaseURL:       "https://commforums-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId:         "commforums",
    storageBucket:     "commforums.firebasestorage.app",
    messagingSenderId: "990280192388",
    appId:             "1:990280192388:web:caa73c921e5a6abd13cdd1",
    measurementId:     "G-933WGHKX6S"
};

// ──────────────────────────────────────────────
// Init Firebase
// ──────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
var auth     = firebase.auth();
var db       = firebase.database();
var postsRef = db.ref('forum/posts');

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
var currentUser     = null;   // Firebase user object, or null
var currentCategory = 'all';
var currentSort     = 'new';
var allPosts        = {};
var openReplies     = {};
var replyListeners  = {};

var isAdmin          = false;
var allFlaggedReplies = {};   // { postId: { replyId: replyData, ... }, ... } — built from a global listener
var modReplyListener  = null;

// ──────────────────────────────────────────────
// Auth state observer — drives all UI changes
// ──────────────────────────────────────────────
auth.onAuthStateChanged(function (user) {
    currentUser = user;

    var guestBar  = document.getElementById('authBarGuest');
    var userBar   = document.getElementById('authBarUser');
    var nameSpan  = document.getElementById('authBarName');
    var compose   = document.getElementById('forumCompose');
    var gate      = document.getElementById('forumGate');
    var authorFld = document.getElementById('postAuthor');

    if (user) {
        // ── Logged in ──
        var displayName = getUserDisplayName(user);

        guestBar.style.display = 'none';
        userBar.style.display  = 'flex';
        nameSpan.textContent   = displayName;

        compose.style.display = 'block';
        gate.style.display    = 'none';

        if (authorFld) authorFld.value = displayName;

        closeAuthModal();
        showToast('Signed in as ' + displayName);

        // Check admin flag (set manually in the database — see README).
        // Note: with the simplified rules this is a UI-only check, not
        // a server-enforced one — see the README security note.
        db.ref('users/' + user.uid + '/isAdmin').once('value').then(function (snap) {
            isAdmin = snap.val() === true;
            refreshModQueueVisibility();
        });
    } else {
        // ── Logged out ──
        guestBar.style.display = 'flex';
        userBar.style.display  = 'none';

        compose.style.display = 'none';
        gate.style.display    = 'flex';

        isAdmin = false;
        refreshModQueueVisibility();
    }

    // Always re-render so reply boxes reflect auth state
    renderPosts();
});

function getUserDisplayName(user) {
    if (user.displayName) return user.displayName;
    // Fallback: part before @ in email
    return user.email ? user.email.split('@')[0] : 'Member';
}

// ──────────────────────────────────────────────
// Auth modal helpers
// ──────────────────────────────────────────────
function openAuthModal(tab) {
    switchAuthTab(tab || 'login');
    document.getElementById('authOverlay').classList.add('open');
}

function closeAuthModal(e) {
    // If called from overlay click, only close when clicking the backdrop itself
    if (e && e.target !== document.getElementById('authOverlay')) return;
    document.getElementById('authOverlay').classList.remove('open');
    clearAuthErrors();
}

function switchAuthTab(tab) {
    var isLogin = (tab === 'login');
    document.getElementById('authPanelLogin').style.display    = isLogin ? 'block' : 'none';
    document.getElementById('authPanelRegister').style.display = isLogin ? 'none'  : 'block';
    document.getElementById('tabLogin').classList.toggle('active',    isLogin);
    document.getElementById('tabRegister').classList.toggle('active', !isLogin);
    clearAuthErrors();
}

function clearAuthErrors() {
    ['loginError', 'regError'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.textContent = ''; el.classList.remove('visible'); }
    });
}

function showAuthError(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
}

// ──────────────────────────────────────────────
// Register
// ──────────────────────────────────────────────
function doRegister() {
    var username = document.getElementById('regUsername').value.trim();
    var email    = document.getElementById('regEmail').value.trim();
    var password = document.getElementById('regPassword').value;

    if (!username) { showAuthError('regError', 'Choose a display name.'); return; }
    if (!email)    { showAuthError('regError', 'Enter your email.');       return; }
    if (password.length < 6) { showAuthError('regError', 'Password must be at least 6 characters.'); return; }

    var btn = document.getElementById('regBtn');
    btn.disabled = true;
    btn.textContent = 'Creating\u2026';

    auth.createUserWithEmailAndPassword(email, password)
        .then(function (cred) {
            // Save display name to Firebase Auth profile
            return cred.user.updateProfile({ displayName: username });
        })
        .then(function () {
            // Also save to database for reference.
            // isAdmin is intentionally NOT set here — grant it manually
            // in the console/CLI so a client can never self-promote.
            var uid = auth.currentUser.uid;
            return db.ref('users/' + uid).set({
                username: username,
                email:    email,
                joinedAt: firebase.database.ServerValue.TIMESTAMP
            });
        })
        .catch(function (err) {
            showAuthError('regError', friendlyAuthError(err.code));
            btn.disabled = false;
            btn.textContent = 'Create Account';
        });
}

// ──────────────────────────────────────────────
// Login
// ──────────────────────────────────────────────
function doLogin() {
    var email    = document.getElementById('loginEmail').value.trim();
    var password = document.getElementById('loginPassword').value;

    if (!email)    { showAuthError('loginError', 'Enter your email.');    return; }
    if (!password) { showAuthError('loginError', 'Enter your password.'); return; }

    var btn = document.getElementById('loginBtn');
    btn.disabled = true;
    btn.textContent = 'Signing in\u2026';

    auth.signInWithEmailAndPassword(email, password)
        .catch(function (err) {
            showAuthError('loginError', friendlyAuthError(err.code));
            btn.disabled = false;
            btn.textContent = 'Sign In';
        });
}

// ──────────────────────────────────────────────
// Sign out
// ──────────────────────────────────────────────
function signOut() {
    auth.signOut().then(function () {
        showToast('Signed out.');
    });
}

// ──────────────────────────────────────────────
// Friendly Firebase error messages
// ──────────────────────────────────────────────
function friendlyAuthError(code) {
    var map = {
        'auth/email-already-in-use':    'That email is already registered.',
        'auth/invalid-email':           'That email address is invalid.',
        'auth/weak-password':           'Password is too weak.',
        'auth/user-not-found':          'No account found with that email.',
        'auth/wrong-password':          'Incorrect password.',
        'auth/invalid-credential':      'Incorrect email or password.',
        'auth/too-many-requests':       'Too many attempts. Try again later.',
        'auth/network-request-failed':  'Network error. Check your connection.'
    };
    return map[code] || 'Something went wrong. Please try again.';
}

// ──────────────────────────────────────────────
// Client-side moderation (runs in the browser at submit time —
// no Cloud Functions / Blaze plan required, works on Spark).
// Same simple checks as before: blocked words, link/spam count,
// empty content, excessive capitalization.
// ──────────────────────────────────────────────
var BLOCKED_WORDS = [
    // Replace/extend with your own list. Keep case-insensitive matches.
    'spamword1', 'spamword2', 'slur1', 'slur2'
];
var MAX_LINKS = 3;
var MIN_LENGTH = 3;
var MAX_SUBJECT_LENGTH = 150;

function moderateText(subject, body) {
    var text = (subject + '\n' + body).toLowerCase();

    var hitWord = BLOCKED_WORDS.filter(function (w) { return text.indexOf(w.toLowerCase()) !== -1; })[0];
    if (hitWord) {
        return { flagged: true, reason: 'Contains blocked term ("' + hitWord + '")' };
    }

    var linkMatches = text.match(/https?:\/\/\S+/g) || [];
    if (linkMatches.length > MAX_LINKS) {
        return { flagged: true, reason: 'Too many links (' + linkMatches.length + ')' };
    }

    if (body.trim().length < MIN_LENGTH) {
        return { flagged: true, reason: 'Message too short / empty' };
    }

    if (subject && subject.length > MAX_SUBJECT_LENGTH) {
        return { flagged: true, reason: 'Subject exceeds max length' };
    }

    var letters = text.replace(/[^a-z]/gi, '');
    if (letters.length > 20) {
        var upperRatio = body.replace(/[^A-Z]/g, '').length / Math.max(1, body.replace(/[^a-zA-Z]/g, '').length);
        if (upperRatio > 0.7) {
            return { flagged: true, reason: 'Excessive capitalization' };
        }
    }

    return { flagged: false, reason: null };
}

// ──────────────────────────────────────────────
// Keyboard shortcut: Esc closes modal
// ──────────────────────────────────────────────
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAuthModal();
});

// ──────────────────────────────────────────────
// Character counter
// ──────────────────────────────────────────────
document.getElementById('postBody').addEventListener('input', function () {
    document.getElementById('charCount').textContent = this.value.length + ' / 1800';
});

// ──────────────────────────────────────────────
// Submit a new post (requires auth)
// Moderation runs right here in the browser and the post is written
// as "approved" or "flagged" immediately — no Cloud Function involved.
// ──────────────────────────────────────────────
function submitPost() {
    if (!currentUser) { openAuthModal('login'); return; }

    var author   = getUserDisplayName(currentUser);
    var category = document.getElementById('postCategory').value;
    var subject  = document.getElementById('postSubject').value.trim();
    var body     = document.getElementById('postBody').value.trim();

    if (!subject) { showToast('Add a subject before posting.'); return; }
    if (!body)    { showToast('Your message is empty.');        return; }

    var btn = document.getElementById('submitPostBtn');
    btn.disabled = true;
    btn.textContent = 'Posting\u2026';

    var mod = moderateText(subject, body);

    postsRef.push({
        author:   author,
        uid:      currentUser.uid,
        category: category,
        subject:  subject,
        body:     body,
        score:    0,
        replies:  0,
        status:   mod.flagged ? 'flagged' : 'approved',
        moderation: {
            flagged:   mod.flagged,
            reason:    mod.reason,
            checkedAt: firebase.database.ServerValue.TIMESTAMP,
            automatic: true
        },
        ts:       firebase.database.ServerValue.TIMESTAMP
    }, function (err) {
        if (err) {
            showToast('Failed to post. Check your connection.');
        } else {
            document.getElementById('postSubject').value = '';
            document.getElementById('postBody').value    = '';
            document.getElementById('charCount').textContent = '0 / 1800';
            showToast(mod.flagged ? 'Your post was flagged for review.' : 'Posted!');
        }
        btn.disabled = false;
        btn.textContent = 'Post';
    });
}

// ──────────────────────────────────────────────
// Real-time listener on posts
// ──────────────────────────────────────────────
postsRef.on('value', function (snapshot) {
    allPosts = snapshot.val() || {};
    renderPosts();
    if (isAdmin) renderModQueue();
});

// ──────────────────────────────────────────────
// Category / sort switching
// ──────────────────────────────────────────────
function switchCategory(cat, btn) {
    currentCategory = cat;
    document.querySelectorAll('.forum-tab').forEach(function (t) { t.classList.remove('active'); });
    btn.classList.add('active');
    renderPosts();
}

function setSort(sort, btn) {
    currentSort = sort;
    document.querySelectorAll('.forum-sort-btn').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    renderPosts();
}

// ──────────────────────────────────────────────
// Render post list
// Only "approved" posts are ever shown in the public feed. "pending"
// and "flagged" posts stay invisible to everyone except in the admin
// Moderation Queue (see renderModQueue below).
// ──────────────────────────────────────────────
function renderPosts() {
    var container = document.getElementById('forumPosts');
    if (!container) return;

    var entries = Object.keys(allPosts)
        .map(function (id) { return { id: id, data: allPosts[id] }; })
        .filter(function (e) { return e.data.status === 'approved'; });

    if (currentCategory !== 'all') {
        entries = entries.filter(function (e) { return e.data.category === currentCategory; });
    }

    if (currentSort === 'new') {
        entries.sort(function (a, b) { return (b.data.ts || 0) - (a.data.ts || 0); });
    } else {
        entries.sort(function (a, b) { return (b.data.score || 0) - (a.data.score || 0); });
    }

    document.getElementById('postCountLabel').textContent =
        entries.length + (entries.length === 1 ? ' thread' : ' threads');

    if (entries.length === 0) {
        container.innerHTML =
            '<div class="forum-empty">' +
            '<div class="forum-empty-icon">&#128218;</div>' +
            '<p>No threads here yet. Start the conversation.</p>' +
            '</div>';
        return;
    }

    // Detach all existing reply listeners before wiping the DOM.
    // Without this, stale handles in replyListeners block re-attachment
    // after the DOM nodes are replaced.
    Object.keys(replyListeners).forEach(function (pid) {
        db.ref('forum/replies/' + pid).off('value', replyListeners[pid]);
    });
    replyListeners = {};

    var html = '';
    entries.forEach(function (e) { html += buildPostHTML(e.id, e.data); });
    container.innerHTML = html;

    // Re-open any panels that were open before the re-render
    Object.keys(openReplies).forEach(function (pid) {
        if (openReplies[pid]) {
            var panel = document.getElementById('replies-' + pid);
            if (panel) { panel.classList.add('open'); loadReplies(pid); }
        }
    });
}

// ──────────────────────────────────────────────
// Build a single post HTML
// ──────────────────────────────────────────────
var categoryLabels = {
    'book-discussions': 'Book Discussions',
    'recommendations':  'Recommendations',
    'events':            'Events & Programs',
    'library-help':      'Library Help',
    'general':            'General'
};
function buildPostHTML(id, post) {
    var preview     = (post.body || '');
    var timeStr     = post.ts ? formatTime(post.ts) : '';
    var catLabel    = categoryLabels[post.category] || post.category || '';
    var replyCount  = post.replies || 0;

    // Reply area: composer if logged in, gate if not
    var replyArea;
    if (currentUser) {
        replyArea =
            '<div class="forum-reply-compose">' +
                '<input type="text" id="reply-input-' + id + '" placeholder="Your reply\u2026" maxlength="600" />' +
                '<button class="forum-reply-send" onclick="submitReply(\'' + id + '\')">Reply</button>' +
            '</div>';
    } else {
        replyArea =
            '<div class="reply-gate">' +
                '<span>Sign in to reply.</span>' +
                '<button class="reply-gate-link" onclick="openAuthModal(\'login\')">Sign In</button>' +
            '</div>';
    }

    return (
        '<div class="forum-post" id="post-' + id + '">' +

            '<div class="forum-post-vote">' +
                '<button class="vote-btn" onclick="vote(\'' + id + '\', 1)" title="Upvote">&#9650;</button>' +
                '<span class="vote-score" id="score-' + id + '">' + (post.score || 0) + '</span>' +
                '<button class="vote-btn" onclick="vote(\'' + id + '\', -1)" title="Downvote">&#9660;</button>' +
            '</div>' +

            '<div class="forum-post-body">' +
                '<div class="forum-post-meta-top">' +
                    '<span class="forum-tag-pill">' + escHtml(catLabel) + '</span>' +
                '</div>' +
                '<p class="forum-post-subject" onclick="toggleReplies(\'' + id + '\')">' +
                    escHtml(post.subject || '(untitled)') +
                '</p>' +
                '<p class="forum-post-preview">' + escHtml(preview) + '</p>' +
                '<div class="forum-post-footer">' +
                    '<span class="forum-post-author">by <span>' + escHtml(post.author || 'Anonymous') + '</span></span>' +
                    '<span class="forum-post-time">' + escHtml(timeStr) + '</span>' +
                    '<button class="reply-toggle-btn" onclick="toggleReplies(\'' + id + '\')">' +
                        'Replies (' + replyCount + ')' +
                    '</button>' +
                '</div>' +
            '</div>' +

            '<div class="forum-reply-count">' +
                '<span class="rcount-num" id="rcount-' + id + '">' + replyCount + '</span>' +
                '<span class="rcount-label">replies</span>' +
            '</div>' +

            '<div class="forum-replies-panel" id="replies-' + id + '">' +
                '<div class="forum-replies-inner">' +
                    '<div id="reply-list-' + id + '"><div class="forum-loading">Loading\u2026</div></div>' +
                    replyArea +
                '</div>' +
            '</div>' +

        '</div>'
    );
}

// ──────────────────────────────────────────────
// Toggle replies panel
// ──────────────────────────────────────────────
function toggleReplies(pid) {
    var panel = document.getElementById('replies-' + pid);
    if (!panel) return;

    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        openReplies[pid] = false;
        // Detach and remove so loadReplies can attach a fresh listener on next open
        if (replyListeners[pid]) {
            db.ref('forum/replies/' + pid).off('value', replyListeners[pid]);
            delete replyListeners[pid];
        }
    } else {
        panel.classList.add('open');
        openReplies[pid] = true;
        loadReplies(pid);
    }
}

// ──────────────────────────────────────────────
// Load replies in real time
// Only "approved" replies are shown. "pending"/"flagged" replies are
// filtered out here (flagged ones surface in the admin queue instead).
// ──────────────────────────────────────────────
function loadReplies(pid) {
    // Always attach a fresh listener (stale ones were cleaned in renderPosts)
    var ref = db.ref('forum/replies/' + pid);
    replyListeners[pid] = ref.on('value', function (snap) {
        var list = document.getElementById('reply-list-' + pid);
        if (!list) return;

        var replies = snap.val();
        var arr = replies
            ? Object.keys(replies)
                .map(function (k) { return replies[k]; })
                .filter(function (r) { return r.status === 'approved'; })
            : [];

        if (arr.length === 0) {
            list.innerHTML =
                '<p style="font-family:\'IBM Plex Mono\',monospace;font-size:10.5px;' +
                'color:var(--muted);letter-spacing:0.1em;margin:0 0 10px">No replies yet.</p>';
            return;
        }

        arr.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });

        var html = '';
        arr.forEach(function (r) {
            html +=
                '<div class="forum-reply-item">' +
                    '<div class="forum-reply-author-line">' +
                        '<span>' + escHtml(r.author || 'Anonymous') + '</span>' +
                        ' &#160;&#183;&#160; ' + escHtml(formatTime(r.ts)) +
                    '</div>' +
                    '<p class="forum-reply-text">' + escHtml(r.text || '') + '</p>' +
                '</div>';
        });
        list.innerHTML = html;
    });
}

// ──────────────────────────────────────────────
// Submit a reply (requires auth)
// Moderation runs right here in the browser and the reply is written
// as "approved" or "flagged" immediately — no Cloud Function involved.
// ──────────────────────────────────────────────
function submitReply(pid) {
    if (!currentUser) { openAuthModal('login'); return; }

    var input = document.getElementById('reply-input-' + pid);
    if (!input) return;

    var text = input.value.trim();
    if (!text) { showToast('Write something first.'); return; }

    var mod = moderateText('', text);

    db.ref('forum/replies/' + pid).push({
        author: getUserDisplayName(currentUser),
        uid:    currentUser.uid,
        text:   text,
        status: mod.flagged ? 'flagged' : 'approved',
        moderation: {
            flagged:   mod.flagged,
            reason:    mod.reason,
            checkedAt: firebase.database.ServerValue.TIMESTAMP,
            automatic: true
        },
        ts:     firebase.database.ServerValue.TIMESTAMP
    }, function (err) {
        if (!err) {
            input.value = '';
            db.ref('forum/posts/' + pid + '/replies').transaction(function (cur) {
                return (cur || 0) + 1;
            });
            showToast(mod.flagged ? 'Reply flagged for review.' : 'Reply posted!');
        } else {
            showToast('Failed to post reply.');
        }
    });
}

// ──────────────────────────────────────────────
// Vote (requires auth)
// ──────────────────────────────────────────────
function vote(pid, delta) {
    if (!currentUser) { openAuthModal('login'); return; }
    db.ref('forum/posts/' + pid + '/score').transaction(function (cur) {
        return (cur || 0) + delta;
    });
}

// ════════════════════════════════════════════════════════════
//  ADMIN MODERATION QUEUE
//  Self-inserting panel — no HTML changes required. Appears above
//  the thread list only for signed-in admins (users/{uid}/isAdmin
//  === true, set manually — see README).
// ════════════════════════════════════════════════════════════

function ensureModQueueContainer() {
    var existing = document.getElementById('forumModQueue');
    if (existing) return existing;

    var postsContainer = document.getElementById('forumPosts');
    if (!postsContainer || !postsContainer.parentNode) return null;

    var panel = document.createElement('div');
    panel.id = 'forumModQueue';
    panel.style.display = 'none';
    panel.style.border = '1px solid #2f6f4f';
    panel.style.borderRadius = '8px';
    panel.style.padding = '14px 16px';
    panel.style.margin = '0 0 18px';
    panel.style.fontFamily = "'IBM Plex Mono', monospace";
    panel.style.fontSize = '12px';

    var heading = document.createElement('div');
    heading.textContent = '\u26A0 MODERATION QUEUE';
    heading.style.fontWeight = 'bold';
    heading.style.letterSpacing = '0.1em';
    heading.style.marginBottom = '10px';
    panel.appendChild(heading);

    var list = document.createElement('div');
    list.id = 'forumModQueueList';
    panel.appendChild(list);

    postsContainer.parentNode.insertBefore(panel, postsContainer);
    return panel;
}

function refreshModQueueVisibility() {
    var panel = ensureModQueueContainer();
    if (!panel) return;
    panel.style.display = isAdmin ? 'block' : 'none';

    if (isAdmin) {
        renderModQueue();
        attachModReplyListener();
    } else {
        detachModReplyListener();
    }
}

// Global listener over ALL replies so flagged replies (which live
// nested under their parent post) can surface in one combined queue.
function attachModReplyListener() {
    if (modReplyListener) return; // already attached
    modReplyListener = db.ref('forum/replies').on('value', function (snap) {
        allFlaggedReplies = {};
        var all = snap.val() || {};
        Object.keys(all).forEach(function (pid) {
            Object.keys(all[pid]).forEach(function (rid) {
                var r = all[pid][rid];
                if (r.status === 'flagged') {
                    if (!allFlaggedReplies[pid]) allFlaggedReplies[pid] = {};
                    allFlaggedReplies[pid][rid] = r;
                }
            });
        });
        if (isAdmin) renderModQueue();
    });
}

function detachModReplyListener() {
    if (modReplyListener) {
        db.ref('forum/replies').off('value', modReplyListener);
        modReplyListener = null;
    }
    allFlaggedReplies = {};
}

function renderModQueue() {
    var list = document.getElementById('forumModQueueList');
    if (!list) return;

    var flaggedPosts = Object.keys(allPosts)
        .map(function (id) { return { id: id, data: allPosts[id] }; })
        .filter(function (e) { return e.data.status === 'flagged'; });

    var flaggedReplies = [];
    Object.keys(allFlaggedReplies).forEach(function (pid) {
        Object.keys(allFlaggedReplies[pid]).forEach(function (rid) {
            flaggedReplies.push({ pid: pid, rid: rid, data: allFlaggedReplies[pid][rid] });
        });
    });

    if (flaggedPosts.length === 0 && flaggedReplies.length === 0) {
        list.innerHTML = '<p style="opacity:0.7">Nothing flagged right now.</p>';
        return;
    }

    var html = '';

    flaggedPosts.forEach(function (e) {
        var reason = (e.data.moderation && e.data.moderation.reason) || 'n/a';
        html +=
            '<div style="border:1px solid #444;border-radius:6px;padding:10px;margin-bottom:10px;">' +
                '<div style="font-weight:bold;">[POST] ' + escHtml(e.data.subject || '(untitled)') + '</div>' +
                '<div style="opacity:0.75;margin:4px 0;">by ' + escHtml(e.data.author || 'Anonymous') + ' \u00b7 reason: ' + escHtml(reason) + '</div>' +
                '<div style="margin-bottom:8px;">' + escHtml(e.data.body || '') + '</div>' +
                '<button onclick="approvePost(\'' + e.id + '\')">Approve</button> ' +
                '<button onclick="removePost(\'' + e.id + '\')">Remove</button>' +
            '</div>';
    });

    flaggedReplies.forEach(function (e) {
        var reason = (e.data.moderation && e.data.moderation.reason) || 'n/a';
        html +=
            '<div style="border:1px solid #444;border-radius:6px;padding:10px;margin-bottom:10px;">' +
                '<div style="font-weight:bold;">[REPLY] on thread ' + escHtml(e.pid) + '</div>' +
                '<div style="opacity:0.75;margin:4px 0;">by ' + escHtml(e.data.author || 'Anonymous') + ' \u00b7 reason: ' + escHtml(reason) + '</div>' +
                '<div style="margin-bottom:8px;">' + escHtml(e.data.text || '') + '</div>' +
                '<button onclick="approveReply(\'' + e.pid + '\', \'' + e.rid + '\')">Approve</button> ' +
                '<button onclick="removeReply(\'' + e.pid + '\', \'' + e.rid + '\')">Remove</button>' +
            '</div>';
    });

    list.innerHTML = html;
}

function approvePost(id) {
    if (!isAdmin) return;
    db.ref('forum/posts/' + id).update({
        status: 'approved',
        'moderation/reviewedBy': currentUser.uid,
        'moderation/reviewedAt': firebase.database.ServerValue.TIMESTAMP
    });
}

function removePost(id) {
    if (!isAdmin) return;
    db.ref('forum/posts/' + id).remove();
    db.ref('forum/replies/' + id).remove();
}

function approveReply(pid, rid) {
    if (!isAdmin) return;
    db.ref('forum/replies/' + pid + '/' + rid).update({
        status: 'approved',
        'moderation/reviewedBy': currentUser.uid,
        'moderation/reviewedAt': firebase.database.ServerValue.TIMESTAMP
    });
}

function removeReply(pid, rid) {
    if (!isAdmin) return;
    db.ref('forum/replies/' + pid + '/' + rid).remove();
    db.ref('forum/posts/' + pid + '/replies').transaction(function (cur) {
        return Math.max(0, (cur || 0) - 1);
    });
}

// ──────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────
function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatTime(ts) {
    if (!ts) return '';
    var now  = Date.now();
    var diff = Math.floor((now - ts) / 1000);
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff / 60)   + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600)  + 'h ago';
    var d = new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function showToast(msg) {
    var t = document.getElementById('forum-toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3200);
}
