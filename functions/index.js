const functions = require("firebase-functions");
const Razorpay = require("razorpay");
const crypto = require("crypto");

// 🔑 Razorpay instance
const razorpay = new Razorpay({
  key_id: "rzp_test_SjF02kTxhDZTsJ",
  key_secret: "OQKlVMhSdVXQHz4jHPhj84cE",
});

// ✅ Create Order API
exports.createOrder = functions.https.onRequest(async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount) {
      return res.status(400).json({ error: "Amount is required" });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100, // ₹ → paise
      currency: "INR",
      receipt: "receipt_" + Date.now(),
    });

    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Order creation failed" });
  }
});

// ✅ Verify Payment API (IMPORTANT)
exports.verifyPayment = functions.https.onRequest((req, res) => {
  try {
    const { order_id, payment_id, signature } = req.body;

    const expectedSignature = crypto
      .createHmac("sha256", "OQKlVMhSdVXQHz4jHPhj84cE")
      .update(order_id + "|" + payment_id)
      .digest("hex");

    if (expectedSignature === signature) {
      return res.json({ status: "success" });
    } else {
      return res.status(400).json({ status: "failed" });
    }
  } catch (error) {
    res.status(500).json({ error: "Verification failed" });
  }
});