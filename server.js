const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const DB_FILE = path.join(__dirname, 'data.json');
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.MASROOFI_API_KEY || 'change-me-please';
const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || 'SDG';

// ---------- تخزين بسيط في ملف JSON ----------
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { accounts: {}, transactions: [], pendingTransactions: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function normalizeAccountName(name) {
  return String(name || '').trim();
}

function getOrCreateAccount(db, name) {
  const key = normalizeAccountName(name);
  if (!key) return null;
  if (!db.accounts[key]) {
    db.accounts[key] = { name: key, balance: 0, currency: DEFAULT_CURRENCY };
  }
  return db.accounts[key];
}

// ---------- المصادقة (Bearer token بسيط) ----------
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || token !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

app.use(requireAuth);

// ---------- تسجيل معاملة مؤكدة ----------
// يطابق ما يرسله node "Record in Masroofi" في n8n
app.post('/api/transactions', (req, res) => {
  const {
    whatsapp_message_id,
    phone,
    type,
    amount,
    currency,
    account,
    recipient,
    sender,
    description,
    timestamp,
    source,
    confidence
  } = req.body || {};

  const validTypes = ['expense', 'income', 'transfer'];
  const numericAmount = Number(amount);

  if (!validTypes.includes(type) || !Number.isFinite(numericAmount) || numericAmount <= 0 || !account) {
    return res.status(400).json({
      ok: false,
      error: 'بيانات غير مكتملة أو غير صحيحة (type / amount / account)'
    });
  }

  const db = readDB();
  const acc = getOrCreateAccount(db, account);
  acc.currency = currency || acc.currency;

  if (type === 'expense') {
    acc.balance -= numericAmount;
  } else if (type === 'income') {
    acc.balance += numericAmount;
  } else if (type === 'transfer') {
    acc.balance -= numericAmount;
    if (recipient) {
      const destAcc = getOrCreateAccount(db, recipient);
      destAcc.balance += numericAmount;
    }
  }

  const record = {
    id: db.transactions.length + 1,
    whatsapp_message_id: whatsapp_message_id || null,
    phone: phone || null,
    type,
    amount: numericAmount,
    currency: acc.currency,
    account: acc.name,
    recipient: recipient || null,
    sender: sender || null,
    description: description || '',
    timestamp: timestamp || null,
    source: source || 'whatsapp',
    confidence: confidence ?? null,
    status: 'confirmed',
    created_at: new Date().toISOString()
  };
  db.transactions.push(record);
  writeDB(db);

  const typeLabel = { expense: 'مصروف', income: 'دخل', transfer: 'تحويل' }[type];
  res.json({
    ok: true,
    message: `✅ تم تسجيل ${typeLabel} بمبلغ ${numericAmount} ${acc.currency} على حساب ${acc.name}`,
    new_balance: acc.balance,
    account: acc.name,
    amount: numericAmount
  });
});

// ---------- حفظ معاملة معلّقة (تحتاج تأكيد) ----------
// يطابق ما يرسله node "Save Pending" في n8n، ويرجّع الحقول
// التي يحتاجها node "WhatsApp Ask Confirmation" بعده مباشرة
app.post('/api/pending-transactions', (req, res) => {
  const {
    whatsapp_message_id,
    phone,
    original_text,
    type,
    amount,
    currency,
    account,
    description,
    confidence
  } = req.body || {};

  const db = readDB();
  const record = {
    id: db.pendingTransactions.length + 1,
    whatsapp_message_id: whatsapp_message_id || null,
    phone: phone || null,
    original_text: original_text || '',
    transaction_type: type || 'unknown',
    amount: amount ?? null,
    currency: currency || DEFAULT_CURRENCY,
    account: account || null,
    description: description || '',
    confidence: confidence ?? null,
    status: 'pending',
    created_at: new Date().toISOString()
  };
  db.pendingTransactions.push(record);
  writeDB(db);

  // نرجّع نفس الحقول التي يقرأها node "WhatsApp Ask Confirmation"
  res.json({
    ok: true,
    pending_id: record.id,
    transaction_type: record.transaction_type,
    amount: record.amount,
    account: record.account
  });
});

// ---------- نقاط عرض مساعدة (للتحقق والمتابعة) ----------
app.get('/api/accounts', (req, res) => {
  const db = readDB();
  res.json({ ok: true, accounts: Object.values(db.accounts) });
});

app.get('/api/transactions', (req, res) => {
  const db = readDB();
  const limit = Number(req.query.limit) || 50;
  res.json({ ok: true, transactions: db.transactions.slice(-limit).reverse() });
});

app.get('/api/pending-transactions', (req, res) => {
  const db = readDB();
  res.json({ ok: true, pending: db.pendingTransactions.filter(p => p.status === 'pending') });
});

// تأكيد يدوي لمعاملة معلّقة (مفيد لاحقاً لو ضفت خطوة في n8n تستقبل رد المستخدم)
app.post('/api/pending-transactions/:id/confirm', (req, res) => {
  const db = readDB();
  const id = Number(req.params.id);
  const pending = db.pendingTransactions.find(p => p.id === id);
  if (!pending) return res.status(404).json({ ok: false, error: 'not found' });

  const { account, type, amount } = req.body || {};
  const finalAccount = account || pending.account;
  const finalType = type || pending.transaction_type;
  const finalAmount = Number(amount ?? pending.amount);

  if (!finalAccount || !['expense', 'income', 'transfer'].includes(finalType) || !Number.isFinite(finalAmount)) {
    return res.status(400).json({ ok: false, error: 'بيانات غير كافية لإكمال التأكيد' });
  }

  const acc = getOrCreateAccount(db, finalAccount);
  if (finalType === 'expense') acc.balance -= finalAmount;
  if (finalType === 'income') acc.balance += finalAmount;

  pending.status = 'confirmed';
  db.transactions.push({
    id: db.transactions.length + 1,
    whatsapp_message_id: pending.whatsapp_message_id,
    phone: pending.phone,
    type: finalType,
    amount: finalAmount,
    currency: pending.currency,
    account: acc.name,
    recipient: null,
    sender: null,
    description: pending.description,
    timestamp: null,
    source: 'whatsapp-confirmed',
    confidence: pending.confidence,
    status: 'confirmed',
    created_at: new Date().toISOString()
  });
  writeDB(db);

  res.json({ ok: true, new_balance: acc.balance, account: acc.name });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Masroofi API شغال على المنفذ ${PORT}`);
});
