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

// قراءة وإنشاء قاعدة البيانات المحلية تلقائياً
function getDB() {
  const initialAdmins = [
    {
      id: 991,
      name: "مدير المنصة الرئيسي (أدمن 1)",
      email: "admin1@souq.jo",
      phone: "0790000001",
      city: "عمان",
      role: "admin",
      password: "admin123",
      avatar: "https://ui-avatars.com/api/?name=Admin+1&background=1e1b4b&color=fff"
    },
    {
      id: 992,
      name: "مدير العمليات والدعم (أدمن 2)",
      email: "admin2@souq.jo",
      phone: "0780000002",
      city: "إربد",
      role: "admin",
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
      archivedMessages: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2), 'utf8');
    return initialData;
  }

  const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  // التأكد من وجود حسابات الأدمن الـ 3 دائماً
  initialAdmins.forEach(adm => {
    if (!db.users.find(u => u.email === adm.email)) {
      db.users.push(adm);
    }
  });
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

  // التحقق من تكرار الإيميل ورقم الهاتف
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ success: false, message: 'البريد الإلكتروني مسجل مسبقاً، يرجى تسجيل الدخول.' });
  }

  if (phone && db.users.find(u => u.phone === phone)) {
    return res.status(400).json({ success: false, message: 'رقم الهاتف مسجل مسبقاً بحساب آخر.' });
  }

  const newUser = {
    id: Date.now(),
    name,
    email,
    phone: phone || '',
    city: city || 'عمان',
    role, // عميل أو تاجر
    password: password || '',
    avatar: avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=4f46e5&color=fff`,
    authProvider: authProvider || 'local'
  };

  db.users.push(newUser);
  saveDB(db);
  res.json({ success: true, user: newUser });
});

app.post('/api/login', (req, res) => {
  const db = getDB();
  const { identifier, password, isSocial, socialEmail, socialName, socialAvatar } = req.body;

  // تسجيل دخول اجتماعي
  if (isSocial) {
    let user = db.users.find(u => u.email.toLowerCase() === socialEmail.toLowerCase());
    if (user) {
      return res.json({ success: true, user });
    } else {
      return res.json({ success: false, needRegister: true, socialEmail, socialName, socialAvatar });
    }
  }

  // تسجيل دخول عادي
  const user = db.users.find(u => (u.email.toLowerCase() === identifier.toLowerCase() || u.name === identifier) && u.password === password);
  if (user) {
    res.json({ success: true, user });
  } else {
    res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة، تأكد من الإيميل وكلمة المرور' });
  }
});

app.get('/api/users', (req, res) => {
  const db = getDB();
  res.json(db.users);
});

// ---------------- API طلبات الشراء ----------------
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
    createdAt: new Date().toISOString()
  };
  db.requests.unshift(newReq);
  saveDB(db);
  res.json({ success: true, id: newReq.id });
});

// حذف وإنهاء الطلب (للعميل أو الأدمن)
app.post('/api/requests/delete', (req, res) => {
  const db = getDB();
  const { requestId, userId } = req.body;
  const reqIndex = db.requests.findIndex(r => r.id === requestId);
  
  if (reqIndex !== -1) {
    db.requests[reqIndex].isDeleted = 1;
    saveDB(db);
    return res.json({ success: true });
  }
  res.status(404).json({ success: false, message: 'الطلب غير موجود' });
});

// ---------------- API العروض ----------------
app.get('/api/my-offers', (req, res) => {
  const db = getDB();
  const { userId } = req.query;
  const userOffers = db.offers.filter(o => o.merchantId == userId);
  
  // إرفاق تفاصيل الطلب مع كل عرض
  const detailedOffers = userOffers.map(o => {
    const reqItem = db.requests.find(r => r.id === o.requestId) || {};
    return { ...o, requestTitle: reqItem.title, requestCity: reqItem.customerCity, requestBudget: `${reqItem.budgetMin} - ${reqItem.budgetMax} د.أ` };
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

  // إرسال الإشعار لصاحب الطلب فقط
  const request = db.requests.find(r => r.id === requestId);
  if (request) {
    const timeNow = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
    db.notifications.unshift({
      id: Date.now() + 1,
      userId: request.customerId,
      title: 'عرض سعر جديد!',
      text: `قدم ${merchantName} عرضاً بقيمة ${price} د.أ على طلبك [${request.title}]`,
      time: timeNow
    });
  }

  saveDB(db);
  res.json({ success: true, id: newOffer.id });
});

// ---------------- API الرسائل والدردشة ----------------
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

  // إشعار للشخص المستلم فقط
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
  const notifs = db.notifications.filter(n => n.userId == userId);
  res.json(notifs);
});

// ---------------- API الإدارة والأرشفة ----------------
app.get('/api/admin/deleted-requests', (req, res) => {
  const db = getDB();
  const deleted = db.requests.filter(r => r.isDeleted === 1);
  res.json(deleted);
});

app.post('/api/admin/soft-delete', (req, res) => {
  const db = getDB();
  const { requestId } = req.body;
  const reqItem = db.requests.find(r => r.id === requestId);
  if (reqItem) reqItem.isDeleted = 1;
  saveDB(db);
  res.json({ success: true });
});

app.post('/api/admin/restore-request', (req, res) => {
  const db = getDB();
  const { requestId } = req.body;
  const reqItem = db.requests.find(r => r.id === requestId);
  if (reqItem) reqItem.isDeleted = 0;
  saveDB(db);
  res.json({ success: true });
});

app.post('/api/admin/permanent-delete', (req, res) => {
  const db = getDB();
  const { requestId } = req.body;
  db.requests = db.requests.filter(r => r.id !== requestId);
  db.offers = db.offers.filter(o => o.requestId !== requestId);
  saveDB(db);
  res.json({ success: true });
});

app.get('/api/admin/all-messages', (req, res) => {
  const db = getDB();
  res.json(db.messages);
});

app.post('/api/admin/archive-message', (req, res) => {
  const db = getDB();
  const { messageId } = req.body;
  const msgIndex = db.messages.findIndex(m => m.id === messageId);
  if (msgIndex !== -1) {
    const [archived] = db.messages.splice(msgIndex, 1);
    db.archivedMessages.push(archived);
    saveDB(db);
  }
  res.json({ success: true });
});

app.get('/api/admin/archived-messages', (req, res) => {
  const db = getDB();
  res.json(db.archivedMessages || []);
});

app.get('*', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath = path.join(__dirname, 'index.html');

  if (fs.existsSync(publicPath)) {
    res.sendFile(publicPath);
  } else if (fs.existsSync(rootPath)) {
    res.sendFile(rootPath);
  } else {
    res.status(404).send('ملف index.html غير موجود، تأكد من رفعه على GitHub');
  }
});

app.listen(PORT, () => {
  console.log(`\n✓ السيرفر يعمل بنجاح على: http://localhost:${PORT}`);
  console.log(`✓ تم تفعيل حسابات الأدمن الثلاثة (admin1@souq.jo, admin2@souq.jo, admin3@souq.jo)\n`);
});
