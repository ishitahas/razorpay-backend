// Run while the server is running:  node test-verify.js
// Simulates what Razorpay sends after a payment and checks that the
// backend accepts a valid signature and rejects a tampered one.
require("dotenv").config();
const crypto = require("crypto");

const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const SECRET = process.env.RAZORPAY_KEY_SECRET;

const sign = (orderId, paymentId) =>
  crypto.createHmac("sha256", SECRET).update(`${orderId}|${paymentId}`).digest("hex");

const post = (path, body) =>
  fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

(async () => {
  const { body } = await post("/api/orders", { amount: 100 });
  const orderId = body.order.id;
  const paymentId = "pay_test_" + Date.now();
  console.log("1. Order created:", orderId);

  const good = await post("/api/payments/verify", {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: sign(orderId, paymentId),
  });
  console.log("2. Valid signature  ->", good.status, JSON.stringify(good.body));

  const bad = await post("/api/payments/verify", {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: "tampered" + sign(orderId, paymentId).slice(8),
  });
  console.log("3. Tampered signature ->", bad.status, JSON.stringify(bad.body));

  const status = await fetch(`${BASE}/api/orders/${orderId}`).then((r) => r.json());
  console.log("4. Order status:", status.status);

  const pass = good.status === 200 && bad.status === 400 && status.status === "paid";
  console.log(pass ? "\nALL CHECKS PASSED ✅" : "\nSOMETHING FAILED ❌");
})();
