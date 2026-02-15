const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const PdfPrinter = require('pdfmake');

// إعدادات العميل
const client = new Client({ 
    authStrategy: new LocalAuth({ clientId: "whatsapp-bot" }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// متغيرات الحالة والبيانات
const userState = new Map();
const groupsMetadata = new Map();
const blacklist = new Set();
const admins = new Set(['212715104027@c.us']);
const ONLINESIM_API_KEY = process.env.ONLINESIM_API_KEY || 'ضع_مفتاح_API_الخاص_بك_هنا';

const OWNER_ID = '212621957775@c.us';
const SIGNATURE = "\n👨‍💻 *dev by: IRIZI 😊*";

// --- دالة التواصل مع OnlineSim API ---
async function fetchOnlineSim(endpoint, params = {}) {
    const urlParams = new URLSearchParams({ apikey: ONLINESIM_API_KEY, ...params });
    const response = await fetch(`https://onlinesim.io/api/${endpoint}.php?${urlParams}`);
    return await response.json();
}

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('[✅] Bot is ready!');
});

client.on('message_create', async message => {
    try {
        const userId = message.from.includes('@g.us') ? message.author : message.from;
        const content = message.body ? message.body.trim() : '';
        const isGroupMessage = message.from.includes('@g.us');
        const replyTo = isGroupMessage ? message.from : userId;

        // أمر طلب رقم جديد
        if (content === '!رقم' || content === '!onlinesim') {
            await message.react('📱');
            await client.sendMessage(replyTo, `
📱 *طلب رقم من OnlineSim*
مرحباً ${message._data.notifyName}! 
اختر الخدمة المطلوبة:
1. WhatsApp
2. Telegram
3. Google (Gmail)
4. Facebook

💡 أرسل رقم الخيار أو *إلغاء* للخروج${SIGNATURE}`);
            userState.set(userId, { step: 'onlinesim_select_service' });
            return;
        }

        // معالجة خطوات الطلب
        if (userState.has(userId)) {
            const state = userState.get(userId);

            if (content === 'إلغاء') {
                userState.delete(userId);
                await message.reply('✅ تم إلغاء العملية.');
                return;
            }

            if (state.step === 'onlinesim_select_service') {
                const services = { '1': 'whatsapp', '2': 'telegram', '3': 'google', '4': 'facebook' };
                const service = services[content];

                if (!service) {
                    await message.reply('⚠️ خيار غير صحيح، اختر من 1 إلى 4.');
                    return;
                }

                await message.reply(`⏳ جاري طلب رقم لخدمة ${service.toUpperCase()}...`);
                
                try {
                    // طلب شراء رقم (الدولة الافتراضية هنا هي روسيا 7، يمكنك تغييرها)
                    const order = await fetchOnlineSim('getNum', { service: service, country: 7 });

                    if (order.response === '1' || order.tzid) {
                        state.tzid = order.tzid;
                        state.step = 'onlinesim_waiting_sms';
                        userState.set(userId, state);

                        await client.sendMessage(replyTo, `
✅ *تم حجز الرقم بنجاح!*
📱 الرقم: \`+${order.number}\`
🆔 رقم الطلب: ${order.tzid}

الآن قم بإدخال الرقم في التطبيق، وأرسل كلمة *كود* هنا لاستلام رمز التحقق.${SIGNATURE}`);
                    } else {
                        await message.reply(`❌ فشل الطلب: ${order.response || 'لا يوجد رصيد أو الخدمة غير متوفرة'}`);
                        userState.delete(userId);
                    }
                } catch (e) {
                    await message.reply('❌ حدث خطأ في الاتصال بالموقع.');
                    userState.delete(userId);
                }
                return;
            }

            if (state.step === 'onlinesim_waiting_sms' && content === 'كود') {
                await message.react('📩');
                try {
                    const check = await fetchOnlineSim('getState', { tzid: state.tzid });

                    if (check[0] && check[0].msg) {
                        await client.sendMessage(replyTo, `
✅ *وصل رمز التحقق!*
💬 الكود: *${check[0].msg}*
🔢 الرقم: +${check[0].number}

شكراً لاستخدامك خدماتنا!${SIGNATURE}`);
                        userState.delete(userId);
                    } else {
                        await message.reply('⏳ لم يصل الكود بعد... انتظر قليلاً ثم أرسل *كود* مرة أخرى.');
                    }
                } catch (e) {
                    await message.reply('❌ حدث خطأ أثناء فحص الكود.');
                }
                return;
            }
        }

        // ... (باقي أوامر البوت الأصلية التي كانت في الملف) ...
        
    } catch (error) {
        console.error('[❌] Error:', error);
    }
});

client.initialize();
