import express from "express";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json());

/* =========================
   SUPABASE CONFIG
========================= */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Server running",
  });
});

/* =========================
   BASIC TEST
========================= */

app.get("/api/me", (req, res) => {
  res.json({ success: true, message: "API working" });
});

/* =====================================================
   AUTH API ROUTES
===================================================== */

/* ========= REGISTER USER ========= */
app.post("/api/auth/register", async (req, res) => {
  try {
    console.log("REGISTER BODY:", req.body);

    let { name, email, password, phone } = req.body;

    name = name?.trim();
    email = email?.trim();
    password = password?.trim();

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields",
      });
    }

    /* check existing user */
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User already exists",
      });
    }

    /* insert user */
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          name,
          email,
          phone,
          password_hash: password, // matches DB column
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: "User registered successfully",
      user: data,
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/* ========= LOGIN USER ========= */
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password required",
      });
    }

    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .eq("password_hash", password)
      .maybeSingle();

    if (error || !data) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials",
      });
    }

    res.json({
      success: true,
      message: "Login successful",
      user: data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/* =====================================================
   COMPLAINT API
===================================================== */

app.post("/api/complaints", async (req, res) => {
  try {
    const {
      user_id,
      station_id,
      title,
      description,
      category,
      priority,
    } = req.body;

    const { data, error } = await supabase
      .from("complaints")
      .insert([
        {
          user_id,
          station_id,
          title,
          description,
          category,
          priority,
        },
      ])
      .select();

    if (error) throw error;

    res.json({ success: true, message: "Complaint created", data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/complaints", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("complaints")
      .select(
        `*, users(name,email), police_stations(station_name,district)`
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch("/api/complaints/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority } = req.body;

    const { data, error } = await supabase
      .from("complaints")
      .update({
        status,
        priority,
        updated_at: new Date(),
      })
      .eq("id", id)
      .select();

    if (error) throw error;

    res.json({ success: true, message: "Complaint updated", data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================================
   REWARDS API
===================================================== */

app.get("/api/rewards/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const { data, error } = await supabase
      .from("rewards")
      .select("*")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      rewards: data,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/* =========================
   EXPORT FOR VERCEL
========================= */

export default app;