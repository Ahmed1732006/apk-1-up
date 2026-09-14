# IN THE VOID — Android APK

## الهوية
- Application ID ثابت: `com.inthevoid.platform`
- الإصدار الجديد: `1.1.0`
- النسخة الحالية المرفقة في المشروع كانت `versionCode 1`؛ أول build معدل يستخدم `versionCode 2` (وفي GitHub Actions يتم اشتقاق رقم أعلى من رقم تشغيل الـworkflow).

## ما تم إصلاحه
- أيقونة IN THE VOID الجديدة هي مصدر launcher/adaptive/splash assets.
- إزالة اعتماد شاشة البداية القديمة ذات شعار Capacitor الأزرق؛ إعداد SplashScreen جديد وهوية التطبيق الجديدة.
- Firebase Cloud Messaging مع قناة إشعارات باسم IN THE VOID.
- طلب `POST_NOTIFICATIONS` على Android الحديث، مع عدم إعادة الطلب في كل تشغيل بعد الرفض.
- حفظ device tokens في `device_push_tokens`.
- Push broadcast عبر topic `all_users`، ودعم selected/excluded عبر tokens في Edge Function.
- الضغط على الإشعار يفتح التطبيق والإشعار/المحتوى المرتبط به.
- Back داخل التطبيق أصبح يعتمد على history خاص بالـSPA؛ من الصفحة الرئيسية يحتاج ضغطتين متتاليتين للخروج.
- Offline boot يعتمد على cache محلي للبيانات التي سبق تحميلها، مع مزامنة تلقائية عند عودة الإنترنت.
- الملفات المحملة سابقًا تبقى في IndexedDB وتُفتح بدون إنترنت.
- فشل الشبكة لا يعرض HTML source ولا صفحة `تعذر تحميل المنصة`.
- كل مكتبات الويب الأساسية المستخدمة وقت التشغيل موجودة محليًا داخل `vendor/`.

## البناء على GitHub
1. ارفع محتويات المشروع إلى GitHub.
2. افتح Actions ثم `Build IN THE VOID APK`.
3. شغّل workflow.
4. نزّل Artifact باسم `IN_THE_VOID-APK`.

الـworkflow يقوم تلقائيًا بـ:
- تثبيت Node dependencies.
- تجهيز web bundle Offline.
- إنشاء مشروع Capacitor Android.
- توليد assets الخاصة بالأيقونة والـSplash.
- تطبيق Android/Firebase/version fixes.
- `npx cap sync android`.
- بناء `assembleDebug`.
- رفع APK كـArtifact.

## Firebase / Supabase Push
نفّذ مرة واحدة:

`SQL_DEVICE_PUSH_TOKENS.sql`

ثم خزّن Firebase Admin Service Account في Supabase Edge Function Secret باسم:

`FCM_SERVICE_ACCOUNT`

وبعدها:

```bash
supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"
supabase functions deploy send-push
```

**لا تضع Service Account JSON داخل المشروع أو APK أو GitHub.**

## ملاحظة مهمة جدًا عن التحديث فوق الـAPK القديم
تم فحص الـAPK القديم المرفق: `Application ID = com.inthevoid.platform` و`versionCode = 1`، لكن شهادة توقيعه SHA-1 هي:

`87:EA:ED:F1:92:01:78:A0:DA:94:C4:92:A4:4A:85:5A:5F:9E:2B:2B`

أما `android-debug.keystore` الموجود مع المشروع فله شهادة مختلفة. لذلك **لا يمكن ضمان تثبيت الـAPK الجديد فوق الـAPK القديم كـUpdate إلا إذا كان مفتاح التوقيع الخاص بالـAPK القديم متوفرًا**.

رفع `versionCode` وحده لا يحل اختلاف التوقيع. إذا كان الـAPK القديم منشورًا بمفتاح Release/Upload حقيقي، يجب استخدام نفس المفتاح في البناء الجديد.
