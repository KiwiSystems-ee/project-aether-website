(() => {
  "use strict";

  const SUPABASE_URL = window.AETHER_SUPABASE_URL;
  const SUPABASE_KEY = window.AETHER_SUPABASE_KEY;
  const SESSION_KEY = "aether-community-web-session-v1";
  const $ = id => document.getElementById(id);
  const categories = ["General", "Help & Support", "World Showcase", "Add-ons", "Suggestions"];
  let session = readSession();
  let signupMode = false;
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
    const signedIn = !!session?.user?.id;
    $("communitySignOut").hidden = !signedIn;
    $("communityJoin").textContent = signedIn ? "You’re part of Aether" : "Join the conversation";
    $("communityComposeHint").textContent = signedIn
      ? "Posting as " + (session.user.user_metadata?.username || session.user.email || "Aether member")
      : "Sign in to share with the community.";
    ["communityPostTitle", "communityPostBody", "communityCategory"].forEach(id => { $(id).disabled = !signedIn; });
    $("communityPostForm").querySelector('[type="submit"]').disabled = !signedIn;
    if (signedIn) setConnection("Signed in as " + (session.user.email || "Aether member"), true);
    else setConnection("Public community · sign in to post", true);
  }

  function setAuthError(message) {
    const error = $("communityAuthError");
    error.textContent = message;
    error.hidden = !message;
  }

  function openAuthDialog() {
    if (session) {
      $("communityPostTitle").focus();
      $("communityPostTitle").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    $("communityAuthDialog").showModal();
    $("communityTurnstile").hidden = false;
    renderTurnstile();
    $("communityEmail").focus();
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
      input.disabled = !session;
      const submit = document.createElement("button");
      submit.className = "post-action";
      submit.type = "submit";
      submit.textContent = "Reply";
      submit.disabled = !session;
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
              accepted_terms_at: new Date().toISOString()
            },
            gotrue_meta_security: { captcha_token: captchaToken }
          })
        }, false);
        if (!result.access_token) {
          setAuthError("Check your email to confirm your account, then sign in here.");
          $("communityPassword").value = "";
          return;
        }
      } else {
        result = await api("/auth/v1/token?grant_type=password", {
          method: "POST",
          body: JSON.stringify({ email, password, gotrue_meta_security: { captcha_token: captchaToken } })
        }, false);
      }
      saveSession(result);
      if (new URLSearchParams(location.search).get("return") === "download") {
        window.location.replace("download.html");
        return;
      }
      $("communityAuthDialog").close();
      $("communityAuthForm").reset();
      setSignupMode(false);
      setConnection("Signed in · welcome to the community", true);
      await loadFeed();
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
    if (!session?.user?.id) return openAuthDialog();
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
      button.disabled = !session;
    }
  }

  async function handleFeedClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const article = button.closest(".post-card");
    if (!article) return;
    if (!session?.user?.id) return openAuthDialog();
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
    if (!session?.user?.id) return openAuthDialog();
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
    $("communityAuthClose").addEventListener("click", () => $("communityAuthDialog").close());
    $("communityAuthForm").addEventListener("submit", submitAuth);
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
      if (event.target === $("communityAuthDialog")) $("communityAuthDialog").close();
    });
    renderAuthState();
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
