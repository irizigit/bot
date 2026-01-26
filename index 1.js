const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch'); // تأكد من تثبيت node-fetch@2 إذا كنت تستخدم CommonJS

// --- إعدادات الحماية من الأخطاء ---
// هذا الأمر يمنع توقف البوت عند حدوث أخطاء بسيطة غير متوقعة
process.on('uncaughtException', (err) => {
    console.error('[⚠️] Uncaught Exception:', err.message);
    // لا تقم بعمل process.exit() هنا لتجنب إغلاق البوت
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[⚠️] Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- إعداد العميل ---
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "whatsapp-bot",
        dataPath: "./.wwebjs_auth" // تحديد مسار واضح للجلسة
    }),
    puppeteer: {
        headless: true, // تشغيل بدون واجهة رسومية
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // مهم لنظام ويندوز لتقليل العمليات
            '--disable-gpu'
        ]
    }
});

// متغيرات الحالة
let isReady = false;

// --- الأحداث (Events) ---

client.on('qr', (qr) => {
    console.log('[📱] امسح كود QR للدخول:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    if (isReady) return; // حماية من التكرار
    isReady = true;
    console.log('------------------------------------------------');
    console.log('[✅] البوت جاهز ويعمل الآن بنجاح!');
    console.log('------------------------------------------------');
});

client.on('authenticated', () => {
    console.log('[🔐] تم المصادقة بنجاح');
});

client.on('auth_failure', msg => {
    console.error('[❌] فشل المصادقة:', msg);
});

// معالجة الانفصال بشكل صحيح لتجنب قفل الملفات
client.on('disconnected', async (reason) => {
    console.log('[⚠️] تم قطع الاتصال:', reason);
    isReady = false;
    
    // محاولة إعادة التشغيل أو الخروج النظيف
    try {
        await client.destroy();
    } catch (error) {
        // نتجاهل الخطأ هنا لأننا نغلق البوت على أي حال
        console.log('[ℹ️] Client destroy error ignored.'); 
    }
    
    // إنهاء العملية بالكامل للسماح للنظام بتحرير الملفات
    // (استخدم أداة مثل PM2 لإعادة تشغيل البوت تلقائياً إذا توقف)
    process.exit(0); 
});

// --- معالجة الرسائل (مثال بسيط) ---
client.on('message_create', async (message) => {
    if (!isReady) return;
    
    try {
        const body = message.body.toLowerCase();
        
        if (body === '!ping') {
            await message.reply('pong! 🏓');
        }
        
        // أضف بقية أوامرك هنا...

    } catch (error) {
        console.error('[❌] خطأ في معالجة الرسالة:', error);
    }
});

// --- تشغيل العميل ---
console.log('[⏳] جاري تهيئة البوت...');
client.initialize().catch(err => {
    console.error('[❌] فشل تشغيل البوت:', err.message);
});