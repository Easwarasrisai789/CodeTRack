const apiKey = 'AIzaSyDUKKDS-WNvr7K9G_719JQUloinZl_71r8';
const projectId = 'my-ae-b4bf9';
const email = 'eswarvenky08@gmail.com';
const password = process.env.CT_ADMIN_PASSWORD;

if (!password) {
  console.error('Missing CT_ADMIN_PASSWORD');
  process.exit(1);
}

async function post(url, body, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

async function main() {
  let auth = await post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    { email, password, returnSecureToken: true },
  );

  if (!auth.ok && auth.data?.error?.message === 'EMAIL_EXISTS') {
    auth = await post(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      { email, password, returnSecureToken: true },
    );
    console.log('auth: existing account signed in');
  } else if (auth.ok) {
    console.log('auth: account created');
  } else {
    console.log('auth failed', auth.data?.error?.message || auth.status);
    process.exit(1);
  }

  if (!auth.ok) {
    console.log('sign-in failed', auth.data?.error?.message || auth.status);
    process.exit(1);
  }

  const uid = auth.data.localId;
  const token = auth.data.idToken;
  const now = new Date().toISOString();
  const userDoc = {
    fields: {
      uid: { stringValue: uid },
      name: { stringValue: 'Admin' },
      email: { stringValue: email },
      phone: { stringValue: '' },
      isAdmin: { booleanValue: true },
      createdAt: { stringValue: now },
    },
  };

  const userUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}`;
  const userWrite = await fetch(userUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(userDoc),
  });
  const userBody = await userWrite.json();
  console.log('profile', userWrite.status, userBody.error?.message || 'ok');

  const directoryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/directory/${encodeURIComponent(email)}`;
  const directoryWrite = await fetch(directoryUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      fields: {
        uid: { stringValue: uid },
        email: { stringValue: email },
        name: { stringValue: 'Admin' },
      },
    }),
  });
  const directoryBody = await directoryWrite.json();
  console.log('directory', directoryWrite.status, directoryBody.error?.message || 'ok');
  console.log('uid', uid);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
