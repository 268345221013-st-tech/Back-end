const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── Serve uploaded images statically ────────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// ── Multer config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file,  cb) => {
    const ext  = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = `img_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },          // 5 MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('เฉพาะไฟล์รูปภาพเท่านั้น'));
  }
});

// ── 1. MongoDB ───────────────────────────────────────────────────────────────
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
  rating:          { type: Number, default: 5, min: 1, max: 5 },
  images:          { type: [String], default: [] }          // stores URL paths e.g. /uploads/img_xxx.jpg
}, { timestamps: true });
const Restaurant = mongoose.model('Restaurant', RestaurantSchema);

// ── Seed admin ───────────────────────────────────────────────────────────────
const seedAdmin = async () => {
  try {
    const existing = await User.findOne({ username: 'admin' });
    if (!existing) {
      await User.create({ username: 'admin', password: '1234', role: 'admin' });
      console.log('✅ Created admin (admin / 1234)');
    } else if (existing.password !== '1234') {
      await User.updateOne({ username: 'admin' }, { password: '1234' });
      console.log('🔄 Reset admin password → 1234');
    } else {
      console.log('✅ Admin OK');
    }
  } catch (err) { console.error('❌ Seed error:', err.message); }
};

mongoose.connect('mongodb://127.0.0.1:27017/yummylog_db')
  .then(async () => { console.log('✅ MongoDB connected'); await seedAdmin(); })
  .catch(err => console.error('❌ MongoDB error:', err));

// ── 2. Image Upload endpoint ─────────────────────────────────────────────────
// POST /api/upload  →  returns { urls: ["/uploads/img_xxx.jpg", ...] }
app.post('/api/upload', upload.array('images', 5), (req, res) => {
  if (!req.files || req.files.length === 0)
    return res.status(400).json({ error: 'ไม่พบไฟล์รูปภาพ' });
  const urls = req.files.map(f => `/uploads/${f.filename}`);
  res.json({ urls });
});

// DELETE /api/upload  body: { url: "/uploads/img_xxx.jpg" }
app.delete('/api/upload', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'ไม่ระบุ url' });
  const filename = path.basename(url);
  const filepath = path.join(UPLOAD_DIR, filename);
  fs.unlink(filepath, err => {
    if (err) return res.status(404).json({ error: 'ไม่พบไฟล์' });
    res.json({ success: true });
  });
});

// ── 3. Auth ───────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: 'กรุณากรอก username และ password' });
    const t = username.trim(), p = password.trim();
    let user = await User.findOne({ username: t });
    if (!user) {
      const role = t.toLowerCase() === 'admin' ? 'admin' : 'user';
      user = await User.create({ username: t, password: p, role });
    } else if (user.password !== p) {
      return res.status(401).json({ success: false, message: 'รหัสผ่านไม่ถูกต้อง' });
    }
    res.json({ success: true, user: { id: user._id, _id: user._id, username: user.username, role: user.role } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/reset-password', async (req, res) => {
  try {
    await User.updateOne({ username: 'admin' }, { password: '1234', role: 'admin' }, { upsert: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 4. Admin ──────────────────────────────────────────────────────────────────
app.get('/api/admin/users', async (req, res) => {
  try { res.json(await User.find({}, '-password').sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/users', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username?.trim() || !password?.trim())
      return res.status(400).json({ error: 'กรุณากรอก username และ password' });
    if (await User.findOne({ username: username.trim() }))
      return res.status(400).json({ error: 'ชื่อผู้ใช้นี้มีอยู่แล้ว' });
    const u = await User.create({ username: username.trim(), password: password.trim(), role: role === 'admin' ? 'admin' : 'user' });
    res.json({ success: true, user: { _id: u._id, username: u.username, role: u.role, createdAt: u.createdAt } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const { password, role } = req.body;
    const update = {};
    if (password?.trim()) update.password = password.trim();
    if (role)             update.role     = role === 'admin' ? 'admin' : 'user';
    if (!Object.keys(update).length) return res.status(400).json({ error: 'ไม่มีข้อมูลที่ต้องการอัปเดต' });
    const u = await User.findByIdAndUpdate(req.params.id, update, { new: true, select: '-password' });
    if (!u) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    res.json({ success: true, user: u });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
    if (target.username === 'admin') return res.status(400).json({ error: 'ไม่สามารถลบ admin หลักได้' });
    await User.findByIdAndDelete(req.params.id);
    await Restaurant.deleteMany({ userId: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/admin/stats', async (req, res) => {
  try {
    const [totalUsers, totalRestaurants] = await Promise.all([User.countDocuments(), Restaurant.countDocuments()]);
    res.json({ totalUsers, totalRestaurants });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 5. Restaurant CRUD ────────────────────────────────────────────────────────
app.get('/api/restaurants/:userId', async (req, res) => {
  try { res.json(await Restaurant.find({ userId: req.params.userId }).sort({ createdAt: -1 })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/restaurants', async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.zone && body.locationName) {
      const m = body.locationName.match(/^\[(.*?)\]/);
      body.zone = m ? m[1] : 'ไม่ระบุโซน / อื่นๆ';
    }
    if (body.latitude  !== undefined) body.latitude  = (body.latitude  === '' || body.latitude  === null) ? null : Number(body.latitude);
    if (body.longitude !== undefined) body.longitude = (body.longitude === '' || body.longitude === null) ? null : Number(body.longitude);
    if (isNaN(body.latitude))  body.latitude  = null;
    if (isNaN(body.longitude)) body.longitude = null;
    res.json(await Restaurant.create(body));
  } catch (err) { res.status(400).json({ error: 'บันทึกไม่สำเร็จ', details: err.message }); }
});

app.put('/api/restaurants/:id', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.latitude  !== undefined) body.latitude  = (body.latitude  === '' || body.latitude  === null) ? null : Number(body.latitude);
    if (body.longitude !== undefined) body.longitude = (body.longitude === '' || body.longitude === null) ? null : Number(body.longitude);
    if (isNaN(body.latitude))  body.latitude  = null;
    if (isNaN(body.longitude)) body.longitude = null;
    const item = await Restaurant.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!item) return res.status(404).json({ error: 'ไม่พบร้านอาหาร' });
    res.json(item);
  } catch (err) { res.status(400).json({ error: 'แก้ไขไม่สำเร็จ', details: err.message }); }
});

app.delete('/api/restaurants/:id', async (req, res) => {
  try { await Restaurant.findByIdAndDelete(req.params.id); res.json({ message: 'Deleted' }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`🚀 Server → http://localhost:${PORT}`));