
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (e) {}

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// الحصول على تاريخ اليوم بدقة بتوقيت الأردن (YYYY-MM-DD)
function getJordanTodayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Amman' }).format(new Date());
}

// الحصول على الوقت الحالي بتوقيت الأردن
function getJordanTimeStr() {
  return new Date().toLocaleTimeString('ar-EG', { timeZone: 'Asia/Amman', hour: '2-digit', minute: '2-digit' });
}

// قراءة وإنشاء قاعدة البيانات
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
      alertActivationRequests: []
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

// إرسال إيميل حقيقي عبر SMTP إذا تم ضبط متغيرات البيئة على السيرفر
async function sendRealEmailIfConfigured(toEmail, subject, htmlContent) {
  if (!nodemailer || !process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await transporter.sendMail({
      from: `"سوق الطلب المعكوس - الأردن" <${process.env.SMTP_USER}>`,
      to: toEmail,
      subject: subject,
      html: htmlContent
    });
  } catch (e) {
    console.error('فشل إرسال الإيميل الخارجي:', e.message);
  }
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
    alertStatus: 'none', // none, pending, active, rejected
    alertStartDate: null,
    alertEndDate: null
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

// ---------------- API إدارة التنبيهات (من تاريخ إلى تاريخ) ----------------
app.post('/api/alerts/request-activation', (req, res) => {
  const db = getDB();
  const { userId, categories } = req.body;

  const user = db.users.find(u => u.id === userId);
  if (!user) return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });

  user.alertCategories = categories || [];
  user.alertStatus = 'pending';

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
    startDate: user.alertStartDate || getJordanTodayStr(),
    endDate: user.alertEndDate || '',
    requestedAt: new Date().toISOString()
  };

  if (existingReqIndex !== -1) {
    db.alertActivationRequests[existingReqIndex] = reqObj;
  } else {
    db.alertActivationRequests.unshift(reqObj);
  }

  // إشعار للسوبر أدمن في لوحة الإدارة
  db.notifications.unshift({
    id: Date.now() + 1,
    userId: 991, // السوبر أدمن
    type: 'admin_alert_request',
    title: 'طلب تفعيل تنبيهات جديد 🔔',
    text: `المستخدم (${user.name}) طلب تفعيل التنبيهات لـ ${categories.length} أقسام. افتح تبويب إدارة التنبيهات للموافقة.`,
    time: getJordanTimeStr()
  });

  saveDB(db);
  res.json({ success: true, user });
});

app.get('/api/admin/alert-activation-requests', (req, res) => {
  const db = getDB();
  res.json(db.alertActivationRequests || []);
});

app.post('/api/admin/handle-alert-activation', (req, res) => {
  const db = getDB();
  const { adminEmail, targetUserId, action, startDate, endDate } = req.body;

  if (adminEmail !== 'admin1@souq.jo') {
    return res.status(403).json({ success: false, message: 'هذه الصلاحية مخصصة للسوبر أدمن فقط (admin1@souq.jo)!' });
  }

  const user = db.users.find(u => u.id === targetUserId);
  const reqItem = db.alertActivationRequests.find(r => r.userId === targetUserId);
  const timeNow = getJordanTimeStr();

  if (action === 'approve') {
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'يجب تحديد الفترة (من تاريخ إلى تاريخ)!' });
    }
    if (startDate > endDate) {
      return res.status(400).json({ success: false, message: 'تاريخ البداية لا يمكن أن يكون بعد تاريخ الانتهاء!' });
    }

    if (user) {
      user.alertStatus = 'active';
      user.alertStartDate = startDate;
      user.alertEndDate = endDate;
    }
    if (reqItem) {
      reqItem.status = 'active';
      reqItem.startDate = startDate;
      reqItem.endDate = endDate;
    }

    db.notifications.unshift({
      id: Date.now(),
      userId: targetUserId,
      type: 'alert_approved',
      title: 'تمت الموافقة وتفعيل التنبيهات 🎉',
      text: `وافق السوبر أدمن على تفعيل تنبيهات البريد لك من تاريخ (${startDate}) إلى تاريخ (${endDate}).`,
      time: timeNow
    });
  } else {
    if (user) user.alertStatus = 'rejected';
    if (reqItem) reqItem.status = 'rejected';

    db.notifications.unshift({
      id: Date.now(),
      userId: targetUserId,
      type: 'alert_rejected',
      title: 'تحديث بخصوص طلب التنبيهات',
      text: 'لم يتم اعتماد طلب تفعيل التنبيهات من الإدارة.',
      time: timeNow
    });
  }

  saveDB(db);
  res.json({ success: true });
});

// جلب سجل الإيميلات الواردة لمستخدم معين
app.get('/api/user/email-alerts', (req, res) => {
  const db = getDB();
  const { userId } = req.query;
  res.json((db.emailAlertsLogs || []).filter(log => log.toUserId == userId));
});

// ---------------- API طلبات الشراء وإرسال التنبيهات ----------------
app.get('/api/requests', (req, res) => {
  const db = getDB();
  const activeRequests = db.requests.filter(r => !r.isDeleted);
  activeRequests.forEach(r => {
    r.offers = db.offers.filter(o => o.requestId === r.id);
  });
  res.json(activeRequests);
});

app.post('/api/requests', async (req, res) => {
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

  // التحقق من المستخدمين المؤهلين لاستلام التنبيه في الفترة الزمنية المحددة (من تاريخ إلى تاريخ)
  const todayStr = getJordanTodayStr();
  const eligibleUsers = db.users.filter(u => 
    u.id !== newReq.customerId &&
    u.alertStatus === 'active' &&
    u.alertStartDate && u.alertEndDate &&
    todayStr >= u.alertStartDate &&
    todayStr <= u.alertEndDate &&
    u.alertCategories &&
    u.alertCategories.includes(newReq.category)
  );

  for (const u of eligibleUsers) {
    const alertRecord = {
      id: Date.now() + Math.floor(Math.random() * 10000),
      toUserId: u.id,
      toEmail: u.email,
      toName: u.name,
      toRole: u.role,
      category: newReq.category,
      requestTitle: newReq.title,
      budget: `${newReq.budgetMin} - ${newReq.budgetMax} د.أ`,
      city: newReq.customerCity,
      notes: newReq.notes || 'لا توجد تفاصيل إضافية',
      image: newReq.image || null,
      sentAt: `${todayStr} (${getJordanTimeStr()})`
    };
    db.emailAlertsLogs.unshift(alertRecord);

    db.notifications.unshift({
      id: Date.now() + Math.floor(Math.random() * 10000),
      userId: u.id,
      type: 'email_alert',
      title: `إيميل تنبيه جديد في قسم [${newReq.category}] 📧`,
      text: `طلب جديد: ${newReq.title} بميزانية (${newReq.budgetMin} - ${newReq.budgetMax} د.أ)`,
      time: getJordanTimeStr()
    });

    // إرسال إيميل خارجي إن وُجدت إعدادات SMTP
    const emailHtml = `
      <div dir="rtl" style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
        <h2 style="color: #312e81;">تنبيه طلب جديد في قسم: ${newReq.category}</h2>
        <p><strong>المنتج المطلوب:</strong> ${newReq.title}</p>
        <p><strong>الميزانية المقترحة:</strong> ${newReq.budgetMin} - ${newReq.budgetMax} د.أ</p>
        <p><strong>المحافظة:</strong> ${newReq.customerCity}</p>
        <p><strong>التفاصيل:</strong> ${newReq.notes || 'لا توجد تفاصيل'}</p>
        ${newReq.image ? `<p><img src="${newReq.image}" style="max-width:250px; border-radius:8px;" /></p>` : ''}
      </div>
    `;
    sendRealEmailIfConfigured(u.email, `طلب جديد في قسم ${newReq.category}: ${newReq.title}`, emailHtml);
  }

  saveDB(db);
  res.json({ success: true, id: newReq.id });
});

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

    db.notifications.unshift({
      id: Date.now(),
      userId: offer.merchantId,
      type: 'offer_accepted',
      title: 'تهانينا! تم اعتماد عرضك 🎉',
      text: `قام العميل ${request.customerName} باختيارك واعتماد عرضك على طلبه [${request.title}]${companyDelivery ? ` مع طلب توصيل عبر ${deliveryCompany}` : ''}`,
      time: getJordanTimeStr()
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
      type: 'new_offer',
      title: 'عرض سعر جديد!',
      text: `قدم ${merchantName} عرضاً بقيمة ${price} د.أ على طلبك [${request.title}]`,
      time: getJordanTimeStr()
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
  res.json(db.messages.filter(m => m.fromName === userName || m.toName === userName));
});

app.post('/api/messages', (req, res) => {
  const db = getDB();
  const { fromUserId, fromName, toUserId, toName, text } = req.body;
  const time = getJordanTimeStr();

  const newMsg = { id: Date.now(), fromUserId, fromName, toUserId, toName, text, time };
  db.messages.push(newMsg);

  if (toUserId) {
    db.notifications.unshift({
      id: Date.now() + 2,
      userId: toUserId,
      type: 'new_message',
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

// ---------------- API الإدارة والأرشيف ----------------
app.get('/api/admin/deleted-requests', (req, res) => {
  res.json(getDB().requests.filter(r => r.isDeleted === 1));
});

app.post('/api/admin/soft-delete', (req, res) => {
  const db = getDB();
  const reqItem = db.requests.find(r => r.id === req.body.requestId);
  if (reqItem) reqItem.isDeleted = 1;
  saveDB(db);
  res.json({ success: true });
});

app.post('/api/admin/restore-request', (req, res) => {
  const db = getDB();
  const reqItem = db.requests.find(r => r.id === req.body.requestId);
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
  res.json(getDB().messages);
});

app.post('/api/admin/archive-message', (req, res) => {
  const db = getDB();
  const idx = db.messages.findIndex(m => m.id === req.body.messageId);
  if (idx !== -1) {
    const [archived] = db.messages.splice(idx, 1);
    db.archivedMessages.unshift(archived);
    saveDB(db);
  }
  res.json({ success: true });
});

app.get('/api/admin/archived-messages', (req, res) => {
  res.json(getDB().archivedMessages || []);
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
