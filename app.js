(() => {
  "use strict";

  const SUPABASE_URL = window.AETHER_SUPABASE_URL;
  const SUPABASE_KEY = window.AETHER_SUPABASE_KEY;
  const SESSION_KEY = "aether-community-web-session-v1";
  const $ = id => document.getElementById(id);
  const categories = ["General", "Help & Support", "World Showcase", "Add-ons", "Suggestions"];
  let session = readSession();
  let signupMode = false;
  let authPending = false;
  let mfaMode = "";
  let mfaFactorId = "";
  let mfaChallengeId = "";
  let mfaChallengeRequired = false;
  let selectedCategory = "All";
  let posts = [];
  let turnstilePromise = null;
  let turnstileWidget = null;
  let captchaToken = "";

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return value?.access_token && value?.user?.id ? value : null;
    } catch {
      return null;
    }
  }

  function saveSession(value) {
    session = value?.access_token && value?.user?.id ? value : null;
    if (!session) authPending = false;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    renderAuthState();
  }

  function api(path, options = {}, retry = true) {
    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + (session?.access_token || SUPABASE_KEY),
      "Content-Type": "application/json",
      ...options.headers
    };
    return fetch(SUPABASE_URL + path, { ...options, headers }).then(async response => {
      if (response.status === 401 && retry && session?.refresh_token) {
        const refreshed = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
          method: "POST",
          headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: session.refresh_token })
        });
        if (refreshed.ok) {
          saveSession(await refreshed.json());
          return api(path, options, false);
        }
        saveSession(null);
      }

      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!response.ok) {
        throw new Error(data?.msg || data?.message || data?.hint || data?.details || data?.error_description || data?.error || "Request failed (" + response.status + ")");
      }
      return data;
    });
  }

  function setConnection(message, good = false) {
    const status = $("communityConnection");
    status.textContent = message;
    const dot = status.previousElementSibling;
    if (dot) dot.style.backgroundColor = good ? "var(--mint)" : "var(--green)";
  }

  function renderAuthState() {
    const signedIn = !!session?.user?.id && !authPending;
    $("communitySignOut").hidden = !signedIn;
    $("communityJoin").textContent = signedIn ? "You’re part of Aether" : "Join the conversation";
    $("communityComposeHint").textContent = signedIn
      ? "Posting as " + (session.user.user_metadata?.username || session.user.email || "Aether member")
      : "Sign in to share with the community.";
    ["communityPostTitle", "communityPostBody", "communityCategory"].forEach(id => { $(id).disabled = !signedIn; });
    $("communityPostForm").querySelector('[type="submit"]').disabled = !signedIn;
    if (authPending) setConnection("Authenticator verification required to continue.");
    else if (signedIn) setConnection("Signed in as " + (session.user.email || "Aether member"), true);
    else setConnection("Public community · sign in to post", true);
  }

  function setAuthError(message) {
    const error = $("communityAuthError");
    error.textContent = message;
    error.hidden = !message;
  }

  function tokenClaims(accessToken) {
    try {
      const payload = accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const binary = atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return {};
    }
  }

  async function listTotpFactors() {
    const user = await api("/auth/v1/user");
    const all = Array.isArray(user?.factors) ? user.factors : [];
    return {
      all,
      totp: all.filter(factor => factor.factor_type === "totp" || factor.type === "totp")
    };
  }

  function showMfaPanel(mode, message) {
    mfaMode = mode;
    $("communityAuthCredentials").hidden = true;
    $("communityMfaPanel").hidden = false;
    $("communityMfaQrWrap").hidden = mode !== "setup";
    $("communityMfaSkip").hidden = mode !== "setup";
    $("communityMfaCancel").hidden = mode === "setup";
    $("communityMfaCodeWrap").hidden = mode === "error";
    $("communityMfaVerify").hidden = mode === "error";
    $("communityAuthClose").hidden = authPending;
    $("communityMfaTitle").textContent = mode === "setup"
      ? "Set up your authenticator."
      : mode === "error" ? "Couldn’t verify security settings." : "Enter your authenticator code.";
    $("communityMfaIntro").textContent = message;
    $("communityMfaCodeLabel").textContent = mode === "setup" ? "Six-digit authenticator code" : "Six-digit sign-in code";
    $("communityMfaVerify").textContent = mode === "setup" ? "Verify and enable" : "Verify and sign in";
    $("communityMfaCode").value = "";
    $("communityMfaStatus").textContent = mode === "setup" ? "Your authenticator secret is shared only with Supabase Auth." : "Enter the current code from your authenticator app.";
    if (!$("communityAuthDialog").open) $("communityAuthDialog").showModal();
    if (mode !== "error") $("communityMfaCode").focus();
  }

  function showAuthCredentials() {
    mfaMode = "";
    mfaFactorId = "";
    mfaChallengeId = "";
    mfaChallengeRequired = false;
    $("communityAuthCredentials").hidden = false;
    $("communityMfaPanel").hidden = true;
    $("communityAuthClose").hidden = false;
    $("communityMfaQr").removeAttribute("src");
    $("communityMfaSecret").textContent = "";
    $("communityMfaCode").value = "";
  }

  async function startAuthenticatorSetup(currentFactors = null) {
    currentFactors = currentFactors || await listTotpFactors();
    for (const factor of currentFactors.totp.filter(item => item.status === "unverified")) {
      await api("/auth/v1/factors/" + encodeURIComponent(factor.id), { method: "DELETE" });
    }
    const factor = await api("/auth/v1/factors", {
      method: "POST",
      body: JSON.stringify({
        factor_type: "totp",
        friendly_name: "Project Aether Authenticator",
        issuer: "Project Aether"
      })
    });
    if (!factor?.id || !factor?.totp?.qr_code || !factor?.totp?.secret) {
      throw new Error("Supabase did not return the authenticator setup details.");
    }
    mfaFactorId = factor.id;
    const qrCode = factor.totp.qr_code;
    $("communityMfaQr").src = qrCode.startsWith("data:")
      ? qrCode
      : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrCode);
    $("communityMfaSecret").textContent = factor.totp.secret;
    showMfaPanel("setup", "Scan this QR code, then enter the six-digit code from your authenticator app to finish setup.");
  }

  async function startAuthenticatorChallenge(factor) {
    mfaChallengeRequired = true;
    mfaFactorId = factor.id;
    const challenge = await api("/auth/v1/factors/" + encodeURIComponent(factor.id) + "/challenge", {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!challenge?.id) throw new Error("Could not start authenticator verification. Please sign in again.");
    mfaChallengeId = challenge.id;
    showMfaPanel("challenge", "Your account uses an authenticator app. Enter its current six-digit code to sign in.");
  }

  async function finishAuthenticatedSignIn() {
    authPending = false;
    renderAuthState();
    if ($("communityAuthDialog").open) $("communityAuthDialog").close();
    $("communityAuthForm").reset();
    showAuthCredentials();
    setSignupMode(false);
    setConnection("Signed in · welcome to the community", true);
    if (new URLSearchParams(location.search).get("return") === "download") {
      window.location.replace("download.html");
      return;
    }
    await loadFeed();
  }

  async function handleAuthenticatedSession(authSession) {
    authPending = true;
    mfaFactorId = "";
    mfaChallengeId = "";
    mfaChallengeRequired = false;
    saveSession(authSession);
    try {
      const factors = await listTotpFactors();
      const verifiedFactor = factors.totp.find(factor => factor.status === "verified");
      if (verifiedFactor) {
        if (tokenClaims(authSession.access_token).aal === "aal2") {
          await finishAuthenticatedSignIn();
          return;
        }
        await startAuthenticatorChallenge(verifiedFactor);
        return;
      }
      if (authSession?.user?.user_metadata?.authenticator_opt_in === true) {
        await startAuthenticatorSetup(factors);
        return;
      }
      await finishAuthenticatedSignIn();
    } catch (error) {
      const mode = mfaChallengeRequired ? "challenge" : "error";
      showMfaPanel(mode, mode === "challenge"
        ? "Your authenticator is required to sign in. Check your connection and enter a current code to retry."
        : "We couldn’t check or set up your authenticator. Sign out and try again.");
      $("communityMfaStatus").textContent = error.message || "Could not set up the authenticator.";
      setAuthError("");
    }
  }

  async function skipAuthenticatorSetup() {
    if (!session || mfaMode !== "setup") return;
    const button = $("communityMfaSkip");
    button.disabled = true;
    $("communityMfaStatus").textContent = "Saving your choice…";
    try {
      if (mfaFactorId) {
        try { await api("/auth/v1/factors/" + encodeURIComponent(mfaFactorId), { method: "DELETE" }); } catch { /* An unverified factor is not active. */ }
      }
      const user = await api("/auth/v1/user", {
        method: "PUT",
        body: JSON.stringify({ data: { authenticator_opt_in: false } })
      });
      saveSession({ ...session, user });
      await finishAuthenticatedSignIn();
    } catch (error) {
      $("communityMfaStatus").textContent = "Could not save that choice: " + (error.message || "Please try again.");
    } finally {
      button.disabled = false;
    }
  }

  async function verifyAuthenticatorCode() {
    const code = $("communityMfaCode").value.replace(/\D/g, "");
    if (!/^\d{6}$/.test(code)) {
      $("communityMfaStatus").textContent = "Enter the six-digit code from your authenticator app.";
      $("communityMfaCode").focus();
      return;
    }
    const button = $("communityMfaVerify");
    button.disabled = true;
    $("communityMfaStatus").textContent = "Checking your code…";
    try {
      if (!mfaChallengeId) {
        const challenge = await api("/auth/v1/factors/" + encodeURIComponent(mfaFactorId) + "/challenge", {
          method: "POST",
          body: JSON.stringify({})
        });
        mfaChallengeId = challenge.id;
      }
      const verified = await api("/auth/v1/factors/" + encodeURIComponent(mfaFactorId) + "/verify", {
        method: "POST",
        body: JSON.stringify({ challenge_id: mfaChallengeId, code })
      });
      if (!verified?.access_token || !verified?.user?.id) {
        throw new Error("The authenticator was verified, but Supabase did not return a refreshed session. Sign in again to continue.");
      }
      mfaChallengeId = "";
      authPending = false;
      saveSession(verified);
      await finishAuthenticatedSignIn();
    } catch (error) {
      $("communityMfaStatus").textContent = error.message || "That code could not be verified. Check it and try again.";
      mfaChallengeId = "";
    } finally {
      button.disabled = false;
    }
  }

  function openAuthDialog() {
    if (session && !authPending) {
      $("communityPostTitle").focus();
      $("communityPostTitle").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    $("communityAuthDialog").showModal();
    if (!authPending) {
      $("communityTurnstile").hidden = false;
      renderTurnstile();
      $("communityEmail").focus();
    }
  }

  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve();
    if (turnstilePromise) return turnstilePromise;
    turnstilePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => {
        turnstilePromise = null;
        reject(new Error("Could not load signup verification."));
      };
      document.head.appendChild(script);
    });
    return turnstilePromise;
  }

  async function renderTurnstile() {
    const slot = $("communityTurnstile");
    const status = $("communityTurnstileStatus");
    slot.hidden = false;
    if (!window.AETHER_TURNSTILE_SITE_KEY) {
      status.textContent = "Sign-in and account creation are not configured on this website yet.";
      $("communityAuthSubmit").disabled = true;
      return;
    }
    status.textContent = "Complete the verification to continue.";
    $("communityAuthSubmit").disabled = true;
    try {
      await loadTurnstile();
      if (turnstileWidget !== null) {
        window.turnstile.reset(turnstileWidget);
        return;
      }
      turnstileWidget = window.turnstile.render(slot, {
        sitekey: window.AETHER_TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: token => { captchaToken = token; status.textContent = "Verification complete."; $("communityAuthSubmit").disabled = false; },
        "expired-callback": () => { captchaToken = ""; status.textContent = "Verification expired. Please try again."; $("communityAuthSubmit").disabled = true; },
        "error-callback": () => { captchaToken = ""; status.textContent = "Verification could not load for this website address."; $("communityAuthSubmit").disabled = true; }
      });
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function setSignupMode(enabled) {
    signupMode = enabled;
    $("signupFields").hidden = !enabled;
    $("communityUsername").required = enabled;
    $("communityAgeGroup").required = enabled;
    $("communityAgreement").required = enabled;
    $("communityTurnstile").hidden = false;
    $("communityAuthSubmit").textContent = enabled ? "Create account" : "Sign in";
    $("communityAuthSwitch").textContent = enabled ? "Already have an account? Sign in" : "New to Aether? Create an account";
    $("authTitle").textContent = enabled ? "Join the community." : "Welcome back.";
    $("authMessage").textContent = enabled
      ? "Create one Aether account to share and reply."
      : "Sign in to post, reply, and like discussions.";
    $("communityPassword").autocomplete = enabled ? "new-password" : "current-password";
    $("communityTurnstileStatus").textContent = "";
    captchaToken = "";
    renderTurnstile();
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function makeButton(label, action, className = "post-action") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  function renderPosts() {
    const feed = $("communityFeed");
    feed.replaceChildren();
    const visible = posts.filter(post => selectedCategory === "All" || post.category === selectedCategory);
    if (!visible.length) {
      const message = document.createElement("p");
      message.className = "feed-message";
      message.textContent = selectedCategory === "All"
        ? "No discussions yet. Be the first to start one."
        : "No posts in this category yet.";
      feed.appendChild(message);
      return;
    }
    for (const post of visible) feed.appendChild(renderPost(post));
  }

  function renderPost(post) {
    const article = document.createElement("article");
    article.className = "post-card";
    article.dataset.postId = String(post.id);

    const meta = document.createElement("div");
    meta.className = "post-meta";
    const category = document.createElement("span");
    category.className = "post-category";
    category.textContent = post.category;
    const separator = document.createElement("span");
    separator.textContent = "·";
    const author = document.createElement("span");
    author.textContent = post.author || "Aether member";
    const date = document.createElement("time");
    date.dateTime = post.created_at || "";
    date.textContent = formatDate(post.created_at);
    meta.append(category, separator, author, separator.cloneNode(), date);

    const title = document.createElement("h4");
    title.textContent = post.title;
    const body = document.createElement("p");
    body.className = "post-body";
    body.textContent = post.body;
    const actions = document.createElement("div");
    actions.className = "post-actions";
    const likedByMe = session?.user?.id && post.likedByMe;
    const like = makeButton((likedByMe ? "♥ " : "♡ ") + post.likeCount, "like");
    if (likedByMe) like.classList.add("is-liked");
    like.setAttribute("aria-label", (likedByMe ? "Unlike" : "Like") + " post; " + post.likeCount + " likes");
    const reply = makeButton("Replies · " + post.replyCount, "replies");
    actions.append(like, reply);
    article.append(meta, title, body, actions);
    return article;
  }

  async function loadFeed() {
    const feed = $("communityFeed");
    feed.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "feed-message";
    loading.textContent = "Loading recent discussions…";
    feed.appendChild(loading);
    try {
      const rows = await api("/rest/v1/forum_posts?select=id,user_id,category,title,body,created_at&order=created_at.desc&limit=50");
      const ids = (rows || []).map(post => post.id);
      if (!ids.length) {
        posts = [];
        renderPosts();
        return;
      }
      const userIds = [...new Set(rows.map(post => post.user_id).filter(Boolean))];
      const postFilter = "in.(" + ids.map(encodeURIComponent).join(",") + ")";
      const userFilter = "in.(" + userIds.map(encodeURIComponent).join(",") + ")";
      const [profiles, likes, replies] = await Promise.all([
        userIds.length
          ? api("/rest/v1/profiles?select=id,username&id=" + userFilter)
          : Promise.resolve([]),
        api("/rest/v1/forum_likes?select=post_id,user_id&post_id=" + postFilter),
        api("/rest/v1/forum_replies?select=post_id&post_id=" + postFilter)
      ]);
      const names = Object.fromEntries((profiles || []).map(profile => [profile.id, profile.username]));
      const likeCounts = Object.create(null);
      const replyCounts = Object.create(null);
      const ownLikes = new Set();
      for (const like of likes || []) {
        likeCounts[like.post_id] = (likeCounts[like.post_id] || 0) + 1;
        if (like.user_id === session?.user?.id) ownLikes.add(String(like.post_id));
      }
      for (const item of replies || []) replyCounts[item.post_id] = (replyCounts[item.post_id] || 0) + 1;
      posts = rows.map(post => ({
        ...post,
        author: names[post.user_id] || "Aether member",
        likeCount: likeCounts[post.id] || 0,
        replyCount: replyCounts[post.id] || 0,
        likedByMe: ownLikes.has(String(post.id))
      }));
      renderPosts();
    } catch (error) {
      posts = [];
      feed.replaceChildren();
      const message = document.createElement("p");
      message.className = "feed-message";
      message.textContent = "The community feed could not load. " + error.message;
      feed.appendChild(message);
      setConnection("Community connection unavailable");
    }
  }

  async function loadReplies(article) {
    const postId = article.dataset.postId;
    let list = article.querySelector(".reply-list");
    if (list) {
      list.remove();
      return;
    }
    list = document.createElement("div");
    list.className = "reply-list";
    const loading = document.createElement("p");
    loading.className = "feed-message";
    loading.textContent = "Loading replies…";
    list.appendChild(loading);
    article.appendChild(list);
    try {
      const rows = await api("/rest/v1/forum_replies?select=id,user_id,body,created_at&post_id=eq." + encodeURIComponent(postId) + "&order=created_at.asc&limit=100");
      const userIds = [...new Set(rows.map(reply => reply.user_id).filter(Boolean))];
      const profiles = userIds.length
        ? await api("/rest/v1/profiles?select=id,username&id=in.(" + userIds.map(encodeURIComponent).join(",") + ")")
        : [];
      const names = Object.fromEntries(profiles.map(profile => [profile.id, profile.username]));
      list.replaceChildren();
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.className = "reply-item";
        empty.textContent = "No replies yet.";
        list.appendChild(empty);
      }
      for (const row of rows) {
        const item = document.createElement("p");
        item.className = "reply-item";
        const name = document.createElement("b");
        name.textContent = (names[row.user_id] || "Aether member") + " · ";
        item.append(name, document.createTextNode(row.body));
        list.appendChild(item);
      }
      const form = document.createElement("form");
      form.className = "reply-form";
      const input = document.createElement("input");
      input.name = "reply";
      input.maxLength = 4000;
      input.required = true;
      input.placeholder = session ? "Write a reply…" : "Sign in to reply";
      input.disabled = !session || authPending;
      const submit = document.createElement("button");
      submit.className = "post-action";
      submit.type = "submit";
      submit.textContent = "Reply";
      submit.disabled = !session || authPending;
      form.append(input, submit);
      list.appendChild(form);
    } catch (error) {
      list.replaceChildren();
      const message = document.createElement("p");
      message.className = "reply-item";
      message.textContent = "Replies could not load. " + error.message;
      list.appendChild(message);
    }
  }

  async function signOut() {
    if (session?.access_token) {
      try {
        await fetch(SUPABASE_URL + "/auth/v1/logout", {
          method: "POST",
          headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token }
        });
      } catch (error) {
        console.warn("Could not notify Supabase of sign-out:", error);
      }
    }
    saveSession(null);
    showAuthCredentials();
    if ($("communityAuthDialog").open) $("communityAuthDialog").close();
    setConnection("Signed out · browsing as a guest", true);
    await loadFeed();
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError("");
    const email = $("communityEmail").value.trim();
    const password = $("communityPassword").value;
    const button = $("communityAuthSubmit");
    button.disabled = true;
    button.textContent = signupMode ? "Creating account…" : "Signing in…";
    try {
      let result;
      if (!captchaToken) throw new Error("Complete the verification first.");
      if (signupMode) {
        if (!$("communityAgreement").checked) throw new Error("Accept the Terms of Service and acknowledge the Privacy Policy to create an account.");
        const username = $("communityUsername").value.trim();
        if (!/^[A-Za-z0-9_ -]{3,24}$/.test(username)) throw new Error("Username must be 3–24 characters: letters, numbers, spaces, _ or -.");
        result = await api("/auth/v1/signup", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            data: {
              username,
              age_group: $("communityAgeGroup").value,
              accepted_terms_version: "2026-11-15",
              accepted_terms_at: new Date().toISOString(),
              authenticator_opt_in: $("communityAuthenticatorOptIn").checked
            },
            gotrue_meta_security: { captcha_token: captchaToken }
          })
        }, false);
        if (!result.access_token) {
          setAuthError($("communityAuthenticatorOptIn").checked
            ? "Check your email to confirm your account. After you sign in, we’ll guide you through authenticator setup."
            : "Check your email to confirm your account, then sign in here.");
          $("communityPassword").value = "";
          return;
        }
      } else {
        result = await api("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email, password, gotrue_meta_security: { captcha_token: captchaToken } })
        }, false);
      }
      await handleAuthenticatedSession(result);
    } catch (error) {
      setAuthError(error.message || "Could not authenticate this account.");
    } finally {
      captchaToken = "";
      button.disabled = true;
      button.textContent = signupMode ? "Create account" : "Sign in";
      if (turnstileWidget !== null && window.turnstile) window.turnstile.reset(turnstileWidget);
    }
  }

  async function submitPost(event) {
    event.preventDefault();
    if (!session?.user?.id || authPending) return openAuthDialog();
    const title = $("communityPostTitle").value.trim();
    const body = $("communityPostBody").value.trim();
    if (!title || !body) return;
    const button = $("communityPostForm").querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api("/rest/v1/forum_posts", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          user_id: session.user.id,
          category: $("communityCategory").value,
          title,
          body
        })
      });
      $("communityPostForm").reset();
      renderAuthState();
      await loadFeed();
    } catch (error) {
      setConnection("Post failed: " + error.message);
    } finally {
      button.disabled = !session || authPending;
    }
  }

  async function handleFeedClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const article = button.closest(".post-card");
    if (!article) return;
    if (!session?.user?.id || authPending) return openAuthDialog();
    if (button.dataset.action === "replies") return loadReplies(article);
    if (button.dataset.action !== "like") return;
    button.disabled = true;
    const postId = article.dataset.postId;
    const post = posts.find(item => String(item.id) === postId);
    if (!post) return;
    try {
      if (post.likedByMe) {
        await api("/rest/v1/forum_likes?post_id=eq." + encodeURIComponent(postId) + "&user_id=eq." + encodeURIComponent(session.user.id), { method: "DELETE" });
      } else {
        await api("/rest/v1/forum_likes", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ post_id: Number(postId), user_id: session.user.id })
        });
      }
      await loadFeed();
    } catch (error) {
      setConnection("Could not update like: " + error.message);
    } finally {
      button.disabled = false;
    }
  }

  async function submitReply(event) {
    if (!event.target.matches(".reply-form")) return;
    event.preventDefault();
    if (!session?.user?.id || authPending) return openAuthDialog();
    const form = event.target;
    const article = form.closest(".post-card");
    const input = form.elements.reply;
    const body = input.value.trim();
    if (!body) return;
    form.querySelector("button").disabled = true;
    try {
      await api("/rest/v1/forum_replies", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ post_id: Number(article.dataset.postId), user_id: session.user.id, body })
      });
      await loadReplies(article);
      await loadFeed();
    } catch (error) {
      setConnection("Reply failed: " + error.message);
      form.querySelector("button").disabled = false;
    }
  }

  function init() {
    $("currentYear").textContent = String(new Date().getFullYear());
    $("communityJoin").addEventListener("click", openAuthDialog);
    $("communitySignOut").addEventListener("click", signOut);
    $("communityAuthClose").addEventListener("click", () => {
      if (authPending) {
        if (mfaMode === "setup") void skipAuthenticatorSetup();
        else void signOut();
        return;
      }
      $("communityAuthDialog").close();
    });
    $("communityAuthForm").addEventListener("submit", submitAuth);
    $("communityMfaCode").addEventListener("input", event => {
      event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
    });
    $("communityMfaVerify").addEventListener("click", verifyAuthenticatorCode);
    $("communityMfaSkip").addEventListener("click", skipAuthenticatorSetup);
    $("communityMfaCancel").addEventListener("click", signOut);
    $("communityAuthSwitch").addEventListener("click", () => {
      setAuthError("");
      setSignupMode(!signupMode);
    });
    $("communityRefresh").addEventListener("click", loadFeed);
    $("communityPostForm").addEventListener("submit", submitPost);
    $("communityFeed").addEventListener("click", handleFeedClick);
    $("communityFeed").addEventListener("submit", submitReply);
    $("communityFilters").addEventListener("click", event => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      selectedCategory = button.dataset.category;
      $("communityFilters").querySelectorAll("[data-category]").forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderPosts();
    });
    $("communityAuthDialog").addEventListener("click", event => {
      if (event.target === $("communityAuthDialog") && !authPending) $("communityAuthDialog").close();
    });
    $("communityAuthDialog").addEventListener("cancel", event => {
      if (authPending) event.preventDefault();
    });
    renderAuthState();
    if (session?.user?.id) {
      authPending = true;
      renderAuthState();
      void handleAuthenticatedSession(session);
      return;
    }
    if (new URLSearchParams(location.search).get("return") === "download") {
      if (session?.user?.id) {
        window.location.replace("download.html");
        return;
      }
      openAuthDialog();
    }
    loadFeed();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();

