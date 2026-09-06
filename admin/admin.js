(() => {
  const qs = (s) => document.querySelector(s);

  async function login() {
    const password = qs("#password").value;
    const res = await fetch("/api/admin/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.success) {
      qs("#login-screen").classList.add("hidden");
      qs("#editor-screen").classList.remove("hidden");
      await loadType();
    } else {
      qs("#login-msg").textContent = data.message || "Login failed.";
    }
  }

  async function loadType() {
    const type = qs("#content-type").value;
    const res = await fetch(`/api/admin/content/${type}`, { credentials: "same-origin" });
    const data = await res.json();
    if (res.status === 401) {
      qs("#editor-screen").classList.add("hidden");
      qs("#login-screen").classList.remove("hidden");
      return;
    }
    qs("#content-editor").value = JSON.stringify(data, null, 2);
    qs("#editor-msg").textContent = "";
  }

  async function saveType() {
    const type = qs("#content-type").value;
    let parsed;
    try {
      parsed = JSON.parse(qs("#content-editor").value);
    } catch (e) {
      qs("#editor-msg").textContent = "Invalid JSON — not saved. " + e.message;
      return;
    }
    const res = await fetch(`/api/admin/content/${type}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
    const data = await res.json();
    qs("#editor-msg").textContent = data.success ? "Saved." : data.message || "Save failed.";
  }

  qs("#login-btn").addEventListener("click", login);
  qs("#password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
  qs("#load-btn").addEventListener("click", loadType);
  qs("#save-btn").addEventListener("click", saveType);
  qs("#content-type").addEventListener("change", loadType);
})();
