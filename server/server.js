import "dotenv/config";
import express from "express";
import multer from "multer";
import Stripe from "stripe";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 8080);

// ✅ Надёжные пути (не зависят от того, откуда ты запускаешь node)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ROOT = .../delivery-nalchik
const ROOT = path.join(__dirname, "..");

// ------------------ Stripe (optional) ------------------
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeKey ? new Stripe(stripeKey) : null;
void stripe;

// ------------------ CORS ------------------
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Dashboard-Key, X-Admin-Key, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ✅ STATIC и главная страница — теперь всегда из delivery-nalchik/public
app.use(express.static(path.join(ROOT, "public")));

// Ensure uploads dir exists
const UPLOADS_ROOT = path.join(ROOT, "public", "uploads");
fs.mkdirSync(UPLOADS_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const kind = String(req.query.kind || "misc");
    const safeKind = kind === "products" || kind === "icons3d" ? kind : "misc";
    const dest = path.join(UPLOADS_ROOT, safeKind);
    fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".bin";
    const base = path
      .basename(file.originalname || "file", ext)
      .toLowerCase()
      .replace(/[^a-z0-9\-_]+/g, "-")
      .slice(0, 50) || "file";
    const stamp = Date.now().toString(36);
    cb(null, `${base}-${stamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(file.mimetype);
    cb(ok ? null : new Error("Bad file type"), ok);
  },
});

app.post("/api/admin/upload", requireAdminKey, upload.single("file"), (req, res) => {
  const kind = String(req.query.kind || "misc");
  const safeKind = kind === "products" || kind === "icons3d" ? kind : "misc";
  const fname = req.file?.filename;
  if (!fname) return res.status(400).json({ ok: false, error: "No file" });
  res.json({ ok: true, url: `/uploads/${safeKind}/${fname}` });
});


app.get("/", (req, res) => res.sendFile(path.join(ROOT, "public", "index.html")));

// ------------------ Health ------------------
app.get("/api/health", (req, res) => res.json({ ok: true }));

// ------------------ ZONES ------------------
const ZONES = [
  { id: "center", name_ru: "Центр", fee: 149, min: 0, freeFrom: 1500 },
  { id: "gornaya", name_ru: "Горная", fee: 199, min: 300, freeFrom: 1700 },
  { id: "dubki", name_ru: "Дубки", fee: 249, min: 500, freeFrom: 2000 },
  { id: "alex", name_ru: "Александровка", fee: 299, min: 700, freeFrom: 2300 },
];

app.get("/api/zones", (req, res) => {
  res.json({ ok: true, zones: ZONES });

// ------------------ PRODUCTS STORAGE ------------------
const PRODUCTS_FILE = path.join(ROOT, "data", "products.json");

function readProducts() {
  try {
    const raw = fs.readFileSync(PRODUCTS_FILE, "utf-8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    // fallback to seed in public if exists
    try {
      const seed = fs.readFileSync(path.join(ROOT, "public", "products.seed.json"), "utf-8");
      const arr = JSON.parse(seed);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
}

function writeProducts(arr) {
  fs.mkdirSync(path.dirname(PRODUCTS_FILE), { recursive: true });
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(arr, null, 2), "utf-8");
}

// Public: get products
app.get("/api/products", (req, res) => {
  res.json({ ok: true, products: readProducts() });
});

// Admin: replace products list
app.put("/api/admin/products", requireAdminKey, (req, res) => {
  const arr = req.body?.products;
  if (!Array.isArray(arr)) return res.status(400).json({ ok: false, error: "Bad products" });
  // minimal sanitize
  const clean = arr.map((p) => ({
    id: String(p.id || "").trim() || ("p_" + Math.random().toString(36).slice(2, 8)),
    name_ru: String(p.name_ru || ""),
    name_en: String(p.name_en || ""),
    desc_ru: String(p.desc_ru || ""),
    desc_en: String(p.desc_en || ""),
    price: Number(p.price || 0),
    cat_ru: String(p.cat_ru || ""),
    cat_en: String(p.cat_en || ""),
    emoji: String(p.emoji || "🛍️"),
    hot: Boolean(p.hot),
    popular: Number(p.popular || 0),
    image: p.image ? String(p.image) : "",
    icon3d: p.icon3d ? String(p.icon3d) : "",
  }));
  writeProducts(clean);
  res.json({ ok: true, products: clean });
});


});

// ------------------ DASHBOARD AUTH ------------------
// Простой доступ по ключу (для кабинета курьера/диспетчера).
// Фронт шлёт header: X-Dashboard-Key: <key>


function requireAdminKey(req, res, next) {
  const expected = String(process.env.ADMIN_KEY || "");
  const got = String(req.header("X-Admin-Key") || "");
  if (!expected) return next(); // demo
  if (!got || got !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  return next();
}

function requireDashboardKey(req, res, next) {
  const expected = String(process.env.DASHBOARD_KEY || "").trim();
  const got = String(req.header("X-Dashboard-Key") || "").trim();

  // Если ключ в .env не задан — считаем, что доступ открыт (удобно для демо)
  if (!expected) return next();

  if (!got || got !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  return next();
}

// ------------------ ORDERS STORAGE ------------------
const ORDERS_FILE = path.join(ROOT, "data", "orders.json");

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf-8")) || [];
  } catch {
    return [];
  }
}

function writeOrders(arr) {
  fs.mkdirSync(path.dirname(ORDERS_FILE), { recursive: true });
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(arr, null, 2), "utf-8");
}

function genId() {
  return (
    "DN" +
    Date.now().toString(36).toUpperCase() +
    Math.random().toString(16).slice(2, 6).toUpperCase()
  );
}

const STATUS = {
  NEW: "NEW",
  ACCEPTED: "ACCEPTED",
  PICKING: "PICKING",
  ON_THE_WAY: "ON_THE_WAY",
  DONE: "DONE",
  CANCELED: "CANCELED",
};

// ------------------ HELPERS ------------------
function normalizeStatus(s) {
  let v = String(s ?? "").trim().toUpperCase();
  v = v.replace(/[.\s]+$/g, ""); // "DONE." -> "DONE"
  v = v.replace(/\s+/g, "_");    // "ON THE WAY" -> "ON_THE_WAY"
  return v;
}

function statusRu(s) {
  const code = normalizeStatus(s);
  return (
    {
      NEW: "НОВЫЙ",
      ACCEPTED: "ПРИНЯТ",
      PICKING: "СОБИРАЕМ",
      ON_THE_WAY: "В ПУТИ",
      DONE: "ДОСТАВЛЕН",
      CANCELED: "ОТМЕНЁН",
    }[code] || code
  );
}

function payRu(p) {
  return (
    {
      card: "Картой онлайн",
      cash: "Наличными",
      transfer: "Переводом",
    }[p] || "Не указано"
  );
}

function rub(n) {
  const v = Math.round(Number(n) || 0);
  return `${v}₽`;
}

function canMove(from, to) {
  const f = normalizeStatus(from);
  const t = normalizeStatus(to);

  const ok = {
    NEW: new Set(["ACCEPTED", "CANCELED"]),
    ACCEPTED: new Set(["PICKING", "CANCELED"]),
    PICKING: new Set(["ON_THE_WAY", "CANCELED"]),
    ON_THE_WAY: new Set(["DONE", "CANCELED"]),
    DONE: new Set([]),
    CANCELED: new Set([]),
  };

  return (ok[f] || new Set()).has(t);
}

function parseIds(str) {
  return String(str || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

const COURIER_IDS = new Set(parseIds(process.env.COURIER_IDS));

function displayUser(u) {
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim();
  const username = u?.username ? `@${u.username}` : "";
  const id = u?.id ? `id:${u.id}` : "";
  return [name || "Курьер", username, id].filter(Boolean).join(" ").trim();
}

// ------------------ TELEGRAM UI ------------------
function tgKeyboard(order) {
  const st = normalizeStatus(order.status);

  if (st === STATUS.DONE || st === STATUS.CANCELED) return { inline_keyboard: [] };

  if (st === STATUS.NEW) {
    return {
      inline_keyboard: [
        [{ text: "✅ Принять", callback_data: `S|${order.id}|${STATUS.ACCEPTED}` }],
        [{ text: "❌ Отменить", callback_data: `S|${order.id}|${STATUS.CANCELED}` }],
      ],
    };
  }

  if (st === STATUS.ACCEPTED) {
    return {
      inline_keyboard: [
        [{ text: "🛍️ Собираем", callback_data: `S|${order.id}|${STATUS.PICKING}` }],
        [{ text: "❌ Отменить", callback_data: `S|${order.id}|${STATUS.CANCELED}` }],
      ],
    };
  }

  if (st === STATUS.PICKING) {
    return {
      inline_keyboard: [
        [{ text: "🚗 В пути", callback_data: `S|${order.id}|${STATUS.ON_THE_WAY}` }],
        [{ text: "❌ Отменить", callback_data: `S|${order.id}|${STATUS.CANCELED}` }],
      ],
    };
  }

  return {
    inline_keyboard: [
      [{ text: "📦 Доставлен", callback_data: `S|${order.id}|${STATUS.DONE}` }],
      [{ text: "❌ Отменить", callback_data: `S|${order.id}|${STATUS.CANCELED}` }],
    ],
  };
}

function formatOrderToTelegram(o, zone) {
  const c = o.customer || {};
  const items = o.items || [];
  const totals = o.totals || {};

  const itemsText =
    items.length > 0
      ? items
          .map((it) => `• ${it.name_ru || it.name_en} × ${it.qty} = ${rub(it.price * it.qty)}`)
          .join("\n")
      : "• (нет товаров)";

  const courierLine = o.meta?.courier?.label ? `👤 Курьер: ${o.meta.courier.label}` : "";

  return [
    `📦 ЗАКАЗ — Delivery Nalchik 24/7`,
    ``,
    `🆔 ${o.id}`,
    `🕒 ${new Date(o.createdAt).toLocaleString("ru-RU")}`,
    `📌 Статус: ${statusRu(o.status)}`,
    ...(courierLine ? [courierLine] : []),
    ``,
    `👤 ${c.name}`,
    `📞 ${c.phone}`,
    `📍 ${c.address}`,
    `🗺️ ${zone?.name_ru} (${rub(zone?.fee)})`,
    `💳 ${payRu(c.pay)}`,
    `📝 ${c.comment || "—"}`,
    ``,
    itemsText,
    ``,
    `Товары: ${rub(totals.itemsTotal)}`,
    `Доставка: ${rub(totals.deliveryFee)}`,
    `💰 ИТОГО: ${rub(totals.grandTotal)}`,
  ].join("\n");
}

// ------------------ TELEGRAM API ------------------
async function tgApi(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${token}/${method}`;

  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await r.json();
  if (!data.ok) throw new Error(JSON.stringify(data));
  return data.result;
}

async function tgAnswerCallback(callbackQueryId, text, alert = false) {
  try {
    await tgApi("answerCallbackQuery", {
      callback_query_id: callbackQueryId,
      text,
      show_alert: alert,
    });
  } catch (e) {
    console.error("answerCallbackQuery error:", e.message);
  }
}

async function tgSendToChat(chatId, text, replyToMessageId = null) {
  const payload = { chat_id: chatId, text };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;

  try {
    await tgApi("sendMessage", payload);
    return true;
  } catch (e) {
    console.error("sendMessage error:", e.message);
    return false;
  }
}

async function sendTelegramOrderMessage(text, replyMarkup) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const res = await tgApi("sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
  return { chatId: res.chat.id, messageId: res.message_id };
}

async function updateTelegramOrderMessage(order) {
  if (!order.meta?.telegram) return;

  const zone = ZONES.find((z) => z.id === order.customer.zoneId);
  const text = formatOrderToTelegram(order, zone);

  try {
    await tgApi("editMessageText", {
      chat_id: order.meta.telegram.chatId,
      message_id: order.meta.telegram.messageId,
      text,
      reply_markup: tgKeyboard(order),
    });
  } catch (e) {
    console.error("editMessageText error:", e.message);
  }
}

async function notifyAccepted(order) {
  const courier = order.meta?.courier?.label || "—";
  const total = rub(order.totals?.grandTotal || 0);

  const msg = [
    `✅ Заказ ${order.id} *принят*`,
    `👤 Курьер: ${courier}`,
    `📌 Статус: ${statusRu(order.status)}`,
    `💰 Сумма: ${total}`,
    `ℹ️ Этот заказ уже закреплён за курьером (другой не сможет принять).`,
  ].join("\n");

  const chatId = order.meta?.telegram?.chatId || process.env.TELEGRAM_CHAT_ID;
  const replyId = order.meta?.telegram?.messageId || null;

  const ok = await tgSendToChat(chatId, msg);
  if (!ok && replyId) await tgSendToChat(chatId, msg, replyId);
}

// ------------------ TELEGRAM POLLING ------------------
async function startTelegramPolling() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  console.log("✅ Telegram polling STARTED");
  console.log(
    "👤 Couriers allowed:",
    COURIER_IDS.size ? [...COURIER_IDS].join(", ") : "(any — COURIER_IDS empty)"
  );

  let offset = 0;

  while (true) {
    try {
      const r = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?timeout=30&offset=${offset}`
      );
      const data = await r.json();

      for (const upd of data.result || []) {
        offset = upd.update_id + 1;
        const cq = upd.callback_query;
        if (!cq) continue;

        const parts = String(cq.data || "").split("|");
        if (parts.length !== 3) {
          await tgAnswerCallback(cq.id, "Некорректная кнопка", true);
          continue;
        }

        const [, orderId, rawNextStatus] = parts;
        const nextStatus = normalizeStatus(rawNextStatus);
        const userId = cq.from?.id;

        if (COURIER_IDS.size && !COURIER_IDS.has(userId)) {
          await tgAnswerCallback(cq.id, "⛔️ Нет доступа (только курьеры)", true);
          continue;
        }

        const all = readOrders();
        const idx = all.findIndex((o) => o.id === orderId);
        if (idx < 0) {
          await tgAnswerCallback(cq.id, "Заказ не найден", true);
          continue;
        }

        const order = all[idx];
        order.meta = order.meta || {};
        order.meta.courier = order.meta.courier || null;

        order.status = normalizeStatus(order.status);

        if (order.status === STATUS.DONE || order.status === STATUS.CANCELED) {
          await tgAnswerCallback(cq.id, "Этот заказ уже завершён", true);
          continue;
        }

        if (!canMove(order.status, nextStatus)) {
          await tgAnswerCallback(cq.id, "Нельзя менять статус в таком порядке", true);
          continue;
        }

        const prevStatus = order.status;
        const courierLabel = displayUser(cq.from);

        if (nextStatus === STATUS.ACCEPTED) {
          if (order.meta.courier?.userId && order.meta.courier.userId !== userId) {
            await tgAnswerCallback(cq.id, `⛔ Уже принят: ${order.meta.courier.label}`, true);
            continue;
          }
          order.meta.courier = { userId, label: courierLabel };
        } else {
          if (!order.meta.courier?.userId) {
            await tgAnswerCallback(cq.id, "Сначала нажми «Принять»", true);
            continue;
          }
          if (order.meta.courier.userId !== userId) {
            await tgAnswerCallback(cq.id, `⛔ Заказ у курьера: ${order.meta.courier.label}`, true);
            continue;
          }
        }

        order.status = nextStatus;
        order.updatedAt = new Date().toISOString();

        all[idx] = order;
        writeOrders(all);

        await updateTelegramOrderMessage(order);

        if (prevStatus === STATUS.NEW && nextStatus === STATUS.ACCEPTED) {
          await notifyAccepted(order);
        }

        await tgAnswerCallback(cq.id, "✅ Обновлено");
      }
    } catch (e) {
      console.error("TG polling error:", e.message);
    }

    await new Promise((r) => setTimeout(r, 400));
  }
}

// ------------------ CREATE ORDER ------------------
app.post("/api/order", async (req, res) => {
  try {
    const order = req.body;
    const zone = ZONES.find((z) => z.id === order.customer.zoneId);

    const record = {
      id: genId(),
      status: STATUS.NEW,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      customer: order.customer,
      items: order.items,
      totals: order.totals,
      meta: {},
    };

    const all = readOrders();
    all.unshift(record);
    writeOrders(all);

    const tg = await sendTelegramOrderMessage(
      formatOrderToTelegram(record, zone),
      tgKeyboard(record)
    );

    record.meta.telegram = tg;
    writeOrders([record, ...all.slice(1)]);

    res.json({ ok: true, orderId: record.id });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ------------------ DASHBOARD API (courier/dispatcher) ------------------
// Список всех заказов (доступ по X-Dashboard-Key)
app.get("/api/orders", requireDashboardKey, (req, res) => {
  const all = readOrders();
  res.json({ ok: true, orders: all });
});

// Обновить статус заказа (доступ по X-Dashboard-Key)
app.patch("/api/orders/:id", requireDashboardKey, async (req, res) => {
  try {
    const id = String(req.params.id || "");
    const nextStatus = normalizeStatus(req.body?.status);

    const all = readOrders();
    const idx = all.findIndex((o) => o.id === id);
    if (idx < 0) return res.status(404).json({ ok: false, error: "Not found" });

    const order = all[idx];
    order.status = normalizeStatus(order.status);

    // Нельзя двигать завершённые
    if (order.status === STATUS.DONE || order.status === STATUS.CANCELED) {
      return res.status(400).json({ ok: false, error: "Order is final" });
    }

    if (!nextStatus || !Object.values(STATUS).includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: "Bad status" });
    }

    if (!canMove(order.status, nextStatus)) {
      return res.status(400).json({ ok: false, error: "Invalid transition" });
    }

    const prevStatus = order.status;

    // Для совместимости с Telegram-логикой: если заказ ещё не закреплён,
    // а мы двигаем статус из дашборда — закрепим за "Dashboard".
    order.meta = order.meta || {};
    if (!order.meta.courier) {
      order.meta.courier = { userId: 0, label: "Dashboard" };
    }

    order.status = nextStatus;
    order.updatedAt = new Date().toISOString();

    all[idx] = order;
    writeOrders(all);

    await updateTelegramOrderMessage(order);
    if (prevStatus === STATUS.NEW && nextStatus === STATUS.ACCEPTED) {
      await notifyAccepted(order);
    }

    res.json({ ok: true, order });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// ------------------ ORDER FOR SITE (public) ------------------
app.get("/api/orders/:id", (req, res) => {
  const all = readOrders();
  const order = all.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false });
  return res.json(buildPublicOrderPayload(order));
});

// public-версия (совместимость)
app.get("/api/orders/public/:id", (req, res) => {
  const all = readOrders();
  const order = all.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ ok: false });
  return res.json(buildPublicOrderPayload(order));
});

// ------------------ LIVE UPDATES (SSE) ------------------
// Клиент (app.js) подключается сюда: /api/orders/stream/:id
app.get("/api/orders/stream/:id", (req, res) => {
  const id = String(req.params.id || "");

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let lastSig = "";

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const tick = () => {
    const all = readOrders();
    const order = all.find((o) => o.id === id);

    if (!order) {
      send({ ok: false, order: null });
      return false;
    }

    const payload = buildPublicOrderPayload(order);
    const sig = `${payload.order.status}|${payload.order.updatedAt || ""}`;

    if (sig !== lastSig) {
      lastSig = sig;
      send(payload);
    }

    const st = String(payload.order.status || "").toUpperCase();
    const isFinal = st === "DONE" || st === "CANCELED";
    return !isFinal;
  };

  // initial
  let keep = tick();
  if (!keep) {
    res.end();
    return;
  }

  const t = setInterval(() => {
    try {
      keep = tick();
      if (!keep) {
        clearInterval(t);
        res.end();
      }
    } catch {
      // ignore
    }
  }, 2000);

  req.on("close", () => {
    clearInterval(t);
  });
});

// ------------------ START SERVER ------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  startTelegramPolling();
});
