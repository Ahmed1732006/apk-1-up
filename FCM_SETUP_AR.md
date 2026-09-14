# إعداد إشعارات IN THE VOID — Firebase FCM

## مهم
لا تضع ملف Firebase Admin SDK / Service Account داخل APK أو داخل مجلد الموقع.
ملف `google-services.json` الخاص بتطبيق Android مختلف عن Service Account ويُستخدم فقط لإعداد Firebase داخل مشروع Android.

## 1) قاعدة البيانات
نفّذ مرة واحدة في Supabase SQL Editor:

```sql
-- الملف: SQL_DEVICE_PUSH_TOKENS.sql
```

## 2) Secret الخاص بالسيرفر
ضع محتوى Service Account JSON في Secret باسم:

`FCM_SERVICE_ACCOUNT`

مثال باستخدام Supabase CLI:

```bash
supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
supabase functions deploy send-push
```

لا ترفع `service-account.json` إلى GitHub.

## 3) ماذا يفعل `send-push`؟
- `all`: يرسل إلى FCM topic باسم `all_users`.
- `selected`: يقرأ device tokens للمستخدمين المحددين ويرسل لهم فقط.
- `excluded`: يرسل لكل الأجهزة المسجلة ما عدا المستخدمين المستبعدين.
- يحذف الـtokens التي تُبلغ Firebase بأنها غير صالحة.

الطلب القادم من لوحة الإدارة يجب أن يحمل Authorization لمستخدم أدمن؛ الدالة تتحقق من دور المستخدم قبل الإرسال.
