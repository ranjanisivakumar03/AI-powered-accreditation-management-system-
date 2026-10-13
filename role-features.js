/* Role-aware sign-in, manual evidence records, and project JSON persistence. */
(function () {
  let pendingImage = null;
  let projectAPIAvailable = false;
  let projectDataReady;

  function publicUser(role) {
    const account = ACCOUNTS[role];
    return account ? { role: account.role, label: account.label, name: account.name, dept: account.dept, username: account.username } : null;
  }

  function syncUser() {
    if (!USER) return;
    const initials = USER.name.split(/\s+/).map(function (part) { return part[0]; }).slice(0, 2).join("").toUpperCase();
    $("#user-name").textContent = USER.name;
    $("#user-role").textContent = USER.label;
    $("#user-dept").textContent = USER.dept ? "Department: " + USER.dept : "Institution-wide access";
    $("#user-avatar").textContent = initials;
    $("#header-avatar").textContent = initials;
  }

  function applyPayload(data) {
    CR = data.criteria;
    EV = data.evidence;
    S.queue = data.queue;
    if (Array.isArray(data.reports)) S.reports = data.reports;
    if (data.metrics) {
      ["ready", "verified", "gaps", "pend"].forEach(function (key) {
        if (Number.isFinite(data.metrics[key])) S[key] = data.metrics[key];
      });
    }
  }

  function validPayload(data) {
    return data && data.schemaVersion === DATA_VERSION &&
      Array.isArray(data.criteria) && Array.isArray(data.evidence) && Array.isArray(data.queue);
  }

  async function postProjectJSON(data) {
    const response = await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    if (!response.ok) throw new Error("The project JSON file could not be saved.");
    try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (err) { console.warn("Browser backup unavailable", err); }
  }

  async function loadProjectJSON() {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (!response.ok) throw new Error("Project JSON API unavailable");
      const data = await response.json();
      if (!validPayload(data)) throw new Error("Unsupported project JSON file");
      projectAPIAvailable = true;
      if (data.updatedAt) {
        applyPayload(data);
      } else {
        await postProjectJSON(exportPayload());
      }
    } catch (err) {
      projectAPIAvailable = false;
      console.info("Project JSON server is unavailable; using browser storage.", err);
    }
  }

  async function persistData() {
    const data = exportPayload();
    if (!projectAPIAvailable) return saveData();
    try {
      await postProjectJSON(data);
      return true;
    } catch (err) {
      console.error("Could not save project JSON data", err);
      return false;
    }
  }

  projectDataReady = loadProjectJSON().then(function () {
    if (USER) R();
  });

  $("#login-role").onchange = function () {
    const account = ACCOUNTS[$("#login-role").value];
    $("#login-user").value = account.username;
    $("#login-password").value = account.password;
    $("#login-error").textContent = "";
  };
  $("#login-role").dispatchEvent(new Event("change"));

  $("#login-form").onsubmit = async function (event) {
    event.preventDefault();
    const role = $("#login-role").value;
    const account = ACCOUNTS[role];
    if ($("#login-user").value.trim() !== account.username || $("#login-password").value !== account.password) {
      $("#login-error").textContent = "That username and password do not match this role.";
      return;
    }
    await projectDataReady;
    USER = publicUser(role);
    try { sessionStorage.setItem(SESSION_KEY, role); } catch (err) { console.warn("Session storage unavailable", err); }
    $("#login-error").textContent = "";
    $("#login").style.display = "none";
    syncUser();
    if (!location.hash) location.hash = "#/dashboard";
    R();
  };

  $("#logout").onclick = function () {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { console.warn("Session storage unavailable", err); }
    USER = null;
    $("#login").style.display = "grid";
    $("#login-password").value = "";
    $("#login-error").textContent = "";
    $("#login-user").focus();
  };

  if (USER) {
    USER = publicUser(USER.role);
    syncUser();
  }

  // Project JSON persistence remains active without a JSON Data screen.

  P.evidence = function () {
    const filter = window._f || { d: "All", st: "All", q: "" };
    const items = visibleEvidence().filter(function (item) {
      return (filter.d === "All" || item.d === filter.d) &&
        (filter.st === "All" || item.s === filter.st) &&
        item.t.toLowerCase().includes(filter.q.toLowerCase());
    });
    const departments = ['<option>All</option>'].concat(DEPT.map(function (department) {
      return '<option ' + (department === filter.d ? "selected" : "") + '>' + esc(department) + "</option>";
    })).join("");
    const statuses = ["All", "Verified", "Approved", "Pending", "Changes Requested", "Rejected"].map(function (status) {
      return '<option ' + (status === filter.st ? "selected" : "") + ">" + status + "</option>";
    }).join("");
    return ph("Evidence Repository", items.length + " records visible to " + esc(USER.label),
      '<a class="btn p" href="#/evidence/upload">+ Add Evidence</a>') +
      '<div class="card"><div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
      '<input class="chip" style="flex:1;min-width:180px" placeholder="Search evidence..." value="' + esc(filter.q) +
      '" oninput="_f={...(_f||{d:\'All\',st:\'All\',q:\'\'}),q:this.value};R(\'keep\')" id="fq" aria-label="Search evidence">' +
      '<select class="chip" aria-label="Department" onchange="_f={...(_f||{d:\'All\',st:\'All\',q:\'\'}),d:this.value};R()">' + departments + "</select>" +
      '<select class="chip" aria-label="Status" onchange="_f={...(_f||{d:\'All\',st:\'All\',q:\'\'}),st:this.value};R()">' + statuses + "</select>" +
      '<span class="chip">2025–26</span></div><div id="evt">' + evTable(items) + "</div></div>";
  };

  function evidenceForm() {
    const department = USER.role === "admin"
      ? '<select name="department" required>' + DEPT.map(function (item) { return "<option>" + esc(item) + "</option>"; }).join("") + "</select>"
      : '<input type="hidden" name="department" value="' + esc(USER.dept) + '"><input value="' + esc(USER.dept) + '" disabled>';
    const criteria = CR.map(function (item) {
      return '<option value="' + esc(item.id) + '">' + esc(item.id + " — " + item.n) + "</option>";
    }).join("");
    return ph("Add Evidence", "Enter evidence details manually and attach an image. Its bytes are saved as Base64 in the project JSON file.") +
      '<form class="card evidence-form" id="evidence-form"><div class="grid g2">' +
      '<div><label for="ev-title">Evidence title</label><input id="ev-title" name="title" maxlength="120" required placeholder="For example: Faculty Development Programme"></div>' +
      '<div><label>Department</label>' + department + "</div>" +
      '<div><label for="ev-criterion">Accreditation criterion</label><select id="ev-criterion" name="criterion" required>' + criteria + "</select></div>" +
      '<div><label for="ev-year">Academic year</label><input id="ev-year" name="year" required value="2025–26" maxlength="20"></div>' +
      '<div><label for="ev-semester">Semester</label><select id="ev-semester" name="semester"><option>Semester 1</option><option>Semester 2</option><option>Annual</option></select></div>' +
      '</div><div><label for="ev-description">Description</label><textarea id="ev-description" name="description" maxlength="1000" placeholder="Add context, dates, or other details"></textarea></div>' +
      '<div><label for="evidence-image">Evidence image</label><input id="evidence-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required>' +
      '<p class="field-help">PNG, JPEG, WebP, or GIF · Maximum 1.5 MB. The image bytes are Base64 encoded in data.json.</p><div id="image-preview-wrap"></div></div>' +
      '<div><button class="btn p" type="submit">Save evidence record</button> <a class="btn" href="#/evidence">Cancel</a></div></form>';
  }
  P["evidence/upload"] = evidenceForm;

  function encodeImage(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(",")[1] || ""); };
      reader.onerror = function () { reject(reader.error || new Error("Image read failed")); };
      reader.readAsDataURL(file);
    });
  }

  function wireEvidenceForm() {
    pendingImage = null;
    const form = $("#evidence-form");
    const input = $("#evidence-image");
    if (!form) return;
    input.onchange = async function () {
      const file = input.files[0];
      pendingImage = null;
      $("#image-preview-wrap").innerHTML = "";
      if (!file) return;
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
        input.value = "";
        return toast("Choose a PNG, JPEG, WebP, or GIF image.", "⚠");
      }
      if (file.size > 1572864) {
        input.value = "";
        return toast("Choose an image smaller than 1.5 MB.", "⚠");
      }
      try {
        pendingImage = { name: file.name, mimeType: file.type, base64: await encodeImage(file) };
        $("#image-preview-wrap").innerHTML = '<img class="image-preview" src="' + esc(imageSrc(pendingImage)) + '" alt="Selected evidence image preview">';
      } catch (err) {
        toast("Could not read that image.", "⚠");
      }
    };
    form.onsubmit = saveEvidence;
  }

  async function saveEvidence(event) {
    event.preventDefault();
    await projectDataReady;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    const department = USER.role === "admin" ? String(formData.get("department") || "") : USER.dept;
    const criterion = String(formData.get("criterion") || "C1");
    const year = String(formData.get("year") || "2025–26").trim();
    const semester = String(formData.get("semester") || "Annual");
    const description = String(formData.get("description") || "").trim();
    if (!title || !department) return toast("Enter a title and department.", "⚠");
    if (!pendingImage) return toast("Upload an evidence image before saving this record.", "⚠");

    const before = JSON.parse(JSON.stringify(exportPayload()));
    const id = Math.max(0, ...EV.map(function (item) { return Number(item.id) || 0 })) + 1;
    const now = new Date();
    const entry = {
      id: id, t: title, d: department, c: criterion, s: "Pending", u: "Just now", by: USER.name,
      ai: 0, v: 0, type: pendingImage ? "Image" : "Manual", sem: semester,
      mo: now.toLocaleString("en-US", { month: "short", year: "numeric" }),
      year: year, description: description, image: pendingImage, createdAt: now.toISOString()
    };
    EV.unshift(entry);
    S.queue.unshift({ id: id, t: title, d: department, by: USER.name, ago: "just now", c: criterion, ai: 0, v: 0, miss: [], st: "Pending" });
    S.pend++;
    if (!await persistData()) {
      applyPayload(before);
      return toast("Could not write the evidence to the project JSON file. Keep the server running and try again.", "⚠");
    }
    pendingImage = null;
    window._f = null;
    toast(projectAPIAvailable ? "Evidence saved to data.json" : "Evidence saved in this browser. Start node server.js to save it to the project data.json file.");
    location.hash = "#/evidence";
    R();
  }

  function imagePreview(item) {
    const source = imageSrc(item.image);
    if (source) return '<img class="evidence-image" src="' + esc(source) + '" alt="' + esc(item.image.name || item.t) + '">';
    return '<div class="empty"><div style="font-size:34px">▧</div><b>No image attached</b><p>This evidence record has no saved image.</p></div>';
  }

  P["evidence/:id"] = function (id) {
    const item = visibleEvidence().find(function (evidence) { return evidence.id == id; });
    if (!item) return ph("Evidence unavailable", "This record is not visible to your account") + '<a class="btn" href="#/evidence">Back to Evidence</a>';
    const header = ph(esc(item.t), esc(item.d) + " · " + esc(item.year || "2025–26") + " · " + esc(item.sem),
      '<a class="btn" href="#/evidence">← Back</a>');
    const filename = item.image ? '<p class="field-help">Image file: ' + esc(item.image.name || "Evidence image") + "</p>" : "";
    return header + '<div class="grid g2"><div class="card"><h3>' + esc(item.type || "Evidence") + " preview</h3><br>" +
      '<div class="doc evidence-document">' + imagePreview(item) + "</div>" + filename +
      (item.description ? '<p class="sub">' + esc(item.description) + "</p>" : "") + "</div>" +
      '<div><div class="card mb"><div class="row"><span>Criterion</span><b>' + esc(item.c) + "</b></div>" +
      '<div class="row"><span>Status</span>' + stb(item.s) + "</div><div class=\"row\"><span>Submitted by</span><b>" +
      esc(item.by) + "</b></div><div class=\"row\"><span>Academic year</span><b>" + esc(item.year || "2025–26") +
      "</b></div><div class=\"row\"><span>Semester</span><b>" + esc(item.sem || "Annual") + "</b></div></div>" +
      '<div class="ai mb"><h3>Evidence checks</h3><p>Record is saved and awaiting review.</p></div></div></div>';
  };

  P.approvals = function () {
    const queue = visibleQueue();
    const items = queue.filter(function (item) { return item.st === S.tab; });
    const tabs = ["Pending", "Approved", "Rejected", "Changes Requested"];
    return ph("Approval Center", queue.filter(function (item) { return item.st === "Pending"; }).length + " items awaiting review") +
      '<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">' +
      tabs.map(function (tab) { return '<button class="fc ' + (S.tab === tab ? "on" : "") +
        '" onclick="S.tab=\'' + tab + '\';R()">' + (tab === "Pending" ? "My Queue" : tab) +
        " (" + queue.filter(function (item) { return item.st === tab; }).length + ")</button>"; }).join("") +
      "</div>" + (items.length ? items.map(function (item) {
        return '<div class="card mb approval-card"><div><b style="font-size:16px">' + esc(item.t) +
          '</b><div class="sub" style="margin:2px 0">' + esc(item.d) + " · Submitted by " + esc(item.by) + " · " +
          esc(item.ago) + " · Criterion " + esc(item.c) + '</div><span class="badge s-ai">AI confidence: ' +
          item.ai + '%</span> <span class="badge s-ok">Verification: ' + item.v +
          '%</span></div><button class="btn p" onclick="review(' + item.id + ')">Review Evidence</button></div>';
      }).join("") : '<div class="card empty">Nothing here.</div>');
  };

  review = function (id) {
    const item = visibleQueue().find(function (entry) { return entry.id == id; });
    if (!item) return toast("This item is not in your review queue.", "⚠");
    const evidence = EV.find(function (entry) { return entry.id == id; });
    const source = evidence && imageSrc(evidence.image);
    const image = source ? '<img class="image-preview" src="' + esc(source) + '" alt="' +
      esc(evidence.image.name || evidence.t) + '">' : "";
    modal("<h2>" + esc(item.t) + '</h2><p class="sub">' + esc(item.d) + " · " + esc(item.by) + " · " +
      esc(item.ago) + '</p><div class="grid g2" style="margin-top:14px"><div class="doc"><b>Evidence details</b><hr><p>' +
      esc(evidence && evidence.description || "No description provided.") + "</p>" + image +
      '</div><div class="ai"><h3>Review details</h3><p>Criterion mapping: <b>' + esc(item.c) + "</b></p>" +
      bars([["Mapping", item.ai, "ok"], ["Verification", item.v, "ok"]]) + "<b>Missing items</b><br>" +
      (item.miss && item.miss.length ? item.miss.map(function (missing) {
        return '<span class="badge s-warn">' + esc(missing) + "</span> ";
      }).join("") : "No missing items recorded.") + '</div></div><br><div style="display:flex;gap:8px;flex-wrap:wrap">' +
      '<button class="btn ok" onclick="decide(' + id + ',\'Approved\')">Approve</button>' +
      '<button class="btn" onclick="decide(' + id + ',\'Changes Requested\')">Request Changes</button>' +
      '<button class="btn bad" onclick="decide(' + id + ',\'Rejected\')">Reject</button></div>');
  };

  decide = async function (id, status) {
    await projectDataReady;
    const item = visibleQueue().find(function (entry) { return entry.id == id; });
    if (!item || item.st !== "Pending") return toast("This item is no longer pending in your review queue.", "⚠");
    const before = JSON.parse(JSON.stringify(exportPayload()));
    const reviewedAt = new Date().toISOString();
    item.st = status;
    item.reviewedAt = reviewedAt;
    const evidence = EV.find(function (entry) { return entry.id == id; });
    if (evidence) {
      evidence.s = status;
      evidence.reviewedAt = reviewedAt;
    }
    S.pend = Math.max(0, S.pend - 1);
    if (status === "Approved") {
      S.ready = Math.min(100, Math.round((S.ready + 0.2) * 10) / 10);
      S.verified++;
      S.gaps = Math.max(0, S.gaps - 1);
      const criterion = CR.find(function (entry) { return entry.id === item.c; });
      if (criterion) {
        criterion.e++;
        criterion.pe = Math.max(0, criterion.pe - 1);
        criterion.p = Math.min(100, criterion.p + 1);
      }
    }
    if (!await persistData()) {
      applyPayload(before);
      closeM();
      R();
      return toast("Could not save the review update to the project JSON file.", "⚠");
    }
    closeM();
    toast(status === "Approved" ? "Evidence approved." : "Review status updated.");
    R();
  };

  function parseEvidenceDate(item, field) {
    const raw = field === "reviewed" ? item.reviewedAt : item.createdAt;
    if (raw) {
      const parsed = new Date(raw);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    if (field !== "reviewed" && item.mo) {
      const monthDate = new Date("1 " + item.mo);
      if (!Number.isNaN(monthDate.getTime())) return monthDate;
    }
    if (field !== "reviewed" && item.u) {
      const relative = item.u.toLowerCase();
      const days = relative === "today" ? 0 : relative === "yesterday" ? 1 :
        Number((relative.match(/(\d+)\s+days?\s+ago/) || [])[1] || 0);
      const weeks = Number((relative.match(/(\d+)\s+weeks?\s+ago/) || [])[1] || 0);
      if (days || weeks || relative === "today" || relative === "yesterday") {
        const date = new Date();
        date.setDate(date.getDate() - days - weeks * 7);
        return date;
      }
    }
    return null;
  }

  P.timeline = function () {
    const events = [];
    visibleEvidence().forEach(function (item) {
      const added = parseEvidenceDate(item, "added");
      if (added) events.push({ date: added, item: item, label: "Evidence added", icon: "↑" });
      const reviewed = parseEvidenceDate(item, "reviewed");
      if (reviewed) events.push({ date: reviewed, item: item, label: "Review updated", icon: "✓" });
    });
    events.sort(function (a, b) { return b.date - a.date; });
    const content = events.length ? '<div class="tl">' + events.map(function (event) {
      const date = event.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return '<div class="ti"><div class="nd">' + event.icon + '</div><div class="card"><small class="sub">' +
        date + " · " + event.label + '</small><div class="timeline-entry"><div><b>' + esc(event.item.t) +
        '</b><div class="sub" style="margin:0">' + esc(event.item.d) + " · Criterion " +
        esc(event.item.c) + " · Submitted by " + esc(event.item.by) + "</div></div>" + stb(event.item.s) +
        "</div></div></div>";
    }).join("") + "</div>" : '<div class="card empty">Evidence activity will appear here when records are submitted or reviewed.</div>';
    return ph("Academic Evidence Timeline", events.length + " activity events from your visible evidence records",
      '<span class="chip">' + (USER.role === "admin" ? "All departments" : esc(USER.dept)) + "</span>") + content;
  };

  const dashboardBase = P.dashboard;
  P.dashboard = function () {
    return dashboardBase().replace("Good morning, Dr. Ananya", "Good morning, " + esc(USER.name));
  };

  P["ai-copilot"] = function () {
    return ph("Accreditation Copilot", "Ask about evidence, readiness, review workflow, reports, or criteria.") +
      '<div class="card"><div class="chat" id="chat"><div class="msg a"><b>Hello, ' + esc(USER.name) +
      "</b><br>Ask about accreditation readiness, evidence, criteria, and next steps.</div></div>" +
      '<div class="search copilot-input"><input id="cq" placeholder="Ask the Copilot a question…" aria-label="Ask the Accreditation Copilot">' +
      '<button class="btn p" onclick="sendCopilotQuestion()">Send</button></div></div>';
  };
  if (USER && location.hash === "#/ai-copilot") R();

  function copilotAnswerValues() {
    const evidence = visibleEvidence();
    const verified = evidence.filter(function (item) { return item.s === "Verified" || item.s === "Approved"; }).length;
    const pending = evidence.filter(function (item) { return item.s === "Pending" || item.s === "Changes Requested"; }).length;
    const sorted = CR.slice().sort(function (a, b) { return a.p - b.p; });
    const recent = evidence.slice(0, 3).map(function (item) { return item.t + " (" + item.d + ")"; });
    return {
      readiness: S.ready,
      gaps: S.gaps,
      visibleEvidenceCount: evidence.length,
      verifiedCount: verified,
      pendingCount: pending,
      openApprovals: visibleQueue().filter(function (item) { return item.st === "Pending"; }).length,
      imageCount: evidence.filter(function (item) { return !!item.image; }).length,
      departmentEvidenceCount: USER.dept ? evidence.filter(function (item) { return item.d === USER.dept; }).length : evidence.length,
      weakestCriterion: sorted.length ? sorted[0].id + " — " + sorted[0].n + " (" + sorted[0].p + "%)" : "no criterion data is loaded",
      strongestCriterion: sorted.length ? sorted[sorted.length - 1].id + " — " + sorted[sorted.length - 1].n + " (" + sorted[sorted.length - 1].p + "%)" : "no criterion data is loaded",
      criteriaSummary: sorted.map(function (item) { return item.id + " " + item.p + "%"; }).join(", "),
      recentEvidence: recent.length ? recent.join(", ") : "no visible evidence records yet",
      role: USER.label,
      department: USER.dept || "all departments"
    };
  }

  function appendCopilotMessage(question, answerText) {
    const chat = $("#chat");
    if (!chat) return;
    const userMessage = document.createElement("div");
    userMessage.className = "msg u";
    userMessage.textContent = question;
    chat.appendChild(userMessage);

    const answerMessage = document.createElement("div");
    answerMessage.className = "msg a";
    const heading = document.createElement("b");
    heading.textContent = "✦ Accreditation Copilot";
    const answer = document.createElement("p");
    answer.className = "copilot-answer";
    if (answerText) {
      const values = copilotAnswerValues();
      answer.textContent = answerText.replace(/\{([A-Za-z0-9]+)\}/g, function (placeholder, key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder;
      });
    } else {
      answer.textContent = "I could not find a close answer. Try asking about evidence, a criterion, readiness, approvals, reports, or the timeline.";
    }
    answerMessage.appendChild(heading);
    answerMessage.appendChild(answer);
    chat.appendChild(answerMessage);
    chat.scrollTop = chat.scrollHeight;
  }

  window.ask = async function (question) {
    const text = String(question || "").trim();
    if (!text) return;
    const input = $("#cq");
    if (input) input.value = "";
    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text })
      });
      if (!response.ok) throw new Error("Copilot answer request failed.");
      const result = await response.json();
      appendCopilotMessage(text, result.answer);
    } catch (error) {
      console.warn("Could not get a Copilot answer.", error);
      appendCopilotMessage(text, "The Copilot answer service could not be reached. Make sure the project server is running, then try again.");
    }
  };

  window.sendCopilotQuestion = function () {
    const input = $("#cq");
    if (input) window.ask(input.value);
  };

  document.addEventListener("keydown", function (event) {
    if (event.target && event.target.id === "cq" && event.key === "Enter") {
      event.preventDefault();
      window.sendCopilotQuestion();
    }
  });

  function normalizedSearchText(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  P.search = function () {
    const suggestions = ["All evidence", "CSE", "ECE", "Pending", "Approved", "Verified", "Criterion 3", "Criterion 4", "2025"];
    return ph("Smart Search", "Search evidence by title, department, criterion, status, submitter, or academic year.") +
      '<div class="search"><span style="padding:8px 4px;font-size:20px">✦</span>' +
      '<input id="sq" placeholder="Try CSE, pending, Criterion 3, or 2025" aria-label="Search evidence" onkeydown="if(event.key===\'Enter\')doSearch()">' +
      '<button class="btn p" onclick="doSearch()">Search</button></div>' +
      '<p class="sub" style="margin:8px 4px">Choose a keyword to filter the evidence records visible to your account.</p>' +
      '<div class="search-suggestions">' + suggestions.map(function (word) {
      return '<button class="fc" data-search-query="' + esc(word) +
          '" onclick="searchKeyword(this.dataset.searchQuery)">' + esc(word) + "</button>";
      }).join("") + '</div><div id="sr"><div class="card empty">Choose a keyword or enter a search above.</div></div>';
  };

  window.searchKeyword = function (word) {
    const allRecords = word === "All evidence";
    $("#sq").value = allRecords ? "" : word;
    doSearch(allRecords);
    $$('[data-search-query]').forEach(function (button) {
      button.classList.toggle("on", button.dataset.searchQuery === word);
    });
  };

  doSearch = function (showAll) {
    const query = ($("#sq").value || "").trim();
    const items = visibleEvidence();
    if (!query && !showAll) {
      $("#sr").innerHTML = '<div class="card empty">Enter a keyword or choose “All evidence”.</div>';
      return;
    }

    const lower = query.toLowerCase();
    const criterionMatch = lower.match(/\bcriterion\s*([1-7])\b|\bc([1-7])\b/);
    const criterion = criterionMatch ? "C" + (criterionMatch[1] || criterionMatch[2]) : "";
    const departments = DEPT.filter(function (department) { return lower.includes(department.toLowerCase()); });
    const statuses = ["Changes Requested", "Pending", "Verified", "Approved", "Rejected"].filter(function (status) {
      return lower.includes(status.toLowerCase());
    });
    const years = lower.match(/\b20\d{2}\b/g) || [];
    const ignored = new Set(["show", "find", "search", "evidence", "document", "documents", "record", "records",
      "the", "for", "from", "in", "of", "to", "with", "about", "all", "my", "our", "please", "criterion", "status"]);
    const terms = normalizedSearchText(query).split(/\s+/).filter(function (term) {
      return term && !ignored.has(term) && !/^\d+$/.test(term) && !/^c[1-7]$/.test(term) &&
        !DEPT.some(function (department) { return department.toLowerCase() === term; }) &&
        !statuses.some(function (status) { return status.toLowerCase() === term; });
    });
    const matches = items.filter(function (item) {
      if (criterion && item.c !== criterion) return false;
      if (departments.length && !departments.includes(item.d)) return false;
      if (statuses.length && !statuses.includes(item.s)) return false;
      const searchable = normalizedSearchText([
        item.t, item.d, item.c, "criterion " + String(item.c || "").replace(/^C/i, ""),
        item.s, item.by, item.year, item.mo, item.sem, item.description, item.type,
        item.image && item.image.name, item.createdAt
      ].join(" "));
      if (!terms.every(function (term) { return searchable.includes(term); })) return false;
      const dateFields = normalizedSearchText([item.year, item.mo, item.createdAt, item.u].join(" "));
      return years.every(function (year) { return dateFields.includes(year); });
    });
    const unique = Array.from(new Map(matches.map(function (item) { return [String(item.id), item]; })).values());
    const message = showAll ? "Showing all " + unique.length + " visible evidence records." :
      unique.length + " unique evidence record" + (unique.length === 1 ? "" : "s") + " match “" + query + "”.";
    $("#sr").innerHTML = '<div class="ai mb"><h3>Search results</h3><p>' + esc(message) +
      '</p></div><div class="card">' + evTable(unique) + "</div>";
  };

  function reportScopeField() {
    const target = $("#report-scope-value");
    if (!target) return;
    if (W.scope === "Department") {
      const departments = USER.role === "admin" ? DEPT : [USER.dept];
      target.innerHTML = '<label for="report-department">Department</label><select id="report-department">' +
        departments.map(function (department) { return '<option>' + esc(department) + "</option>"; }).join("") + "</select>";
      $("#report-department").value = W.department;
      $("#report-department").onchange = function () { W.department = this.value; };
    } else if (W.scope === "Specific Criteria") {
      target.innerHTML = '<label for="report-criterion">Criterion</label><select id="report-criterion">' +
        CR.map(function (item) { return '<option value="' + esc(item.id) + '">' + esc(item.id + " — " + item.n) + "</option>"; }).join("") +
        "</select>";
      $("#report-criterion").value = W.criterion;
      $("#report-criterion").onchange = function () { W.criterion = this.value; };
    } else {
      target.innerHTML = "";
    }
  }

  wizard = function () {
    W = {
      fw: "NAAC", scope: USER.role === "admin" ? "Entire Institution" : "Department",
      department: USER.dept || DEPT[0], criterion: CR[0] ? CR[0].id : "C1",
      ty: "Readiness Report", year: "2025–26"
    };
    const scopeOptions = USER.role === "admin"
      ? ["Entire Institution", "Department", "Specific Criteria"]
      : ["Department", "Specific Criteria"];
    modal('<h2>Generate an evidence report</h2><p class="sub">The report will use the current evidence records and review statuses.</p>' +
      '<div class="wiz"><label>Framework<select id="report-framework" class="chip"><option>NAAC</option><option>NBA</option></select></label>' +
      '<label>Academic year<input id="report-year" class="chip" value="' + esc(W.year) + '" maxlength="20"></label>' +
      '<label>Scope<select id="report-scope" class="chip">' + scopeOptions.map(function (scope) {
        return '<option>' + esc(scope) + "</option>";
      }).join("") + '</select></label><div id="report-scope-value"></div>' +
      '<label>Report type<select id="report-type" class="chip">' +
      ["Readiness Report", "Criterion Report", "Evidence Summary", "Comprehensive Report"].map(function (type) {
        return "<option>" + esc(type) + "</option>";
      }).join("") + '</select></label></div><br><button class="btn p" onclick="genRep()">Generate Report</button>');
    $("#report-framework").onchange = function () { W.fw = this.value; };
    $("#report-year").oninput = function () { W.year = this.value.trim(); };
    $("#report-scope").onchange = function () { W.scope = this.value; reportScopeField(); };
    $("#report-type").onchange = function () { W.ty = this.value; };
    reportScopeField();
  };

  function reportEvidenceRows(evidence) {
    return evidence.map(function (item) {
      return {
        id: item.id, t: item.t, d: item.d, c: item.c, s: item.s, by: item.by,
        year: item.year || "", sem: item.sem || "", description: item.description || "",
        imageName: item.image && item.image.name ? item.image.name : ""
      };
    });
  }

  function makeReport() {
    const year = String(W.year || "").trim();
    const visible = visibleEvidence().filter(function (item) {
      if (!year || year === "All academic years") return true;
      const requestedYear = (year.match(/20\d{2}/) || [])[0];
      const recordYear = [item.year, item.mo, item.createdAt].filter(Boolean).join(" ");
      if (!recordYear) return true;
      return requestedYear ? recordYear.includes(requestedYear) : normalizedSearchText(recordYear) === normalizedSearchText(year);
    });
    let evidence = visible;
    if (W.scope === "Department") evidence = evidence.filter(function (item) { return item.d === W.department; });
    if (W.scope === "Specific Criteria") evidence = evidence.filter(function (item) { return item.c === W.criterion; });
    evidence = Array.from(new Map(evidence.map(function (item) { return [String(item.id), item]; })).values());

    const selectedCriteria = CR.filter(function (criterion) {
      return W.scope !== "Specific Criteria" || criterion.id === W.criterion;
    }).map(function (criterion) {
      const records = evidence.filter(function (item) { return item.c === criterion.id; });
      return {
        id: criterion.id, name: criterion.n, readiness: Number(criterion.p) || 0,
        evidence: records.length,
        verified: records.filter(function (item) { return item.s === "Verified" || item.s === "Approved"; }).length,
        pending: records.filter(function (item) { return item.s === "Pending" || item.s === "Changes Requested"; }).length
      };
    });
    const verified = evidence.filter(function (item) { return item.s === "Verified" || item.s === "Approved"; }).length;
    const pending = evidence.filter(function (item) { return item.s === "Pending" || item.s === "Changes Requested"; }).length;
    const readiness = selectedCriteria.length
      ? Math.round(selectedCriteria.reduce(function (total, criterion) { return total + criterion.readiness; }, 0) / selectedCriteria.length)
      : 0;
    const recommendations = selectedCriteria.map(function (criterion) {
      if (!criterion.evidence) return criterion.id + " has no evidence records in this report scope.";
      if (criterion.pending) return criterion.id + " has " + criterion.pending + " record(s) waiting for review.";
      return criterion.id + " has " + criterion.verified + " approved or verified record(s).";
    });
    const scopeLabel = W.scope === "Department" ? "Department · " + W.department :
      W.scope === "Specific Criteria" ? "Criterion · " + W.criterion : W.scope;
    return {
      id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 7), generatedReport: true, title: W.fw + " " + W.ty,
      framework: W.fw, type: W.ty, year: year || "All academic years", scope: scopeLabel,
      generatedBy: USER.name, generatedAt: new Date().toISOString(), readiness: readiness,
      totals: { evidence: evidence.length, verified: verified, pending: pending },
      criteria: selectedCriteria, evidence: reportEvidenceRows(evidence), recommendations: recommendations
    };
  }

  genRep = async function () {
    await projectDataReady;
    const report = makeReport();
    const previousReports = S.reports.slice();
    S.reports.unshift(report);
    if (!await persistData()) {
      S.reports = previousReports;
      return toast("The report could not be saved with the current data.", "⚠");
    }
    window._activeReportId = report.id;
    closeM();
    toast("Report generated from " + report.totals.evidence + " evidence records.");
    if (location.hash === "#/reports/preview") R();
    else location.hash = "#/reports/preview";
  };

  P.reports = function () {
    const reports = S.reports.filter(function (report) { return report && report.generatedReport === true; });
    const cards = reports.length ? reports.map(function (report) {
      return '<div class="card report-card"><div style="font-size:28px">📄</div><h3>' + esc(report.title) + "</h3>" +
        '<p class="sub">' + esc(report.framework) + " · " + esc(report.year) + " · " + esc(report.scope) +
        '</p><p class="sub">' + report.totals.evidence + " evidence · " + report.totals.verified +
        " verified · Generated " + esc(new Date(report.generatedAt).toLocaleString()) + '</p>' +
        '<button class="btn p" data-report-open="' + esc(report.id) + '">View report</button> ' +
        '<button class="btn" data-report-download="' + esc(report.id) + '">Download JSON</button></div>';
    }).join("") : '<div class="card empty">No reports have been generated from your evidence yet. Generate a report to see current evidence and review status summarized here.</div>';
    return ph("Accreditation Reports", "Generate reports from evidence currently stored in the repository.",
      '<button class="btn p" onclick="wizard()">+ Generate Report</button>') + '<div class="grid g2">' + cards + "</div>";
  };

  function findReport(id) {
    const reports = S.reports.filter(function (report) { return report && report.generatedReport === true; });
    return reports.find(function (report) { return String(report.id) === String(id); }) || reports[0] || null;
  }

  P["reports/preview"] = function () {
    const report = findReport(window._activeReportId);
    if (!report) return ph("Report Preview", "Generate a report from the current evidence first.") +
      '<a class="btn" href="#/reports">Back to reports</a>';
    const criteriaRows = report.criteria.map(function (item) {
      return "<tr><td>" + esc(item.id + " — " + item.name) + "</td><td>" + item.readiness + "%</td><td>" +
        item.evidence + "</td><td>" + item.verified + "</td><td>" + item.pending + "</td></tr>";
    }).join("");
    const evidenceRows = report.evidence.map(function (item) {
      return "<tr><td>" + esc(item.t) + "</td><td>" + esc(item.d) + "</td><td>" + esc(item.c) +
        "</td><td>" + esc(item.s) + "</td><td>" + esc(item.by) + "</td><td>" + esc(item.year || report.year) + "</td><td>" + esc(item.imageName || "—") + "</td></tr>";
    }).join("");
    const recommendations = report.recommendations.map(function (recommendation) {
      return "<li>" + esc(recommendation) + "</li>";
    }).join("");
    return ph(esc(report.title), esc(report.framework + " · " + report.year + " · " + report.scope),
      '<a class="btn" href="#/reports">Back to reports</a>') +
      '<div class="rep"><div class="cv"><b style="letter-spacing:.2em">ACCREDIAI</b><h1 style="font-size:38px;margin:40px 0 8px">' +
      esc(report.title) + '</h1><p>' + esc(report.framework + " · " + report.year + " · " + report.scope) +
      '</p><p style="margin-top:24px;opacity:.8">Generated by ' + esc(report.generatedBy) + " · " +
      esc(new Date(report.generatedAt).toLocaleString()) + '</p></div><div class="bd"><h2>Evidence Summary</h2>' +
      '<p>Evidence records: <b>' + report.totals.evidence + "</b> · Approved or verified: <b>" +
      report.totals.verified + "</b> · Awaiting review: <b>" + report.totals.pending +
      "</b> · Average criterion readiness: <b>" + report.readiness + "%</b></p><br>" +
      '<h3>Criteria</h3><div class="tw"><table><thead><tr><th>Criterion</th><th>Readiness</th><th>Evidence</th><th>Verified</th><th>Pending</th></tr></thead><tbody>' +
      (criteriaRows || '<tr><td colspan="5">No criteria in this report scope.</td></tr>') +
      '</tbody></table></div><br><h3>Evidence records</h3><div class="tw"><table><thead><tr><th>Evidence</th><th>Department</th><th>Criterion</th><th>Status</th><th>Submitted by</th><th>Year</th><th>Image attachment</th></tr></thead><tbody>' +
      (evidenceRows || '<tr><td colspan="7">No evidence matched this report scope.</td></tr>') +
      '</tbody></table></div><br><h3>Recommendations</h3><ul>' + recommendations + "</ul></div></div>" +
      '<button class="btn" style="margin-top:14px" data-report-download="' + esc(report.id) + '">Download report JSON</button>';
  };

  window.openReport = function (id) {
    window._activeReportId = id;
    if (location.hash === "#/reports/preview") R();
    else location.hash = "#/reports/preview";
  };

  window.downloadReport = function (id) {
    const report = findReport(id);
    if (!report) return toast("Report not found.", "⚠");
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = report.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".json";
    link.click();
    URL.revokeObjectURL(url);
  };

  document.addEventListener("click", function (event) {
    const open = event.target.closest("[data-report-open]");
    if (open) window.openReport(open.dataset.reportOpen);
    const download = event.target.closest("[data-report-download]");
    if (download) window.downloadReport(download.dataset.reportDownload);
  });
  const renderBase = R;
  R = function (keep) {
    if (!USER) return;
    if (keep === "keep") {
      const filter = window._f || { d: "All", st: "All", q: "" };
      $("#evt").innerHTML = evTable(visibleEvidence().filter(function (item) {
        return (!filter.q || item.t.toLowerCase().includes(filter.q.toLowerCase())) &&
          (filter.d === "All" || item.d === filter.d) && (filter.st === "All" || item.s === filter.st);
      }));
      return;
    }
    const route = (location.hash || "#/dashboard").slice(2);
    const root = route.split("/")[0];
    if (!canOpen(root)) {
      toast("This page is not available for your role.", "⚠");
      location.hash = "#/dashboard";
      return;
    }
    const match = route.match(/^evidence\/(\d+)$/);
    if (match && !visibleEvidence().some(function (item) { return item.id == match[1]; })) {
      location.hash = "#/evidence";
      return;
    }
    renderBase(keep);
  };

  wireUp = wireEvidenceForm;
  $("#menu").onclick = function () { $("#side").classList.toggle("on"); };

  if (USER) {
    $("#login").style.display = "none";
    syncUser();
    projectDataReady.then(function () { if (USER) R(); });
  } else {
    $("#login").style.display = "grid";
  }
})();

