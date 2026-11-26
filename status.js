(() => {
  "use strict";
  const BASE = window.AETHER_SUPABASE_URL;
  const KEY = window.AETHER_SUPABASE_KEY;
  const SESSION_KEY = "aether-community-web-session-v1";
  const $ = id => document.getElementById(id);
  const SERVICE_STATES = [
    ["operational", "Operational"],
    ["degraded", "Degraded performance"],
    ["partial_outage", "Partial outage"],
    ["major_outage", "Major outage"],
    ["maintenance", "Maintenance"]
  ];
  const INCIDENT_STATES = [
    ["investigating", "Investigating"],
    ["identified", "Identified"],
    ["monitoring", "Monitoring"],
    ["resolved", "Resolved"]
  ];
  const IMPACTS = [["minor", "Minor"], ["major", "Major"], ["critical", "Critical"]];
  let session = readSession();
  let services = [];
  let incidents = [];
  let updates = [];
  let canEdit = false;

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return value?.access_token && value?.user?.id ? value : null;
    } catch { return null; }
  }

  function saveSession(value) {
    session = value?.access_token && value?.user?.id ? value : null;
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
    updateEditorAccess();
  }

  async function api(path, options = {}, retry = true) {
    const response = await fetch(BASE + path, {
      ...options,
      headers: {
        apikey: KEY,
        Authorization: "Bearer " + (session?.access_token || KEY),
        "Content-Type": "application/json",
        ...options.headers
      }
    });
    if (response.status === 401 && retry && session?.refresh_token) {
      const refreshed = await fetch(BASE + "/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        headers: { apikey: KEY, "Content-Type": "application/json" },
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
    if (!response.ok) throw new Error(data?.message || data?.msg || data?.details || data?.error_description || "Request failed (" + response.status + ")");
    return data;
  }

  function setMessage(message, error = false) {
    const target = $("statusMessage");
    target.textContent = message;
    target.classList.toggle("is-error", error);
  }

  function statusLabel(value) {
    return [...SERVICE_STATES, ...INCIDENT_STATES].find(([key]) => key === value)?.[1] || value;
  }

  function selectControl(items, selected, className = "") {
    const select = document.createElement("select");
    if (className) select.className = className;
    for (const [value, label] of items) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      option.selected = value === selected;
      select.appendChild(option);
    }
    return select;
  }

  function badge(value, labels) {
    const node = document.createElement("span");
    node.className = "status-badge status-" + value.replace(/_/g, "-");
    node.textContent = labels.find(([key]) => key === value)?.[1] || value;
    return node;
  }

  function empty(container, message) {
    container.replaceChildren();
    const p = document.createElement("p");
    p.className = "status-empty";
    p.textContent = message;
    container.appendChild(p);
  }

  function renderServices() {
    const container = $("statusServices");
    container.replaceChildren();
    if (!services.length) {
      empty(container, canEdit ? "No services yet. Add the services you want people to track." : "The status board is being set up.");
      return;
    }
    for (const service of services) {
      const card = document.createElement("article");
      card.className = "status-service-card";
      const head = document.createElement("div");
      head.className = "status-service-head";
      const copy = document.createElement("div");
      copy.className = "status-service-copy";
      const title = document.createElement("h3");
      title.textContent = service.name;
      const description = document.createElement("p");
      description.textContent = service.description || "Project Aether service";
      copy.append(title, description);
      head.append(copy, badge(service.status, SERVICE_STATES));
      card.appendChild(head);
      if (canEdit) {
        const editor = document.createElement("div");
        editor.className = "status-inline-editor";
        const select = selectControl(SERVICE_STATES, service.status);
        select.setAttribute("aria-label", "Set status for " + service.name);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button button-quiet status-save-button";
        button.dataset.saveService = service.id;
        button.textContent = "Save status";
        editor.append(select, button);
        card.appendChild(editor);
      }
      container.appendChild(card);
    }
  }

  function renderIncidents() {
    const container = $("statusIncidents");
    container.replaceChildren();
    if (!incidents.length) {
      empty(container, "No incidents reported. All posted updates will appear here.");
      return;
    }
    for (const incident of incidents) {
      const card = document.createElement("article");
      card.className = "status-incident-card";
      const head = document.createElement("div");
      head.className = "status-incident-head";
      const title = document.createElement("h3");
      title.textContent = incident.title;
      const tags = document.createElement("div");
      tags.className = "status-incident-tags";
      tags.append(badge(incident.impact, IMPACTS), badge(incident.status, INCIDENT_STATES));
      head.append(title, tags);
      card.appendChild(head);

      const history = document.createElement("div");
      history.className = "status-update-history";
      const relatedUpdates = updates.filter(update => update.incident_id === incident.id);
      for (const update of relatedUpdates) {
        const item = document.createElement("div");
        item.className = "status-update-item";
        const meta = document.createElement("div");
        meta.className = "status-update-meta";
        const state = document.createElement("strong");
        state.textContent = statusLabel(update.status);
        const time = document.createElement("time");
        time.dateTime = update.created_at;
        time.textContent = new Date(update.created_at).toLocaleString();
        meta.append(state, time);
        const message = document.createElement("p");
        message.textContent = update.message;
        item.append(meta, message);
        history.appendChild(item);
      }
      if (!relatedUpdates.length) {
        const message = document.createElement("p");
        message.className = "status-empty";
        message.textContent = "No updates have been posted yet.";
        history.appendChild(message);
      }
      card.appendChild(history);

      if (canEdit) {
        const editor = document.createElement("form");
        editor.className = "status-incident-update-form";
        editor.dataset.updateIncident = incident.id;
        const controls = document.createElement("div");
        controls.className = "status-editor-row";
        const statusSelect = selectControl(INCIDENT_STATES, incident.status);
        statusSelect.name = "status";
        statusSelect.setAttribute("aria-label", "Incident status");
        const impactSelect = selectControl(IMPACTS, incident.impact);
        impactSelect.name = "impact";
        impactSelect.setAttribute("aria-label", "Incident impact");
        controls.append(statusSelect, impactSelect);
        const message = document.createElement("textarea");
        message.name = "message";
        message.maxLength = 2000;
        message.rows = 2;
        message.placeholder = "Post an update for players…";
        message.setAttribute("aria-label", "Incident update");
        const button = document.createElement("button");
        button.type = "submit";
        button.className = "button button-quiet";
        button.textContent = "Post update";
        editor.append(controls, message, button);
        card.appendChild(editor);
      }
      container.appendChild(card);
    }
  }

  function setOverview() {
    const overview = $("statusOverview");
    const serviceWeight = { operational: 0, maintenance: 1, degraded: 1, partial_outage: 2, major_outage: 3 };
    const incidentWeight = { minor: 1, major: 2, critical: 3 };
    const active = incidents.filter(item => item.status !== "resolved");
    const worstService = services.reduce((worst, item) => Math.max(worst, serviceWeight[item.status] || 0), 0);
    const worstIncident = active.reduce((worst, item) => Math.max(worst, incidentWeight[item.impact] || 0), 0);
    const state = Math.max(worstService, worstIncident);
    const label = state >= 3 ? "Major outage" : state === 2 ? "Partial outage" : state === 1 ? "Degraded performance" : "All systems operational";
    const dataState = state >= 3 ? "major-outage" : state === 2 ? "partial-outage" : state === 1 ? "degraded" : "operational";
    overview.dataset.state = services.length ? dataState : "loading";
    $("statusOverall").textContent = services.length ? label : "Status board is being set up";
    const dates = [...services, ...incidents, ...updates].map(item => Date.parse(item.updated_at || item.created_at)).filter(Number.isFinite);
    $("statusUpdated").textContent = dates.length ? "Last updated " + new Date(Math.max(...dates)).toLocaleString() : "Waiting for the first status update.";
  }

  function refreshView() {
    renderServices();
    renderIncidents();
    setOverview();
  }

  async function updateEditorAccess() {
    canEdit = false;
    $("statusEditor").hidden = true;
    $("statusAuthHint").hidden = !!session;
    if (!session) return;
    try {
      const owner = await api("/rest/v1/rpc/aether_has_role", { method: "POST", body: JSON.stringify({ requested_role: "Owner" }) });
      const coOwner = owner ? false : await api("/rest/v1/rpc/aether_has_role", { method: "POST", body: JSON.stringify({ requested_role: "Co-owner" }) });
      canEdit = owner === true || coOwner === true;
      $("statusEditor").hidden = !canEdit;
      $("statusAuthHint").hidden = true;
      refreshView();
    } catch {
      $("statusAuthHint").hidden = false;
    }
  }

  async function loadBoard() {
    $("statusRefresh").disabled = true;
    setMessage("");
    try {
      const [serviceRows, incidentRows, updateRows] = await Promise.all([
        api("/rest/v1/aether_status_services?select=id,name,description,status,sort_order,updated_at&order=sort_order.asc,name.asc"),
        api("/rest/v1/aether_status_incidents?select=id,title,status,impact,created_at,updated_at&order=created_at.desc&limit=20"),
        api("/rest/v1/aether_status_updates?select=id,incident_id,status,message,created_at&order=created_at.desc&limit=60")
      ]);
      services = Array.isArray(serviceRows) ? serviceRows : [];
      incidents = Array.isArray(incidentRows) ? incidentRows : [];
      updates = Array.isArray(updateRows) ? updateRows : [];
      refreshView();
    } catch (error) {
      $("statusOverview").dataset.state = "error";
      $("statusOverall").textContent = "Status board unavailable";
      $("statusUpdated").textContent = "Please try refreshing in a moment.";
      setMessage("The status board needs its one-time database setup. Ask the site owner to run supabase-status-page.sql in the Supabase SQL Editor. " + (error.message || ""), true);
      empty($("statusServices"), "Service information is unavailable until setup is complete.");
      empty($("statusIncidents"), "Incident history is unavailable until setup is complete.");
    } finally {
      $("statusRefresh").disabled = false;
    }
  }

  async function saveService(button) {
    const card = button.closest(".status-service-card");
    const select = card.querySelector("select");
    button.disabled = true;
    try {
      await api("/rest/v1/aether_status_services?id=eq." + encodeURIComponent(button.dataset.saveService), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: select.value, updated_at: new Date().toISOString(), updated_by: session.user.id })
      });
      setMessage("Service status saved.");
      await loadBoard();
    } catch (error) {
      setMessage("Could not save service status: " + error.message, true);
      button.disabled = false;
    }
  }

  async function addService(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await api("/rest/v1/aether_status_services", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          name: String(data.get("name") || "").trim(),
          description: String(data.get("description") || "").trim(),
          status: "operational",
          sort_order: services.length,
          created_by: session.user.id,
          updated_by: session.user.id
        })
      });
      form.reset();
      setMessage("Service added.");
      await loadBoard();
    } catch (error) {
      setMessage("Could not add service: " + error.message, true);
    } finally { button.disabled = false; }
  }

  async function createIncident(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const rows = await api("/rest/v1/aether_status_incidents", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          title: String(data.get("title") || "").trim(),
          status: data.get("status"),
          impact: data.get("impact"),
          created_by: session.user.id,
          updated_by: session.user.id
        })
      });
      const incident = Array.isArray(rows) ? rows[0] : rows;
      if (!incident?.id) throw new Error("Incident was created without an ID.");
      await api("/rest/v1/aether_status_updates", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          incident_id: incident.id,
          status: data.get("status"),
          message: String(data.get("message") || "").trim(),
          author_id: session.user.id
        })
      });
      form.reset();
      setMessage("Incident posted.");
      await loadBoard();
    } catch (error) {
      setMessage("Could not post incident: " + error.message, true);
      await loadBoard();
    } finally { button.disabled = false; }
  }

  async function updateIncident(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const button = form.querySelector('[type="submit"]');
    const incidentId = form.dataset.updateIncident;
    const incident = incidents.find(item => item.id === incidentId);
    if (!incident) return;
    const message = String(data.get("message") || "").trim() || "Status updated to " + statusLabel(data.get("status")) + ".";
    button.disabled = true;
    try {
      await api("/rest/v1/aether_status_incidents?id=eq." + encodeURIComponent(incidentId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          status: data.get("status"),
          impact: data.get("impact"),
          updated_at: new Date().toISOString(),
          updated_by: session.user.id
        })
      });
      await api("/rest/v1/aether_status_updates", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          incident_id: incidentId,
          status: data.get("status"),
          message,
          author_id: session.user.id
        })
      });
      setMessage("Incident update posted.");
      await loadBoard();
    } catch (error) {
      setMessage("Could not post incident update: " + error.message, true);
      await loadBoard();
    } finally { button.disabled = false; }
  }

  $("statusServiceForm").addEventListener("submit", addService);
  $("statusIncidentForm").addEventListener("submit", createIncident);
  $("statusServices").addEventListener("click", event => {
    const button = event.target.closest("[data-save-service]");
    if (button) saveService(button);
  });
  $("statusIncidents").addEventListener("submit", event => {
    if (event.target.matches("[data-update-incident]")) updateIncident(event);
  });
  $("statusRefresh").addEventListener("click", loadBoard);
  $("currentYear").textContent = String(new Date().getFullYear());
  loadBoard();
  updateEditorAccess();
})();
