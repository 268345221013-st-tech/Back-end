const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ── 1. เชื่อมต่อ MongoDB ──────────────────────────────────────────────────────

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

// Seed / reset admin on startup — ensures admin/1234 always works
const seedAdmin = async () => {
  try {
    const existing = await User.findOne({ username: 'admin' });
    if (!existing) {
      await User.create({ username: 'admin', password: '1234', role: 'admin' });
      console.log('✅ Created admin account (admin / 1234)');
    } else if (existing.password !== '1234') {
      // Reset to known password so first-run always works
      await User.updateOne({ username: 'admin' }, { password: '1234' });
      console.log('🔄 Reset admin password to 1234');
    } else {
      console.log('✅ Admin account OK (admin / 1234)');
    }
  } catch (err) {
    console.error('❌ Seed admin error:', err.message);
  }
};

mongoose.connect('mongodb://127.0.0.1:27017/yummylog_db')
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    await seedAdmin();
  })
  .catch(err => console.error('❌ MongoDB Error:', err));

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });

    const trimUser = username.trim();
    const trimPass = password.trim();

    let user = await User.findOne({ username: trimUser });

    if (!user) {
      // Auto-create new user account on first login
      const role = trimUser.toLowerCase() === 'admin' ? 'admin' : 'user';
      user = await User.create({ username: trimUser, password: trimPass, role });
      console.log(`✅ Created new user: ${trimUser} (${role})`);
    } else if (user.password !== trimPass) {
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

// ── Reset admin password (utility endpoint) ──────────────────────────────────
app.post('/api/admin/reset-password', async (req, res) => {
  try {
    await User.updateOne({ username: 'admin' }, { password: '1234', role: 'admin' }, { upsert: true });
    res.json({ success: true, message: 'รีเซ็ต admin password เป็น 1234 เรียบร้อยแล้ว' });
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

// ── Create user (admin) ───────────────────────────────────────────────────────
app.post('/api/admin/users', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username?.trim() || !password?.trim())
      return res.status(400).json({ error: 'กรุณากรอก username และ password' });
    const exists = await User.findOne({ username: username.trim() });
    if (exists) return res.status(400).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้วในระบบ' });
    const user = await User.create({
      username: username.trim(),
      password: password.trim(),
      role: role === 'admin' ? 'admin' : 'user'
    });
    res.json({ success: true, user: { _id: user._id, username: user.username, role: user.role, createdAt: user.createdAt } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Update user (admin) ───────────────────────────────────────────────────────
app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const { password, role } = req.body;
    const update = {};
    if (password?.trim()) update.password = password.trim();
    if (role)             update.role     = role === 'admin' ? 'admin' : 'user';
    if (Object.keys(update).length === 0)
      return res.status(400).json({ error: 'ไม่มีข้อมูลที่ต้องการอัปเดต' });
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, select: '-password' });
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete user (admin) ───────────────────────────────────────────────────────
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    if (target.username === 'admin')
      return res.status(400).json({ error: 'ไม่สามารถลบบัญชี admin หลักได้' });
    await User.findByIdAndDelete(req.params.id);
    await Restaurant.deleteMany({ userId: req.params.id });
    res.json({ success: true, message: 'ลบผู้ใช้และข้อมูลร้านอาหารสำเร็จ' });
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