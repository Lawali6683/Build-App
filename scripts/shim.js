(function () {
  var CFG = __CONFIG__;
  var B = CFG.base, P = CFG.paths, U = CFG.update;

  function fix(u) {
    try {
      var r = new URL(u, location.href);
      if (r.origin === location.origin && P.some(function (p) { return r.pathname.indexOf(p) === 0; })) return B + r.pathname + r.search + r.hash;
    } catch (e) {}
    return u;
  }

  var f = window.fetch.bind(window);
  window.fetch = function (i, o) {
    if (typeof i === "string" || i instanceof URL) return f(fix(String(i)), o);
    if (i && i.url) {
      var n = fix(i.url);
      if (n !== i.url) return f(new Request(n, i), o);
    }
    return f(i, o);
  };

  var x = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    var a = [].slice.call(arguments);
    a[1] = fix(String(u));
    return x.apply(this, a);
  };

  function banner() {
    try { if (sessionStorage.getItem("idt_upd")) return; } catch (e) {}
    var d = document.createElement("div");
    d.setAttribute("style", "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;background:#101434;color:#fff;border-radius:12px;padding:12px 14px;font:600 14px system-ui,sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 8px 24px rgba(0,0,0,.35)");
    var t = document.createElement("span");
    t.style.flex = "1";
    t.textContent = "A new version is available";
    var a = document.createElement("a");
    a.href = U.link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "Update";
    a.setAttribute("style", "background:#ffb400;color:#101434;padding:8px 12px;border-radius:8px;text-decoration:none");
    var c = document.createElement("button");
    c.textContent = "\u00d7";
    c.setAttribute("aria-label", "Close");
    c.setAttribute("style", "background:none;border:0;color:#fff;font-size:20px");
    c.onclick = function () {
      try { sessionStorage.setItem("idt_upd", "1"); } catch (e) {}
      d.remove();
    };
    d.appendChild(t);
    d.appendChild(a);
    d.appendChild(c);
    document.body.appendChild(d);
  }

  function check() {
    if (!navigator.onLine) return;
    f(U.url + "/rest/v1/rpc/latest_version", {
      method: "POST",
      headers: { apikey: U.key, "content-type": "application/json" },
      body: JSON.stringify({ p_share: U.share }),
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (v) { if (typeof v === "number" && v > U.version) banner(); })
      .catch(function () {});
  }

  if (U) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", check);
    else check();
  }
})();
