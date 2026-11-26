require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const Razorpay = require("razorpay");

const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET,
  PORT = 3000,
  BASE_URL = `http://localhost:${PORT}`,
} = process.env;

if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
  console.error("Missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env");
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

const app = express();

// In-memory store (fine for a minimal project)
const orders = new Map(); // order_id -> { amount, currency, status, payment_id? }

/* ---------- helpers ---------- */

// Constant-time comparison of two hex signatures
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// Payment signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
function verifyPaymentSignature(orderId, paymentId, signature) {
  const expected = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return safeEqual(expected, signature);
}

function markPaid(orderId, paymentId) {
  const order = orders.get(orderId) || {};
  orders.set(orderId, { ...order, status: "paid", payment_id: paymentId });
}

/* ---------- webhook (needs RAW body, so register BEFORE express.json) ---------- */

app.post(
  "/api/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    if (!RAZORPAY_WEBHOOK_SECRET || !signature) {
      return res.status(400).send("Webhook secret/signature missing");
    }

    // Webhook signature = HMAC_SHA256(raw_body, webhook_secret)
    const expected = crypto
      .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
      .update(req.body) // Buffer
      .digest("hex");

    if (!safeEqual(expected, signature)) {
      return res.status(400).send("Invalid webhook signature");
    }

    const event = JSON.parse(req.body.toString());
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const payment = event.payload.payment.entity;
      markPaid(payment.order_id, payment.id);
      console.log("Webhook: payment confirmed", payment.id);
    }
    res.json({ received: true });
  }
);

/* ---------- normal middleware ---------- */
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Razorpay callback_url POSTs form data
app.use(express.static(path.join(__dirname, "public")));

/* ---------- 1. Create order ---------- */
app.post("/api/orders", async (req, res) => {
  try {
    const { amount, currency = "INR" } = req.body; // amount in rupees
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ error: "A valid amount is required" });
    }

    const orderData = {
      amount: Math.round(Number(amount) * 100), // paise
      currency,
      receipt: `rcpt_${Date.now()}`,
    };

    // MOCK_MODE=true lets you test the flow without a Razorpay account.
    // Set MOCK_MODE=false (and use real keys) for the real integration.
    const order =
      process.env.MOCK_MODE === "true"
        ? { id: `order_mock_${Date.now()}`, amount: orderData.amount, currency }
        : await razorpay.orders.create(orderData);

    orders.set(order.id, {
      amount: order.amount,
      currency: order.currency,
      status: "created",
    });

    // key_id is public and needed by Checkout; never send key_secret
    res.json({ key_id: RAZORPAY_KEY_ID, order });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not create order" });
  }
});

/* ---------- 2. Verify payment signature (called from checkout handler) ---------- */
app.post("/api/payments/verify", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }
  if (!orders.has(razorpay_order_id)) {
    return res.status(404).json({ success: false, error: "Unknown order" });
  }

  if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return res.status(400).json({ success: false, error: "Invalid signature" });
  }

  markPaid(razorpay_order_id, razorpay_payment_id);
  res.json({ success: true, order_id: razorpay_order_id, payment_id: razorpay_payment_id });
});

/* ---------- 3. Callback URL (Razorpay redirects the browser here via POST) ---------- */
app.post("/api/payments/callback", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (
    razorpay_order_id &&
    razorpay_payment_id &&
    razorpay_signature &&
    verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)
  ) {
    markPaid(razorpay_order_id, razorpay_payment_id);
    return res.redirect(`/result.html?status=success&payment_id=${razorpay_payment_id}`);
  }
  res.redirect("/result.html?status=failed");
});

/* ---------- 4. Check order status ---------- */
app.get("/api/orders/:id", (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ order_id: req.params.id, ...order });
});

app.listen(PORT, () => console.log(`Server running at ${BASE_URL}`));
