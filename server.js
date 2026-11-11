const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

function getDB() {
  const initialAdmins = [
    {
      id: 991,
      name: "مدير المنصة الرئيسي (السوبر أدمن)",
      email: "admin1@souq.jo",
      phone: "0790000001",
      city: "عمان",
      role: "admin",
      isSuperAdmin: true,
      password: "admin123",
      avatar: "https://ui-avatars.com/api/?name=Super+Admin&background=1e1b4b&color=fff"
    },
    {
      id: 992,
      name: "مدير العمليات والدعم (أدمن 2)",
      email: "admin2@souq.jo",
      phone: "0780000002",
      city: "إربد",
      role: "admin",
      isSuperAdmin: false,
      password: "admin123",
      avatar: "https://ui-avatars.com/api/?name=Admin+2&background=047857&color=fff"
    },
    {
      id: 993,
      name: "مدير الرقابة والتدقيق (أدمن 3)",
      email: "admin3@souq.jo",
      phone: "0770000003",
      city: "الزرقاء",
      role: "admin",
      isSuperAdmin: false,
      password: "admin123",
      avatar: "https://ui-avatars.com/api/?name=Admin+3&background=b45309&color=fff"
    }
  ];

  if (!fs.existsSync(DB_FILE)) {
    const initialData = {
      users: initialAdmins,
      requests: [],
      offers: [],
      messages: [],
      notifications: [],
      archivedMessages: [],
      emailAlertsLogs: [],
      alertActivationRequests: [] // طلبات تفعيل التنبيهات للسوبر أدمن
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    return initialData;
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  initialAdmins.forEach(adm => {
    const existing = db.users.find(u => u.email === adm.email);
    if (!existing) db.users.push(adm);
    else existing.isSuperAdmin = adm.isSuperAdmin;
  });

  if (!db.alertActivationRequests) db.alertActivationRequests = [];
  if (!db.emailAlertsLogs) db.emailAlertsLogs = [];
  if (!db.archivedMessages) db.archivedMessages = [];
  return db;
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ---------------- API المستخدمين ----------------
app.post('/api/register', (req, res) => {
  const db = getDB();
  const { name, email, phone, city, role, password, avatar, authProvider } = req.body;

  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل مسبقاً.' });
  }

  if (phone && db.users.find(u => u.phone === phone)) {
    return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل مسبقاً.' });
  }

  const newUser = {
    id: Date.now(),
    name,
    email,
    phone: phone || '',
    city: city || 'عمان',
    role,
    password: password || '',
    avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4f46e5&color=fff`,
    authProvider: authProvider || 'local',
    alertCategories: [],
    alertStatus: 'none', // none, pending, active, expired, rejected
    alertExpiry: null
  };

  db.users.push(newUser);
  saveDB(db);
  res.json({ success: true, user: newUser });
});

app.post('/api/login', (req, res) => {
  const db = getDB();
  const { identifier, password, isSocial, socialEmail, socialName, socialAvatar } = req.body;

  if (isSocial) {
    let user = db.users.find(u => u.email.toLowerCase() === socialEmail.toLowerCase());
    if (user) return res.json({ success: true, user });
    return res.json({ success: false, needRegister: true, socialEmail, socialName, socialAvatar });
  }

  const user = db.users.find(u => (u.email.toLowerCase() === identifier.toLowerCase() || u.name === identifier) && u.password === password);
  if (user) res.json({ success: true, user });
  else res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة.' });
});

app.get('/api/users', (req, res) => {
  res.json(getDB().users);
});

// ---------------- API نظام التنبيهات الموقوت بموافقة السوبر أدمن ----------------
// المستخدم (عميل أو تاجر) يختار الأقسام ويرسل طلب تفعيل للسوبر أدمن
app.post('/api/alerts/request-activation', (req, res) => {
  const db = getDB();
  const { userId, categories } = req.body;

  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

  user.alertCategories = categories || [];
  user.alertStatus = 'pending'; // قيد موافقة السوبر أدمن

  // إنشاء أو تحديث سجل الطلب في قائمة السوبر أدمن
  const existingReqIndex = db.alertActivationRequests.findIndex(r => r.userId === userId);
  const reqObj = {
    id: Date.now(),
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    userPhone: user.phone,
    userRole: user.role,
    userCity: user.city,
    categories: user.alertCategories,
    status: 'pending',
    requestedAt: new Date().toISOString()
  };

  if (existingReqIndex !== -1) {
    db.alertActivationRequests[existingReqIndex] = reqObj;
  } else {
    db.alertActivationRequests.unshift(reqObj);
  }

  // إرسال إشعار فوري للسوبر أدمن
  const timeNow = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  db.notifications.unshift({
    id: Date.now() + 1,
    userId: 991, // السوبر أدمن
    title: 'طلب تفعيل تنبيهات جديد 🔔',
    text: `طلب المستخدم (${user.name} - ${user.role === 'merchant' ? 'تاجر' : 'عميل'}) تفعيل ميزة التنبيهات لـ ${categories.length} أقسام.`,
    time: timeNow
  });

  saveDB(db);
  res.json({ success: true, user });
});

// جلب طلبات التفعيل للسوبر أدمن
app.get('/api/admin/alert-activation-requests', (req, res) => {
  const db = getDB();
  res.json(db.alertActivationRequests || []);
});

// السوبر أدمن فقط يفعل الخاصية بالتقويم لمدة محدودة أو يرفضها
app.post('/api/admin/handle-alert-activation', (req, res) => {
  const db = getDB();
  const { adminEmail, targetUserId, action, expiryDate } = req.body;

  if (adminEmail !== 'admin1@souq.jo') {
    return res.status(403).json({ success: false, message: 'خاص بالسوبر أدمن فقط!' });
  }

  const user = db.users.find(u => u.id === targetUserId);
  const reqItem = db.alertActivationRequests.find(r => r.userId === targetUserId);
  const timeNow = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  if (action === 'approve') {
    if (user) {
      user.alertStatus = 'active';
      user.alertExpiry = expiryDate;
    }
    if (reqItem) {
      reqItem.status = 'active';
      reqItem.expiryDate = expiryDate;
    }

    // إشعار للمستخدم بأن الخدمة فُعلت له
    db.notifications.unshift({
      id: Date.now(),
      userId: targetUserId,
      title: 'تم تفعيل خدمة التنبيهات بالبريد 🎉',
      text: `وافق السوبر أدمن على طلبك. ميزة التنبيهات بالبريد الإلكتروني مفعلة لك حتى تاريخ: ${expiryDate}`,
      time: timeNow
    });
  } else {
    if (user) user.alertStatus = 'rejected';
    if (reqItem) reqItem.status = 'rejected';

    db.notifications.unshift({
      id: Date.now(),
      userId: targetUserId,
      title: 'تحديث بخصوص طلب التنبيهات',
      text: 'نعتذر، لم تتم الموافقة على تفعيل ميزة التنبيهات حالياً.',
      time: timeNow
    });
  }

  saveDB(db);
  res.json({ success: true });
});

// ---------------- API طلبات الشراء ونظام التنبيهات الفوري ----------------
app.get('/api/requests', (req, res) => {
  const db = getDB();
  const activeRequests = db.requests.filter(r => !r.isDeleted);
  activeRequests.forEach(r => {
    r.offers = db.offers.filter(o => o.requestId === r.id);
  });
  res.json(activeRequests);
});

app.post('/api/requests', (req, res) => {
  const db = getDB();
  const newReq = {
    id: Date.now(),
    ...req.body,
    isDeleted: 0,
    status: 'open',
    acceptedOfferId: null,
    acceptedMerchantName: null,
    companyDeliveryRequested: false,
    deliveryCompany: null,
    createdAt: new Date().toISOString()
  };
  db.requests.unshift(newReq);

  // إرسال تنبيهات الإيميل لأي مستخدم (عميل أو تاجر) وافق له السوبر أدمن والاشتراك سارٍ
  const now = new Date();
  const eligibleUsers = db.users.filter(u => 
    u.id !== newReq.customerId && // لا ننبه صاحب الطلب
    u.alertStatus === 'active' &&
    u.alertExpiry &&
    new Date(u.alertExpiry) >= now &&
    u.alertCategories &&
    u.alertCategories.includes(newReq.category)
  );

  eligibleUsers.forEach(u => {
    const alertRecord = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      toEmail: u.email,
      toName: u.name,
      toRole: u.role,
      category: newReq.category,
      requestTitle: newReq.title,
      budget: `${newReq.budgetMin} - ${newReq.budgetMax} د.أ`,
      image: newReq.image || null,
      sentAt: new Date().toISOString()
    };
    db.emailAlertsLogs.unshift(alertRecord);

    db.notifications.unshift({
      id: Date.now() + Math.floor(Math.random() * 1000),
      userId: u.id,
      title: `تنبيه إيميل جديد في قسم [${newReq.category}] 📧`,
      text: `طلب جديد: ${newReq.title} بميزانية (${newReq.budgetMin} - ${newReq.budgetMax} د.أ)`,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    });
  });

  saveDB(db);
  res.json({ success: true, id: newReq.id });
});

// اعتماد التاجر مع خيار التوصيل
app.post('/api/requests/accept-offer', (req, res) => {
  const db = getDB();
  const { requestId, offerId, companyDelivery, deliveryCompany } = req.body;

  const request = db.requests.find(r => r.id === requestId);
  const offer = db.offers.find(o => o.id === offerId);

  if (request && offer) {
    request.status = 'accepted';
    request.acceptedOfferId = offerId;
    request.acceptedMerchantName = offer.merchantName;
    request.companyDeliveryRequested = Boolean(companyDelivery);
    request.deliveryCompany = companyDelivery ? deliveryCompany : null;

    const timeNow = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    db.notifications.unshift({
      id: Date.now(),
      userId: offer.merchantId,
      title: 'تهانينا! تم اعتماد عرضك 🎉',
      text: `قام العميل ${request.customerName} باختيارك واعتماد عرضك على طلبه [${request.title}]${companyDelivery ? ` مع طلب توصيل عبر ${deliveryCompany}` : ''}`,
      time: timeNow
    });

    saveDB(db);
    return res.json({ success: true });
  }
  res.status(404).json({ success: false });
});

app.post('/api/requests/delete', (req, res) => {
  const db = getDB();
  const reqItem = db.requests.find(r => r.id === req.body.requestId);
  if (reqItem) {
    reqItem.isDeleted = 1;
    saveDB(db);
    return res.json({ success: true });
  }
  res.status(404).json({ success: false });
});

// ---------------- API العروض ----------------
app.get('/api/my-offers', (req, res) => {
  const db = getDB();
  const { userId } = req.query;
  const userOffers = db.offers.filter(o => o.merchantId == userId);
  const detailedOffers = userOffers.map(o => {
    const reqItem = db.requests.find(r => r.id === o.requestId) || {};
    return { ...o, requestTitle: reqItem.title, requestCity: reqItem.customerCity, requestStatus: reqItem.status };
  });
  res.json(detailedOffers);
});

app.post('/api/offers', (req, res) => {
  const db = getDB();
  const { requestId, merchantId, merchantName, merchantCity, phone, price, deliveryFee, shipping, negotiable, note, images } = req.body;

  const newOffer = {
    id: Date.now(),
    requestId,
    merchantId,
    merchantName,
    merchantCity,
    phone,
    price,
    deliveryFee,
    shipping,
    negotiable,
    note,
    images: images || [],
    createdAt: new Date().toISOString()
  };

  db.offers.push(newOffer);

  const request = db.requests.find(r => r.id === requestId);
  if (request) {
    db.notifications.unshift({
      id: Date.now() + 1,
      userId: request.customerId,
      title: 'عرض سعر جديد!',
      text: `قدم ${merchantName} عرضاً بقيمة ${price} د.أ على طلبك [${request.title}]`,
      time: new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
    });
  }

  saveDB(db);
  res.json({ success: true, id: newOffer.id });
});

// ---------------- API المحادثات ----------------
app.get('/api/messages', (req, res) => {
  const db = getDB();
  const { userName } = req.query;
  if (!userName) return res.json([]);
  const userMsgs = db.messages.filter(m => m.fromName === userName || m.toName === userName);
  res.json(userMsgs);
});

app.post('/api/messages', (req, res) => {
  const db = getDB();
  const { fromUserId, fromName, toUserId, toName, text } = req.body;
  const time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  const newMsg = {
    id: Date.now(),
    fromUserId,
    fromName,
    toUserId,
    toName,
    text,
    time
  };

  db.messages.push(newMsg);

  if (toUserId) {
    db.notifications.unshift({
      id: Date.now() + 2,
      userId: toUserId,
      title: `رسالة جديدة من ${fromName}`,
      text: text,
      time: time
    });
  }

  saveDB(db);
  res.json({ success: true, message: newMsg });
});

app.get('/api/notifications', (req, res) => {
  const db = getDB();
  const { userId } = req.query;
  res.json(db.notifications.filter(n => n.userId == userId));
});

// ---------------- API الإدارة وسلة المحذوفات ----------------
app.get('/api/admin/deleted-requests', (req, res) => {
  res.json(getDB().requests.filter(r => r.isDeleted === 1));
});

app.post('/api/admin/restore-request', (req, res) => {
  const db = getDB();
  const reqItem = db.requests.find(r => r.id === req.body.requestId);
  if (reqItem) reqItem.isDeleted = 0;
  saveDB(db);
  res.json({ success: true });
});

app.get('/api/admin/all-messages', (req, res) => {
  res.json(getDB().messages);
});

app.get('/api/admin/email-alerts-logs', (req, res) => {
  res.json(getDB().emailAlertsLogs || []);
});

app.get('*', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicPath)) res.sendFile(publicPath);
  else if (fs.existsSync(rootPath)) res.sendFile(rootPath);
  else res.status(404).send('ملف index.html غير موجود');
});

app.listen(PORT, () => {
  console.log(`\n✓ السيرفر يعمل على: http://localhost:${PORT}`);
  console.log(`✓ السوبر أدمن مفعل: admin1@souq.jo / admin123\n`);
});
