"use strict";

// Legacy orders.js is disabled when SPA (app.js) is present.
if (window.__DN247_SPA__) {
  // no-op
} else {
(() => {
  const $ = (sel) => document.querySelector(sel);

  const elId = document.querySelector("[data-order-id]");
  const elStatus = document.querySelector("[data-order-status]");
  const elUpdated = document.querySelector("[data-order-updated]");
  const statusBar = document.querySelector(".orderStatusBar");

  function getOrderId() {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get("id") || url.searchParams.get("orderId");
    if (fromQuery) return fromQuery;

    const keys = [
      "dn247_last_order_id_v1", // ✅ твой ключ
      "lastOrderId",
      "orderId",
      "dn_last_order_id",
      "delivery_last_order_id",
    ];

    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && String(v).trim()) return String(v).trim();
    }
    return null;
  }

  function setStatusClass(code) {
    if (!statusBar) return;

    // убираем предыдущие status--...
    statusBar.classList.forEach((c) => {
      if (c.startsWith("status--")) statusBar.classList.remove(c);
    });

    const safe = String(code || "").trim().toUpperCase();
    if (!safe) return;

    statusBar.classList.add(`status--${safe}`);
  }

  async function load(orderId) {
    const r = await fetch(`/api/orders/public/${encodeURIComponent(orderId)}`, {
      cache: "no-store",
    });

    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!data?.ok || !data?.order) throw new Error("Bad response");

    const o = data.order;

    // UI
    if (elId) elId.textContent = o.id || orderId;
    if (elStatus) elStatus.textContent = o.status || o.status_code || "—";
    if (elUpdated) elUpdated.textContent = new Date(o.updatedAt || Date.now()).toLocaleString();

    // ✅ подсветка ТОЛЬКО по status_code
    setStatusClass(o.status_code);

    return o;
  }

  async function start() {
    const id = getOrderId();
    if (!id) {
      if (elId) elId.textContent = "—";
      if (elStatus) elStatus.textContent = "НЕТ ID ЗАКАЗА";
      setStatusClass(""); // без подсветки
      return;
    }

    // первая загрузка
    try {
      await load(id);
    } catch (e) {
      if (elStatus) elStatus.textContent = "ОШИБКА ЗАГРУЗКИ";
      console.error(e);
    }

    // обновление раз в 3 сек
    setInterval(async () => {
      try {
        await load(id);
      } catch (e) {
        console.error(e);
      }
    }, 3000);
  }

  start();
})();

}
