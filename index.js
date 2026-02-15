const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const fetch = require('node-fetch');

// إعدادات العميل
const client = new Client({ 
    authStrategy: new LocalAuth({ clientId: "whatsapp-bot" }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const userState = new Map();
const ONLINESIM_API_KEY = process.env.ONLINESIM_API_KEY;
const SIGNATURE = "\n👨‍💻 *dev by: IRIZI 😊*";

// قائمة ببعض الدول الشائعة المتاحة في OnlineSim (يمكنك توسيعها)
const availableCountries = [
    { id: '7', name: 'روسيا 🇷🇺' },
    { id: '380', name: 'أوكرانيا 🇺🇦' },
    { id: '77', name: 'كازاخستان 🇰🇿' },
    { id: '44', name: 'المملكة المتحدة 🇬🇧' },
    { id: '48', name: 'بولندا 🇵🇱' },
    { id: '49', name: 'ألمانيا 🇩🇪' },
    { id: '33', name: 'فرنسا 🇫🇷' },
    { id: '1', name: 'أمريكا/كندا 🇺🇸🇨🇦' }
];

async function fetchOnlineSim(endpoint, params = {}) {
    const urlParams = new URLSearchParams({ apikey: ONLINESIM_API_KEY, ...params });
    const response = await fetch(`https://onlinesim.io/api/${endpoint}.php?${urlParams}`);
    return await response.json();
}

client.on('message_create', async message => {
    const userId = message.from.includes('@g.us') ? message.author : message.from;
    const content = message.body ? message.body.trim() : '';
    const replyTo = message.from;

    // 1. بداية طلب الرقم: عرض قائمة الدول
    if (content === '!رقم') {
        let countryList = "🌍 *اختر الدولة المطلوبة:*\n\n";
        availableCountries.forEach((country, index) => {
            countryList += `${index + 1}. ${country.name}\n`;
        });
        countryList += `\n💡 أرسل رقم الخيار أو *إلغاء*${SIGNATURE}`;
        
        await client.sendMessage(replyTo, countryList);
        userState.set(userId, { step: 'select_country' });
        return;
    }

    if (userState.has(userId)) {
        const state = userState.get(userId);

        if (content === 'إلغاء') {
            userState.delete(userId);
            await message.reply('✅ تم إلغاء العملية.');
            return;
        }

        // 2. معالجة اختيار الدولة وعرض الخدمات
        if (state.step === 'select_country') {
            const index = parseInt(content) - 1;
            if (isNaN(index) || !availableCountries[index]) {
                await message.reply('⚠️ خيار غير صحيح، يرجى اختيار رقم من القائمة.');
                return;
            }

            state.countryId = availableCountries[index].id;
            state.countryName = availableCountries[index].name;
            state.step = 'select_service';
            userState.set(userId, state);

            await client.sendMessage(replyTo, `
🌍 الدولة: ${state.countryName}
*اختر الخدمة المطلوبة:*
1. WhatsApp
2. Telegram
3. Google
4. Facebook

💡 أرسل رقم الخيار أو *إلغاء*${SIGNATURE}`);
            return;
        }

        // 3. معالجة اختيار الخدمة وطلب الرقم
        if (state.step === 'select_service') {
            const services = { '1': 'whatsapp', '2': 'telegram', '3': 'google', '4': 'facebook' };
            const service = services[content];

            if (!service) {
                await message.reply('⚠️ خيار غير صحيح.');
                return;
            }

            await message.reply(`⏳ جاري طلب رقم ${service.toUpperCase()} من ${state.countryName}...`);
            
            try {
                const order = await fetchOnlineSim('getNum', { service: service, country: state.countryId });

                if (order.response === '1' || order.tzid) {
                    state.tzid = order.tzid;
                    state.step = 'waiting_sms';
                    userState.set(userId, state);

                    await client.sendMessage(replyTo, `
✅ *تم حجز الرقم بنجاح!*
📱 الرقم: \`+${order.number}\`
🆔 الطلب: ${order.tzid}

أدخل الرقم في التطبيق، ثم أرسل كلمة *كود* لاستلام الرمز.${SIGNATURE}`);
                } else {
                    await message.reply(`❌ فشل: ${order.response || 'الأرقام غير متوفرة لهذه الدولة حالياً'}`);
                    userState.delete(userId);
                }
            } catch (e) {
                await message.reply('❌ خطأ في الاتصال بمزود الخدمة.');
                userState.delete(userId);
            }
            return;
        }

        // 4. فحص الكود
        if (state.step === 'waiting_sms' && content === 'كود') {
            const check = await fetchOnlineSim('getState', { tzid: state.tzid });
            if (check[0] && check[0].msg) {
                await client.sendMessage(replyTo, `✅ كود التحقق: *${check[0].msg}*${SIGNATURE}`);
                userState.delete(userId);
            } else {
                await message.reply('⏳ لم يصل الكود بعد، انتظر دقيقة ثم أرسل *كود* ثانية.');
            }
            return;
        }
    }
});

client.initialize();
