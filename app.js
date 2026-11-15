import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  updateProfile,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  deleteDoc,
  collection,
  serverTimestamp,
  query,
  where,
  getDocs,
  orderBy,
  onSnapshot,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const APP_NAME = 'CodeTrack';
const ADMIN_EMAIL = 'eswarvenky08@gmail.com';
const STORAGE_KEY = 'codeTrackLocalStore';

const firebaseConfig = {
  apiKey: 'AIzaSyDUKKDS-WNvr7K9G_719JQUloinZl_71r8',
  authDomain: 'my-ae-b4bf9.firebaseapp.com',
  projectId: 'my-ae-b4bf9',
  storageBucket: 'my-ae-b4bf9.firebasestorage.app',
  messagingSenderId: '1046126070915',
  appId: '1:1046126070915:web:d9de4654ddb52b66a51fb6',
};

const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => value && !value.includes('YOUR_')
);

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
const db = isFirebaseConfigured ? getFirestore(app) : null;
const auth = isFirebaseConfigured ? getAuth(app) : null;

window.CodeTrackFirebaseDiagnostics = {
  configSource: 'app.js',
  projectId: firebaseConfig.projectId,
  appInitialized: Boolean(app),
  authInitialized: Boolean(auth),
  authUsesSameApp: Boolean(auth && app && auth.app === app),
  authKeyMatchesConfig: Boolean(auth && app && auth.app.options.apiKey === firebaseConfig.apiKey),
  apiKeyLength: firebaseConfig.apiKey.length,
  apiKeySuffix: firebaseConfig.apiKey.slice(-4),
};

const state = {
  currentPage: 'dashboard',
  currentSectionId: null,
  currentTaskId: null,
  currentTab: 'overview',
  user: null,
  profile: null,
  sections: [],
  allSections: [],
  tasks: [],
  allTasks: [],
  bookmarks: [],
  students: [],
  directoryUsers: [],
  sharedSections: [],
  sharedTasks: [],
  incomingShares: [],
  localStore: loadLocalStore(),
  codeEditors: {},
};

const pageMap = {
  dashboard: document.getElementById('dashboardPage'),
  sections: document.getElementById('sectionsPage'),
  tasks: document.getElementById('tasksPage'),
  revisions: document.getElementById('revisionsPage'),
  bookmarks: document.getElementById('bookmarksPage'),
  profile: document.getElementById('profilePage'),
  admin: document.getElementById('adminPage'),
  shared: document.getElementById('sharedPage'),
  sectionDetail: document.getElementById('sectionDetailPage'),
  taskDetail: document.getElementById('taskDetailPage'),
};

document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  bindUI();
  setupAuthFlow();
  renderPageState();
  if (isFirebaseConfigured) {
    listenAuthState();
  } else {
    loadLocalProfile();
  }
}

function bindUI() {
  document.querySelectorAll('.nav-item[data-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.page;
      if (page === 'admin' && state.profile && !state.profile.isAdmin) {
        showToast('Access denied: administrator privileges required.');
        return;
      }
      navigateTo(page);
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('quickCreateTaskBtn').addEventListener('click', () => openTaskModal());
  document.getElementById('quickCreateSectionBtn').addEventListener('click', () => openSectionModal());

  const setAuthMode = (mode) => {
    document.querySelectorAll('.auth-form').forEach((form) => form.classList.toggle('active', form.id === `${mode}Form`));
    document.querySelectorAll('.auth-mode').forEach((modeButton) => {
      modeButton.classList.toggle('active', modeButton.dataset.authMode === mode);
    });
  };

  document.querySelectorAll('.auth-mode').forEach((button) => {
    button.addEventListener('click', () => setAuthMode(button.dataset.authMode));
  });

  document.querySelectorAll('[data-guest-auth]').forEach((button) => {
    button.addEventListener('click', () => {
      setAuthMode(button.dataset.guestAuth);
      document.getElementById('authPage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!email || !password) {
      showToast('Please complete both email and password fields.');
      return;
    }

    if (isFirebaseConfigured) {
      try {
        await signInWithEmailAndPassword(auth, email, password);
      } catch (error) {
        showToast(getFirebaseErrorMessage(error, 'Unable to sign in.', 'Authentication sign-in (Identity Toolkit)'), 9000);
      }
      return;
    }

    const user = findLocalUserByEmail(email);
    if (!user || user.password !== password) {
      showToast('Invalid demo credentials. Use the registered account or sign up first.');
      return;
    }

    state.user = { uid: user.uid, email: user.email, displayName: user.name };
    state.profile = user;
    persistLocalSession(state.user.uid);
    renderApp();
  });

  document.getElementById('registerForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('registerName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const phone = document.getElementById('registerPhone').value.trim();

    if (!name || !email || !password) {
      showToast('Please provide name, email and a password.');
      return;
    }

    if (password.length < 6) {
      showToast('Password must be at least 6 characters long.');
      return;
    }

    if (isFirebaseConfigured) {
      let registrationStage = 'Authentication sign-up (Identity Toolkit)';
      try {
        const response = await createUserWithEmailAndPassword(auth, email, password);
        registrationStage = 'Firebase Auth profile update';
        await updateProfile(response.user, { displayName: name });
        const profile = {
          uid: response.user.uid,
          name,
          email,
          phone,
          createdAt: new Date().toISOString(),
          isAdmin: email.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
        };
        registrationStage = 'Firestore user profile write';
        await setDoc(doc(db, 'users', response.user.uid), profile);
        registrationStage = 'Firestore directory write';
        await syncDirectory(response.user, profile);
        state.profile = profile;
        showToast('Registration successful. You are now signed in.');
      } catch (error) {
        showToast(getFirebaseErrorMessage(error, 'Unable to create account.', registrationStage), 9000);
      }
      return;
    }

    const uid = `local-${Date.now()}`;
    const existing = findLocalUserByEmail(email);
    if (existing) {
      showToast('This email is already registered in local demo mode.');
      return;
    }

    const userProfile = {
      uid,
      name,
      email,
      phone,
      password,
      createdAt: new Date().toISOString(),
      isAdmin: email.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
    };

    const store = loadLocalStore();
    store.users = store.users || [];
    store.users.push(userProfile);
    saveLocalStore(store);

    state.user = { uid, email, displayName: name };
    state.profile = userProfile;
    await syncDirectory(state.user, userProfile);
    persistLocalSession(uid);
    renderApp();
    showToast('Registration successful.');
  });

  document.getElementById('forgotPasswordBtn').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    if (!email) {
      showToast('Enter your email address to receive a reset link.');
      return;
    }

    if (isFirebaseConfigured) {
      try {
        await sendPasswordResetEmail(auth, email);
        showToast('Password reset link sent.');
      } catch (error) {
        showToast(getFirebaseErrorMessage(error, 'Unable to send reset email.', 'Authentication password reset (Identity Toolkit)'), 9000);
      }
      return;
    }

    const user = findLocalUserByEmail(email);
    if (!user) {
      showToast('No local account found for that email.');
      return;
    }

    showToast('Demo mode: use the registered password for login.');
  });

  document.getElementById('sectionForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const sectionId = document.getElementById('sectionId').value;
    const title = document.getElementById('sectionTitle').value.trim();
    const description = document.getElementById('sectionDescription').value.trim();
    const category = document.getElementById('sectionCategory').value.trim();
    const dailyTaskTarget = Number(document.getElementById('sectionDailyTarget').value);

    if (!title || !description || !category || !Number.isInteger(dailyTaskTarget) || dailyTaskTarget < 1 || dailyTaskTarget > 100) {
      showToast('Enter the section details and a daily target between 1 and 100.');
      return;
    }

    try {
      if (sectionId) {
        await updateSection(sectionId, { title, description, category, dailyTaskTarget });
        showToast('Section updated.');
      } else {
        await createSection({ title, description, category, dailyTaskTarget });
        showToast('Section created.');
      }
    } catch (error) {
      showToast(getFirebaseErrorMessage(error, 'Unable to save section.', 'Firestore section save'), 9000);
      return;
    }

    closeModal('sectionModal');
    await renderApp();
  });

  document.getElementById('taskForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = readTaskForm();
    if (!formData.whatDone || !formData.sectionId || !formData.doneOn || !formData.sourceName) {
      showToast('Date, what you did, source, and section are required.');
      return;
    }
    const section = getSectionById(formData.sectionId);
    if (section && section.uid && section.uid !== state.user?.uid) {
      showToast('Shared sections are read only.');
      return;
    }

    try {
      if (formData.taskId) {
        await updateTask(formData.taskId, formData);
        showToast('Task updated.');
      } else {
        await createTask(formData);
        showToast('Task created.');
      }
    } catch (error) {
      showToast(getFirebaseErrorMessage(error, 'Unable to save task.', 'Firestore task save'), 9000);
      return;
    }

    closeModal('taskModal');
    await renderApp();
  });

  document.querySelectorAll('input[name="taskComponents"]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      updateTaskTypePanels();
    });
  });

  document.getElementById('taskForm').addEventListener('reset', () => {
    window.setTimeout(updateTaskTypePanels, 0);
  });

  document.addEventListener('click', (event) => {
    if (event.target.matches('[data-page-link]')) {
      const page = event.target.dataset.pageLink;
      navigateTo(page);
    }
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.dataset.closeModal;
      closeModal(modalId);
    });
  });

  document.addEventListener('submit', async (event) => {
    if (event.target?.id !== 'profileForm') return;
    await handleProfileSubmit(event);
  });

  document.addEventListener('click', async (event) => {
    const tabButton = event.target.closest('[data-task-tab]');
    if (tabButton) {
      state.currentTab = tabButton.dataset.taskTab;
      renderTaskDetail();
      return;
    }

    const resetPasswordButton = event.target.closest('#resetPasswordBtn');
    if (resetPasswordButton) {
      event.preventDefault();
      await sendCurrentUserPasswordReset();
      return;
    }

    const openTaskButton = event.target.closest('[data-open-task]');
    if (openTaskButton) {
      const taskId = openTaskButton.dataset.openTask;
      navigateTo('taskDetail', taskId);
      return;
    }

    const editTaskButton = event.target.closest('[data-edit-task]');
    if (editTaskButton) {
      const taskId = editTaskButton.dataset.editTask;
      openTaskModal(taskId);
      return;
    }

    const deleteTaskButton = event.target.closest('[data-delete-task]');
    if (deleteTaskButton) {
      await deleteTask(deleteTaskButton.dataset.deleteTask);
      return;
    }

    const deleteSectionButton = event.target.closest('[data-delete-section]');
    if (deleteSectionButton) {
      await deleteSection(deleteSectionButton.dataset.deleteSection);
      return;
    }

    const editSectionButton = event.target.closest('[data-edit-section]');
    if (editSectionButton) {
      const section = getSectionById(editSectionButton.dataset.editSection);
      if (!isOwnRecord(section)) {
        showToast('Shared sections are read only.');
        return;
      }
      openSectionModal(section.id);
      return;
    }

    const openSectionButton = event.target.closest('[data-open-section]');
    if (openSectionButton) {
      const sectionId = openSectionButton.dataset.openSection;
      navigateTo('sectionDetail', sectionId);
      return;
    }

    const bookmarkButton = event.target.closest('[data-bookmark-task]');
    if (bookmarkButton) {
      const taskId = bookmarkButton.dataset.bookmarkTask;
      await toggleBookmark(taskId);
      return;
    }

    const saveCodeButton = event.target.closest('[data-save-code]');
    if (saveCodeButton) {
      const taskId = saveCodeButton.dataset.saveCode;
      syncEditorValue('detailCodeEditor');
      const code = document.getElementById('detailCodeEditor')?.value || '';
      try {
        await updateTask(taskId, { code });
        showToast('Code saved.');
        renderTaskDetail();
      } catch (error) {
        showToast(getFirebaseErrorMessage(error, 'Unable to save code.', 'Firestore task update'), 9000);
      }
      return;
    }

    const studentRow = event.target.closest('[data-admin-student]');
    if (studentRow) {
      const uid = studentRow.dataset.adminStudent;
      renderStudentAdminDetail(uid);
      return;
    }

    const markRevisedButton = event.target.closest('[data-mark-revised]');
    if (markRevisedButton) {
      const taskId = markRevisedButton.dataset.markRevised;
      const task = getTaskById(taskId);
      if (!task || (task.uid && task.uid !== state.user?.uid)) {
        showToast('Shared updates are read only.');
        return;
      }
      const ladder = ['Not Started', 'First Revision', 'Second Revision', 'Mastered'];
      const currentIndex = Math.max(0, ladder.indexOf(task.revisionStatus || 'Not Started'));
      const nextStatus = ladder[Math.min(currentIndex + 1, ladder.length - 1)];
      try {
        await updateTask(taskId, {
          revisionStatus: nextStatus,
          status: nextStatus === 'Mastered' ? 'Completed' : 'Pending',
          revisionHistory: [
            ...(task.revisionHistory || []),
            {
              date: new Date().toISOString(),
              notes: `Moved to ${nextStatus}.`,
            },
          ],
        });
        showToast(`Revision updated to ${nextStatus}.`);
        await renderApp();
      } catch (error) {
        showToast(getFirebaseErrorMessage(error, 'Unable to update revision.', 'Firestore task update'), 9000);
      }
      return;
    }

    const shareButton = event.target.closest('[data-share-section]');
    if (shareButton) {
      const sectionId = shareButton.dataset.shareSection;
      const email = document.getElementById(`shareUser-${sectionId}`)?.value.trim() || '';
      await shareSectionWithEmail(sectionId, email);
      return;
    }

    const stopShareButton = event.target.closest('[data-stop-share]');
    if (stopShareButton) {
      await stopSectionShare(stopShareButton.dataset.stopShare, stopShareButton.dataset.recipientUid);
    }
  });
}

async function handleProfileSubmit(event) {
  event.preventDefault();
  if (!state.user) return;

  const name = document.getElementById('profileName').value.trim();
  const phone = document.getElementById('profilePhone').value.trim();

  if (!name) {
    showToast('Name is required.');
    return;
  }

  const updatedProfile = {
    ...state.profile,
    uid: state.user.uid,
    name,
    phone,
    email: state.profile?.email || state.user.email || '',
    isAdmin: Boolean(state.profile?.isAdmin),
  };

  try {
    if (isFirebaseConfigured && auth.currentUser) {
      await updateProfile(auth.currentUser, { displayName: name });
    }
    await saveUserProfile(updatedProfile);
    await syncDirectory(state.user, updatedProfile);
    state.profile = updatedProfile;
    await renderApp();
    showToast('Profile updated.');
  } catch (error) {
    showToast(getFirebaseErrorMessage(error, 'Unable to update profile.', 'Firestore profile update'), 9000);
  }
}

async function sendCurrentUserPasswordReset() {
  const email = state.profile?.email || state.user?.email;
  if (!email) {
    showToast('No email available for reset.');
    return;
  }
  if (isFirebaseConfigured) {
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('Password reset email sent.');
    } catch (error) {
      showToast(getFirebaseErrorMessage(error, 'Password reset failed.', 'Authentication password reset (Identity Toolkit)'), 9000);
    }
  } else {
    showToast('Demo mode: use your registered password to sign in.');
  }
}

function setupAuthFlow() {
  if (isFirebaseConfigured) {
    document.getElementById('authPage').classList.add('active');
    return;
  }

  document.getElementById('authPage').classList.add('active');
}

function listenAuthState() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.user = user;
      try {
        await ensureProfileForUser(user);
        await renderApp();
      } catch (error) {
        state.profile = null;
        showToast(getFirebaseErrorMessage(error, 'Unable to load your account profile.', 'Firestore profile load'), 9000);
        await renderApp();
      }
    } else {
      state.user = null;
      state.profile = null;
      await renderApp();
    }
  });
}

async function ensureProfileForUser(user) {
  if (!db || !user) return;
  const uid = user.uid;
  const email = user.email || '';
  const shouldBeAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
  const profileDoc = await getDoc(doc(db, 'users', uid));

  if (!profileDoc.exists()) {
    const profile = {
      uid,
      name: user.displayName || (shouldBeAdmin ? 'Admin' : 'Student'),
      email,
      createdAt: new Date().toISOString(),
      isAdmin: shouldBeAdmin,
      phone: '',
    };
    await setDoc(doc(db, 'users', uid), profile);
    await syncDirectory(user, profile);
    state.profile = profile;
    return;
  }

  const profile = profileDoc.data();
  if (shouldBeAdmin && profile.isAdmin !== true) {
    profile.isAdmin = true;
    profile.email = email || profile.email;
    await setDoc(doc(db, 'users', uid), { isAdmin: true, email: profile.email, uid }, { merge: true });
  }
  await syncDirectory(user, profile);
  state.profile = profile;
}

async function syncDirectory(user, profile) {
  const email = (user?.email || profile?.email || '').trim().toLowerCase();
  if (!email || !user?.uid) return;
  const entry = {
    uid: user.uid,
    email,
    name: profile?.name || user.displayName || '',
  };
  if (isFirebaseConfigured) {
    await setDoc(doc(db, 'directory', email), entry, { merge: true });
    return;
  }
  const store = loadLocalStore();
  store.directory = store.directory || {};
  store.directory[email] = entry;
  saveLocalStore(store);
}

async function loadLocalProfile() {
  const sessionUid = localStorage.getItem('codeTrackSessionUid');
  if (!sessionUid) {
    state.user = null;
    state.profile = null;
    renderApp();
    return;
  }

  const store = loadLocalStore();
  const user = (store.users || []).find((entry) => entry.uid === sessionUid);
  if (!user) {
    localStorage.removeItem('codeTrackSessionUid');
    state.user = null;
    state.profile = null;
    renderApp();
    return;
  }

  state.user = { uid: user.uid, email: user.email, displayName: user.name };
  state.profile = user;
  renderApp();
}

async function renderApp() {
  const isAuthenticated = Boolean(state.user && state.profile);
  const user = state.user;
  const authPage = document.getElementById('authPage');
  const appShell = document.getElementById('appShell');

  appShell.classList.toggle('signed-in', isAuthenticated);
  authPage.classList.toggle('hidden', isAuthenticated);

  document.querySelectorAll('.admin-only').forEach((item) => {
    item.classList.toggle('hidden', !(state.profile && state.profile.isAdmin));
  });

  document.getElementById('logoutBtn').style.display = isAuthenticated ? 'flex' : 'none';
  document.getElementById('quickCreateTaskBtn').style.display = isAuthenticated ? 'inline-flex' : 'none';
  document.getElementById('quickCreateSectionBtn').style.display = isAuthenticated ? 'inline-flex' : 'none';

  if (isAuthenticated) {
    const sessionName = state.profile.name || state.user.displayName || 'Student';
    const sessionEmail = state.profile.email || state.user.email || 'No email';
    document.getElementById('userAvatar').textContent = sessionName.charAt(0).toUpperCase();
    document.getElementById('userNameBadge').textContent = sessionName;
    document.getElementById('userEmailBadge').textContent = sessionEmail;
  } else {
    document.getElementById('userAvatar').textContent = 'U';
    document.getElementById('userNameBadge').textContent = 'Guest';
    document.getElementById('userEmailBadge').textContent = 'No session';
  }

  if (!isAuthenticated) {
    document.querySelectorAll('.page').forEach((page) => {
      page.classList.toggle('active', page.id === 'authPage');
    });
    document.getElementById('pageTitle').textContent = 'Sign in';
    document.getElementById('topbarEyebrow').textContent = 'CodeTrack';
    return;
  }

  await refreshData();
  if (state.user !== user) return;
  renderPageState();
  renderAllPages();
  navigateTo(state.currentPage, state.currentSectionId || state.currentTaskId);
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}

function renderPageState() {
  const pageTitle = document.getElementById('pageTitle');
  const eyebrow = document.getElementById('topbarEyebrow');
  const labels = {
    dashboard: ['Welcome back', 'Dashboard'],
    sections: ['Learning space', 'My Sections'],
    tasks: ['Daily log', 'Daily updates'],
    shared: ['Read only', 'Shared with me'],
    revisions: ['Come back later', 'Revision List'],
    bookmarks: ['Saved updates', 'Bookmarks'],
    profile: ['Your account', 'Profile'],
    admin: ['System access', 'Admin Panel'],
    sectionDetail: ['Section overview', 'Section Details'],
    taskDetail: ['Task insight', 'Task Details'],
  };

  const [label, title] = labels[state.currentPage] || ['Welcome back', 'Dashboard'];
  pageTitle.textContent = title;
  eyebrow.textContent = label;
}

function navigateTo(page, objectId = null) {
  state.currentPage = page;
  if (page === 'sectionDetail') {
    state.currentSectionId = objectId;
    state.currentTaskId = null;
  } else if (page === 'taskDetail') {
    state.currentTaskId = objectId;
    state.currentSectionId = null;
  } else {
    state.currentSectionId = null;
    state.currentTaskId = null;
  }

  Object.entries(pageMap).forEach(([key, element]) => {
    const active = key === page;
    element.classList.toggle('active', active);
    if (page === 'dashboard' && key === 'dashboard') {
      element.classList.add('active');
    }
  });

  document.querySelectorAll('.nav-item[data-page]').forEach((button) => {
    button.classList.toggle('active', button.dataset.page === page);
  });

  renderPageState();

  switch (page) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'sections':
      renderSectionsPage();
      break;
    case 'tasks':
      renderTasksPage();
      break;
    case 'shared':
      renderSharedPage();
      break;
    case 'revisions':
      renderRevisionsPage();
      break;
    case 'bookmarks':
      renderBookmarksPage();
      break;
    case 'profile':
      renderProfilePage();
      break;
    case 'admin':
      renderAdminPage();
      break;
    case 'sectionDetail':
      renderSectionDetailPage();
      break;
    case 'taskDetail':
      renderTaskDetail();
      break;
    default:
      renderDashboard();
      break;
  }
}

async function refreshData() {
  if (!state.user) {
    state.sections = [];
    state.allSections = [];
    state.tasks = [];
    state.allTasks = [];
    state.bookmarks = [];
    state.directoryUsers = [];
    return;
  }

  if (isFirebaseConfigured) {
    await loadFirestoreState();
    return;
  }

  const store = loadLocalStore();
  state.allSections = (store.sections || []).map((section) => ({ ...section }));
  state.allTasks = (store.tasks || []).map((task) => normalizeTask(task));
  state.sections = state.allSections.filter((section) => section.uid === state.user.uid);
  state.tasks = state.allTasks.filter((task) => task.uid === state.user.uid);
  state.bookmarks = (store.bookmarks || []).filter((bookmark) => bookmark.uid === state.user.uid);
  const localDirectory = new Map((store.users || []).map((person) => [person.uid, {
    uid: person.uid,
    email: person.email || '',
    name: person.name || person.email || '',
  }]));
  Object.values(store.directory || {}).forEach((person) => {
    if (person.uid) {
      localDirectory.set(person.uid, {
        uid: person.uid,
        email: person.email || '',
        name: person.name || person.email || '',
      });
    }
  });
  state.directoryUsers = [...localDirectory.values()].filter((person) => person.uid !== state.user.uid);
  state.students = (store.users || []).map((entry) => ({ ...entry }));
  loadLocalSharedContent(store);
  }

async function loadFirestoreState() {
  if (!db || !state.user) return;

  try {
    const uid = state.user.uid;
    const [sectionsSnapshot, tasksSnapshot, bookmarksSnapshot, directorySnapshot] = await Promise.all([
      getDocs(collection(db, 'users', uid, 'sections')),
      getDocs(collection(db, 'users', uid, 'tasks')),
      getDocs(collection(db, 'users', uid, 'bookmarks')),
      getDocs(collection(db, 'directory')).catch((error) => {
        showToast(getFirebaseErrorMessage(error, 'Could not load registered users. Check that the current Firestore rules are published.', 'Firestore directory list'), 9000);
        return null;
      }),
    ]);

    const ownSections = sectionsSnapshot.docs.map((item) => fromSnapshot(item, uid));
    const ownTasks = tasksSnapshot.docs.map((item) => normalizeTask(fromSnapshot(item, uid)));
    state.sections = ownSections;
    state.tasks = ownTasks;
    state.bookmarks = bookmarksSnapshot.docs.map((item) => fromSnapshot(item, uid));
    state.directoryUsers = (directorySnapshot?.docs || [])
      .map((item) => item.data())
      .filter((person) => person.uid && person.uid !== uid)
      .map((person) => ({
        uid: person.uid,
        email: person.email || '',
        name: person.name || person.email || '',
      }));
    state.allSections = [...ownSections];
    state.allTasks = [...ownTasks];
    state.students = state.profile ? [{ id: uid, ...state.profile }] : [];

    if (state.profile?.isAdmin) {
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const students = usersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      const otherStudents = students.filter((student) => student.uid !== uid && student.id !== uid);
      const otherData = await Promise.all(otherStudents.map(async (student) => {
        const studentUid = student.uid || student.id;
        const [studentSections, studentTasks] = await Promise.all([
          getDocs(collection(db, 'users', studentUid, 'sections')),
          getDocs(collection(db, 'users', studentUid, 'tasks')),
        ]);
        return {
          sections: studentSections.docs.map((item) => fromSnapshot(item, studentUid)),
          tasks: studentTasks.docs.map((item) => normalizeTask(fromSnapshot(item, studentUid))),
        };
      }));

      state.students = students;
      state.allSections = [...ownSections, ...otherData.flatMap((item) => item.sections)];
      state.allTasks = [...ownTasks, ...otherData.flatMap((item) => item.tasks)];
    }

    await loadSharedContent();
  } catch (error) {
    showToast(getFirebaseErrorMessage(error, 'Could not load Firestore data.', 'Firestore data load'), 9000);
  }
}

function cleanFirestoreData(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanFirestoreData(item)).filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const cleaned = {};
    Object.entries(value).forEach(([key, entry]) => {
      if (entry === undefined) return;
      const next = cleanFirestoreData(entry);
      if (next !== undefined) cleaned[key] = next;
    });
    return cleaned;
  }
  return value;
}

function firestorePayload(data) {
  const cleaned = cleanFirestoreData({ ...data });
  delete cleaned.id;
  delete cleaned.taskId;
  delete cleaned.password;
  return cleaned;
}

function fromSnapshot(item, uid) {
  const data = item.data();
  return { ...data, id: item.id, uid: data.uid || uid };
}

function rememberItem(list, item) {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

async function saveUserProfile(profile) {
  if (!state.user) return;

  const payload = firestorePayload({
    ...profile,
    uid: state.user.uid,
    isAdmin: Boolean(profile.isAdmin),
  });

  if (isFirebaseConfigured) {
    await setDoc(doc(db, 'users', state.user.uid), payload, { merge: true });
    return;
  }

  const store = loadLocalStore();
  store.users = store.users || [];
  const index = store.users.findIndex((entry) => entry.uid === state.user.uid);
  if (index >= 0) {
    store.users[index] = { ...store.users[index], ...profile, uid: state.user.uid };
  } else {
    store.users.push({ ...profile, uid: state.user.uid });
  }
  saveLocalStore(store);
}

function loadLocalStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"users":[],"sections":[],"tasks":[],"bookmarks":[]}');
  } catch (error) {
    return { users: [], sections: [], tasks: [], bookmarks: [] };
  }
}

function saveLocalStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function persistLocalSession(uid) {
  localStorage.setItem('codeTrackSessionUid', uid);
}

function findLocalUserByEmail(email) {
  const store = loadLocalStore();
  return (store.users || []).find((user) => user.email.toLowerCase() === email.toLowerCase());
}

function normalizeTask(task) {
  if (!task) return task;
  const normalized = { ...task };
  normalized.whatDone = task.whatDone || task.title || '';
  normalized.title = normalized.whatDone;
  normalized.sourceName = task.sourceName || task.platformName || '';
  normalized.sourceUrl = task.sourceUrl || task.platformUrl || '';
  normalized.details = task.details || task.description || task.notes || '';
  normalized.doneOn = task.doneOn || (task.createdAt ? String(task.createdAt).slice(0, 10) : '');
  normalized.sharedWith = Array.isArray(task.sharedWith) ? task.sharedWith : [];
  normalized.tags = Array.isArray(task.tags)
    ? task.tags
    : typeof task.tags === 'string'
      ? task.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
  normalized.components = getTaskComponents(task);
  return normalized;
}

function getTaskComponents(task) {
  if (Array.isArray(task.components) && task.components.length) {
    return task.components;
  }

  const legacyComponents = {
    description_only: ['description'],
    coding_problem: ['problem'],
    code_solution: ['code'],
    external_platform: ['platform'],
    notes_theory: ['notes'],
    complete_coding_task: ['description', 'problem', 'code', 'platform', 'notes'],
  };
  return legacyComponents[task.taskType] || ['description'];
}

function getLegacyTaskType(components) {
  if (components.length === 1) {
    const componentTypes = {
      description: 'description_only',
      problem: 'coding_problem',
      code: 'code_solution',
      platform: 'external_platform',
      notes: 'notes_theory',
    };
    return componentTypes[components[0]] || 'description_only';
  }
  if (components.includes('problem') && components.includes('code')) {
    return 'complete_coding_task';
  }
  return components.length ? components.join('_') : 'description_only';
}

function getLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentUserSections() {
  return state.sections.filter((section) => section.uid === state.user.uid);
}

function getTaskById(taskId) {
  return [...state.tasks, ...state.sharedTasks].find((task) => task.id === taskId || task.taskId === taskId);
}

function getSectionById(sectionId) {
  return [...state.sections, ...state.sharedSections].find((section) => section.id === sectionId || section.sectionId === sectionId);
}

function isOwnRecord(record) {
  return Boolean(record && state.user && record.uid === state.user.uid);
}

function taskLabel(task) {
  return task?.whatDone || task?.title || 'Untitled update';
}

function taskSourceLabel(task) {
  return task?.sourceName || task?.platformName || 'No source';
}

function taskDateLabel(task) {
  return task?.doneOn || (task?.createdAt ? String(task.createdAt).slice(0, 10) : '');
}

function getAllTasksForCurrentUser() {
  return state.tasks.filter((task) => task.uid === state.user.uid);
}

function getCompletedCount(tasks) {
  return tasks.filter((task) => (task.status || '').toLowerCase() === 'completed').length;
}

function getPendingCount(tasks) {
  return tasks.filter((task) => (task.status || '').toLowerCase() !== 'completed').length;
}

function taskFieldsFromInput(data) {
  const components = Array.isArray(data.components) ? data.components : [];
  const fields = {
    sectionId: data.sectionId || '',
    sectionTitle: data.sectionTitle || getSectionById(data.sectionId)?.title || 'General',
    title: data.whatDone || data.title || '',
    shortDescription: data.shortDescription || data.details || data.sourceName || '',
    description: data.details || data.description || '',
    difficulty: data.difficulty || 'Easy',
    priority: data.priority || 'Medium',
    status: data.status || 'Pending',
    revisionDate: data.revisionDate || '',
    taskType: data.taskType || getLegacyTaskType(components),
    components,
    notes: data.notes || '',
    code: data.code || '',
    problemStatement: data.problemStatement || '',
    inputFormat: data.inputFormat || '',
    outputFormat: data.outputFormat || '',
    constraints: data.constraints || '',
    sampleInput: data.sampleInput || '',
    sampleOutput: data.sampleOutput || '',
    programmingLanguage: data.programmingLanguage || '',
    codeEditor: data.codeEditor || '',
    solutionExplanation: data.solutionExplanation || '',
    importantConcepts: data.importantConcepts || '',
    keyPoints: data.keyPoints || '',
    platformName: data.platformName || '',
    platformUrl: data.platformUrl || '',
    platformId: data.platformId || '',
    doneOn: data.doneOn || '',
    whatDone: data.whatDone || data.title || '',
    sourceName: data.sourceName || '',
    sourceUrl: data.sourceUrl || '',
    details: data.details || data.description || '',
    sharedWith: Array.isArray(data.sharedWith) ? data.sharedWith : [],
    revisionStatus: data.revisionStatus || 'Not Started',
    nextRevisionDate: data.nextRevisionDate || '',
    revisionNotes: data.revisionNotes || '',
    tags: Array.isArray(data.tags)
      ? data.tags
      : typeof data.tags === 'string'
        ? data.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
        : [],
  };
  if (Array.isArray(data.revisionHistory)) fields.revisionHistory = data.revisionHistory;
  if (typeof data.bookmarked === 'boolean') fields.bookmarked = data.bookmarked;
  return fields;
}

async function createSection(data) {
  const section = {
    uid: state.user.uid,
    title: data.title,
    description: data.description,
    category: data.category,
    dailyTaskTarget: data.dailyTaskTarget,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    taskCount: 0,
    sharedWith: [],
    shareAccess: {},
  };

  let id;
  if (isFirebaseConfigured) {
    const ref = doc(collection(db, 'users', state.user.uid, 'sections'));
    id = ref.id;
    await setDoc(ref, section);
  } else {
    id = `section-${Date.now()}`;
    const store = loadLocalStore();
    store.sections.push({ ...section, id });
    saveLocalStore(store);
  }

  const stored = { ...section, id };
  rememberItem(state.sections, stored);
  rememberItem(state.allSections, stored);
  return id;
}

async function updateSection(sectionId, data) {
  const updates = firestorePayload({ ...data, updatedAt: new Date().toISOString() });
  if (isFirebaseConfigured) {
    await setDoc(doc(db, 'users', state.user.uid, 'sections', sectionId), updates, { merge: true });
  } else {
    const store = loadLocalStore();
    const index = store.sections.findIndex((section) => section.id === sectionId);
    if (index >= 0) {
      store.sections[index] = { ...store.sections[index], ...updates };
      saveLocalStore(store);
    }
  }

  const existing = getSectionById(sectionId) || { id: sectionId, uid: state.user.uid };
  const next = { ...existing, ...updates, id: sectionId };
  rememberItem(state.sections, next);
  rememberItem(state.allSections, next);
}

async function deleteSection(sectionId) {
  const section = getSectionById(sectionId);
  if (!isOwnRecord(section)) {
    showToast('Shared sections are read only.');
    return;
  }
  const confirmed = window.confirm('Delete this section and all tasks inside it?');
  if (!confirmed) return;

  try {
    const tasksToDelete = state.tasks.filter((task) => task.sectionId === sectionId);
    if (isFirebaseConfigured) {
      await deleteDoc(doc(db, 'users', state.user.uid, 'sections', sectionId));
      for (const task of tasksToDelete) {
        await deleteDoc(doc(db, 'users', state.user.uid, 'tasks', task.id));
        await deleteDoc(doc(db, 'users', state.user.uid, 'bookmarks', task.id));
      }
    } else {
      const store = loadLocalStore();
      store.sections = store.sections.filter((section) => section.id !== sectionId);
      store.tasks = store.tasks.filter((task) => task.sectionId !== sectionId);
      store.bookmarks = (store.bookmarks || []).filter((bookmark) => !tasksToDelete.some((task) => task.id === bookmark.taskId));
      saveLocalStore(store);
    }

    const removedTaskIds = new Set(tasksToDelete.map((task) => task.id));
    state.sections = state.sections.filter((section) => section.id !== sectionId);
    state.allSections = state.allSections.filter((section) => section.id !== sectionId);
    state.tasks = state.tasks.filter((task) => task.sectionId !== sectionId);
    state.allTasks = state.allTasks.filter((task) => task.sectionId !== sectionId);
    state.bookmarks = state.bookmarks.filter((bookmark) => !removedTaskIds.has(bookmark.taskId) && !removedTaskIds.has(bookmark.id));
    showToast('Section deleted.');
    await renderApp();
  } catch (error) {
    showToast(getFirebaseErrorMessage(error, 'Unable to delete section.', 'Firestore section delete'), 9000);
  }
}

async function createTask(data) {
  const now = new Date().toISOString();
  const section = getSectionById(data.sectionId);
  const record = firestorePayload({
    uid: state.user.uid,
    ...taskFieldsFromInput(data),
    sharedWith: Array.isArray(section?.sharedWith) ? section.sharedWith : [],
    sectionTitle: section?.title || 'General',
    revisionHistory: Array.isArray(data.revisionHistory) ? data.revisionHistory : [],
    createdAt: now,
    updatedAt: now,
    sequence: getTaskCountForSection(data.sectionId) + 1,
    bookmarked: false,
  });

  let id;
  if (isFirebaseConfigured) {
    const ref = doc(collection(db, 'users', state.user.uid, 'tasks'));
    id = ref.id;
    await setDoc(ref, record);
  } else {
    id = `task-${Date.now()}`;
    const store = loadLocalStore();
    store.tasks.push({ ...record, id });
    saveLocalStore(store);
  }

  const stored = normalizeTask({ ...record, id });
  rememberItem(state.tasks, stored);
  rememberItem(state.allTasks, stored);
  await updateSectionTaskCount(data.sectionId);
  return id;
}

async function updateTask(taskId, updates) {
  const cleaned = firestorePayload({ ...updates, updatedAt: new Date().toISOString() });
  if (typeof updates.tags === 'string') {
    cleaned.tags = updates.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
  }

  if (isFirebaseConfigured) {
    await setDoc(doc(db, 'users', state.user.uid, 'tasks', taskId), cleaned, { merge: true });
  } else {
    const store = loadLocalStore();
    const index = store.tasks.findIndex((task) => task.id === taskId);
    if (index >= 0) {
      store.tasks[index] = { ...store.tasks[index], ...cleaned };
      saveLocalStore(store);
    }
  }

  const existing = getTaskById(taskId) || { id: taskId, uid: state.user.uid };
  const next = normalizeTask({ ...existing, ...cleaned, id: taskId, uid: existing.uid || state.user.uid });
  rememberItem(state.tasks, next);
  rememberItem(state.allTasks, next);
}

async function deleteTask(taskId) {
  const task = getTaskById(taskId);
  if (!isOwnRecord(task)) {
    showToast('Shared updates are read only.');
    return;
  }
  const confirmed = window.confirm('Delete this update permanently?');
  if (!confirmed) return;
  try {
    if (isFirebaseConfigured) {
      await deleteDoc(doc(db, 'users', state.user.uid, 'tasks', taskId));
      await deleteDoc(doc(db, 'users', state.user.uid, 'bookmarks', taskId));
    } else {
      const store = loadLocalStore();
      store.tasks = store.tasks.filter((entry) => entry.id !== taskId);
      store.bookmarks = (store.bookmarks || []).filter((bookmark) => bookmark.taskId !== taskId);
      saveLocalStore(store);
    }

    state.tasks = state.tasks.filter((entry) => entry.id !== taskId);
    state.allTasks = state.allTasks.filter((entry) => entry.id !== taskId);
    state.bookmarks = state.bookmarks.filter((bookmark) => bookmark.taskId !== taskId && bookmark.id !== taskId);
    if (task?.sectionId) await updateSectionTaskCount(task.sectionId);
    showToast('Task deleted.');
    await renderApp();
  } catch (error) {
    showToast(getFirebaseErrorMessage(error, 'Unable to delete task.', 'Firestore task delete'), 9000);
  }
}

function getTaskCountForSection(sectionId) {
  return state.tasks.filter((task) => task.sectionId === sectionId).length;
}

async function updateSectionTaskCount(sectionId) {
  const section = getSectionById(sectionId);
  if (!section) return;
  const count = state.tasks.filter((task) => task.sectionId === sectionId).length;
  const updatedAt = new Date().toISOString();
  section.taskCount = count;
  section.updatedAt = updatedAt;
  const mirror = state.allSections.find((item) => item.id === sectionId);
  if (mirror && mirror !== section) {
    mirror.taskCount = count;
    mirror.updatedAt = updatedAt;
  }

  if (isFirebaseConfigured) {
    await setDoc(doc(db, 'users', state.user.uid, 'sections', sectionId), { taskCount: count, updatedAt }, { merge: true });
    return;
  }

  const store = loadLocalStore();
  const index = store.sections.findIndex((item) => item.id === sectionId);
  if (index >= 0) {
    store.sections[index].taskCount = count;
    store.sections[index].updatedAt = updatedAt;
    saveLocalStore(store);
  }
}

function readTaskForm() {
  const whatDone = document.getElementById('taskWhatDone').value.trim();
  const details = document.getElementById('taskDetails').value.trim();
  const sourceName = document.getElementById('taskSourceName').value.trim();
  const sourceUrl = document.getElementById('taskSourceUrl').value.trim();
  return {
    taskId: document.getElementById('taskId').value,
    sectionId: document.getElementById('taskSectionId').value,
    doneOn: document.getElementById('taskDoneOn').value,
    whatDone,
    title: whatDone,
    details,
    description: details,
    notes: details,
    sourceName,
    sourceUrl,
    platformName: sourceName,
    platformUrl: sourceUrl,
    revisionStatus: document.getElementById('taskRevisionStatus').value || 'Not Started',
    nextRevisionDate: document.getElementById('taskNextRevisionDate').value || '',
    revisionNotes: document.getElementById('taskRevisionNotes').value.trim(),
    status: document.getElementById('taskRevisionStatus').value === 'Mastered' ? 'Completed' : 'Pending',
    components: ['description'],
  };
}

function openSectionModal(sectionId = null) {
  const modal = document.getElementById('sectionModal');
  modal.classList.remove('hidden');
  const form = document.getElementById('sectionForm');
  form.reset();

  if (sectionId) {
    const section = getSectionById(sectionId);
    if (!section) return;
    document.getElementById('sectionId').value = section.id;
    document.getElementById('sectionTitle').value = section.title;
    document.getElementById('sectionDescription').value = section.description;
    document.getElementById('sectionCategory').value = section.category;
    document.getElementById('sectionDailyTarget').value = section.dailyTaskTarget || 2;
    document.getElementById('sectionModalTitle').textContent = 'Edit Section';
    return;
  }

  document.getElementById('sectionId').value = '';
  document.getElementById('sectionDailyTarget').value = 2;
  document.getElementById('sectionModalTitle').textContent = 'Create Section';
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.add('hidden');
}

function openTaskModal(taskId = null) {
  const task = taskId ? getTaskById(taskId) : null;
  if (task && !isOwnRecord(task)) {
    showToast('This shared update is read only.');
    return;
  }
  const modal = document.getElementById('taskModal');
  modal.classList.remove('hidden');
  document.getElementById('taskForm').reset();
  setupSectionOptions();
  document.getElementById('taskDoneOn').value = getLocalDateKey();
  document.getElementById('taskRevisionStatus').value = 'Not Started';

  if (task) {
    populateTaskForm(task);
    document.getElementById('taskModalTitle').textContent = 'Edit daily update';
    return;
  }

  document.getElementById('taskId').value = '';
  document.getElementById('taskModalTitle').textContent = 'Add daily update';
}

function populateTaskForm(task) {
  document.getElementById('taskForm').reset();
  setupSectionOptions();
  document.getElementById('taskId').value = task.id;
  document.getElementById('taskSectionId').value = task.sectionId || '';
  document.getElementById('taskDoneOn').value = taskDateLabel(task);
  document.getElementById('taskWhatDone').value = taskLabel(task);
  document.getElementById('taskDetails').value = task.details || '';
  document.getElementById('taskSourceName').value = taskSourceLabel(task) === 'No source' ? '' : taskSourceLabel(task);
  document.getElementById('taskSourceUrl').value = task.sourceUrl || '';
  document.getElementById('taskRevisionStatus').value = task.revisionStatus || 'Not Started';
  document.getElementById('taskNextRevisionDate').value = task.nextRevisionDate || '';
  document.getElementById('taskRevisionNotes').value = task.revisionNotes || '';
}

function setupSectionOptions() {
  const select = document.getElementById('taskSectionId');
  const ownSections = state.sections.filter((section) => isOwnRecord(section));
  select.innerHTML = ownSections.length
    ? ownSections.map((section) => `<option value="${section.id}">${escapeHtml(section.title)}</option>`).join('')
    : '<option value="">Create a section first</option>';
  if (ownSections[0]) select.value = ownSections[0].id;
}

function updateTaskTypePanels() {}

function renderAllPages() {
  renderDashboard();
  renderSectionsPage();
  renderTasksPage();
  renderSharedPage();
  renderRevisionsPage();
  renderBookmarksPage();
  renderProfilePage();
  renderAdminPage();
  renderSectionDetailPage();
  renderTaskDetail();
}

async function findUserByEmail(emailId) {
  if (isFirebaseConfigured) {
    const snapshot = await getDoc(doc(db, 'directory', emailId));
    return snapshot.exists() ? snapshot.data() : null;
  }
  const store = loadLocalStore();
  return store.directory?.[emailId] || null;
}

async function loadSharedContent() {
  state.sharedSections = [];
  state.sharedTasks = [];
  state.incomingShares = [];
  if (!db || !state.user) return;

  const uid = state.user.uid;
  const sharesSnap = await getDocs(collection(db, 'users', uid, 'incomingShares'));
  state.incomingShares = sharesSnap.docs.map((item) => ({ id: item.id, ...item.data() }));

  for (const share of state.incomingShares) {
    if (!share.ownerUid || !share.sectionId) continue;
    const sectionSnap = await getDoc(doc(db, 'users', share.ownerUid, 'sections', share.sectionId));
    if (!sectionSnap.exists()) continue;
    const section = { ...sectionSnap.data(), id: sectionSnap.id, uid: share.ownerUid, readOnly: true };
    if (!(section.sharedWith || []).includes(uid)) continue;
    state.sharedSections.push(section);

    const tasksSnap = await getDocs(query(
      collection(db, 'users', share.ownerUid, 'tasks'),
      where('sharedWith', 'array-contains', uid),
    ));
    tasksSnap.docs.forEach((item) => {
      const task = normalizeTask({ ...fromSnapshot(item, share.ownerUid), readOnly: true });
      if (task.sectionId === share.sectionId) state.sharedTasks.push(task);
    });
  }
}

function loadLocalSharedContent(store) {
  const uid = state.user.uid;
  state.sharedSections = (store.sections || [])
    .filter((section) => section.uid !== uid && (section.sharedWith || []).includes(uid))
    .map((section) => ({ ...section, readOnly: true }));
  state.sharedTasks = (store.tasks || [])
    .filter((task) => task.uid !== uid && (task.sharedWith || []).includes(uid))
    .map((task) => normalizeTask({ ...task, readOnly: true }));
  state.incomingShares = (store.shares || []).filter((share) => share.recipientUid === uid);
}

async function shareSectionWithEmail(sectionId, email) {
  const section = getSectionById(sectionId);
  if (!isOwnRecord(section)) {
    showToast('You can only share sections you own.');
    return;
  }

  const emailId = email.trim().toLowerCase();
  if (!emailId.includes('@')) {
    showToast('Enter the email of a registered user.');
    return;
  }
  if (emailId === (state.profile?.email || '').toLowerCase()) {
    showToast('You already own this section.');
    return;
  }

  try {
    const recipient = await findUserByEmail(emailId);
    if (!recipient?.uid) {
      showToast('No account found for that email. Ask them to register first.');
      return;
    }

    const sharedWith = Array.from(new Set([...(section.sharedWith || []), recipient.uid]));
    const shareAccess = {
      ...(section.shareAccess || {}),
      [recipient.uid]: { email: emailId, name: recipient.name || emailId, access: 'read' },
    };
    await updateSection(sectionId, { sharedWith, shareAccess });

    const tasks = state.tasks.filter((task) => task.sectionId === sectionId && isOwnRecord(task));
    for (const task of tasks) {
      await updateTask(task.id, { sharedWith: Array.from(new Set([...(task.sharedWith || []), recipient.uid])) });
    }

    const shareId = `${state.user.uid}_${sectionId}`;
    const shareRecord = {
      ownerUid: state.user.uid,
      ownerName: state.profile?.name || '',
      ownerEmail: (state.profile?.email || '').toLowerCase(),
      sectionId,
      sectionTitle: section.title,
      recipientUid: recipient.uid,
      access: 'read',
      createdAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured) {
      await setDoc(doc(db, 'users', recipient.uid, 'incomingShares', shareId), shareRecord);
    } else {
      const store = loadLocalStore();
      store.shares = store.shares || [];
      const stored = { ...shareRecord, id: shareId };
      const index = store.shares.findIndex((entry) => entry.id === shareId && entry.recipientUid === recipient.uid);
      if (index >= 0) store.shares[index] = stored;
      else store.shares.push(stored);
      saveLocalStore(store);
    }

    showToast(`${emailId} can read this section. They cannot edit it.`);
    await renderApp();
  } catch (error) {
    showToast(getFirebaseErrorMessage(error, 'Unable to share this section.', 'Firestore section share'), 9000);
  }
}

async function stopSectionShare(sectionId, recipientUid) {
  const section = getSectionById(sectionId);
  if (!isOwnRecord(section) || !recipientUid) {
    showToast('You can only stop access on sections you own.');
    return;
  }

  try {
    const sharedWith = (section.sharedWith || []).filter((uid) => uid !== recipientUid);
    const shareAccess = { ...(section.shareAccess || {}) };
    delete shareAccess[recipientUid];
    await updateSection(sectionId, { sharedWith, shareAccess });

    const tasks = state.tasks.filter((task) => task.sectionId === sectionId && isOwnRecord(task));
    for (const task of tasks) {
      await updateTask(task.id, { sharedWith: (task.sharedWith || []).filter((uid) => uid !== recipientUid) });
    }

    const shareId = `${state.user.uid}_${sectionId}`;
    if (isFirebaseConfigured) {
      await deleteDoc(doc(db, 'users', recipientUid, 'incomingShares', shareId));
    } else {
      const store = loadLocalStore();
      store.shares = (store.shares || []).filter((entry) => !(entry.id === shareId && entry.recipientUid === recipientUid));
      saveLocalStore(store);
    }

    showToast('Access stopped. They can no longer open this section.');
    await renderApp();
  } catch (error) {
    showToast(getFirebaseErrorMessage(error, 'Unable to stop access.', 'Firestore share removal'), 9000);
  }
}

function renderDashboard() {
  const page = document.getElementById('dashboardPage');
  if (!state.user) {
    page.innerHTML = '<div class="empty-state"><h4>Sign in to view your dashboard.</h4></div>';
    return;
  }

  const tasks = getAllTasksForCurrentUser();
  const sections = getCurrentUserSections();
  const completed = getCompletedCount(tasks);
  const pending = getPendingCount(tasks);
  const recentTasks = [...tasks].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, 4);
  const recentRevisions = [...tasks].filter((task) => task.nextRevisionDate).sort((a, b) => new Date(a.nextRevisionDate || 0) - new Date(b.nextRevisionDate || 0)).slice(0, 4);

  page.innerHTML = `
    <div class="dashboard-grid">
      <div class="metric-card">
        <div class="metric-head">
          <h3>Total Sections</h3>
          <span data-lucide="folder-open"></span>
        </div>
        <p class="metric-value">${sections.length}</p>
        <div class="metric-trend">${sections.length > 0 ? 'Organized learning path' : 'Start by creating your first section'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-head">
          <h3>Total Tasks</h3>
          <span data-lucide="clipboard-list"></span>
        </div>
        <p class="metric-value">${tasks.length}</p>
        <div class="metric-trend">${tasks.length > 0 ? 'Ready for revision' : 'Add what you did today'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-head">
          <h3>Completed</h3>
          <span data-lucide="check-circle-2"></span>
        </div>
        <p class="metric-value">${completed}</p>
        <div class="metric-trend">Progress is moving forward</div>
      </div>
      <div class="metric-card">
        <div class="metric-head">
          <h3>Pending</h3>
          <span data-lucide="clock-3"></span>
        </div>
        <p class="metric-value">${pending}</p>
        <div class="metric-trend">Keep your momentum steady</div>
      </div>
    </div>

    <div class="panel-grid">
      <div class="panel">
        <div class="panel-header">
          <h3>Recently added tasks</h3>
          <button type="button" data-page-link="tasks">View all</button>
        </div>
        <div class="list-stack">
          ${recentTasks.length ? recentTasks.map((task) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(taskLabel(task))}</strong>
                <span class="list-subtle">${escapeHtml(task.sectionTitle || 'General')} · ${escapeHtml(taskSourceLabel(task))}</span>
              </div>
              <span class="status-tag ${getStatusClass(task.status)}">${task.status || 'Pending'}</span>
            </div>
          `).join('') : '<div class="empty-state"><h4>No recent tasks yet.</h4></div>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h3>Revision queue</h3>
          <button type="button" data-page-link="revisions">Open list</button>
        </div>
        <div class="list-stack">
          ${recentRevisions.length ? recentRevisions.map((task) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(taskLabel(task))}</strong>
                <span class="list-subtle">${escapeHtml(task.nextRevisionDate || 'No date set')} · ${escapeHtml(taskSourceLabel(task))}</span>
              </div>
              <span class="pill ${getStatusClass(task.status)}">${task.revisionStatus || 'Not Started'}</span>
            </div>
          `).join('') : '<div class="empty-state"><h4>No revision tasks scheduled.</h4></div>'}
        </div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-page-link]').forEach((button) => {
    button.addEventListener('click', () => navigateTo(button.dataset.pageLink));
  });

  lucide.createIcons();
}

function renderSectionsPage() {
  const page = document.getElementById('sectionsPage');
  if (!state.user) {
    page.innerHTML = '<div class="empty-state"><h4>Sign in to manage sections.</h4></div>';
    return;
  }

  const sections = [...state.sections].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  page.innerHTML = `
    <div class="page-toolbar">
      <h3>My Sections</h3>
      <div class="filter-bar">
        <button type="button" class="primary-btn" id="newSectionBtn"><span data-lucide="folder-plus"></span> New Section</button>
      </div>
    </div>
    <div class="section-grid">
      ${sections.length ? sections.map((section) => `
        <article class="section-card">
          <div class="card-top">
            <div>
              <h4 class="card-title">${escapeHtml(section.title)}</h4>
              <div class="card-meta">
                <span>${escapeHtml(section.category)}</span>
                <span>•</span>
                <span>${formatDate(section.createdAt)}</span>
              </div>
            </div>
            <span class="badge">${getSectionTaskCount(section.id)} tasks · goal ${section.dailyTaskTarget || 2}/day</span>
          </div>
          <p class="card-description">${escapeHtml(section.description)}</p>
          <div class="card-actions">
            <button type="button" class="small-btn primary" data-open-section="${section.id}">Open</button>
            <button type="button" class="small-btn" data-edit-section="${section.id}">Edit</button>
            <button type="button" class="small-btn danger" data-delete-section="${section.id}">Delete</button>
          </div>
        </article>
      `).join('') : '<div class="empty-state"><h4>No sections yet.</h4><p>Start by creating your first learning section.</p></div>'}
    </div>
  `;

  document.getElementById('newSectionBtn').addEventListener('click', () => openSectionModal());
  lucide.createIcons();
}

function renderTasksPage() {
  const page = document.getElementById('tasksPage');
  if (!state.user) {
    page.innerHTML = '<div class="empty-state"><h4>Sign in to record what you did.</h4></div>';
    return;
  }

  const tasks = [...state.tasks].sort((a, b) => String(taskDateLabel(b)).localeCompare(String(taskDateLabel(a))));
  page.innerHTML = `
    <div class="page-toolbar">
      <h3>Daily updates</h3>
      <div class="filter-bar">
        <button type="button" class="primary-btn" id="newTaskBtn"><span data-lucide="plus-circle"></span> Add daily update</button>
      </div>
    </div>
    <div class="table-card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Section</th>
              <th>What I did</th>
              <th>Source</th>
              <th>Revision</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${tasks.length ? tasks.map((task) => `
              <tr>
                <td>${escapeHtml(taskDateLabel(task) || 'Not set')}</td>
                <td>${escapeHtml(task.sectionTitle || 'General')}</td>
                <td><strong>${escapeHtml(taskLabel(task))}</strong><div class="muted">${escapeHtml(task.details || '')}</div></td>
                <td>${task.sourceUrl ? `<a href="${escapeHtml(task.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(taskSourceLabel(task))}</a>` : escapeHtml(taskSourceLabel(task))}</td>
                <td><span class="status-tag ${getStatusClass(task.revisionStatus)}">${escapeHtml(task.revisionStatus || 'Not Started')}</span></td>
                <td>
                  <div class="card-actions">
                    <button type="button" class="small-btn primary" data-open-task="${task.id}">Open</button>
                    <button type="button" class="small-btn" data-edit-task="${task.id}">Edit</button>
                    <button type="button" class="small-btn danger" data-delete-task="${task.id}">Delete</button>
                  </div>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="6"><div class="empty-state"><h4>No daily updates yet.</h4><p>Add what you did today and where it came from.</p></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('newTaskBtn').addEventListener('click', () => openTaskModal());
  lucide.createIcons();
}

function renderSharedPage() {
  const page = document.getElementById('sharedPage');
  if (!state.user) {
    page.innerHTML = '<div class="empty-state"><h4>Sign in to see sections shared with you.</h4></div>';
    return;
  }

  page.innerHTML = `
    <div class="page-toolbar">
      <h3>Shared with me</h3>
    </div>
    <div class="section-grid">
      ${state.sharedSections.length ? state.sharedSections.map((section) => `
        <article class="section-card">
          <div class="card-top">
            <div>
              <h4 class="card-title">${escapeHtml(section.title)}</h4>
              <div class="card-meta">
                <span>${escapeHtml(section.category || 'Shared')}</span>
                <span>•</span>
                <span>Read only</span>
              </div>
            </div>
            <span class="badge">Read</span>
          </div>
          <p class="card-description">${escapeHtml(section.description || '')}</p>
          <div class="card-actions">
            <button type="button" class="small-btn primary" data-open-section="${section.id}">Open</button>
          </div>
        </article>
      `).join('') : '<div class="empty-state"><h4>Nothing shared with you yet.</h4><p>When someone shares a section, you can read it here. You cannot edit it.</p></div>'}
    </div>
  `;
}

function renderRevisionsPage() {
  const page = document.getElementById('revisionsPage');
  if (!state.user) {
    page.innerHTML = '<div class="empty-state"><h4>Sign in to manage revisions.</h4></div>';
    return;
  }

  const tasks = [...state.tasks].sort((a, b) => String(a.nextRevisionDate || '9999').localeCompare(String(b.nextRevisionDate || '9999')));

  page.innerHTML = `
    <div class="page-toolbar">
      <h3>Revision List</h3>
    </div>
    <div class="table-card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date done</th>
              <th>What I did</th>
              <th>Source</th>
              <th>Revision</th>
              <th>Revise on</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${tasks.length ? tasks.map((task) => `
              <tr>
                <td>${escapeHtml(taskDateLabel(task) || 'Not set')}</td>
                <td><strong>${escapeHtml(taskLabel(task))}</strong><div class="muted">${escapeHtml(task.sectionTitle || 'General')}</div></td>
                <td>${escapeHtml(taskSourceLabel(task))}</td>
                <td><span class="status-tag ${getStatusClass(task.revisionStatus)}">${escapeHtml(task.revisionStatus || 'Not Started')}</span></td>
                <td>${escapeHtml(task.nextRevisionDate || 'Not scheduled')}</td>
                <td>${escapeHtml(task.revisionNotes || 'No notes yet.')}</td>
                <td><button type="button" class="small-btn primary" data-mark-revised="${task.id}">${task.revisionStatus === 'Mastered' ? 'Mastered' : 'Revise'}</button></td>
              </tr>
            `).join('') : '<tr><td colspan="7"><div class="empty-state"><h4>No updates to revise yet.</h4></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  lucide.createIcons();
}

function renderBookmarksPage() {
  const page = document.getElementById('bookmarksPage');
  if (!state.user) {
    page.innerHTML = '<div class="empty-state"><h4>Sign in to bookmark tasks.</h4></div>';
    return;
  }

  const bookmarkedTasks = state.tasks.filter((task) => task.bookmarked || state.bookmarks.some((bookmark) => bookmark.taskId === task.id));
  page.innerHTML = `
    <div class="page-toolbar">
      <h3>Bookmarks</h3>
    </div>
    <div class="table-card">
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>What I did</th>
              <th>Source</th>
              <th>Revision</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${bookmarkedTasks.length ? bookmarkedTasks.map((task) => `
              <tr>
                <td>${escapeHtml(taskDateLabel(task) || 'Not set')}</td>
                <td><strong>${escapeHtml(taskLabel(task))}</strong><div class="muted">${escapeHtml(task.sectionTitle || 'General')}</div></td>
                <td>${escapeHtml(taskSourceLabel(task))}</td>
                <td>${escapeHtml(task.revisionStatus || 'Not Started')}</td>
                <td>
                  <div class="card-actions">
                    <button type="button" class="small-btn primary" data-open-task="${task.id}">Open</button>
                    <button type="button" class="small-btn danger" data-bookmark-task="${task.id}">Remove</button>
                  </div>
                </td>
              </tr>
            `).join('') : '<tr><td colspan="5"><div class="empty-state"><h4>No bookmarked updates yet.</h4><p>Bookmark an update when you want to revise it again.</p></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  lucide.createIcons();
}

function renderProfilePage() {
  const page = document.getElementById('profilePage');
  if (!state.user || !state.profile) {
    page.innerHTML = '<div class="empty-state"><h4>Please sign in.</h4></div>';
    return;
  }

  page.innerHTML = `
    <div class="panel-grid">
      <div class="panel">
        <div class="panel-header">
          <h3>Profile</h3>
        </div>
        <form id="profileForm">
          <div class="form-grid two">
            <div class="form-group">
              <label for="profileName">Full name</label>
              <input id="profileName" type="text" value="${escapeHtml(state.profile.name || state.user.displayName || '')}" required />
            </div>
            <div class="form-group">
              <label for="profilePhone">Phone</label>
              <input id="profilePhone" type="tel" value="${escapeHtml(state.profile.phone || '')}" />
            </div>
          </div>
          <div class="form-group">
            <label for="profileEmail">Email</label>
            <input id="profileEmail" type="email" value="${escapeHtml(state.profile.email || state.user.email || '')}" readonly />
          </div>
          <div class="modal-actions">
            <button type="button" class="ghost-btn" id="resetPasswordBtn">Reset password</button>
            <button type="submit" class="primary-btn">Save profile</button>
          </div>
        </form>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h3>Account summary</h3>
        </div>
        <div class="detail-key">
          <div class="info-tile">
            <p>Sections</p>
            <strong>${state.sections.length}</strong>
          </div>
          <div class="info-tile">
            <p>Tasks</p>
            <strong>${state.tasks.length}</strong>
          </div>
          <div class="info-tile">
            <p>Completed</p>
            <strong>${getCompletedCount(state.tasks)}</strong>
          </div>
          <div class="info-tile">
            <p>Role</p>
            <strong>${state.profile.isAdmin ? 'Administrator' : 'Student'}</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAdminPage() {
  const page = document.getElementById('adminPage');
  if (!state.user || !state.profile || !state.profile.isAdmin) {
    page.innerHTML = `
      <div class="empty-state">
        <h4>Administrator access required.</h4>
        <p>Only an authorized admin can view this panel.</p>
      </div>
    `;
    return;
  }

  const totalStudents = state.students.length || 0;
  const totalSections = state.allSections.length || 0;
  const totalTasks = state.allTasks.length || 0;
  const activeStudents = state.students.filter((student) => !student.isAdmin).length;

  const rows = state.students.length
    ? state.students.map((student) => {
        const studentUid = student.uid || student.id;
        const sectionsCount = state.allSections.filter((section) => section.uid === studentUid).length;
        const tasksCount = state.allTasks.filter((task) => task.uid === studentUid).length;
        return `
          <tr data-admin-student="${studentUid}" style="cursor:pointer;">
            <td>${escapeHtml(student.name || 'Unknown')}</td>
            <td>${escapeHtml(student.email || 'No email')}</td>
            <td>${formatDate(student.createdAt)}</td>
            <td>${sectionsCount}</td>
            <td>${tasksCount}</td>
            <td><span class="status-tag ${student.isAdmin ? 'completed' : 'pending'}">${student.isAdmin ? 'Admin' : 'Active'}</span></td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="6"><div class="empty-state"><h4>No students found.</h4></div></td></tr>';

  page.innerHTML = `
    <div class="dashboard-grid">
      <div class="metric-card"><div class="metric-head"><h3>Registered Students</h3><span data-lucide="users"></span></div><p class="metric-value">${totalStudents}</p><div class="metric-trend">Student accounts</div></div>
      <div class="metric-card"><div class="metric-head"><h3>Sections</h3><span data-lucide="folder-open"></span></div><p class="metric-value">${totalSections}</p><div class="metric-trend">Across all students</div></div>
      <div class="metric-card"><div class="metric-head"><h3>Daily updates</h3><span data-lucide="clipboard-list"></span></div><p class="metric-value">${totalTasks}</p><div class="metric-trend">What people logged</div></div>
      <div class="metric-card"><div class="metric-head"><h3>Active Students</h3><span data-lucide="shield-check"></span></div><p class="metric-value">${activeStudents}</p><div class="metric-trend">Currently active</div></div>
    </div>

    <div class="panel" style="margin-top:24px;">
      <div class="panel-header">
        <h3>Student Management</h3>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Registration</th>
              <th>Sections</th>
              <th>Tasks</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>
  `;
  lucide.createIcons();
}

function renderStudentAdminDetail(uid) {
  const student = state.students.find((entry) => (entry.uid || entry.id) === uid);
  if (!student) return;

  const studentSections = state.allSections.filter((section) => section.uid === uid);
  const studentTasks = state.allTasks.filter((task) => task.uid === uid);

  const sectionList = studentSections.length
    ? studentSections.map((section) => `<li>${escapeHtml(section.title)} – ${getSectionTaskCount(section.id, uid)} tasks</li>`).join('')
    : '<li>No sections available.</li>';

  const taskList = studentTasks.length
    ? `<div class="table-wrapper"><table>
        <thead><tr><th>Date</th><th>Section</th><th>What they did</th><th>Source</th><th>Details</th><th>Revision</th></tr></thead>
        <tbody>${studentTasks.map((task) => `
          <tr>
            <td>${escapeHtml(taskDateLabel(task) || 'Not set')}</td>
            <td>${escapeHtml(task.sectionTitle || 'General')}</td>
            <td>${escapeHtml(taskLabel(task))}</td>
            <td>${escapeHtml(taskSourceLabel(task))}</td>
            <td>${escapeHtml(task.details || task.revisionNotes || '')}</td>
            <td>${escapeHtml(task.revisionStatus || 'Not Started')}</td>
          </tr>
        `).join('')}</tbody>
      </table></div>`
    : '<p>No updates yet.</p>';

  document.getElementById('adminPage').innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <h3>Student details</h3>
        <button type="button" data-back-admin>Back to list</button>
      </div>
      <div class="detail-key">
        <div class="info-tile"><p>Name</p><strong>${escapeHtml(student.name || 'Unknown')}</strong></div>
        <div class="info-tile"><p>Email</p><strong>${escapeHtml(student.email || 'Unknown')}</strong></div>
        <div class="info-tile"><p>Registered</p><strong>${formatDate(student.createdAt)}</strong></div>
        <div class="info-tile"><p>Role</p><strong>${student.isAdmin ? 'Administrator' : 'Student'}</strong></div>
      </div>
      <div class="panel-grid">
        <div class="panel">
          <h3>Sections</h3>
          <ul>${sectionList}</ul>
        </div>
        <div class="panel">
          <h3>Daily updates</h3>
          ${taskList}
        </div>
      </div>
    </div>
  `;

  document.querySelector('[data-back-admin]').addEventListener('click', () => navigateTo('admin'));
}

function renderSectionDetailPage() {
  const section = getSectionById(state.currentSectionId);
  const page = document.getElementById('sectionDetailPage');

  if (!section) {
    page.innerHTML = '<div class="empty-state"><h4>Section data unavailable.</h4></div>';
    return;
  }

  const owned = isOwnRecord(section);
  const sectionTasks = (owned ? state.tasks : state.sharedTasks)
    .filter((task) => task.sectionId === section.id)
    .sort((a, b) => String(taskDateLabel(b)).localeCompare(String(taskDateLabel(a))));
  const sharePeople = Object.entries(section.shareAccess || {});
  const sharedUids = new Set([
    ...(section.sharedWith || []),
    ...sharePeople.map(([uid]) => uid),
  ]);
  const shareRecipients = state.directoryUsers
    .filter((person) => !sharedUids.has(person.uid))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
  const dailyTarget = Math.max(1, Number(section.dailyTaskTarget) || 2);
  const todayKey = getLocalDateKey();
  const todayCount = sectionTasks.filter((task) => taskDateLabel(task) === todayKey).length;
  const todayPercent = Math.min(100, Math.round((todayCount / dailyTarget) * 100));
  const activityDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const dateKey = getLocalDateKey(date);
    const count = sectionTasks.filter((task) => taskDateLabel(task) === dateKey).length;
    return {
      dateKey,
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      count,
      complete: count >= dailyTarget,
    };
  });

  page.innerHTML = `
    <div class="task-detail-shell">
      <div class="detail-header">
        <div>
          <p class="eyebrow">Section</p>
          <h3>${escapeHtml(section.title)}</h3>
        </div>
        <div class="card-actions">
          ${owned ? `<button type="button" class="small-btn primary" id="sectionAddTaskBtn">Add daily update</button>
          <button type="button" class="small-btn" data-edit-section="${section.id}">Edit Section</button>` : '<span class="badge">Read only</span>'}
        </div>
      </div>

      <div class="detail-key">
        <div class="info-tile"><p>Category</p><strong>${section.category}</strong></div>
        <div class="info-tile"><p>Created</p><strong>${formatDate(section.createdAt)}</strong></div>
        <div class="info-tile"><p>Tasks</p><strong>${sectionTasks.length}</strong></div>
      </div>

      <div class="panel activity-panel">
        <div class="panel-header">
          <div>
            <h3>Daily activity</h3>
            <span class="list-subtle">Add ${dailyTarget} task${dailyTarget === 1 ? '' : 's'} each day to meet this section's goal.</span>
          </div>
          <span class="activity-today">${todayCount} / ${dailyTarget} today</span>
        </div>
        <div class="goal-progress" role="progressbar" aria-label="Today's task target" aria-valuenow="${Math.min(todayCount, dailyTarget)}" aria-valuemin="0" aria-valuemax="${dailyTarget}">
          <span style="width: ${todayPercent}%"></span>
        </div>
        <div class="activity-week">
          ${activityDays.map((day) => `
            <div class="activity-day ${day.complete ? 'complete' : ''}">
              <span>${day.label}</span>
              <strong>${day.count}</strong>
              <small>${day.complete ? 'Goal met' : `of ${dailyTarget}`}</small>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">
          <h3>Task sequence</h3>
        </div>
        <div class="list-stack">
          ${sectionTasks.length ? sectionTasks.map((task, index) => `
            <div class="list-item">
              <div>
                <strong>${escapeHtml(taskDateLabel(task) || 'No date')} · ${escapeHtml(taskLabel(task))}</strong>
                <span class="list-subtle">${escapeHtml(taskSourceLabel(task))} · ${escapeHtml(task.revisionStatus || 'Not Started')}</span>
              </div>
              <div class="card-actions">
                <button type="button" class="small-btn primary" data-open-task="${task.id}">Open</button>
                ${owned ? `<button type="button" class="small-btn" data-edit-task="${task.id}">Edit</button>` : ''}
              </div>
            </div>
          `).join('') : '<div class="empty-state"><h4>No tasks in this section yet.</h4></div>'}
        </div>
      </div>

      ${owned ? `
        <div class="panel">
          <div class="panel-header">
            <div>
              <h3>Share this section</h3>
              <span class="list-subtle">The other person can read this section only. They cannot change it.</span>
            </div>
          </div>
          <div class="share-row">
            <div class="form-group">
              <label for="shareUser-${section.id}">Choose a person</label>
              <select id="shareUser-${section.id}" ${shareRecipients.length ? 'required' : 'disabled'}>
                ${shareRecipients.length
                  ? `<option value="">Select a person</option>${shareRecipients.map((person) => `
                    <option value="${escapeHtml(person.email)}">${escapeHtml(person.name || person.email)} · ${escapeHtml(person.email)}</option>
                  `).join('')}`
                  : '<option value="">No other registered users found</option>'}
              </select>
            </div>
            <button type="button" class="primary-btn" data-share-section="${section.id}" ${shareRecipients.length ? '' : 'disabled'}>Give read access</button>
          </div>
          <div class="list-stack">
            ${sharePeople.length ? sharePeople.map(([uid, person]) => `
              <div class="list-item">
                <div>
                  <strong>${escapeHtml(person.name || person.email)}</strong>
                  <span class="list-subtle">${escapeHtml(person.email)} · Read only</span>
                </div>
                <button type="button" class="small-btn danger" data-stop-share="${section.id}" data-recipient-uid="${uid}">Stop access</button>
              </div>
            `).join('') : '<p class="muted">Not shared with anyone yet.</p>'}
          </div>
        </div>
      ` : ''}
    </div>
  `;

  document.getElementById('sectionAddTaskBtn')?.addEventListener('click', () => {
    openTaskModal();
    document.getElementById('taskSectionId').value = section.id;
  });
}

function renderTaskDetail() {
  const task = getTaskById(state.currentTaskId);
  const page = document.getElementById('taskDetailPage');

  if (!task) {
    page.innerHTML = '<div class="empty-state"><h4>Update not found.</h4></div>';
    return;
  }

  const owned = isOwnRecord(task);
  const sourceLink = task.sourceUrl
    ? `<a href="${escapeHtml(task.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(task.sourceUrl)}</a>`
    : '<span class="muted">No link saved</span>';
  const history = (task.revisionHistory || []).length
    ? task.revisionHistory.map((entry) => `
        <div class="list-item">
          <div>
            <strong>${formatDate(entry.date)}</strong>
            <span class="list-subtle">${escapeHtml(entry.notes || 'Revision entry')}</span>
          </div>
        </div>
      `).join('')
    : '<p class="muted">No revision history yet. Use Revise when you come back to this.</p>';

  page.innerHTML = `
    <div class="task-detail-card">
      <div class="detail-header">
        <div>
          <p class="eyebrow">${owned ? 'Daily update' : 'Shared · read only'}</p>
          <h3>${escapeHtml(taskLabel(task))}</h3>
        </div>
        <div class="card-actions">
          ${owned ? `<button type="button" class="small-btn" data-bookmark-task="${task.id}">${task.bookmarked ? 'Remove bookmark' : 'Bookmark'}</button>
          <button type="button" class="small-btn primary" data-edit-task="${task.id}">Edit</button>
          <button type="button" class="small-btn danger" data-delete-task="${task.id}">Delete</button>` : '<span class="badge">Read only</span>'}
        </div>
      </div>
      <div class="detail-key">
        <div class="info-tile"><p>Date</p><strong>${escapeHtml(taskDateLabel(task) || 'Not set')}</strong></div>
        <div class="info-tile"><p>Section</p><strong>${escapeHtml(task.sectionTitle || 'General')}</strong></div>
        <div class="info-tile"><p>Source</p><strong>${escapeHtml(taskSourceLabel(task))}</strong></div>
        <div class="info-tile"><p>Revision</p><strong>${escapeHtml(task.revisionStatus || 'Not Started')}</strong></div>
        <div class="info-tile"><p>Revise on</p><strong>${escapeHtml(task.nextRevisionDate || 'Not scheduled')}</strong></div>
      </div>
      <div class="panel">
        <h3>Details</h3>
        <p>${escapeHtml(task.details || 'No extra details saved.')}</p>
        <h3>Source link</h3>
        <p>${sourceLink}</p>
        <h3>Revision notes</h3>
        <p>${escapeHtml(task.revisionNotes || 'Nothing noted for the next revision.')}</p>
      </div>
      <div class="panel">
        <h3>Revision history</h3>
        ${history}
      </div>
    </div>
  `;

  lucide.createIcons();
}

function initCodeEditor(elementId, value = '') {
  const element = document.getElementById(elementId);
  if (!element) return null;

  if (state.codeEditors[elementId] && typeof state.codeEditors[elementId].toTextArea === 'function') {
    state.codeEditors[elementId].toTextArea();
  }

  const editor = CodeMirror.fromTextArea(element, {
    mode: 'javascript',
    theme: 'material-darker',
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentUnit: 2,
  });

  editor.setValue(value || '');
  state.codeEditors[elementId] = editor;
  return editor;
}

function syncEditorValue(elementId) {
  const editor = state.codeEditors[elementId];
  if (editor && typeof editor.save === 'function') {
    editor.save();
  }
}

function showToast(message, duration = 2600) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.add('hidden'), duration);
}

function getFirebaseErrorMessage(error, fallback, stage = 'Firebase operation') {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '');
  const normalizedMessage = message.toLowerCase();

  if (code.includes('api-key-not-valid') || code.includes('api_key_invalid') || normalizedMessage.includes('api key not valid')) {
    return `Stage: ${stage}. Firebase rejected this Web API key (API_KEY_INVALID). Confirm the key belongs to project ${firebaseConfig.projectId}, is active, allows the Identity Toolkit API, and permits this site's HTTP referrer.`;
  }
  if (code.includes('operation-not-allowed')) {
    return `Stage: ${stage}. Identity Toolkit returned OPERATION_NOT_ALLOWED. Enable Email/Password in Firebase Console → Authentication → Sign-in method.`;
  }
  if (code.includes('email-already-in-use')) {
    return `Stage: ${stage}. This email already has a Firebase account. Use Login or Forgot password instead.`;
  }
  if (normalizedMessage.includes('missing or insufficient permissions')) {
    return `Stage: ${stage}. Firestore denied the request. Create the Firestore database and publish firestore.rules for project ${firebaseConfig.projectId}.`;
  }
  if (code.includes('permission-denied')) {
    return `Stage: ${stage}. Firestore denied the request. Create the Firestore database and publish firestore.rules for project ${firebaseConfig.projectId}.`;
  }
  if (code.includes('failed-precondition') || code.includes('not-found')) {
    return `Stage: ${stage}. Firestore is not ready for this request. Confirm a Firestore database exists in project ${firebaseConfig.projectId} and try again.`;
  }
  if (code.includes('network-request-failed') || code.includes('unavailable')) {
    return `Stage: ${stage}. Firebase could not be reached. Check your internet connection and Firebase project availability, then retry.`;
  }
  if (code.includes('unauthorized-domain')) {
    return `Stage: ${stage}. This host is not authorized for Firebase Authentication. Add it under Authentication → Settings → Authorized domains.`;
  }

  return `Stage: ${stage}. ${message || fallback}`;
}

function getStatusClass(status = 'Pending') {
  const normalized = (status || '').toLowerCase();
  if (normalized.includes('complete') || normalized.includes('master')) return 'completed';
  if (normalized.includes('progress')) return 'in-progress';
  return 'pending';
}

function getDifficultyClass(level = 'Easy') {
  const normalized = (level || '').toLowerCase();
  if (normalized.includes('hard')) return 'hard';
  if (normalized.includes('medium')) return 'medium';
  return 'easy';
}

function getSectionTaskCount(sectionId, uidOverride = null) {
  const targetUid = uidOverride || state.user.uid;
  const sourceTasks = uidOverride ? state.allTasks : state.tasks;
  return sourceTasks.filter((task) => (task.uid === targetUid || task.uid === undefined) && task.sectionId === sectionId).length;
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (match) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[match]));
}

async function handleLogout() {
  if (isFirebaseConfigured) {
    await signOut(auth);
    return;
  }

  localStorage.removeItem('codeTrackSessionUid');
  state.user = null;
  state.profile = null;
  renderApp();
}

async function toggleBookmark(taskId) {
  const task = state.tasks.find((entry) => entry.id === taskId);
  if (!task || !state.user) return;

  const bookmarked = !task.bookmarked;
  const createdAt = new Date().toISOString();

  try {
    if (isFirebaseConfigured) {
      const bookmarkRef = doc(db, 'users', state.user.uid, 'bookmarks', taskId);
      if (bookmarked) {
        await setDoc(bookmarkRef, { taskId, createdAt, uid: state.user.uid });
      } else {
        await deleteDoc(bookmarkRef);
      }
      await updateTask(taskId, { bookmarked });
    } else {
      const store = loadLocalStore();
      store.bookmarks = store.bookmarks || [];
      const bookmarkIndex = store.bookmarks.findIndex((entry) => entry.taskId === taskId && entry.uid === state.user.uid);
      if (bookmarked) {
        if (bookmarkIndex === -1) store.bookmarks.push({ taskId, uid: state.user.uid, createdAt });
      } else if (bookmarkIndex >= 0) {
        store.bookmarks.splice(bookmarkIndex, 1);
      }
      const taskIndex = store.tasks.findIndex((entry) => entry.id === taskId);
      if (taskIndex >= 0) store.tasks[taskIndex].bookmarked = bookmarked;
      saveLocalStore(store);
      task.bookmarked = bookmarked;
    }

    if (bookmarked) {
      rememberItem(state.bookmarks, { id: taskId, taskId, uid: state.user.uid, createdAt });
    } else {
      state.bookmarks = state.bookmarks.filter((entry) => entry.taskId !== taskId && entry.id !== taskId);
    }

    showToast(bookmarked ? 'Task saved to bookmarks.' : 'Bookmark removed.');
    await renderApp();
  } catch (error) {
    showToast(getFirebaseErrorMessage(error, 'Unable to update bookmark.', 'Firestore bookmark update'), 9000);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
});

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '');
  if (hash && hash.startsWith('section/')) {
    navigateTo('sectionDetail', hash.replace('section/', ''));
  } else if (hash && hash.startsWith('task/')) {
    navigateTo('taskDetail', hash.replace('task/', ''));
  }
});

function renderPageFromHash() {
  const hash = location.hash.replace('#', '');
  if (hash && hash.startsWith('section/')) {
    navigateTo('sectionDetail', hash.replace('section/', ''));
    return;
  }
  if (hash && hash.startsWith('task/')) {
    navigateTo('taskDetail', hash.replace('task/', ''));
    return;
  }
  navigateTo('dashboard');
}

if (typeof window !== 'undefined') {
  window.CodeTrackApp = {
    navigateTo,
    openTaskModal,
    openSectionModal,
    showToast,
    getTaskById,
  };
}
