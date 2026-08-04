// HTML sign-in page for /admin/*.
//
//   GET  /admin/login[?next=/admin/...]  → login form (or bounce if already in)
//   POST /admin/login  (username, password, next) → set session cookie + redirect
//   POST /admin/login  (action=logout)            → clear session cookie
//
// A real form rather than a Basic Auth prompt, so browser password managers can
// store and autofill the credentials. Credentials still come from the ADMIN_USER
// and ADMIN_PASS env vars; see functions/admin/_auth.js for the session cookie.

import {
    checkCredentials,
    clearedSessionCookie,
    createSessionToken,
    esc,
    getSession,
    htmlResponse,
    isConfigured,
    notConfiguredResponse,
    originAllowed,
    redirect,
    safeNext,
    sessionCookie,
} from "./_auth.js";

// Slows down credential stuffing without needing any server-side state.
const FAILED_LOGIN_DELAY_MS = 600;

function loginPage({ next, error, notice, user = "" }) {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Sign in — flags admin</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1.5rem;
       background:#15171b;color:#e8e8ea;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
  main{width:100%;max-width:22rem}
  h1{margin:0 0 .35rem;font-size:1.2rem}
  p.sub{margin:0 0 1.25rem;color:#8d95a3;font-size:.9rem}
  form{display:grid;gap:.85rem}
  label{display:grid;gap:.3rem;font-size:.85rem;color:#aeb6c2}
  input{width:100%;padding:.55rem .65rem;border-radius:8px;border:1px solid #323844;
        background:#1b1f26;color:#e8e8ea;font:inherit}
  input:focus{outline:none;border-color:#6ea8fe;box-shadow:0 0 0 2px #6ea8fe33}
  button{margin-top:.25rem;padding:.55rem .65rem;border-radius:8px;border:1px solid #3a4a63;
         background:#1d2733;color:#dfe5ee;font:inherit;font-weight:600;cursor:pointer}
  button:hover{border-color:#6ea8fe}
  .error{margin:0 0 1rem;padding:.55rem .7rem;border-radius:8px;
         border:1px solid #5a1f1f;background:#2a1a1c;color:#ffd2d2;font-size:.88rem}
  .notice{margin:0 0 1rem;padding:.55rem .7rem;border-radius:8px;
          border:1px solid #244a2c;background:#182219;color:#bdebc4;font-size:.88rem}
</style></head>
<body>
<main>
  <h1>Flags admin</h1>
  <p class="sub">Sign in to review guide feedback.</p>
  ${error ? `<p class="error">${esc(error)}</p>` : ""}
  ${notice ? `<p class="notice">${esc(notice)}</p>` : ""}
  <form method="post" action="/admin/login">
    <input type="hidden" name="next" value="${esc(next)}">
    <label>Username
      <input name="username" type="text" autocomplete="username" autocapitalize="none"
             autocorrect="off" spellcheck="false" required autofocus value="${esc(user)}">
    </label>
    <label>Password
      <input name="password" type="password" autocomplete="current-password" required>
    </label>
    <button type="submit">Sign in</button>
  </form>
</main>
</body></html>`;
}

export async function onRequestGet({ request, env }) {
    if (!isConfigured(env)) return notConfiguredResponse();

    const url = new URL(request.url);
    const next = safeNext(url.searchParams.get("next"));

    // Already signed in — no reason to show the form.
    if (await getSession(request, env)) return redirect(request, next);

    return htmlResponse(loginPage({ next, notice: url.searchParams.get("out") ? "Signed out." : "" }));
}

export async function onRequestPost({ request, env }) {
    if (!isConfigured(env)) return notConfiguredResponse();
    if (!originAllowed(request)) return htmlResponse("<h1>Bad origin</h1>", 403);

    let form;
    try {
        form = await request.formData();
    } catch {
        return htmlResponse("<h1>Bad request</h1>", 400);
    }

    if (form.get("action") === "logout") {
        return redirect(request, "/admin/login?out=1", { "Set-Cookie": clearedSessionCookie(request) });
    }

    const next = safeNext(form.get("next"));
    const user = form.get("username") || "";
    const pass = form.get("password") || "";

    if (!(await checkCredentials(env, user, pass))) {
        await new Promise((resolve) => setTimeout(resolve, FAILED_LOGIN_DELAY_MS));
        return htmlResponse(
            loginPage({ next, error: "Incorrect username or password.", user }),
            401,
        );
    }

    const token = await createSessionToken(env);
    return redirect(request, next, { "Set-Cookie": sessionCookie(request, token) });
}
