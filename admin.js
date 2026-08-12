// ============================================================
//  ADMIN DASHBOARD — CommForums
//  Standalone page, gated by a hardcoded ID/password.
//
//  IMPORTANT: this is a client-side-only gate. Anyone who views
//  this file's source (or your browser's dev tools) can see the
//  credentials below. It hides the dashboard from casual visitors;
//  it is NOT real access control. See README for details.
// ──────────────────────────────────────────────
var ADMIN_ID       = 'admin123';
var ADMIN_PASSWORD = 'nimda321';

// ──────────────────────────────────────────────
// STEP 1 — REPLACE WITH YOUR FIREBASE CONFIG
// (same config you used in script.js)
// ──────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyB_9JF7v-gMN4_q176PUgZjaGy6RjWhV4Y",
  authDomain: "commforums.firebaseapp.com",
  databaseURL: "https://commforums-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "commforums",
  storageBucket: "commforums.firebasestorage.app",
  messagingSenderId: "990280192388",
  appId: "1:990280192388:web:caa73c921e5a6abd13cdd1",
  measurementId: "G-933WGHKX6S"
};


firebase.initializeApp(firebaseConfig);
var db = firebase.database();

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
var allPosts   = {};
var allReplies = {};   // { postId: { replyId: replyData } }
var allUsers   = {};
var currentTab = 'queue';

// ──────────────────────────────────────────────
// Login gate
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    if (sessionStorage.getItem('cf_admin_authed') === '1') {
        showDashboard();
    }

    document.getElementById('adminPassInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') doAdminLogin();
    });
    document.getElementById('adminIdInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') doAdminLogin();
    });
});

function doAdminLogin() {
    var id  = document.getElementById('adminIdInput').value.trim();
    var pw  = document.getElementById('adminPassInput').value;
    var err = document.getElementById('adminLoginError');

    if (id === ADMIN_ID && pw === ADMIN_PASSWORD) {
        err.textContent = '';
        sessionStorage.setItem('cf_admin_authed', '1');
        showDashboard();
    } else {
        err.textContent = 'Incorrect ID or password.';
    }
}

function adminLogout() {
    sessionStorage.removeItem('cf_admin_authed');
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('adminLoginScreen').style.display = 'flex';
    document.getElementById('adminIdInput').value = '';
    document.getElementById('adminPassInput').value = '';
}

function showDashboard() {
    document.getElementById('adminLoginScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';
    attachListeners();
}

// ──────────────────────────────────────────────
// Realtime listeners
// ──────────────────────────────────────────────
var listenersAttached = false;
function attachListeners() {
    if (listenersAttached) return;
    listenersAttached = true;

    db.ref('forum/posts').on('value', function (snap) {
        allPosts = snap.val() || {};
        updateStats();
        renderCurrentTab();
    });

    db.ref('forum/replies').on('value', function (snap) {
        allReplies = snap.val() || {};
        updateStats();
        renderCurrentTab();
    });

    db.ref('users').on('value', function (snap) {
        allUsers = snap.val() || {};
        updateStats();
        renderCurrentTab();
    });
}

// ──────────────────────────────────────────────
// Stats
// ──────────────────────────────────────────────
function updateStats() {
    var postIds = Object.keys(allPosts);
    var replyCount = 0;
    var flaggedCount = 0;

    postIds.forEach(function (id) {
        if (allPosts[id].status === 'flagged') flaggedCount++;
    });

    Object.keys(allReplies).forEach(function (pid) {
        Object.keys(allReplies[pid]).forEach(function (rid) {
            replyCount++;
            if (allReplies[pid][rid].status === 'flagged') flaggedCount++;
        });
    });

    document.getElementById('statTotalPosts').textContent   = postIds.length;
    document.getElementById('statTotalReplies').textContent = replyCount;
    document.getElementById('statFlagged').textContent      = flaggedCount;
    document.getElementById('statTotalUsers').textContent   = Object.keys(allUsers).length;
}

// ──────────────────────────────────────────────
// Tabs
// ──────────────────────────────────────────────
function switchAdminTab(tab, btn) {
    currentTab = tab;
    document.querySelectorAll('.admin-tab').forEach(function (t) { t.classList.remove('active'); });
    btn.classList.add('active');

    document.getElementById('adminPanelQueue').style.display = tab === 'queue' ? 'block' : 'none';
    document.getElementById('adminPanelPosts').style.display = tab === 'posts' ? 'block' : 'none';
    document.getElementById('adminPanelUsers').style.display = tab === 'users' ? 'block' : 'none';

    renderCurrentTab();
}

function renderCurrentTab() {
    if (currentTab === 'queue') renderAdminQueue();
    else if (currentTab === 'posts') renderAdminPosts();
    else if (currentTab === 'users') renderAdminUsers();
}

// ──────────────────────────────────────────────
// Moderation Queue (flagged posts + flagged replies)
// ──────────────────────────────────────────────
function renderAdminQueue() {
    var list = document.getElementById('adminQueueList');

    var flaggedPosts = Object.keys(allPosts)
        .map(function (id) { return { id: id, data: allPosts[id] }; })
        .filter(function (e) { return e.data.status === 'flagged'; });

    var flaggedReplies = [];
    Object.keys(allReplies).forEach(function (pid) {
        Object.keys(allReplies[pid]).forEach(function (rid) {
            var r = allReplies[pid][rid];
            if (r.status === 'flagged') flaggedReplies.push({ pid: pid, rid: rid, data: r });
        });
    });

    if (flaggedPosts.length === 0 && flaggedReplies.length === 0) {
        list.innerHTML = '<div class="admin-empty">Nothing flagged right now. 🎉</div>';
        return;
    }

    var html = '';

    flaggedPosts.forEach(function (e) {
        var reason = (e.data.moderation && e.data.moderation.reason) || 'n/a';
        html +=
            '<div class="admin-row">' +
                '<div class="admin-row-top">' +
                    '<span class="admin-row-title">[POST] ' + escAdmin(e.data.subject || '(untitled)') + '</span>' +
                    '<span class="admin-status-pill admin-status-flagged">Flagged</span>' +
                '</div>' +
                '<div class="admin-row-meta">by ' + escAdmin(e.data.author || 'Anonymous') + ' · reason: ' + escAdmin(reason) + '</div>' +
                '<p class="admin-row-body">' + escAdmin(e.data.body || '') + '</p>' +
                '<div class="admin-row-actions">' +
                    '<button onclick="approvePost(\'' + e.id + '\')">Approve</button>' +
                    '<button class="danger" onclick="deletePost(\'' + e.id + '\')">Delete</button>' +
                '</div>' +
            '</div>';
    });

    flaggedReplies.forEach(function (e) {
        var reason = (e.data.moderation && e.data.moderation.reason) || 'n/a';
        var parentSubject = (allPosts[e.pid] && allPosts[e.pid].subject) || e.pid;
        html +=
            '<div class="admin-row">' +
                '<div class="admin-row-top">' +
                    '<span class="admin-row-title">[REPLY] on "' + escAdmin(parentSubject) + '"</span>' +
                    '<span class="admin-status-pill admin-status-flagged">Flagged</span>' +
                '</div>' +
                '<div class="admin-row-meta">by ' + escAdmin(e.data.author || 'Anonymous') + ' · reason: ' + escAdmin(reason) + '</div>' +
                '<p class="admin-row-body">' + escAdmin(e.data.text || '') + '</p>' +
                '<div class="admin-row-actions">' +
                    '<button onclick="approveReply(\'' + e.pid + '\', \'' + e.rid + '\')">Approve</button>' +
                    '<button class="danger" onclick="deleteReply(\'' + e.pid + '\', \'' + e.rid + '\')">Delete</button>' +
                '</div>' +
            '</div>';
    });

    list.innerHTML = html;
}

// ──────────────────────────────────────────────
// All Posts
// ──────────────────────────────────────────────
function renderAdminPosts() {
    var list = document.getElementById('adminPostsList');
    var filter = (document.getElementById('postsFilterInput').value || '').toLowerCase();

    var entries = Object.keys(allPosts)
        .map(function (id) { return { id: id, data: allPosts[id] }; })
        .filter(function (e) {
            if (!filter) return true;
            return (e.data.subject || '').toLowerCase().indexOf(filter) !== -1 ||
                   (e.data.author  || '').toLowerCase().indexOf(filter) !== -1;
        })
        .sort(function (a, b) { return (b.data.ts || 0) - (a.data.ts || 0); });

    if (entries.length === 0) {
        list.innerHTML = '<div class="admin-empty">No posts match.</div>';
        return;
    }

    var html = '';
    entries.forEach(function (e) {
        var isFlagged = e.data.status === 'flagged';
        var pillClass = isFlagged ? 'admin-status-flagged' : 'admin-status-approved';
        var pillLabel = isFlagged ? 'Flagged' : 'Approved';
        var replyCount = e.data.replies || 0;

        html +=
            '<div class="admin-row">' +
                '<div class="admin-row-top">' +
                    '<span class="admin-row-title">' + escAdmin(e.data.subject || '(untitled)') + '</span>' +
                    '<span class="admin-status-pill ' + pillClass + '">' + pillLabel + '</span>' +
                '</div>' +
                '<div class="admin-row-meta">by ' + escAdmin(e.data.author || 'Anonymous') +
                    ' · ' + escAdmin(e.data.category || '') +
                    ' · score ' + (e.data.score || 0) +
                    ' · ' + replyCount + ' repl' + (replyCount === 1 ? 'y' : 'ies') + '</div>' +
                '<p class="admin-row-body">' + escAdmin(e.data.body || '') + '</p>' +
                '<div class="admin-row-actions">' +
                    (isFlagged
                        ? '<button onclick="approvePost(\'' + e.id + '\')">Approve</button>'
                        : '<button class="neutral" onclick="flagPost(\'' + e.id + '\')">Flag</button>') +
                    '<button class="danger" onclick="deletePost(\'' + e.id + '\')">Delete</button>' +
                '</div>' +
            '</div>';
    });

    list.innerHTML = html;
}

// ──────────────────────────────────────────────
// Users
// ──────────────────────────────────────────────
function renderAdminUsers() {
    var list = document.getElementById('adminUsersList');
    var filter = (document.getElementById('usersFilterInput').value || '').toLowerCase();

    var entries = Object.keys(allUsers)
        .map(function (uid) { return { uid: uid, data: allUsers[uid] }; })
        .filter(function (e) {
            if (!filter) return true;
            return (e.data.username || '').toLowerCase().indexOf(filter) !== -1 ||
                   (e.data.email    || '').toLowerCase().indexOf(filter) !== -1;
        })
        .sort(function (a, b) { return (b.data.joinedAt || 0) - (a.data.joinedAt || 0); });

    if (entries.length === 0) {
        list.innerHTML = '<div class="admin-empty">No users match.</div>';
        return;
    }

    var html = '';
    entries.forEach(function (e) {
        var isAdmin = e.data.isAdmin === true;
        html +=
            '<div class="admin-row">' +
                '<div class="admin-row-top">' +
                    '<span class="admin-row-title">' + escAdmin(e.data.username || 'Unknown') + '</span>' +
                    (isAdmin ? '<span class="admin-status-pill admin-status-approved">Admin</span>' : '') +
                '</div>' +
                '<div class="admin-row-meta">' + escAdmin(e.data.email || '') + ' · uid: ' + escAdmin(e.uid) + '</div>' +
                '<div class="admin-row-actions">' +
                    (isAdmin
                        ? '<button class="neutral" onclick="toggleAdmin(\'' + e.uid + '\', true)">Revoke Admin</button>'
                        : '<button onclick="toggleAdmin(\'' + e.uid + '\', false)">Grant Admin</button>') +
                '</div>' +
            '</div>';
    });

    list.innerHTML = html;
}

// ──────────────────────────────────────────────
// Actions
// ──────────────────────────────────────────────
function approvePost(id) {
    db.ref('forum/posts/' + id).update({ status: 'approved' });
    showAdminToast('Post approved.');
}
function flagPost(id) {
    db.ref('forum/posts/' + id).update({ status: 'flagged' });
    showAdminToast('Post flagged.');
}
function deletePost(id) {
    if (!confirm('Delete this post and all its replies? This cannot be undone.')) return;
    db.ref('forum/posts/' + id).remove();
    db.ref('forum/replies/' + id).remove();
    showAdminToast('Post deleted.');
}

function approveReply(pid, rid) {
    db.ref('forum/replies/' + pid + '/' + rid).update({ status: 'approved' });
    showAdminToast('Reply approved.');
}
function deleteReply(pid, rid) {
    if (!confirm('Delete this reply? This cannot be undone.')) return;
    db.ref('forum/replies/' + pid + '/' + rid).remove();
    db.ref('forum/posts/' + pid + '/replies').transaction(function (cur) {
        return Math.max(0, (cur || 0) - 1);
    });
    showAdminToast('Reply deleted.');
}

function toggleAdmin(uid, currentlyAdmin) {
    db.ref('users/' + uid + '/isAdmin').set(!currentlyAdmin);
    showAdminToast(currentlyAdmin ? 'Admin access revoked.' : 'Admin access granted.');
}

// ──────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────
function escAdmin(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showAdminToast(msg) {
    var t = document.getElementById('admin-toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2600);
}
