# Masroofi API

سيرفر خلفي بسيط (Node.js + Express) يطابق تماماً الحقول التي يرسلها ملف n8n بتاعك،
عشان الـ workflow يشتغل من غير أي تعديل عليه.

## التشغيل محلياً

```bash
cd masroofi-api
npm install
cp .env.example .env
# عدّل MASROOFI_API_KEY في .env لمفتاح سري خاص بيك
npm start
```

السيرفر هيشتغل على `http://localhost:3000`

## النقاط (Endpoints)

| Method | المسار | الاستخدام |
|---|---|---|
| POST | `/api/transactions` | تسجيل معاملة مؤكدة (يستخدمها node "Record in Masroofi") |
| POST | `/api/pending-transactions` | حفظ معاملة تحتاج تأكيد (يستخدمها node "Save Pending") |
| POST | `/api/pending-transactions/:id/confirm` | تأكيد يدوي لمعاملة معلّقة لاحقاً |
| GET | `/api/accounts` | عرض كل الحسابات وأرصدتها |
| GET | `/api/transactions` | عرض آخر المعاملات |
| GET | `/api/pending-transactions` | عرض المعاملات المعلّقة |
| GET | `/health` | فحص إن السيرفر شغال |

كل الطلبات (ما عدا `/health`) لازم تحمل الهيدر:
```
Authorization: Bearer <MASROOFI_API_KEY>
```

## التخزين

البيانات بتتخزن في ملف `data.json` جنب السيرفر — بسيط ومباشر، يكفي للبداية.
لو عايز قاعدة بيانات حقيقية لاحقاً (لما يكبر الاستخدام) قول لي وأحوّلها لـ SQLite أو Postgres.

## الربط مع n8n

في n8n، ضيف/عدّل متغيرات البيئة دي:

```
MASROOFI_API_URL=https://your-domain.com/api/transactions
MASROOFI_API_KEY=نفس-المفتاح-اللي-حطيته-في-.env
```

ملاحظة: الـ workflow بيستخدم نفس `MASROOFI_API_URL` لكن يستبدل الجزء الأخير من المسار
(`/api/transactions` أو `/api/pending-transactions`) حسب الحاجة — تأكد إنه بيتبني صح،
أو ببساطة خليه ثابت على الدومين فقط وعدّل الـ URL في كل node يدوياً ليطابق المسار الصحيح.

## النشر (Deployment)

أسهل الخيارات لمشروع زي ده:
- **Railway** أو **Render**: ارفع المجلد كـ Git repo، حدد `npm start`، وضيف متغيرات البيئة من لوحة التحكم — مجاني للبداية.
- **VPS بسيط** (DigitalOcean/Hetzner): شغّل بـ `pm2` أو `systemd` عشان يفضل شغال بعد إعادة التشغيل.

## الفجوات المتبقية في الـ workflow نفسه (مش في هذا الـ API)

- **Webhook Verification**: واتساب بيطلب GET request للتحقق (`hub.verify_token`) قبل قبول أي POST — لازم تضيف node منفصل في n8n للتعامل مع ده.
- **متابعة رد المستخدم على "تحتاج تأكيد"**: حالياً لو المستخدم رد بتصحيح، هيدخل كرسالة جديدة عادية مش مربوط بالمعاملة المعلّقة. أضفت endpoint `/confirm` جاهز، لكن يحتاج node إضافي في n8n يربط الرد الجديد بالـ `pending_id`.
- **الرسايل الصوتية/الصور**: الكود الحالي بياخد نص فقط.
