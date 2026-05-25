const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── 1. เชื่อมต่อ MongoDB ──────────────────────────────────────────────────────
mongoose.connect('mongodb://127.0.0.1:27017/yummylog_db')
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ── 2. Schemas ────────────────────────────────────────────────────────────────
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

const RestaurantSchema = new mongoose.Schema({
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:            { type: String, required: true, trim: true },
  recommendedMenu: { type: String, required: true, trim: true },
  zone:            { type: String, default: 'ไม่ระบุโซน / อื่นๆ' },
  locationName:    { type: String, required: true, trim: true },
  latitude:        { type: Number, default: null },
  longitude:       { type: Number, default: null },
  rating:          { type: Number, default: 5, min: 1, max: 5 }
}, { timestamps: true });

const Restaurant = mongoose.model('Restaurant', RestaurantSchema);

// ── 3. AUTH ───────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });

    let user = await User.findOne({ username });

    if (!user) {
      const role = username.toLowerCase() === 'admin' ? 'admin' : 'user';
      user = await User.create({ username, password, role });
    } else if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
    }

    res.json({
      success: true,
      user: { id: user._id, _id: user._id, username: user.username, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── 4. ADMIN ──────────────────────────────────────────────────────────────────
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await User.find({}, '-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const [totalUsers, totalRestaurants] = await Promise.all([
      User.countDocuments(),
      Restaurant.countDocuments()
    ]);
    res.json({ totalUsers, totalRestaurants });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 5. RESTAURANT CRUD ────────────────────────────────────────────────────────
app.get('/api/restaurants/:userId', async (req, res) => {
  try {
    const list = await Restaurant.find({ userId: req.params.userId }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/restaurants', async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.zone && body.locationName) {
      const match = body.locationName.match(/^\[(.*?)\]/);
      body.zone = match ? match[1] : 'ไม่ระบุโซน / อื่นๆ';
    }
    if (body.latitude  !== undefined) body.latitude  = (body.latitude  === '' || body.latitude  === null) ? null : Number(body.latitude);
    if (body.longitude !== undefined) body.longitude = (body.longitude === '' || body.longitude === null) ? null : Number(body.longitude);
    if (isNaN(body.latitude))  body.latitude  = null;
    if (isNaN(body.longitude)) body.longitude = null;

    const item = await Restaurant.create(body);
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: 'บันทึกข้อมูลไม่สำเร็จ', details: err.message });
  }
});

app.put('/api/restaurants/:id', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.latitude  !== undefined) body.latitude  = (body.latitude  === '' || body.latitude  === null) ? null : Number(body.latitude);
    if (body.longitude !== undefined) body.longitude = (body.longitude === '' || body.longitude === null) ? null : Number(body.longitude);
    if (isNaN(body.latitude))  body.latitude  = null;
    if (isNaN(body.longitude)) body.longitude = null;

    const item = await Restaurant.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!item) return res.status(404).json({ error: 'ไม่พบข้อมูลร้านอาหาร' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: 'แก้ไขข้อมูลไม่สำเร็จ', details: err.message });
  }
});

app.delete('/api/restaurants/:id', async (req, res) => {
  try {
    await Restaurant.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Server running → http://localhost:${PORT}`));